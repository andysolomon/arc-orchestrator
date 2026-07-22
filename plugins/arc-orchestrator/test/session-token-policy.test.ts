import { describe, expect, test } from "bun:test";
import {
  createSessionTokenTracker,
  DEFAULT_SESSION_ROTATION_THRESHOLDS,
  resolveSessionTokenPolicy,
  SESSION_TOKEN_DEFAULT_MAX_SESSION_TOKENS,
  SESSION_TOKEN_DEFAULT_WINDOW_MS,
  SESSION_TOKEN_POLICY_ENV,
  sessionTokenPolicyMode,
  shouldRotate,
  type SessionTokenSnapshot,
} from "../lib/session-token-policy";
import {
  ROLLOUT_SESSION_TOKEN_POLICY_ENV,
  resolveSessionTokenPolicyStage,
} from "../lib/rollout-gates";

const exceededSnapshot: SessionTokenSnapshot = {
  sessionLabel: "job",
  knownLowerBound: SESSION_TOKEN_DEFAULT_MAX_SESSION_TOKENS + 1,
  completeness: "complete",
};

describe("session-token-policy: resolveSessionTokenPolicy", () => {
  test("unset, empty, and garbage values default to off", () => {
    expect(resolveSessionTokenPolicy({}).mode).toBe("off");
    expect(
      resolveSessionTokenPolicy({ [SESSION_TOKEN_POLICY_ENV]: "" }).mode,
    ).toBe("off");
    expect(
      resolveSessionTokenPolicy({ [SESSION_TOKEN_POLICY_ENV]: "garbage" }).mode,
    ).toBe("off");
  });

  test("shadow and active are recognized case-insensitively", () => {
    expect(
      resolveSessionTokenPolicy({ [SESSION_TOKEN_POLICY_ENV]: "shadow" }).mode,
    ).toBe("shadow");
    expect(
      resolveSessionTokenPolicy({ [SESSION_TOKEN_POLICY_ENV]: " ACTIVE " })
        .mode,
    ).toBe("active");
    expect(sessionTokenPolicyMode({ [SESSION_TOKEN_POLICY_ENV]: "Shadow" }))
      .toBe("shadow");
  });
});

describe("rollout-gates: resolveSessionTokenPolicyStage", () => {
  test("reads ARC_ORCHESTRATOR_SESSION_TOKEN_POLICY and defaults to off", () => {
    expect(ROLLOUT_SESSION_TOKEN_POLICY_ENV).toBe(
      "ARC_ORCHESTRATOR_SESSION_TOKEN_POLICY",
    );
    expect(resolveSessionTokenPolicyStage({})).toBe("off");
    expect(
      resolveSessionTokenPolicyStage({
        ARC_ORCHESTRATOR_SESSION_TOKEN_POLICY: "shadow",
      }),
    ).toBe("shadow");
    expect(
      resolveSessionTokenPolicyStage({
        ARC_ORCHESTRATOR_SESSION_TOKEN_POLICY: "active",
      }),
    ).toBe("active");
  });
});

describe("session-token-policy: off policy is a byte-identical no-op", () => {
  // Byte-identity pin for the engine call site: under off policy the engine
  // constructs no tracker (resolveSessionTokenPolicy(env).mode === "off") and
  // shouldRotate never yields evidence, so no session_token_exceeded key is
  // ever attached and every existing trace serializes unchanged.
  test("off policy never rotates, never marks exceeded, never yields evidence", () => {
    const policy = resolveSessionTokenPolicy({});
    expect(policy.mode).toBe("off");
    const decision = shouldRotate(exceededSnapshot, policy);
    expect(decision).toEqual({ rotate: false, exceeded: false, evidence: null });

    // The engine attaches evidence only when decision.evidence is non-null, so
    // an off-policy trace stays byte-for-byte identical after the call site.
    const trace: Record<string, unknown> = { run_id: "run-1", tokens: null };
    const before = JSON.stringify(trace);
    if (decision.evidence) {
      trace.session_token_exceeded = decision.evidence;
    }
    expect(JSON.stringify(trace)).toBe(before);
  });
});

describe("session-token-policy: shadow evidence", () => {
  test("shadow records session_token_exceeded evidence but never rotates", () => {
    const policy = resolveSessionTokenPolicy({
      [SESSION_TOKEN_POLICY_ENV]: "shadow",
    });
    const decision = shouldRotate(exceededSnapshot, policy);
    expect(decision.exceeded).toBe(true);
    expect(decision.rotate).toBe(false);
    expect(decision.evidence).toEqual({
      kind: "session_token_exceeded",
      schemaVersion: 1,
      mode: "shadow",
      sessionLabel: "job",
      knownLowerBound: SESSION_TOKEN_DEFAULT_MAX_SESSION_TOKENS + 1,
      completeness: "complete",
      maxSessionTokens: SESSION_TOKEN_DEFAULT_MAX_SESSION_TOKENS,
      windowMs: SESSION_TOKEN_DEFAULT_WINDOW_MS,
      rotate: false,
    });
  });

  test("shadow below threshold yields no evidence", () => {
    const policy = resolveSessionTokenPolicy({
      [SESSION_TOKEN_POLICY_ENV]: "shadow",
    });
    const decision = shouldRotate(
      { sessionLabel: "job", knownLowerBound: 10, completeness: "complete" },
      policy,
    );
    expect(decision).toEqual({ rotate: false, exceeded: false, evidence: null });
  });
});

