// ADR 0010 phase 13.4. `select()` — the pure function that turns a registry, a
// capability snapshot, a budget ledger, and an availability view into an ordered
// stack of rungs, replacing the hand-authored `CandidateStack.candidates`.
//
// Nothing calls this yet. It lands behind `rollout-gates.ts` and runs first under
// `routing-shadow.ts` against the authored stacks, per ADR 0010's rollout plan.
//
// Purity is a contract, not an aspiration: no I/O, no environment reads, no clock.
// Every time-dependent value arrives through `inputs`. Note the sharpest edge —
// `RootBudgetLedger` carries a `clock` field, and calling it would silently break
// determinism for a fixed input tuple. Only `ledger.remaining.cost` is read here,
// and a test passes a ledger whose clock throws to keep that honest.
//
// Step 7 (lead-backend coherence) is phase 13.4a and now runs — but only when the
// caller supplies a `leadPolicy`. Without one the stage does not execute and the
// three explanation fields it owns stay *omitted* rather than defaulted to
// `false`: an absent field says "not evaluated", where `false` would attest to a
// check that never ran.

import {
  bandFor,
  BENCHMARK_AXIS_AUTHORITY,
  MAX_CAPABILITY_BAND,
  type CapabilityAxis,
  type CapabilityBand,
  type CapabilitySnapshot,
  type Measurement,
  type RungSnapshotEntry,
} from "./capability-snapshot";
import { capabilityRouteFor, type CanonicalCapabilityRouteId } from "./capability-routes";
import type { RootBudgetLedger } from "./delegation-budget";
import type { NormalizedFailureClass } from "./failure-classification";
import {
  MODEL_REGISTRY_SCHEMA_VERSION,
  parseRungId,
  rungId as makeRungId,
  rungsFor,
  type ModelRegistryEntry,
  type RungId,
} from "./model-registry";
import type { Backend, Effort } from "./trace-schema";

export const SELECTION_POLICY_VERSION = "capability-rung/v1";

export type QuotaScope = {
  pool: string;
  remainingFraction: number | null; // null = unobservable -> no preference
  resetsAtMs: number | null;
};

export type AvailabilityView = {
  backends: Partial<
    Record<
      Backend,
      {
        state: "available" | "degraded" | "unavailable";
        classification: NormalizedFailureClass | null;
        observedAtMs: number;
      }
    >
  >;
  quotaPools: Record<string, QuotaScope>;
};

// `displacementRule` is single-valued and is never branched on: with one member
// a branch could not fail, and 13.4 established that a guard which cannot fire is
// the appearance of safety without the fact of it. It is here so the rule is
// stated at every call site, and so a second rule arrives as a type error at each
// one rather than as a silent behavior change.
export type LeadPolicy = {
  incumbentLeadBackend: Backend | null; // null for a route with no incumbent
  displacementRule: "band-improvement-only";
};

export type LeadRepair = {
  from: RungId;
  to: RungId;
  reason: "lead-backend-coherence";
};

export type SelectionRequest = {
  capabilityRoute: CanonicalCapabilityRouteId;
  axis: CapabilityAxis;
  capabilityFloor: CapabilityBand;
  minimumFloor: CapabilityBand; // === capabilityFloor means "do not degrade"
  bandCeiling: CapabilityBand | null; // eco mode; null = uncapped
  override: { stableId: string; effort: Effort | null } | null;
  taskIdentity: string;
  depth: number;
  // Optional, and deliberately so. ADR 0010 writes this as a required field, but
  // `incumbentLeadBackend: null` already means "this route has no incumbent lead",
  // and "the caller has not derived one yet" is a different statement. Collapsing
  // the two would let an unmigrated caller run with no coherence protection while
  // the trace recorded a check that passed. Absent means step 7 did not run.
  leadPolicy?: LeadPolicy;
};

export type SelectionInputs = {
  request: SelectionRequest;
  registry: readonly ModelRegistryEntry[];
  snapshot: CapabilitySnapshot;
  ledger: RootBudgetLedger; // read-only; reservation still happens in the scheduler
  availability: AvailabilityView;
  policyVersion: string;
  nowMs: number; // injected, never read from a clock
};

