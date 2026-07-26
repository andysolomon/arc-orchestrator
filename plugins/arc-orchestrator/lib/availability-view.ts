// ADR 0010 phase 13.5. Builds the `AvailabilityView` that `select()` consumes:
// observed backend health, plus subscription quota as ordering input only.
//
// Nothing produces observations yet — like `select()` itself, this lands ahead of
// the caller that will feed it, and 13.10 wires both under `routing-shadow.ts`.
// What it fixes now is the shape of the answer, and two rules that are easy to get
// wrong once something is feeding it live.
//
// Quota never touches the ledger. `BudgetDimension` is not expanded, the
// reserve/reconcile math in `delegation-budget.ts` is untouched, every
// `RoutingTraceV2` budget field is unchanged, and `budget-limits/v1` (decision
// 0003) stays the sole admission authority. USD and subscription quota deplete
// against different clocks and are not fungible; a remainder that is frequently
// unobservable must never be able to refuse a dispatch.
//
// Pure: no clock, no I/O. `nowMs` is injected, the same contract `select()` has.

import type { NormalizedFailureClass } from "./failure-classification";
import type { AvailabilityView, QuotaScope } from "./capability-selection";
import type { Backend } from "./trace-schema";

export const AVAILABILITY_VIEW_SCHEMA_VERSION = 1;

// How long one observation speaks for the present.
//
// The window is short on purpose, and the reason is worth stating because it runs
// against the instinct to remember failures for a while: `select()` treats
// `unavailable` as a hard rejection, so an unavailable verdict prevents the very
// dispatch that would refresh it. Hold it too long and the state becomes
// self-reinforcing — a backend that recovered is never tried, so nothing ever
// observes the recovery. Expiring too early costs one failed dispatch, which
// reclassifies immediately and is self-correcting. Expiring too late costs
// capacity and is not.
//
// 60s matches `RETRY_BUDGET_DEFAULT_WINDOW_MS`, which bounds a traversal for the
// same reason.
export const AVAILABILITY_OBSERVATION_WINDOW_MS = 60_000;

export type BackendObservation = {
  backend: Backend;
  classification: NormalizedFailureClass;
  observedAtMs: number;
};

export type QuotaObservation = {
  pool: string;
  // null means the provider does not expose a remainder. It is not zero, and the
  // difference is the whole of section 4 of the ADR.
  remainingFraction: number | null;
  resetsAtMs: number | null;
  observedAtMs: number;
};

export type AvailabilityViewInput = {
  backends?: readonly BackendObservation[];
  quotaPools?: readonly QuotaObservation[];
  nowMs: number;
  windowMs?: number;
};

type ObservedState = "unavailable" | "degraded";

// A failure the transport could not carry: nothing dispatched there will succeed
// until it clears.
const UNAVAILABLE_CLASSES: ReadonlySet<string> = new Set([
  "rate_limit",
  "quota_exhausted",
  "provider_outage",
  "missing_binary",
]);

// A failure that reached the backend and did not complete. It may as easily be
// the task as the transport, so it lowers preference without removing capacity.
const DEGRADED_CLASSES: ReadonlySet<string> = new Set([
  "timeout",
  "transient_network_or_adapter",
]);

/**
 * What one failure class says about a backend's health, or `null` when it says
 * nothing.
 *
 * The `null` case is the load-bearing one. Every terminal class —
 * `policy_denial`, `sandbox_incompatible`, `invalid_configuration`,
 * `deterministic_validation_error` — describes the *request*, not the transport.
 * A sandbox the route cannot use is a fact about the route; a denied policy is a
 * fact about what was asked for. Mapping those onto backend health would let one
 * malformed request take a whole provider out of rotation for every task on the
 * machine, which is a far worse failure than the one being reported.
 */
export function backendStateFor(
  classification: NormalizedFailureClass,
): ObservedState | null {
  if (UNAVAILABLE_CLASSES.has(classification)) {
    return "unavailable";
  }
  if (DEGRADED_CLASSES.has(classification)) {
    return "degraded";
  }
  return null;
}

