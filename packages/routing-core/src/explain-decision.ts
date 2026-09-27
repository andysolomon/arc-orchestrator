// Human-readable explanation of a routing evaluation. Every line is a
// structured fact restated in prose: the class and its reasons, the required
// band, why each candidate was selected, rejected, pruned, or unavailable.
// No model reasoning is involved; the text is derived from the decision.

import type { CapabilityBand } from "./capability-snapshot";
import { registryIndex, type ModelDefinition } from "./model-schema";
import type { RoutingPolicy } from "./policy-schema";
import type { EligibilityRejection } from "./selection";
import type { RoutingEvaluation, TraversalStatus } from "./evaluate-policy";

export type CandidateVerdictKind =
  | "selected"
  | "eligible"
  | "unavailable"
  | "rejected"
  | "pruned"
  | "budget-constrained"
  | "unranked"
  | "not-runnable"
  | "ineligible";

export type CandidateVerdict = {
  rungId: string;
  stableId: string;
  displayName: string;
  backend: string | null;
  effort: string;
  verdict: CandidateVerdictKind;
  reason: string;
  band: number | null;
  estimatedUsd: number | null;
  // Position in the authored stack, or null for a registry rung the stack
  // does not carry (only the capability-rung layer sees those).
  stackIndex: number | null;
  inTail: boolean;
};

export type ExplainedDecision = {
  headline: string;
  lines: string[];
  // The executing prediction (authored stack + availability).
  traversal: CandidateVerdict[];
  // The capability-rung layer (select()), a routing proxy.
  selection: CandidateVerdict[];
};

const REJECTION_TEXT: Record<EligibilityRejection, string> = {
  "route-ineligible": "not eligible for this capability route",
  "sandbox-unsupported": "does not support the route's sandbox",
  "output-contract-unsupported": "does not support the route's output contract",
  "effort-unsupported": "effort is not supported by the transport",
  "maturity-not-runnable": "registry maturity is not runnable",
  "role-restricted": "role-restricted model",
  "backend-unavailable": "backend unavailable",
  "quota-pool-exhausted": "quota pool observed exhausted",
  "below-capability-floor": "below the required capability band",
  "above-band-ceiling": "above the band ceiling",
  "excluded-rung": "excluded for verification independence",
};

function displayNameFor(index: Map<string, ModelDefinition>, stableId: string): string {
  return index.get(stableId)?.displayName ?? stableId;
}

function backendFor(index: Map<string, ModelDefinition>, stableId: string): string | null {
  const backend = index.get(stableId)?.transportBackend ?? null;
  return backend === "claude-code-parent" ? null : backend;
}

function traversalVerdict(status: TraversalStatus): CandidateVerdictKind {
  switch (status) {
    case "selected":
      return "selected";
    case "runnable":
      return "eligible";
    case "unavailable":
    case "quota-exhausted":
      return "unavailable";
    case "not-runnable":
    case "unknown-model":
      return "not-runnable";
    case "ineligible":
      return "ineligible";
  }
}

function bandText(band: CapabilityBand | number | null): string {
  return band == null ? "unranked" : `band ${band}`;
}

