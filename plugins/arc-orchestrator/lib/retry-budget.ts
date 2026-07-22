// Per-label retry budget for the bounded fallback traversal (W-000223).
//
// Two independent guards, both scoped to a single dispatch label:
//   1. Sliding-window attempt cap — at most `maxAttemptsPerWindow` attempts for a
//      label within `windowMs`. The (cap + 1)-th attempt inside the window is not
//      allowed; in `active` policy the traversal stops with `budget-exhausted`.
//   2. Price-band crossing guard — a label may not cross a price band twice in a
//      row without an intervening downgrade. When downgrade enforcement is on the
//      traversal records a downgrade attempt before the second crossing.
//
// Policy is selected by ARC_ORCHESTRATOR_RETRY_POLICY:
//   - shadow (default when the variable is unset, W-000225): the budget is
//            computed and its evidence recorded on attempted steps, but it
//            never blocks and never enforces a downgrade.
//   - off:   explicit opt-out — any set value other than shadow/active
//            (including empty) resolves here. The engine never threads a
//            budget, so the traversal is byte-for-byte unchanged.
//   - active: the budget blocks over-cap attempts and enforces downgrades.

import type { EnvLike } from "./routes";

export const RETRY_BUDGET_SCHEMA_VERSION = 1;

export const RETRY_BUDGET_DEFAULT_WINDOW_MS = 60_000;
export const RETRY_BUDGET_DEFAULT_MAX_ATTEMPTS = 2;

export type RetryPolicyMode = "off" | "shadow" | "active";

export function retryPolicyMode(env: EnvLike): RetryPolicyMode {
  const raw = env.ARC_ORCHESTRATOR_RETRY_POLICY;
  if (raw === undefined) {
    // W-000225: unset defaults to shadow. Set values — including empty and
    // unrecognized strings — re-anchor to off below.
    return "shadow";
  }
  const value = raw.trim().toLowerCase();
  if (value === "shadow") {
    return "shadow";
  }
  if (value === "active") {
    return "active";
  }
  return "off";
}

export type RetryChargeInput = {
  // Dispatch label the attempt is charged against. All candidates in one
  // traversal share the same label so the cap bounds the whole fallback chain.
  label: string;
  // Whether this attempt crosses a price-band boundary relative to the previous
  // attempted candidate (BoundaryCrossing.crossedPriceBand).
  crossesPriceBand?: boolean;
  // Whether the caller enforces the downgrade rule (active policy). When false
  // (shadow) the requirement is reported but no downgrade is recorded.
  enforceDowngrade?: boolean;
};

export type RetryChargeResult = {
  // active: false means the sliding-window cap was already met before this
  // attempt, so the traversal must stop. shadow/off never act on this.
  allowed: boolean;
  // Attempts remaining in the window for this label after this charge, clamped
  // at zero.
  remaining: number;
  // The label just attempted a second consecutive price-band crossing with no
  // intervening downgrade.
  downgradeRequired: boolean;
  // A downgrade was recorded for this charge (only when enforcement is on).
  downgradeAttempted: boolean;
};

export type LabelRetryBudget = {
  readonly mode: RetryPolicyMode;
  readonly windowMs: number;
  readonly maxAttemptsPerWindow: number;
  // Records one attempt for the label and evaluates both guards.
  charge(input: RetryChargeInput): RetryChargeResult;
  // In-window attempts remaining for the label without recording an attempt.
  remaining(label: string): number;
};

export type RetryBudgetOverrides = {
  mode?: RetryPolicyMode;
  windowMs?: number;
  maxAttemptsPerWindow?: number;
  // Injectable clock for deterministic sliding-window tests.
  now?: () => number;
};

type LabelState = {
  attempts: number[];
  priceBandCrossPending: boolean;
};

export function createLabelRetryBudget(
  env: EnvLike,
  overrides: RetryBudgetOverrides = {},
): LabelRetryBudget {
  const mode = overrides.mode ?? retryPolicyMode(env);
  const windowMs = overrides.windowMs ?? RETRY_BUDGET_DEFAULT_WINDOW_MS;
  const maxAttemptsPerWindow =
    overrides.maxAttemptsPerWindow ?? RETRY_BUDGET_DEFAULT_MAX_ATTEMPTS;
  const now = overrides.now ?? (() => Date.now());
  const states = new Map<string, LabelState>();

  const stateFor = (label: string): LabelState => {
    let state = states.get(label);
    if (!state) {
      state = { attempts: [], priceBandCrossPending: false };
      states.set(label, state);
    }
    return state;
  };

  const prune = (state: LabelState, at: number): void => {
    const cutoff = at - windowMs;
    state.attempts = state.attempts.filter((timestamp) => timestamp > cutoff);
  };

  return {
    mode,
    windowMs,
    maxAttemptsPerWindow,
    remaining(label: string): number {
      const state = states.get(label);
      if (!state) {
        return maxAttemptsPerWindow;
      }
      prune(state, now());
      return Math.max(0, maxAttemptsPerWindow - state.attempts.length);
    },
    charge(input: RetryChargeInput): RetryChargeResult {
      const at = now();
      const state = stateFor(input.label);
      prune(state, at);

      // Cap is evaluated against attempts already in the window; the current
      // attempt is then recorded so the window stays truthful in shadow mode.
      const allowed = state.attempts.length < maxAttemptsPerWindow;
      state.attempts.push(at);
      const remaining = Math.max(
        0,
        maxAttemptsPerWindow - state.attempts.length,
      );

      let downgradeRequired = false;
      let downgradeAttempted = false;
      if (input.crossesPriceBand === true) {
        if (state.priceBandCrossPending) {
          downgradeRequired = true;
          if (input.enforceDowngrade === true) {
            downgradeAttempted = true;
            // The enforced downgrade clears the guard; a further crossing re-arms
            // it, so downgrades are required before every second crossing.
            state.priceBandCrossPending = false;
          }
          // Shadow (no enforcement) leaves the guard pending: the label still
          // owes a downgrade.
        } else {
          state.priceBandCrossPending = true;
        }
      } else {
        // A same-band attempt (or the first attempt) clears the guard.
        state.priceBandCrossPending = false;
      }

      return { allowed, remaining, downgradeRequired, downgradeAttempted };
    },
  };
}
