// Session-rotation token policy for canonical selection (W-000225 slice A).
//
// Tracks cumulative token consumption per session label inside a sliding
// window (same shape as the W-000223 retry budget) and decides whether the
// session has exceeded its rotation threshold. This slice is evidence-only:
// active policy marks the decision and emits a session_token_exceeded
// evidence record on the trace, but nothing rotates a session today —
// arc-session-compact and arc-session-resume are out of scope.
//
// Policy is selected by ARC_ORCHESTRATOR_SESSION_TOKEN_POLICY:
//   - off    (default): the engine never constructs/threads a tracker, so
//            execution is byte-for-byte unchanged for every existing caller.
//   - shadow: token consumption is tracked and exceeded evidence recorded,
//            but rotate is never signalled.
//   - active: exceeded sessions are marked rotate=true in the decision and
//            the evidence record; callers still take no action in this slice.

import type { EnvLike } from "./routes";

export const SESSION_TOKEN_POLICY_SCHEMA_VERSION = 1;

export const SESSION_TOKEN_POLICY_ENV = "ARC_ORCHESTRATOR_SESSION_TOKEN_POLICY";

export const SESSION_TOKEN_DEFAULT_WINDOW_MS = 3_600_000;
export const SESSION_TOKEN_DEFAULT_MAX_SESSION_TOKENS = 400_000;

export type SessionTokenPolicyMode = "off" | "shadow" | "active";

export type SessionTokenPolicy = {
  schemaVersion: typeof SESSION_TOKEN_POLICY_SCHEMA_VERSION;
  mode: SessionTokenPolicyMode;
};

export function sessionTokenPolicyMode(env: EnvLike): SessionTokenPolicyMode {
  const value = env[SESSION_TOKEN_POLICY_ENV]?.trim().toLowerCase();
  if (value === "shadow") {
    return "shadow";
  }
  if (value === "active") {
    return "active";
  }
  return "off";
}

export function resolveSessionTokenPolicy(env: EnvLike): SessionTokenPolicy {
  return {
    schemaVersion: SESSION_TOKEN_POLICY_SCHEMA_VERSION,
    mode: sessionTokenPolicyMode(env),
  };
}

// Whether the tracked lower bound reflects every attempt charged so far.
// Charging an attempt whose token usage is unknown downgrades the aggregate to
// "lower-bound": the true consumption is at least knownLowerBound.
export type SessionTokenCompleteness = "complete" | "lower-bound" | "unknown";

export type SessionTokenSnapshot = {
  // Session label the consumption is charged against; every attempt in one
  // dispatch shares it so the threshold bounds the whole session.
  sessionLabel: string;
  // Tokens known to have been consumed inside the window. A lower bound, never
  // an estimate: unknown usage contributes zero.
  knownLowerBound: number;
  completeness: SessionTokenCompleteness;
};

export type SessionRotationThresholds = {
  maxSessionTokens: number;
  windowMs: number;
};

export const DEFAULT_SESSION_ROTATION_THRESHOLDS: SessionRotationThresholds = {
  maxSessionTokens: SESSION_TOKEN_DEFAULT_MAX_SESSION_TOKENS,
  windowMs: SESSION_TOKEN_DEFAULT_WINDOW_MS,
};

export type SessionTokenExceededEvidence = {
  kind: "session_token_exceeded";
  schemaVersion: typeof SESSION_TOKEN_POLICY_SCHEMA_VERSION;
  mode: Exclude<SessionTokenPolicyMode, "off">;
  sessionLabel: string;
  knownLowerBound: number;
  completeness: SessionTokenCompleteness;
  maxSessionTokens: number;
  windowMs: number;
  // True only under active policy; shadow records the exceedance without
  // requesting rotation.
  rotate: boolean;
};

export type SessionRotationDecision = {
  // True only when active policy sees the threshold exceeded. This slice
  // records the decision; no caller acts on it yet.
  rotate: boolean;
  // Threshold comparison independent of enforcement (off always false).
  exceeded: boolean;
  // Present under shadow/active when exceeded; null otherwise and always null
  // under off policy.
  evidence: SessionTokenExceededEvidence | null;
};