describe("session-token-policy: active rotation trigger", () => {
  test("active marks rotate=true in the decision and the evidence record", () => {
    const policy = resolveSessionTokenPolicy({
      [SESSION_TOKEN_POLICY_ENV]: "active",
    });
    const decision = shouldRotate(exceededSnapshot, policy, {
      maxSessionTokens: 100,
      windowMs: 1_000,
    });
    expect(decision.exceeded).toBe(true);
    expect(decision.rotate).toBe(true);
    expect(decision.evidence?.kind).toBe("session_token_exceeded");
    expect(decision.evidence?.mode).toBe("active");
    expect(decision.evidence?.rotate).toBe(true);
    expect(decision.evidence?.maxSessionTokens).toBe(100);
    expect(decision.evidence?.windowMs).toBe(1_000);
  });
});

describe("session-token-policy: per-session isolation", () => {
  test("charges against one session label never leak into another", () => {
    const tracker = createSessionTokenTracker({ now: () => 1_000_000 });
    tracker.charge({ sessionLabel: "session-a", tokens: 150 });
    tracker.charge({ sessionLabel: "session-a", tokens: 50 });
    tracker.charge({ sessionLabel: "session-b", tokens: 7 });

    expect(tracker.snapshot("session-a")).toEqual({
      sessionLabel: "session-a",
      knownLowerBound: 200,
      completeness: "complete",
    });
    expect(tracker.snapshot("session-b")).toEqual({
      sessionLabel: "session-b",
      knownLowerBound: 7,
      completeness: "complete",
    });
    expect(tracker.snapshot("session-c").knownLowerBound).toBe(0);
  });
});

describe("session-token-policy: sliding window (retry-budget comparable)", () => {
  test("charges outside windowMs are pruned like the retry-budget window", () => {
    let clock = 1_000_000;
    const tracker = createSessionTokenTracker({
      windowMs: 60_000,
      now: () => clock,
    });

    tracker.charge({ sessionLabel: "job", tokens: 300 });
    clock += 30_000;
    expect(
      tracker.charge({ sessionLabel: "job", tokens: 100 }).knownLowerBound,
    ).toBe(400);

    // 61s after the first charge it leaves the window; the second remains.
    clock += 31_000;
    expect(tracker.snapshot("job").knownLowerBound).toBe(100);

    // After the whole window drains the label is back to an empty snapshot.
    clock += 60_001;
    expect(tracker.snapshot("job")).toEqual({
      sessionLabel: "job",
      knownLowerBound: 0,
      completeness: "unknown",
    });
  });

  test("unknown-usage charges downgrade completeness to lower-bound", () => {
    const tracker = createSessionTokenTracker({ now: () => 1_000_000 });
    tracker.charge({ sessionLabel: "job", tokens: 42 });
    const snapshot = tracker.charge({ sessionLabel: "job", tokens: null });
    expect(snapshot).toEqual({
      sessionLabel: "job",
      knownLowerBound: 42,
      completeness: "lower-bound",
    });
  });
});

describe("session-token-policy: threshold boundary edges", () => {
  const active = resolveSessionTokenPolicy({
    [SESSION_TOKEN_POLICY_ENV]: "active",
  });
  const thresholds = { maxSessionTokens: 1_000, windowMs: 60_000 };

  test("exactly at the threshold is not exceeded", () => {
    const decision = shouldRotate(
      { sessionLabel: "job", knownLowerBound: 1_000, completeness: "complete" },
      active,
      thresholds,
    );
    expect(decision).toEqual({ rotate: false, exceeded: false, evidence: null });
  });

  test("one token past the threshold rotates under active", () => {
    const decision = shouldRotate(
      { sessionLabel: "job", knownLowerBound: 1_001, completeness: "complete" },
      active,
      thresholds,
    );
    expect(decision.rotate).toBe(true);
    expect(decision.exceeded).toBe(true);
    expect(decision.evidence?.knownLowerBound).toBe(1_001);
  });

  test("zero lower bound (all-unknown usage) never exceeds", () => {
    const decision = shouldRotate(
      { sessionLabel: "job", knownLowerBound: 0, completeness: "unknown" },
      active,
      { maxSessionTokens: 0, windowMs: 60_000 },
    );
    expect(decision.exceeded).toBe(false);
    expect(decision.rotate).toBe(false);
  });

  test("defaults export matches the documented rotation thresholds", () => {
    expect(DEFAULT_SESSION_ROTATION_THRESHOLDS).toEqual({
      maxSessionTokens: SESSION_TOKEN_DEFAULT_MAX_SESSION_TOKENS,
      windowMs: SESSION_TOKEN_DEFAULT_WINDOW_MS,
    });
    expect(SESSION_TOKEN_DEFAULT_MAX_SESSION_TOKENS).toBe(400_000);
    expect(SESSION_TOKEN_DEFAULT_WINDOW_MS).toBe(3_600_000);
  });
});
