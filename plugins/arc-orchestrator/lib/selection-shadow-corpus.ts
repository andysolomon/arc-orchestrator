// ADR 0010 phase 13.10. Reviewable disagreement corpus for observational
// `select()` under routing-shadow. Per-dispatch v2 traces clip explanation
// lists; this record keeps the full unclipped SelectionExplanation.
//
// Pure serialization/compare helpers live here. Persistence is an optional
// JSONL append following the routing-trace-v2 sidecar precedent — callers own
// whether to write.

import type { SelectionDecision, SelectionExplanation } from "./capability-selection";
import type { CanonicalCapabilityRouteId } from "./capability-routes";
import type { CapabilityBand } from "./capability-snapshot";
import type { Backend } from "./trace-schema";
import { boundedLabel, sanitizeFailureDetail } from "./trace-schema";

export const SELECTION_SHADOW_CORPUS_SCHEMA_VERSION = 1;
export const SELECTION_SHADOW_CORPUS_CONTRACT = "selection-shadow-corpus/v1";

export type AuthoredStackView = {
  candidates: readonly string[];
  leadStableId: string | null;
  leadBackend: Backend | null;
  policyVersion: string;
};

export type ProposedStackView = {
  outcome: SelectionDecision["outcome"];
  refusalReason: string | null;
  candidates: readonly string[];
  rungIds: readonly string[];
  leadStableId: string | null;
  leadBackend: Backend | null;
  leadRungId: string | null;
};

export type StackComparison = {
  matches: boolean;
  leadMatches: boolean;
  orderMatches: boolean;
  outcome: SelectionDecision["outcome"];
  explanation: string;
};

export type SelectionShadowCorpusRecord = {
  contract: typeof SELECTION_SHADOW_CORPUS_CONTRACT;
  schema: typeof SELECTION_SHADOW_CORPUS_SCHEMA_VERSION;
  // Injected identity; never derived from task text.
  taskIdentity: string | null;
  capabilityRoute: CanonicalCapabilityRouteId;
  axis: string;
  snapshotVersion: string;
  selectionPolicyVersion: string;
  authored: AuthoredStackView;
  proposed: ProposedStackView;
  comparison: StackComparison;
  // Dual-acceptance floor disagreement from capability-floor/v1, when present.
  floorDisagreement: {
    explicit: CapabilityBand;
    derived: CapabilityBand;
  } | null;
  // Full unclipped explanation — the reason this corpus exists beside clipped
  // per-dispatch traces (SELECTION_TRACE_LIST_LIMIT).
  explanation: SelectionExplanation;
  executed: false;
};

export function authoredStackView(input: {
  candidates: readonly string[];
  leadBackend: Backend | null;
  policyVersion: string;
}): AuthoredStackView {
  return {
    candidates: [...input.candidates],
    leadStableId: input.candidates[0] ?? null,
    leadBackend: input.leadBackend,
    policyVersion: input.policyVersion,
  };
}

export function proposedStackView(decision: SelectionDecision): ProposedStackView {
  if (decision.outcome === "refused") {
    return {
      outcome: "refused",
      refusalReason: decision.reason,
      candidates: [],
      rungIds: [],
      leadStableId: null,
      leadBackend: decision.explanation.leadBackend,
      leadRungId: null,
    };
  }
  const rungIds = decision.stack.map((rung) => rung.rungId);
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const rung of decision.stack) {
    if (seen.has(rung.stableId)) {
      continue;
    }
    seen.add(rung.stableId);
    candidates.push(rung.stableId);
  }
  const lead = decision.stack[0] ?? null;
  return {
    outcome: "selected",
    refusalReason: null,
    candidates,
    rungIds,
    leadStableId: lead?.stableId ?? null,
    leadBackend: decision.explanation.leadBackend ?? lead?.backend ?? null,
    leadRungId: lead?.rungId ?? null,
  };
}

export function compareAuthoredVsProposed(
  authored: AuthoredStackView,
  proposed: ProposedStackView,
): StackComparison {
  if (proposed.outcome === "refused") {
    return {
      matches: false,
      leadMatches: false,
      orderMatches: false,
      outcome: "refused",
      explanation: `authored lead ${authored.leadStableId ?? "(none)"}; select() refused (${proposed.refusalReason ?? "unknown"})`,
    };
  }

  const leadMatches =
    authored.leadStableId === proposed.leadStableId &&
    (authored.leadBackend == null ||
      proposed.leadBackend == null ||
      authored.leadBackend === proposed.leadBackend);

  const orderMatches =
    authored.candidates.length === proposed.candidates.length &&
    authored.candidates.every(
      (stableId, index) => proposed.candidates[index] === stableId,
    );

  const matches = leadMatches && orderMatches;
  return {
    matches,
    leadMatches,
    orderMatches,
    outcome: "selected",
    explanation: matches
      ? "authored and select() stacks agree on lead and order"
      : `authored [${authored.candidates.join(",")}] vs proposed [${proposed.candidates.join(",")}]`,
  };
}