// Pure threshold decision. Exceeded means the known lower bound is strictly
// greater than maxSessionTokens: a session sitting exactly at the threshold is
// not rotated, so the boundary itself stays usable.
export function shouldRotate(
  snapshot: SessionTokenSnapshot,
  policy: SessionTokenPolicy,
  thresholds: SessionRotationThresholds = DEFAULT_SESSION_ROTATION_THRESHOLDS,
): SessionRotationDecision {
  if (policy.mode === "off") {
    return { rotate: false, exceeded: false, evidence: null };
  }
  const exceeded = snapshot.knownLowerBound > thresholds.maxSessionTokens;
  const rotate = policy.mode === "active" && exceeded;
  if (!exceeded) {
    return { rotate: false, exceeded: false, evidence: null };
  }
  return {
    rotate,
    exceeded,
    evidence: {
      kind: "session_token_exceeded",
      schemaVersion: SESSION_TOKEN_POLICY_SCHEMA_VERSION,
      mode: policy.mode,
      sessionLabel: snapshot.sessionLabel,
      knownLowerBound: snapshot.knownLowerBound,
      completeness: snapshot.completeness,
      maxSessionTokens: thresholds.maxSessionTokens,
      windowMs: thresholds.windowMs,
      rotate,
    },
  };
}

export type SessionTokenChargeInput = {
  sessionLabel: string;
  // Tokens consumed by the attempt when known; null/undefined records an
  // attempt with unknown usage and downgrades completeness.
  tokens?: number | null;
};

export type SessionTokenTracker = {
  readonly windowMs: number;
  // Records one attempt's consumption and returns the updated in-window
  // snapshot for the label.
  charge(input: SessionTokenChargeInput): SessionTokenSnapshot;
  // In-window snapshot for the label without recording an attempt.
  snapshot(sessionLabel: string): SessionTokenSnapshot;
};

export type SessionTokenTrackerOverrides = {
  windowMs?: number;
  // Injectable clock for deterministic sliding-window tests.
  now?: () => number;
};

type SessionState = {
  charges: { at: number; tokens: number | null }[];
};

export function createSessionTokenTracker(
  overrides: SessionTokenTrackerOverrides = {},
): SessionTokenTracker {
  const windowMs = overrides.windowMs ?? SESSION_TOKEN_DEFAULT_WINDOW_MS;
  const now = overrides.now ?? (() => Date.now());
  const states = new Map<string, SessionState>();

  const stateFor = (sessionLabel: string): SessionState => {
    let state = states.get(sessionLabel);
    if (!state) {
      state = { charges: [] };
      states.set(sessionLabel, state);
    }
    return state;
  };

  const prune = (state: SessionState, at: number): void => {
    const cutoff = at - windowMs;
    state.charges = state.charges.filter((charge) => charge.at > cutoff);
  };

  const snapshotOf = (
    sessionLabel: string,
    state: SessionState | undefined,
  ): SessionTokenSnapshot => {
    if (!state || state.charges.length === 0) {
      return { sessionLabel, knownLowerBound: 0, completeness: "unknown" };
    }
    let knownLowerBound = 0;
    let sawUnknown = false;
    for (const charge of state.charges) {
      if (charge.tokens == null) {
        sawUnknown = true;
      } else {
        knownLowerBound += charge.tokens;
      }
    }
    return {
      sessionLabel,
      knownLowerBound,
      completeness: sawUnknown ? "lower-bound" : "complete",
    };
  };

  return {
    windowMs,
    snapshot(sessionLabel: string): SessionTokenSnapshot {
      const state = states.get(sessionLabel);
      if (state) {
        prune(state, now());
      }
      return snapshotOf(sessionLabel, state);
    },
    charge(input: SessionTokenChargeInput): SessionTokenSnapshot {
      const at = now();
      const state = stateFor(input.sessionLabel);
      prune(state, at);
      state.charges.push({ at, tokens: input.tokens ?? null });
      return snapshotOf(input.sessionLabel, state);
    },
  };
}