export type SelectedRung = {
  rungId: RungId;
  stableId: string;
  effort: Effort;
  backend: Backend;
  band: CapabilityBand | null; // null when the rung is unranked on this axis
  estimatedUsd: number | null;
  quotaPool: string | null;
};

export type EligibilityRejection =
  | "route-ineligible"
  | "sandbox-unsupported"
  | "output-contract-unsupported"
  | "effort-unsupported"
  | "maturity-not-runnable"
  | "role-restricted"
  | "backend-unavailable"
  | "quota-pool-exhausted"
  | "below-capability-floor"
  | "above-band-ceiling";

export type SelectionRefusal =
  | "no-eligible-rung"
  | "floor-unreachable-in-budget"
  | "budget-exhausted"
  | "override-ineligible"
  | "snapshot-expired";

export type SelectionExplanation = {
  policyVersion: string;
  snapshotVersion: string;
  registryVersion: number;
  axis: CapabilityAxis;
  requestedFloor: CapabilityBand;
  effectiveFloor: CapabilityBand;
  floorLowered: boolean;
  overrideApplied: boolean;
  // The returned stack, in order, after step 7. A rung can appear here *and* in
  // `pruned`: step 7 may reinstate a dominance-pruned rung as the lead, and the
  // `pruned` entry stays because dominance really did find it. `leadRepair` names
  // the rung that came back, so the two records reconstruct the whole decision.
  eligible: RungId[];
  rejected: Array<{ rungId: RungId; reason: EligibilityRejection }>;
  pruned: Array<{ rungId: RungId; dominatedBy: RungId }>;
  budgetConstrained: RungId[];
  // Rungs with no usable measurement on the requested axis. Decision 0005 makes
  // these unrankable rather than ineligible — dropping them would let ranking
  // narrow authority, which is what the registry/snapshot split exists to
  // prevent — so they stay in the stack and sort behind every ranked rung.
  unranked: RungId[];
  leadBackend: Backend | null;
  // Step 7 (phase 13.4a). Present together or not at all: all three are set when
  // the stage runs, and all three stay absent when no `leadPolicy` was supplied or
  // the run refused before a stack existed. `false` means "checked, did not
  // happen"; absent means "not checked".
  leadRepair?: LeadRepair | null;
  leadDisplaced?: boolean; // true only on a strictly higher band
  leadDisplacedByAvailability?: boolean; // no incumbent-backend rung survived
};

export type SelectionDecision =
  | { outcome: "selected"; stack: SelectedRung[]; explanation: SelectionExplanation }
  | { outcome: "refused"; reason: SelectionRefusal; explanation: SelectionExplanation };

const RUNNABLE_MATURITIES: ReadonlySet<string> = new Set([
  "experimental",
  "available",
  "deprecated",
]);

type Candidate = {
  rungId: RungId;
  stableId: string;
  effort: Effort;
  backend: Backend;
  entry: ModelRegistryEntry;
  snapshotEntry: RungSnapshotEntry | null;
  band: CapabilityBand | null;
  usdPerTask: number | null;
  quotaPool: string | null;
};

// Which measurement speaks for a rung on an axis. Decision 0005 binds each suite
// to exactly one axis, so at most one benchmark row can be authoritative here;
// where both a benchmark and an editorial claim exist, the benchmark wins and the
// editorial row is the weaker fallback it was always meant to be. Two rows at the
// same precedence is the policy's same-scope-key conflict, which resolves to
// capability-unknown rather than to a coin flip.
function measurementForAxis(
  entry: RungSnapshotEntry,
  axis: CapabilityAxis,
): Measurement | null {
  const onAxis = entry.measurements.filter(
    (measurement) => measurement.axis === axis,
  );
  if (onAxis.length === 0) {
    return null;
  }
  const authoritative = onAxis.filter(
    (measurement) =>
      measurement.source !== "editorial" &&
      BENCHMARK_AXIS_AUTHORITY[measurement.source] === axis,
  );
  const tier = authoritative.length > 0 ? authoritative : onAxis;
  return tier.length === 1 ? tier[0]! : null;
}

function clampBand(band: number): CapabilityBand {
  const bounded = Math.max(0, Math.min(MAX_CAPABILITY_BAND, Math.trunc(band)));
  return bounded as CapabilityBand;
}

