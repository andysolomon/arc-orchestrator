// ADR 0010 phase 13.6. Maps a `SelectionDecision` onto the `selection` block of
// the `orchestrator-routing-trace/v2` record.
//
// It lives in its own module because it is the only place that knows both halves:
// `capability-selection.ts` imports `Backend` and `Effort` from `trace-schema.ts`,
// so `trace-schema.ts` cannot import the selector's types back. Keeping the
// mapping out of `select()` also keeps that function about selection — it returns
// an explanation, and what a caller records is the caller's decision.
//
// Pure, like `select()` itself: no clock, no I/O, no environment.

import type {
  RoutingTraceV2Selection,
  RoutingTraceV2SelectionTruncation,
} from "./trace-schema";
import type { SelectionDecision } from "./capability-selection";

// How many entries of each list reach the trace. The bound is real rather than
// defensive: the registry generates 61 rungs today, and against an empty snapshot
// `taste-review.read-only.v1` rejects 55 of them while `implement.workspace-write.v1`
// leaves 41 unranked — so every one of those lists already exceeds this limit on
// its own. A per-dispatch record is not the place to carry a whole evaluation, and
// the record must not grow with the registry.
//
// What is kept is the first N in evaluation order, deterministic for a fixed
// input; what is dropped is counted in `truncated` rather than silently
// discarded, so a reader can always tell a complete record from a clipped one.
export const SELECTION_TRACE_LIST_LIMIT = 32;

type Clipped<T> = { kept: T[]; dropped: number };

function clip<T>(values: readonly T[]): Clipped<T> {
  if (values.length <= SELECTION_TRACE_LIST_LIMIT) {
    return { kept: [...values], dropped: 0 };
  }
  return {
    kept: values.slice(0, SELECTION_TRACE_LIST_LIMIT),
    dropped: values.length - SELECTION_TRACE_LIST_LIMIT,
  };
}

export type SelectionTraceOptions = {
  // Did this selection determine the dispatch being recorded? Required, because
  // under shadow mode it is false while everything else in the block looks
  // identical to a live selection, and only the caller knows which it is.
  executed: boolean;
};

export function selectionTraceFrom(
  decision: SelectionDecision,
  options: SelectionTraceOptions,
): RoutingTraceV2Selection {
  const { explanation } = decision;
  const eligible = clip(explanation.eligible);
  const rejected = clip(explanation.rejected);
  const pruned = clip(explanation.pruned);
  const budgetConstrained = clip(explanation.budgetConstrained);
  const unranked = clip(explanation.unranked);

  const truncated: RoutingTraceV2SelectionTruncation = {
    eligible: eligible.dropped,
    rejected: rejected.dropped,
    pruned: pruned.dropped,
    budget_constrained: budgetConstrained.dropped,
    unranked: unranked.dropped,
  };

  return {
    outcome: decision.outcome,
    refusal_reason: decision.outcome === "refused" ? decision.reason : null,
    executed: options.executed,
    policy_version: explanation.policyVersion,
    snapshot_version: explanation.snapshotVersion,
    registry_version: explanation.registryVersion,
    axis: explanation.axis,
    requested_floor: explanation.requestedFloor,
    effective_floor: explanation.effectiveFloor,
    floor_lowered: explanation.floorLowered,
    override_applied: explanation.overrideApplied,
    eligible: eligible.kept,
    rejected: rejected.kept.map((entry) => ({
      rung_id: entry.rungId,
      reason: entry.reason,
    })),
    pruned: pruned.kept.map((entry) => ({
      rung_id: entry.rungId,
      dominated_by: entry.dominatedBy,
    })),
    budget_constrained: budgetConstrained.kept,
    unranked: unranked.kept,
    lead_backend: explanation.leadBackend,
    // Step 7's three fields carry forward exactly as `select()` left them:
    // present together when the stage ran, absent together when it did not. They
    // are spread rather than assigned so an absent field stays absent instead of
    // becoming an explicit `undefined` — which reads the same in JSON but not to
    // `"lead_displaced" in selection`, and that test is how a reader tells "did
    // not run" from "ran and found nothing".
    ...("leadRepair" in explanation
      ? {
          lead_repair:
            explanation.leadRepair == null
              ? null
              : {
                  from: explanation.leadRepair.from,
                  to: explanation.leadRepair.to,
                  reason: explanation.leadRepair.reason,
                },
        }
      : {}),
    ...("leadDisplaced" in explanation
      ? { lead_displaced: explanation.leadDisplaced }
      : {}),
    ...("leadDisplacedByAvailability" in explanation
      ? {
          lead_displaced_by_availability:
            explanation.leadDisplacedByAvailability,
        }
      : {}),
    truncated,
  };
}
