// Counterfactual replay: take historical routing traces, reconstruct each
// dispatch's routing context, and evaluate it under two policies. Everything
// reported is labelled by provenance:
//   * observed  — what the trace says actually happened;
//   * proxy     — what the executing traversal would select under a policy;
//   * estimate  — cost from snapshot cost priors, present only where a prior exists.
// No quality claim is made or implied; a benchmark row is not an outcome.

import type { AvailabilityState, BackendObservation } from "./availability";
import { budgetStateFor, type BudgetState } from "./budget";
import type { CapabilitySnapshot } from "./capability-snapshot";
import {
  compiledFor,
  evaluateRouting,
  type PredictedTraversal,
  type RoutingEvaluation,
} from "./evaluate-policy";
import type { ModelDefinition } from "./model-schema";
import type { RoutingPolicy } from "./policy-schema";
import type { RoutingContext } from "./routing-context";
import {
  legacyOf,
  phaseOfTrace,
  type ReadRoutingTrace,
  type RoutingTraceV2,
  type TraceRecord,
} from "./trace-schema";
import {
  normalizeWorkloadClass,
  type Backend,
  type TaskPhase,
  type WorkloadClass,
} from "./vocabulary";
import type { WorkloadEvidence } from "./workload-profile";

export const REPLAY_VERSION = "counterfactual-replay/v1" as const;

const UNAVAILABLE_CLASSES: ReadonlySet<string> = new Set([
  "rate_limit",
  "quota_exhausted",
  "provider_outage",
  "missing_binary",
]);

export type ReplayableTrace = {
  id: string;
  traversalId: string | null;
  timestamp: string;
  phase: TaskPhase;
  mode: TraceRecord["mode"];
  workloadClass: WorkloadClass | null;
  requestedAlias: string | null;
  // What actually happened, from the trace.
  observed: {
    selectedStableId: string | null;
    selectedModel: string | null;
    backend: Backend;
    status: TraceRecord["status"];
    attempts: number;
    fallbacks: number;
    // Backends that failed with an availability class during this traversal.
    unavailableBackends: Backend[];
    budgetRemainingCost: number | null;
    label: string | null;
  };
  evidence: WorkloadEvidence | null;
  sources: number;
};

type ReadTrace = Exclude<ReadRoutingTrace, { kind: "invalid" }>;

function unavailableBackendFrom(legacy: TraceRecord, v2: RoutingTraceV2 | null): Backend | null {
  const normalized = v2?.failure.normalized_class ?? null;
  if (normalized && UNAVAILABLE_CLASSES.has(normalized)) {
    return legacy.backend;
  }
  if (legacy.failure_class === "backend_unavailable") {
    return legacy.backend;
  }
  return null;
}

/**
 * Group records into dispatch traversals. v2 records share `traversal_id`;
 * legacy records chain through `fallback_of`. Each group becomes one replayable
 * trace whose observed outcome is the final attempt.
 */
export function groupReplayableTraces(records: readonly ReadTrace[]): ReplayableTrace[] {
  const groups = new Map<string, ReadTrace[]>();
  const runToGroup = new Map<string, string>();
  const order: string[] = [];
  // Chains link backwards (`fallback_of` names the predecessor), so records are
  // walked oldest-first regardless of the order the caller collected them in.
  const chronological = [...records].sort((a, b) => {
    const at = legacyOf(a).timestamp;
    const bt = legacyOf(b).timestamp;
    if (at !== bt) return at.localeCompare(bt);
    const ai = a.kind === "v2" ? a.record.traversal.attempt_index ?? 0 : 0;
    const bi = b.kind === "v2" ? b.record.traversal.attempt_index ?? 0 : 0;
    return ai - bi;
  });
  for (const read of chronological) {
    const legacy = legacyOf(read);
    const v2 = read.kind === "v2" ? read.record : null;
    let key = v2?.traversal.traversal_id ?? null;
    if (!key && legacy.fallback_of && runToGroup.has(legacy.fallback_of)) {
      key = runToGroup.get(legacy.fallback_of)!;
    }
    if (!key) {
      key = legacy.run_id;
    }
    runToGroup.set(legacy.run_id, key);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(read);
  }
  return order.map((key) => {
    const members = groups.get(key)!;
    const sorted = [...members].sort((a, b) => {
      const av = a.kind === "v2" ? a.record.traversal.attempt_index ?? 0 : 0;
      const bv = b.kind === "v2" ? b.record.traversal.attempt_index ?? 0 : 0;
      if (av !== bv) return av - bv;
      return legacyOf(a).timestamp.localeCompare(legacyOf(b).timestamp);
    });
    const last = sorted[sorted.length - 1]!;
    const lastLegacy = legacyOf(last);
    const lastV2 = last.kind === "v2" ? last.record : null;
    const unavailable: Backend[] = [];
    for (const member of sorted) {
      const legacy = legacyOf(member);
      const v2 = member.kind === "v2" ? member.record : null;
      const backend = unavailableBackendFrom(legacy, v2);
      if (backend && !unavailable.includes(backend)) {
        unavailable.push(backend);
      }
    }
    const succeeded = lastLegacy.status === "completed" || lastLegacy.status === "blocked";
    const selectedStableId = succeeded ? (lastV2?.serving.stable_id ?? lastV2?.models.candidate ?? null) : null;
    const workloadProfile = lastV2?.workload_profile ?? lastLegacy.workload_profile ?? null;
    return {
      id: key,
      traversalId: lastV2?.traversal.traversal_id ?? null,
      timestamp: lastLegacy.timestamp,
      phase: phaseOfTrace(lastLegacy),
      mode: lastLegacy.mode,
      workloadClass:
        normalizeWorkloadClass(lastLegacy.workload_class ?? null) ??
        (workloadProfile?.routed_class ?? null),
      requestedAlias: lastV2?.route.requested_public_alias ?? null,
      observed: {
        selectedStableId,
        selectedModel: succeeded ? lastLegacy.model : null,
        backend: lastLegacy.backend,
        status: lastLegacy.status,
        attempts: sorted.length,
        fallbacks: Math.max(0, sorted.length - 1),
        unavailableBackends: unavailable,
        budgetRemainingCost: lastV2?.budgets.root.cost.remaining ?? null,
        label: lastLegacy.label,
      },
      evidence: null,
      sources: sorted.length,
    };
  });
}

