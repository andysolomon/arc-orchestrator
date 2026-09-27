// ADR 0010 phase 13.6. Maps a `SelectionDecision` onto the `selection` block of
// the `orchestrator-routing-trace/v2` record. Pure, like `select()` itself.

import type { SelectionDecision } from "./selection";
import type {
  RoutingTraceV2Selection,
  RoutingTraceV2SelectionTruncation,
} from "./trace-schema";

// How many entries of each list reach the trace. A per-dispatch record is not
// the place to carry a whole evaluation, and the record must not grow with the
// registry. What is dropped is counted in `truncated`.
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
  // under shadow mode it is false while everything else looks identical.
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
    // present together when the stage ran, absent together when it did not.
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
