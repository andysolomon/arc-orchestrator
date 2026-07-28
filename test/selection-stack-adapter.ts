import type { SelectionDecision } from "../plugins/arc-orchestrator/lib/capability-selection";
import type { CandidateStack } from "../plugins/arc-orchestrator/lib/model-registry";

/**
 * Tests-only ADR 0008 adapter: select() stack → CandidateStack.candidates order.
 * CandidateStack is stableId-only, so fixtures must use one selected effort per
 * model; a second effort for the same stableId is a test-setup error, not a
 * silent collapse.
 */
export function selectionDecisionToCandidateStack(
  decision: SelectionDecision,
  template: CandidateStack,
): CandidateStack {
  if (decision.outcome !== "selected") {
    throw new Error(`expected selected, got ${decision.reason}`);
  }
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const rung of decision.stack) {
    if (seen.has(rung.stableId)) {
      throw new Error(
        `selection-stack-adapter: duplicate stableId ${rung.stableId} (use one effort per model)`,
      );
    }
    seen.add(rung.stableId);
    candidates.push(rung.stableId);
  }
  return {
    route: template.route,
    policyVersion: template.policyVersion,
    automaticFallback: template.automaticFallback,
    ...(template.workloadClass !== undefined
      ? { workloadClass: template.workloadClass }
      : {}),
    candidates,
  };
}