function dispatchBackendFor(entry: ModelRegistryEntry): Backend | null {
  const backend = entry.transportBackend;
  if (backend == null || backend === "claude-code-parent") {
    return null;
  }
  return backend;
}

// Ordering input only, per ADR 0010 section 4: an unobservable remainder degrades
// to "no preference", never to "refuse" and never to "sorts last". Treating null
// as unconstrained is the fail-soft direction — the alternative would penalize a
// pool precisely because nothing is known about it.
function quotaPreference(
  availability: AvailabilityView,
  pool: string | null,
): number {
  if (pool == null) {
    return 1;
  }
  const scope = availability.quotaPools[pool];
  if (!scope || scope.remainingFraction == null) {
    return 1;
  }
  return scope.remainingFraction;
}

function compareCandidates(
  a: Candidate,
  b: Candidate,
  availability: AvailabilityView,
): number {
  // Unranked rungs sort behind every ranked one, whatever their cost. An unknown
  // capability is not a cheap capability.
  if ((a.band == null) !== (b.band == null)) {
    return a.band == null ? 1 : -1;
  }
  if (a.band != null && b.band != null && a.band !== b.band) {
    return b.band - a.band;
  }
  // Within a band, cost breaks the tie. Unknown cost sorts after known cost:
  // "orderable by band but not by cost" is a real state, and guessing where an
  // unpriced rung belongs is the estimate decision 0005 forbids.
  if ((a.usdPerTask == null) !== (b.usdPerTask == null)) {
    return a.usdPerTask == null ? 1 : -1;
  }
  if (
    a.usdPerTask != null &&
    b.usdPerTask != null &&
    a.usdPerTask !== b.usdPerTask
  ) {
    return a.usdPerTask - b.usdPerTask;
  }
  const quotaA = quotaPreference(availability, a.quotaPool);
  const quotaB = quotaPreference(availability, b.quotaPool);
  if (quotaA !== quotaB) {
    return quotaB - quotaA; // scarcer pools last
  }
  return a.rungId < b.rungId ? -1 : a.rungId > b.rungId ? 1 : 0;
}

function toSelectedRung(candidate: Candidate): SelectedRung {
  return {
    rungId: candidate.rungId,
    stableId: candidate.stableId,
    effort: candidate.effort,
    backend: candidate.backend,
    band: candidate.band,
    estimatedUsd: candidate.usdPerTask,
    quotaPool: candidate.quotaPool,
  };
}

type LeadCoherence = {
  ordered: Candidate[];
  leadRepair: LeadRepair | null;
  leadDisplaced: boolean;
  leadDisplacedByAvailability: boolean;
};

