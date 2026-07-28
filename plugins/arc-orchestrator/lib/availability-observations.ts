// ADR 0010 phase 13.10. Minimal process-local producer of BackendObservation
// values for shadow `buildAvailabilityView`. Observations never alter
// dispatch; they only inform observational select() under routing-shadow.
//
// Empty / absent observations remain valid — select() treats unknown backends
// as unconstrained.

import type { NormalizedFailureClass } from "./failure-classification";
import {
  backendStateFor,
  type BackendObservation,
} from "./availability-view";
import type { Backend } from "./trace-schema";

const observations: BackendObservation[] = [];

/**
 * Record a classified backend failure when it describes transport health.
 * Terminal request-scoped classes are ignored (see backendStateFor).
 */
export function recordAvailabilityObservation(input: {
  backend: Backend;
  classification: NormalizedFailureClass;
  observedAtMs: number;
}): BackendObservation | null {
  if (backendStateFor(input.classification) == null) {
    return null;
  }
  const observation: BackendObservation = {
    backend: input.backend,
    classification: input.classification,
    observedAtMs: input.observedAtMs,
  };
  observations.push(observation);
  return observation;
}

export function listAvailabilityObservations(): readonly BackendObservation[] {
  return observations.slice();
}

/** Test/helper seam: clear the process-local buffer. */
export function clearAvailabilityObservations(): void {
  observations.length = 0;
}