export type PolicyOutcome = {
  selectedRungId: string | null;
  selectedStableId: string | null;
  backend: Backend | null;
  index: number | null;
  fallback: boolean;
  refused: boolean;
  exhausted: boolean;
  estimatedUsd: number | null;
  band: number | null;
  budgetViolation: boolean;
  error: string | null;
};

export type ReplayRow = {
  trace: ReplayableTrace;
  current: PolicyOutcome;
  candidate: PolicyOutcome;
  changed: boolean;
  // Whether the current-policy proxy reproduces the observed selection, so a
  // reader can judge how faithful the proxy is before trusting the delta.
  currentMatchesObserved: boolean | null;
};

export type PolicyMetrics = {
  traces: number;
  selections: Record<string, number>;
  backends: Record<string, number>;
  bands: Record<string, number>;
  workloads: Record<string, number>;
  fallbacks: number;
  fallbackRate: number;
  refusals: number;
  unavailableRoutes: number;
  budgetViolations: number;
  estimatedCost: { usd: number; priced: number; unpriced: number };
};

export type ReplayReport = {
  version: typeof REPLAY_VERSION;
  rows: ReplayRow[];
  current: PolicyMetrics;
  candidate: PolicyMetrics;
  changes: number;
  proxyFidelity: { comparable: number; matched: number };
  notes: string[];
};

function outcomeFrom(evaluation: RoutingEvaluation): PolicyOutcome {
  if (evaluation.error || !evaluation.traversal) {
    return {
      selectedRungId: null,
      selectedStableId: null,
      backend: null,
      index: null,
      fallback: false,
      refused: true,
      exhausted: false,
      estimatedUsd: null,
      band: null,
      budgetViolation: false,
      error: evaluation.error?.message ?? "no traversal",
    };
  }
  const traversal: PredictedTraversal = evaluation.traversal;
  const selected = traversal.selected;
  const estimatedUsd = selected?.estimatedUsd ?? null;
  return {
    selectedRungId: selected?.rungId ?? null,
    selectedStableId: selected?.stableId ?? null,
    backend: selected?.backend ?? null,
    index: traversal.selectedIndex,
    fallback: (traversal.selectedIndex ?? 0) > 0,
    refused: false,
    exhausted: traversal.exhausted,
    estimatedUsd,
    band: selected?.band ?? null,
    budgetViolation: estimatedUsd != null && estimatedUsd > evaluation.budget.remaining.cost,
    error: null,
  };
}