// Newest evidence wins, because the view describes now. Equal timestamps break
// toward the more severe state: it is the only tiebreak that is both
// deterministic and fail-safe, and two observations of one backend in the same
// millisecond are far more likely to be one event seen twice than a recovery.
const STATE_SEVERITY: Record<ObservedState, number> = {
  unavailable: 2,
  degraded: 1,
};

function moreAuthoritative(
  candidate: { observedAtMs: number; state: ObservedState },
  incumbent: { observedAtMs: number; state: ObservedState },
): boolean {
  if (candidate.observedAtMs !== incumbent.observedAtMs) {
    return candidate.observedAtMs > incumbent.observedAtMs;
  }
  return STATE_SEVERITY[candidate.state] > STATE_SEVERITY[incumbent.state];
}

// Newest wins here too. On equal timestamps the scarcer reading wins, and a
// numeric reading beats an unobservable one — both are order-independent, so the
// view does not depend on which order the caller happened to collect
// observations in.
function preferQuota(
  candidate: QuotaObservation,
  incumbent: QuotaObservation,
): boolean {
  if (candidate.observedAtMs !== incumbent.observedAtMs) {
    return candidate.observedAtMs > incumbent.observedAtMs;
  }
  if (candidate.remainingFraction == null) {
    return false;
  }
  if (incumbent.remainingFraction == null) {
    return true;
  }
  return candidate.remainingFraction < incumbent.remainingFraction;
}

/**
 * Assemble the view `select()` reads.
 *
 * A backend with no usable observation is absent from `backends`, and absence is
 * how "nothing is known" is spelled: `select()` rejects only on an explicit
 * `unavailable`, so an unobserved backend routes normally. Recording an
 * unobserved backend as `available` would claim an observation of health that
 * nobody made.
 */
export function buildAvailabilityView(
  input: AvailabilityViewInput,
): AvailabilityView {
  const windowMs = input.windowMs ?? AVAILABILITY_OBSERVATION_WINDOW_MS;
  const cutoff = input.nowMs - windowMs;

  const backends: AvailabilityView["backends"] = {};
  const chosen = new Map<Backend, { observedAtMs: number; state: ObservedState }>();
  for (const observation of input.backends ?? []) {
    if (observation.observedAtMs <= cutoff) {
      continue;
    }
    const state = backendStateFor(observation.classification);
    if (state == null) {
      continue;
    }
    const candidate = { observedAtMs: observation.observedAtMs, state };
    const incumbent = chosen.get(observation.backend);
    if (incumbent && !moreAuthoritative(candidate, incumbent)) {
      continue;
    }
    chosen.set(observation.backend, candidate);
    backends[observation.backend] = {
      state,
      classification: observation.classification,
      observedAtMs: observation.observedAtMs,
    };
  }

  // `null` records a pool seen only through unusable observations: it exists, and
  // its level is unknown. A stale or already-reset remainder is not evidence about
  // the level now, and decaying it toward unobservable is the only safe direction
  // — `select()` rejects on an observed zero, so a stale zero left standing would
  // refuse dispatches against quota that has since reset.
  const usableQuota = new Map<string, QuotaObservation | null>();
  for (const observation of input.quotaPools ?? []) {
    const stale = observation.observedAtMs <= cutoff;
    const reset =
      observation.resetsAtMs != null && input.nowMs >= observation.resetsAtMs;
    const incumbent = usableQuota.get(observation.pool);
    if (stale || reset) {
      if (incumbent === undefined) {
        usableQuota.set(observation.pool, null);
      }
      continue;
    }
    if (
      incumbent == null ||
      preferQuota(observation, incumbent)
    ) {
      usableQuota.set(observation.pool, observation);
    }
  }

  const quotaPools: Record<string, QuotaScope> = {};
  for (const [pool, observation] of usableQuota) {
    quotaPools[pool] =
      observation == null
        ? { pool, remainingFraction: null, resetsAtMs: null }
        : {
            pool,
            remainingFraction: observation.remainingFraction,
            resetsAtMs: observation.resetsAtMs,
          };
  }

  return { backends, quotaPools };
}