// Step 7. The one constraint no per-rung predicate can express: `isProviderSwitch`
// (`delegation-routing.ts:338`) compares the transport of the *first* stack
// candidate against the selected one, so the lead's backend decides which caller
// preferences are satisfiable at all in that class. Reordering the lead is never a
// local improvement.
//
// `reinstatable` is why this stage takes two lists. ADR 0010 says the lead must
// change only when no incumbent-backend rung survives step 2 or step 6 — an outage
// or a budget exhaustion. It does not account for step 4: dominance pruning drops
// a same-band costlier rung, and the incumbent lead is usually exactly that. Both
// of the ADR's own worked examples land there (`gpt-5.5` against `grok-4.5` at
// medium-work, `opus-5` against `grok-4.5` at medium-light-work: same band, and
// grok is the cheaper of each pair), so without reinstatement the repair could
// never fire in the cases it was written for. Dominance is an ordering
// optimization resting on "same band and cheaper is strictly better", and leading
// is the property that premise does not price. Only dominance-pruned rungs are
// reinstatable — never one rejected for eligibility, floor, ceiling, or budget —
// so every hard constraint survives step 7 untouched.
function enforceLeadCoherence(
  ordered: Candidate[],
  reinstatable: readonly Candidate[],
  policy: LeadPolicy,
  availability: AvailabilityView,
): LeadCoherence {
  const lead = ordered[0]!;
  const incumbent = policy.incumbentLeadBackend;
  const coherent: LeadCoherence = {
    ordered,
    leadRepair: null,
    leadDisplaced: false,
    leadDisplacedByAvailability: false,
  };
  if (incumbent == null || lead.backend === incumbent) {
    return coherent;
  }

  const onIncumbent = [...ordered, ...reinstatable]
    .filter((candidate) => candidate.backend === incumbent)
    .sort((a, b) => compareCandidates(a, b, availability));
  const best = onIncumbent[0];
  if (!best) {
    // The incumbent backend has nothing left to lead with. That is an outage or a
    // budget exhaustion, not a ranking choice, and it gets its own field so the
    // two causes stay distinguishable in the trace.
    return { ...coherent, leadDisplacedByAvailability: true };
  }

  // A strictly higher band is the only thing that may take the lead. Because
  // `bandWidth` is validated at >= 2x the largest error margin, a band improvement
  // is by construction a difference the benchmark can resolve — an 8.3-point gap
  // inside one band is not. An unranked rung on either side is not an improvement:
  // unknown capability must never displace an incumbent lead.
  if (lead.band != null && best.band != null && lead.band > best.band) {
    return { ...coherent, leadDisplaced: true };
  }

  // Repaired, not refused. The stack is serviceable; it is just ordered
  // differently than raw score suggests.
  return {
    ordered: [
      best,
      ...ordered.filter((candidate) => candidate.rungId !== best.rungId),
    ],
    leadRepair: {
      from: lead.rungId,
      to: best.rungId,
      reason: "lead-backend-coherence",
    },
    leadDisplaced: false,
    leadDisplacedByAvailability: false,
  };
}

/**
 * Derive a `LeadPolicy` from an authored stack. ADR 0010 requires
 * `incumbentLeadBackend` to be *recorded* from what leads today rather than newly
 * authored, so the constraint preserves current behavior by default instead of
 * introducing a fresh hand-tuned knob.
 *
 * An unresolvable lead throws rather than returning `null`: `null` means "this
 * route has no incumbent", and silently turning a typo into "no constraint" would
 * drop the protection at the one call site that most needs it.
 */
export function deriveLeadPolicy(
  stack: { candidates: readonly string[] },
  registry: readonly ModelRegistryEntry[],
): LeadPolicy {
  const leadStableId = stack.candidates[0];
  if (leadStableId == null) {
    return { incumbentLeadBackend: null, displacementRule: "band-improvement-only" };
  }
  const entry = registry.find((row) => row.stableId === leadStableId);
  if (!entry) {
    throw new Error(
      `deriveLeadPolicy: stack lead ${leadStableId} is not in the registry`,
    );
  }
  // A parent-only lead has no transport of its own, so there is no backend for a
  // caller preference to match and nothing for this constraint to preserve.
  return {
    incumbentLeadBackend: dispatchBackendFor(entry),
    displacementRule: "band-improvement-only",
  };
}

function anyMeasurementExpired(
  snapshot: CapabilitySnapshot,
  nowMs: number,
): boolean {
  for (const rung of snapshot.rungs) {
    for (const measurement of rung.measurements) {
      const expiresAt = Date.parse(measurement.expiresAt);
      if (!Number.isNaN(expiresAt) && expiresAt < nowMs) {
        return true;
      }
    }
  }
  return false;
}