function bump(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function emptyMetrics(): PolicyMetrics {
  return {
    traces: 0,
    selections: {},
    backends: {},
    bands: {},
    workloads: {},
    fallbacks: 0,
    fallbackRate: 0,
    refusals: 0,
    unavailableRoutes: 0,
    budgetViolations: 0,
    estimatedCost: { usd: 0, priced: 0, unpriced: 0 },
  };
}

function accumulate(metrics: PolicyMetrics, trace: ReplayableTrace, outcome: PolicyOutcome): void {
  metrics.traces += 1;
  bump(metrics.workloads, trace.workloadClass ?? trace.phase);
  if (outcome.refused) {
    metrics.refusals += 1;
    return;
  }
  if (outcome.exhausted) {
    metrics.unavailableRoutes += 1;
    return;
  }
  bump(metrics.selections, outcome.selectedStableId ?? "(none)");
  bump(metrics.backends, outcome.backend ?? "(none)");
  bump(metrics.bands, outcome.band == null ? "unranked" : `band ${outcome.band}`);
  if (outcome.fallback) metrics.fallbacks += 1;
  if (outcome.budgetViolation) metrics.budgetViolations += 1;
  if (outcome.estimatedUsd == null) {
    metrics.estimatedCost.unpriced += 1;
  } else {
    metrics.estimatedCost.priced += 1;
    metrics.estimatedCost.usd += outcome.estimatedUsd;
  }
}

function finalize(metrics: PolicyMetrics): PolicyMetrics {
  const dispatched = metrics.traces - metrics.refusals - metrics.unavailableRoutes;
  metrics.fallbackRate = dispatched > 0 ? metrics.fallbacks / dispatched : 0;
  metrics.estimatedCost.usd = Math.round(metrics.estimatedCost.usd * 10000) / 10000;
  return metrics;
}

export function contextForTrace(trace: ReplayableTrace, nowMs: number, budget?: BudgetState | null): RoutingContext {
  const observations: BackendObservation[] = trace.observed.unavailableBackends.map((backend) => ({
    backend,
    classification: "provider_outage",
    observedAtMs: nowMs,
  }));
  const availability: AvailabilityState = { backends: observations };
  return {
    phase: trace.phase,
    workloadClass: trace.workloadClass,
    evidence: trace.evidence,
    // Pinned dispatches are replayed as automatic: an explicit --route has no
    // counterfactual under a different chain, and the row notes the pin.
    requestedAlias: null,
    availability,
    budget:
      budget ??
      (trace.observed.budgetRemainingCost != null
        ? budgetStateFor({ remaining: { cost: trace.observed.budgetRemainingCost } })
        : null),
    nowMs,
    taskIdentity: trace.id,
  };
}

export type ReplayOptions = {
  nowMs: number;
  // Treat explicit `--route` pins as automatic when replaying (default true):
  // a pinned dispatch has no counterfactual under a different chain.
  budget?: BudgetState | null;
};

export function replayTraces(
  traces: readonly ReplayableTrace[],
  policies: { current: RoutingPolicy; candidate: RoutingPolicy },
  registry: readonly ModelDefinition[],
  snapshot: CapabilitySnapshot | null,
  options: ReplayOptions,
): ReplayReport {
  const currentCompiled = compiledFor(policies.current, registry);
  const candidateCompiled = compiledFor(policies.candidate, registry);
  const current = emptyMetrics();
  const candidate = emptyMetrics();
  const rows: ReplayRow[] = [];
  let comparable = 0;
  let matched = 0;
  for (const trace of traces) {
    const context = contextForTrace(trace, options.nowMs, options.budget);
    const currentOutcome = outcomeFrom(
      evaluateRouting({ policy: policies.current, registry, snapshot, context, compiled: currentCompiled }),
    );
    const candidateOutcome = outcomeFrom(
      evaluateRouting({ policy: policies.candidate, registry, snapshot, context, compiled: candidateCompiled }),
    );
    accumulate(current, trace, currentOutcome);
    accumulate(candidate, trace, candidateOutcome);
    let currentMatchesObserved: boolean | null = null;
    if (trace.observed.selectedStableId && !currentOutcome.refused) {
      comparable += 1;
      currentMatchesObserved = currentOutcome.selectedStableId === trace.observed.selectedStableId;
      if (currentMatchesObserved) matched += 1;
    }
    rows.push({
      trace,
      current: currentOutcome,
      candidate: candidateOutcome,
      changed: currentOutcome.selectedRungId !== candidateOutcome.selectedRungId,
      currentMatchesObserved,
    });
  }
  const notes = [
    "observed = recorded in the trace; proxy = predicted authored-stack traversal under the policy; estimate = snapshot cost priors where present.",
    "Estimated cost sums only priced selections; unpriced selections are counted, never guessed.",
    "No quality change is claimed: capability bands are benchmark evidence, not outcomes on these tasks.",
  ];
  return {
    version: REPLAY_VERSION,
    rows,
    current: finalize(current),
    candidate: finalize(candidate),
    changes: rows.filter((row) => row.changed).length,
    proxyFidelity: { comparable, matched },
    notes,
  };
}