export function buildSelectionShadowCorpusRecord(input: {
  taskIdentity: string | null;
  capabilityRoute: CanonicalCapabilityRouteId;
  axis: string;
  decision: SelectionDecision;
  authored: AuthoredStackView;
  floorDisagreement?: {
    explicit: CapabilityBand;
    derived: CapabilityBand;
  } | null;
}): SelectionShadowCorpusRecord {
  const proposed = proposedStackView(input.decision);
  return {
    contract: SELECTION_SHADOW_CORPUS_CONTRACT,
    schema: SELECTION_SHADOW_CORPUS_SCHEMA_VERSION,
    taskIdentity: input.taskIdentity,
    capabilityRoute: input.capabilityRoute,
    axis: input.axis,
    snapshotVersion: input.decision.explanation.snapshotVersion,
    selectionPolicyVersion: input.decision.explanation.policyVersion,
    authored: input.authored,
    proposed,
    comparison: compareAuthoredVsProposed(input.authored, proposed),
    floorDisagreement: input.floorDisagreement ?? null,
    explanation: input.decision.explanation,
    executed: false,
  };
}

function label(value: string): string {
  return boundedLabel(value) ?? value;
}

/**
 * Deterministic, redacted, reviewable corpus JSON. Explanation lists stay
 * unclipped; only string labels pass the v2 redaction boundary.
 */
export function serializeSelectionShadowCorpusRecord(
  record: SelectionShadowCorpusRecord,
): string {
  const sanitized: SelectionShadowCorpusRecord = {
    ...record,
    taskIdentity:
      record.taskIdentity == null
        ? null
        : (sanitizeFailureDetail(record.taskIdentity, 64) ?? record.taskIdentity),
    capabilityRoute: label(record.capabilityRoute) as CanonicalCapabilityRouteId,
    axis: label(record.axis),
    snapshotVersion: label(record.snapshotVersion),
    selectionPolicyVersion: label(record.selectionPolicyVersion),
    authored: {
      ...record.authored,
      candidates: record.authored.candidates.map(label),
      leadStableId:
        record.authored.leadStableId == null
          ? null
          : label(record.authored.leadStableId),
      leadBackend:
        record.authored.leadBackend == null
          ? null
          : (label(record.authored.leadBackend) as Backend),
      policyVersion: label(record.authored.policyVersion),
    },
    proposed: {
      ...record.proposed,
      refusalReason:
        record.proposed.refusalReason == null
          ? null
          : label(record.proposed.refusalReason),
      candidates: record.proposed.candidates.map(label),
      rungIds: record.proposed.rungIds.map(label),
      leadStableId:
        record.proposed.leadStableId == null
          ? null
          : label(record.proposed.leadStableId),
      leadBackend:
        record.proposed.leadBackend == null
          ? null
          : (label(record.proposed.leadBackend) as Backend),
      leadRungId:
        record.proposed.leadRungId == null
          ? null
          : label(record.proposed.leadRungId),
    },
    comparison: {
      ...record.comparison,
      explanation:
        sanitizeFailureDetail(record.comparison.explanation, 240) ??
        record.comparison.explanation,
    },
    explanation: sanitizeExplanation(record.explanation),
    executed: false,
  };
  return JSON.stringify(sanitized);
}

function sanitizeExplanation(
  explanation: SelectionExplanation,
): SelectionExplanation {
  return {
    ...explanation,
    policyVersion: label(explanation.policyVersion),
    snapshotVersion: label(explanation.snapshotVersion),
    axis: explanation.axis,
    eligible: explanation.eligible.map(label),
    rejected: explanation.rejected.map((entry) => ({
      rungId: label(entry.rungId),
      reason: entry.reason,
    })),
    pruned: explanation.pruned.map((entry) => ({
      rungId: label(entry.rungId),
      dominatedBy: label(entry.dominatedBy),
    })),
    budgetConstrained: explanation.budgetConstrained.map(label),
    unranked: explanation.unranked.map(label),
    leadBackend: explanation.leadBackend,
    ...("leadRepair" in explanation
      ? {
          leadRepair:
            explanation.leadRepair == null
              ? null
              : {
                  from: label(explanation.leadRepair.from),
                  to: label(explanation.leadRepair.to),
                  reason: explanation.leadRepair.reason,
                },
        }
      : {}),
    ...("leadDisplaced" in explanation
      ? { leadDisplaced: explanation.leadDisplaced }
      : {}),
    ...("leadDisplacedByAvailability" in explanation
      ? {
          leadDisplacedByAvailability:
            explanation.leadDisplacedByAvailability,
        }
      : {}),
  };
}