export function select(inputs: SelectionInputs): SelectionDecision {
  const { request, registry, snapshot, ledger, availability, nowMs } = inputs;

  const rejected: Array<{ rungId: RungId; reason: EligibilityRejection }> = [];
  const pruned: Array<{ rungId: RungId; dominatedBy: RungId }> = [];
  const budgetConstrained: RungId[] = [];
  const unranked: RungId[] = [];

  const baseExplanation = (): SelectionExplanation => ({
    policyVersion: inputs.policyVersion,
    snapshotVersion: snapshot.snapshotVersion,
    registryVersion: MODEL_REGISTRY_SCHEMA_VERSION,
    axis: request.axis,
    requestedFloor: request.capabilityFloor,
    effectiveFloor: request.capabilityFloor,
    floorLowered: false,
    overrideApplied: false,
    eligible: [],
    rejected,
    pruned,
    budgetConstrained,
    unranked,
    leadBackend: null,
  });

  // Staleness is a hard failure across the whole snapshot rather than per axis.
  // A snapshot is captured, versioned, and refreshed as a unit, so one expired
  // row means the artifact is stale; serving the un-expired half of it is exactly
  // the silent degradation ADR 0010 refuses.
  if (anyMeasurementExpired(snapshot, nowMs)) {
    return {
      outcome: "refused",
      reason: "snapshot-expired",
      explanation: baseExplanation(),
    };
  }

  // Step 1 — resolve the capability route. Mode, sandbox, permissions, and the
  // output contract are fixed here and never reconsidered.
  const route = capabilityRouteFor(request.capabilityRoute);

  const snapshotByRungId = new Map(
    snapshot.rungs.map((rung) => [rung.rungId, rung] as const),
  );

  // Step 2 — hard filter over every rung, on registry facts and availability
  // only. No snapshot score is consulted; this is what makes the zeroed-snapshot
  // property hold.
  const eligible: Candidate[] = [];
  for (const entry of registry) {
    for (const rungIdValue of rungsFor(entry)) {
      const parsed = parseRungId(rungIdValue);
      if (!parsed) {
        continue;
      }
      const effort = parsed.effort;
      const reject = (reason: EligibilityRejection): void => {
        rejected.push({ rungId: rungIdValue, reason });
      };

      if (!RUNNABLE_MATURITIES.has(entry.maturity)) {
        reject("maturity-not-runnable");
        continue;
      }
      // Any role restriction disqualifies a rung from a derived stack, matching
      // the registry's existing ban on role-restricted candidates in
      // automatic-fallback stacks. An override may not lift this.
      if (entry.roleRestriction != null) {
        reject("role-restricted");
        continue;
      }
      if (!entry.routeEligibility.includes(request.capabilityRoute)) {
        reject("route-ineligible");
        continue;
      }
      if (!entry.sandboxPermissionSupport.includes(route.sandbox)) {
        reject("sandbox-unsupported");
        continue;
      }
      if (!entry.outputContracts.includes(route.outputContract)) {
        reject("output-contract-unsupported");
        continue;
      }

      // No `effort-unsupported` check here, deliberately. The candidate set is
      // generated by `rungsFor`, which derives rungs from `supportedEffortsFor`,
      // so an effort the transport cannot forward never becomes a candidate in
      // the first place. A branch for it would be a guard that can never fire —
      // the appearance of safety without the fact of it. The ADR's
      // `effort-unsupported` rejection is produced where an unsupported effort
      // can actually appear: snapshot validation (`EFFORT_UNSUPPORTED`, 13.2),
      // where the data is hand-edited rather than derived.

      const backend = dispatchBackendFor(entry);
      if (backend == null) {
        // No transport can carry this entry, so nothing in the availability view
        // describes it. Closest true statement in the ADR's fixed vocabulary.
        reject("backend-unavailable");
        continue;
      }
      const health = availability.backends[backend];
      if (health?.state === "unavailable") {
        reject("backend-unavailable");
        continue;
      }

      const snapshotEntry = snapshotByRungId.get(rungIdValue) ?? null;
      const quotaPool = snapshotEntry?.quotaPool ?? null;
      // Fires only on an *observed* zero. A null remainder is unobservable, not
      // empty, and must never reject.
      if (quotaPool != null) {
        const scope = availability.quotaPools[quotaPool];
        if (scope && scope.remainingFraction === 0) {
          reject("quota-pool-exhausted");
          continue;
        }
      }

      const measurement = snapshotEntry
        ? measurementForAxis(snapshotEntry, request.axis)
        : null;
      const band =
        measurement == null
          ? null
          : clampBand(bandFor(measurement.score, snapshot.bandWidth));
      if (band == null) {
        unranked.push(rungIdValue);
      }

      eligible.push({
        rungId: rungIdValue,
        stableId: entry.stableId,
        effort,
        backend,
        entry,
        snapshotEntry,
        band,
        usdPerTask: snapshotEntry?.costPrior?.usdPerTask ?? null,
        quotaPool,
      });
    }
  }

  if (eligible.length === 0) {
    return {
      outcome: "refused",
      reason: "no-eligible-rung",
      explanation: baseExplanation(),
    };
  }

  // Step 3 — a validated override. It bypasses ordering, banding, price policy,
  // and budget, because an explicit operator choice that a band or a cost silently
  // discarded would not be an override. It cannot bypass step 1 or the role
  // restriction above; those were already applied. Bypassing budget here is not a
  // spending loophole: `budget-limits/v1` remains the sole admission authority
  // (decision 0003), and `tryReserveDispatch` still rejects an unaffordable
  // dispatch downstream. This function orders candidates; it does not admit them.
  if (request.override) {
    const wanted = eligible.filter(
      (candidate) =>
        candidate.stableId === request.override!.stableId &&
        (request.override!.effort == null ||
          candidate.effort === request.override!.effort),
    );
    const explanation = baseExplanation();
    explanation.overrideApplied = true;
    if (wanted.length === 0) {
      return {
        outcome: "refused",
        reason: "override-ineligible",
        explanation,
      };
    }
    const ordered = [...wanted].sort((a, b) =>
      compareCandidates(a, b, availability),
    );
    explanation.eligible = ordered.map((candidate) => candidate.rungId);
    explanation.leadBackend = ordered[0]!.backend;
    // Step 7 does not run here, and its fields stay absent. An override names a
    // `stableId`, and every rung of one entry shares its `transportBackend`, so
    // the stack is single-backend and there is nothing to promote — the stage
    // could only ever return "no repair", and recording that would attest to a
    // check with no way to fail. An override *can* still move the lead off the
    // incumbent backend, which is a real consequence for caller preferences; it
    // is the operator's explicit instruction, the same way an override bypasses
    // budget, and `overrideApplied` beside `leadBackend` is what records it.
    // Step 7's vocabulary has no term for "displaced by override" — worth a
    // field of its own if 13.6 finds readers need to tell the causes apart.
    return {
      outcome: "selected",
      stack: ordered.map(toSelectedRung),
      explanation,
    };
  }

  if (ledger.remaining.cost <= 0) {
    return {
      outcome: "refused",
      reason: "budget-exhausted",
      explanation: baseExplanation(),
    };
  }

  // Steps 4-6, run once per floor. Degradation re-runs them at a lower floor
  // rather than patching the previous result, so a degraded selection is
  // indistinguishable from one requested at that floor to begin with.
  const evaluateAtFloor = (
    floor: CapabilityBand,
    record: boolean,
  ): { affordable: Candidate[]; reinstatable: Candidate[] } => {
    const withinBounds = eligible.filter((candidate) => {
      if (candidate.band == null) {
        // Unrankable rungs are exempt from the floor because there is no band to
        // compare, but they can never satisfy it either — see the guard below.
        return true;
      }
      if (
        request.bandCeiling != null &&
        candidate.band > request.bandCeiling
      ) {
        if (record) {
          rejected.push({ rungId: candidate.rungId, reason: "above-band-ceiling" });
        }
        return false;
      }
      if (candidate.band < floor) {
        if (record) {
          rejected.push({
            rungId: candidate.rungId,
            reason: "below-capability-floor",
          });
        }
        return false;
      }
      return true;
    });

    // Dominance pruning. Only rungs with both a band and a cost participate on
    // either side: proving `usdPerTask(A) <= usdPerTask(B)` is impossible when
    // one of them is unknown, and assuming a value there is the estimate the
    // policy forbids.
    const comparable = withinBounds.filter(
      (candidate) => candidate.band != null && candidate.usdPerTask != null,
    );
    const dominated = new Map<RungId, RungId>();
    for (const b of comparable) {
      for (const a of comparable) {
        if (a.rungId === b.rungId) {
          continue;
        }
        const bandAtLeast = a.band! >= b.band!;
        const costAtMost = a.usdPerTask! <= b.usdPerTask!;
        const strict = a.band! > b.band! || a.usdPerTask! < b.usdPerTask!;
        if (bandAtLeast && costAtMost && strict) {
          dominated.set(b.rungId, a.rungId);
          break;
        }
      }
    }
    if (record) {
      for (const [rungIdValue, dominatedBy] of dominated) {
        pruned.push({ rungId: rungIdValue, dominatedBy });
      }
    }

    const survivors = withinBounds.filter(
      (candidate) => !dominated.has(candidate.rungId),
    );

    // Step 6 — budget. An unpriced rung is not filtered out: cost-unknown may
    // never disable an otherwise-eligible entry, per decision 0001's fail-safe
    // and decision 0005's restatement of it for capability data.
    const affordableIn = (
      candidates: Candidate[],
      recordConstrained: boolean,
    ): Candidate[] =>
      candidates.filter((candidate) => {
        if (candidate.usdPerTask == null) {
          return true;
        }
        if (candidate.usdPerTask > ledger.remaining.cost) {
          if (recordConstrained) {
            budgetConstrained.push(candidate.rungId);
          }
          return false;
        }
        return true;
      });

    // Dominance-pruned rungs are budget-checked too, so step 7 can only ever
    // reinstate something that would have been dispatchable anyway. Their budget
    // rejections are not recorded: `budgetConstrained` gates the
    // `floor-unreachable-in-budget` refusal, and a rung dominance had already
    // removed did not make the floor unreachable.
    return {
      affordable: affordableIn(survivors, record),
      reinstatable: affordableIn(
        withinBounds.filter((candidate) => dominated.has(candidate.rungId)),
        false,
      ),
    };
  };

  // A stack whose only members are unranked does not satisfy a floor above 0:
  // nothing has been shown to reach it, and "unknown" must not read as "meets".
  const satisfiesFloor = (candidates: Candidate[], floor: CapabilityBand): boolean =>
    floor === 0
      ? candidates.length > 0
      : candidates.some((candidate) => candidate.band != null);

  // The floor is settled first without recording anything, then the whole
  // evaluation is replayed once at the floor actually used. Recording on the way
  // down would leave the explanation asserting `below-capability-floor` against
  // rungs that end up in the returned stack — a trace describing a decision that
  // was reconsidered.
  let effectiveFloor = request.capabilityFloor;
  let evaluation = evaluateAtFloor(effectiveFloor, false);
  while (
    !satisfiesFloor(evaluation.affordable, effectiveFloor) &&
    effectiveFloor > request.minimumFloor
  ) {
    effectiveFloor = (effectiveFloor - 1) as CapabilityBand;
    evaluation = evaluateAtFloor(effectiveFloor, false);
  }
  evaluation = evaluateAtFloor(effectiveFloor, true);
  const survivors = evaluation.affordable;

  const explanation = baseExplanation();
  explanation.effectiveFloor = effectiveFloor;
  explanation.floorLowered = effectiveFloor !== request.capabilityFloor;

  if (!satisfiesFloor(survivors, effectiveFloor)) {
    // Distinguish "the budget removed everything" from "nothing was ever there".
    // `budgetConstrained` is non-empty only when a rung cleared the band filter
    // and then failed on cost.
    return {
      outcome: "refused",
      reason:
        budgetConstrained.length > 0
          ? "floor-unreachable-in-budget"
          : "no-eligible-rung",
      explanation,
    };
  }

  const ordered = [...survivors].sort((a, b) =>
    compareCandidates(a, b, availability),
  );

  // Step 7 — stack-level constraint validation and repair. It runs last, after
  // budget, because budget can itself remove the lead. Without a `leadPolicy` it
  // does not run at all and its three fields stay absent.
  let stack = ordered;
  if (request.leadPolicy) {
    const coherence = enforceLeadCoherence(
      ordered,
      evaluation.reinstatable,
      request.leadPolicy,
      availability,
    );
    stack = coherence.ordered;
    explanation.leadRepair = coherence.leadRepair;
    explanation.leadDisplaced = coherence.leadDisplaced;
    explanation.leadDisplacedByAvailability =
      coherence.leadDisplacedByAvailability;
  }

  explanation.eligible = stack.map((candidate) => candidate.rungId);
  explanation.leadBackend = stack[0]!.backend;

  return {
    outcome: "selected",
    stack: stack.map(toSelectedRung),
    explanation,
  };
}

// Convenience for callers that hold a stableId/effort pair rather than a RungId.
export function rungIdFor(stableId: string, effort: Effort): RungId {
  return makeRungId(stableId, effort);
}