export function explainEvaluation(
  evaluation: RoutingEvaluation,
  registry: readonly ModelDefinition[],
  policy?: RoutingPolicy,
): ExplainedDecision {
  const index = registryIndex(registry);
  const lines: string[] = [];
  const surfaceName = (stableId: string) =>
    policy?.surfaces[stableId]?.name ?? displayNameFor(index, stableId);

  if (evaluation.error) {
    return {
      headline: `No dispatch: ${evaluation.error.message}`,
      lines: [evaluation.error.message],
      traversal: [],
      selection: [],
    };
  }

  const profile = evaluation.workloadProfile;
  if (evaluation.phase === "implement") {
    if (evaluation.workloadClassSource === "explicit") {
      lines.push(`task class ${evaluation.workloadClass} supplied explicitly`);
      if (evaluation.classDisagreement) {
        lines.push(
          `the workload profiler would have classified it ${evaluation.classDisagreement.profiled} (${profile?.reasons.join("; ")})`,
        );
      }
    } else if (evaluation.workloadClassSource === "profiled" && profile) {
      lines.push(`task classified as ${profile.workloadClass}: ${profile.reasons.join("; ")}`);
    }
  } else {
    lines.push(`phase ${evaluation.phase} routes on its own ordered stack; workload class does not apply`);
  }

  if (evaluation.floor) {
    const floor = evaluation.floor;
    lines.push(
      floor.capabilityFloor > 0
        ? `required capability band >= ${floor.capabilityFloor} (${floor.source === "explicit" ? "explicit floor" : `derived from the authored lead ${floor.derived.derivedFrom?.rungId ?? "(unranked)"}`}) on the ${evaluation.route?.axis} axis`
        : `no capability floor above 0 (${floor.derived.derivedFrom == null ? "the stack lead is unranked in the snapshot" : "derived floor is band 0"})`,
    );
  }

  const traversal: CandidateVerdict[] = [];
  if (evaluation.traversal) {
    for (const step of evaluation.traversal.steps) {
      traversal.push({
        rungId: step.rungId,
        stableId: step.stableId,
        displayName: surfaceName(step.stableId),
        backend: step.backend,
        effort: step.effort,
        verdict: traversalVerdict(step.status),
        reason: step.reasons.join("; "),
        band: step.band,
        estimatedUsd: step.estimatedUsd,
        stackIndex: step.index,
        inTail: step.inTail,
      });
    }
    const selected = evaluation.traversal.selected;
    if (selected) {
      lines.push(
        `${surfaceName(selected.stableId)} @ ${selected.effort} is the first runnable rung in the ${evaluation.stack?.workloadClass ?? evaluation.stack?.phase ?? "pinned"} stack${selected.index > 0 ? ` (${selected.index} earlier rung${selected.index === 1 ? "" : "s"} skipped)` : ""}`,
      );
    } else {
      lines.push("no runnable rung remains: the stack is exhausted under the observed availability");
    }
    for (const step of evaluation.traversal.steps) {
      if (step.status === "unavailable") {
        lines.push(`${surfaceName(step.stableId)} was unavailable (${step.reasons.join("; ")})`);
      }
    }
  }

  const selection: CandidateVerdict[] = [];
  const stackPosition = new Map<string, number>();
  const tailAt = evaluation.tailStartIndex;
  evaluation.traversal?.steps.forEach((step) => stackPosition.set(step.rungId, step.index));
  const verdictFor = (rungId: string, verdict: CandidateVerdictKind, reason: string, band: number | null, estimatedUsd: number | null): CandidateVerdict => {
    const at = rungId.lastIndexOf("@");
    const stableId = rungId.slice(0, at);
    const stackIndex = stackPosition.get(rungId) ?? null;
    return {
      rungId,
      stableId,
      displayName: surfaceName(stableId),
      backend: backendFor(index, stableId),
      effort: rungId.slice(at + 1),
      verdict,
      reason,
      band,
      estimatedUsd,
      stackIndex,
      inTail: stackIndex != null && tailAt >= 0 && stackIndex >= tailAt,
    };
  };
  if (evaluation.selection) {
    const decision = evaluation.selection;
    const explanation = decision.explanation;
    if (decision.outcome === "selected") {
      const lead = decision.stack[0]!;
      lines.push(
        `capability-rung selection (routing proxy, not the executing selector): ${surfaceName(lead.stableId)} @ ${lead.effort} leads at ${bandText(lead.band)}${lead.estimatedUsd != null ? `, ~$${lead.estimatedUsd.toFixed(2)}/task` : ", cost unknown"}`,
      );
      decision.stack.forEach((rung, position) => {
        selection.push(
          verdictFor(
            rung.rungId,
            position === 0 ? "selected" : rung.band == null ? "unranked" : "eligible",
            position === 0
              ? "highest band, cheapest within band"
              : `${bandText(rung.band)}${rung.estimatedUsd != null ? `, ~$${rung.estimatedUsd.toFixed(2)}` : ", cost unknown"}`,
            rung.band,
            rung.estimatedUsd,
          ),
        );
      });
      if (explanation.leadRepair) {
        lines.push(
          `lead repaired for backend coherence: ${explanation.leadRepair.to} kept the lead over ${explanation.leadRepair.from}`,
        );
      }
      if (explanation.floorLowered) {
        lines.push(`floor lowered from ${explanation.requestedFloor} to ${explanation.effectiveFloor} to find an affordable candidate`);
      }
    } else {
      lines.push(`capability-rung selection refused: ${decision.reason}`);
    }
    for (const entry of explanation.pruned) {
      selection.push(verdictFor(entry.rungId, "pruned", `dominated by ${entry.dominatedBy} (same or higher band, no more expensive)`, null, null));
    }
    for (const rungId of explanation.budgetConstrained) {
      selection.push(verdictFor(rungId, "budget-constrained", `estimated cost exceeds the remaining budget ($${evaluation.budget.remaining.cost.toFixed(2)})`, null, null));
    }
    for (const rungId of explanation.unranked) {
      if (!selection.some((verdict) => verdict.rungId === rungId)) {
        selection.push(verdictFor(rungId, "unranked", "no measurement on this axis; unknown capability sorts last, never first", null, null));
      }
    }
    for (const entry of explanation.rejected) {
      selection.push(verdictFor(entry.rungId, entry.reason === "backend-unavailable" ? "unavailable" : "rejected", REJECTION_TEXT[entry.reason], null, null));
    }
  }

  const headline = evaluation.traversal?.selected
    ? `Selected: ${surfaceName(evaluation.traversal.selected.stableId)} @ ${evaluation.traversal.selected.effort}`
    : "Selected: none (stack exhausted)";
  return { headline, lines, traversal, selection };
}

/** Compact one-paragraph rendering for CLI output and tooltips. */
export function renderExplanationText(explained: ExplainedDecision): string {
  return [explained.headline, ...explained.lines.map((line) => `- ${line}`)].join("\n");
}
