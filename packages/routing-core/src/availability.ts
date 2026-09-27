// ADR 0010 phase 13.5. Builds the `AvailabilityView` that `select()` consumes:
// observed backend health, plus subscription quota as ordering input only.
//
// Quota never touches the ledger. USD and subscription quota deplete against
// different clocks and are not fungible; a remainder that is frequently
// unobservable must never be able to refuse a dispatch.
//
// Pure: no clock, no I/O. `nowMs` is injected, the same contract `select()` has.

import type { Backend, NormalizedFailureClass } from "./vocabulary";

export const AVAILABILITY_VIEW_SCHEMA_VERSION = 1;

export type QuotaScope = {
  pool: string;
  remainingFraction: number | null; // null = unobservable -> no preference
  resetsAtMs: number | null;
};

export type BackendHealthState = "available" | "degraded" | "unavailable";

export type AvailabilityView = {
  backends: Partial<
    Record<
      Backend,
      {
        state: BackendHealthState;
        classification: NormalizedFailureClass | null;
        observedAtMs: number;
      }
    >
  >;
  quotaPools: Record<string, QuotaScope>;
};

// How long one observation speaks for the present. `select()` treats
// `unavailable` as a hard rejection, so an unavailable verdict prevents the very
// dispatch that would refresh it; a short window keeps the state from becoming
// self-reinforcing. 60s matches `RETRY_BUDGET_DEFAULT_WINDOW_MS`.
export const AVAILABILITY_OBSERVATION_WINDOW_MS = 60_000;

export type BackendObservation = {
  backend: Backend;
  classification: NormalizedFailureClass;
  observedAtMs: number;
};

export type QuotaObservation = {
  pool: string;
  // null means the provider does not expose a remainder. It is not zero.
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

/** Serializable availability evidence: what a simulator or a trace reader supplies. */
export type AvailabilityState = {
  backends?: readonly BackendObservation[];
  quotaPools?: readonly QuotaObservation[];
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
 * nothing. Every terminal class describes the *request*, not the transport, and
 * mapping those onto backend health would let one malformed request take a whole
 * provider out of rotation.
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
// toward the more severe state.
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
 * Assemble the view `select()` reads. A backend with no usable observation is
 * absent from `backends`, and absence is how "nothing is known" is spelled.
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
  // the level now, and decaying it toward unobservable is the only safe direction.
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

/** Synthesize fresh observations that mark the given backends unavailable at `nowMs`. */
export function unavailableObservations(
  backends: readonly Backend[],
  nowMs: number,
  classification: NormalizedFailureClass = "provider_outage",
): BackendObservation[] {
  return backends.map((backend) => ({ backend, classification, observedAtMs: nowMs }));
}
