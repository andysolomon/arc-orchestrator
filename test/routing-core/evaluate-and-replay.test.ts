// The shared evaluation engine and counterfactual replay. Availability,
// budget, quota, override, exclusion, unknown-benchmark, and unknown-pricing
// behavior are exercised through `evaluateRouting` — the same function the
// control plane's simulator calls — over the shipped policy and registry.

import { describe, expect, test } from "bun:test";
import { MODEL_POLICY } from "../../plugins/arc-orchestrator/lib/model-policy";
import { MODEL_REGISTRY } from "../../plugins/arc-orchestrator/lib/model-registry";
import { DEFAULT_CAPABILITY_SNAPSHOT } from "../../plugins/orchestrator-core/routing-policy";
import {
  budgetStateFor,
  clonePolicy,
  emptyCapabilitySnapshot,
  evaluateRouting,
  explainEvaluation,
  groupReplayableTraces,
  readRoutingTrace,
  renderExplanationText,
  replayTraces,
  unavailable,
  type CapabilitySnapshot,
  type RoutingContext,
  type RoutingTraceV2,
  type TraceRecord,
} from "../../packages/routing-core/src/index";

const NOW_MS = Date.parse("2026-09-26T00:00:00Z");
const snapshot = DEFAULT_CAPABILITY_SNAPSHOT;

function evaluate(context: Partial<RoutingContext> & { phase: RoutingContext["phase"] }, overrides: { snapshot?: CapabilitySnapshot | null; policy?: typeof MODEL_POLICY } = {}) {
  return evaluateRouting({
    policy: overrides.policy ?? MODEL_POLICY,
    registry: MODEL_REGISTRY,
    snapshot: overrides.snapshot === undefined ? snapshot : overrides.snapshot,
    context: { nowMs: NOW_MS, taskIdentity: "test", ...context },
  });
}

describe("evaluateRouting: executing traversal", () => {
  test("hard-medium leads with Sol on codex, tail after the primary chain", () => {
    const evaluation = evaluate({ phase: "implement", workloadClass: "hard-medium" });
    expect(evaluation.error).toBeNull();
    expect(evaluation.traversal?.selected?.rungId).toBe("gpt-6-sol@high");
    expect(evaluation.traversal?.selected?.backend).toBe("codex");
    expect(evaluation.tailStartIndex).toBe(3);
    expect(evaluation.traversal?.steps.slice(3).every((step) => step.inTail)).toBe(true);
  });

  test("an unavailable lead backend advances to the next rung (availability-only fallback)", () => {
    const evaluation = evaluate({ phase: "implement", workloadClass: "hard-medium", availability: { backends: unavailable(["codex"], NOW_MS) } });
    expect(evaluation.traversal?.selected?.rungId).toBe("cursor-grok-4.7-high@high");
    expect(evaluation.traversal?.steps[0]?.status).toBe("unavailable");
    expect(evaluation.traversal?.availabilitySkips).toBe(1);
    const explained = explainEvaluation(evaluation, MODEL_REGISTRY, MODEL_POLICY);
    expect(explained.headline).toBe("Selected: Cursor Grok 4.7 High @ high");
    expect(explained.lines.join("\n")).toContain("Codex Sol was unavailable (codex observed provider_outage)");
  });

  test("stale availability observations expire and the lead returns", () => {
    const stale = unavailable(["codex"], NOW_MS - 120_000);
    const evaluation = evaluate({ phase: "implement", workloadClass: "hard-medium", availability: { backends: stale } });
    expect(evaluation.traversal?.selected?.rungId).toBe("gpt-6-sol@high");
  });

  test("every backend unavailable exhausts the stack and the explanation says so", () => {
    const evaluation = evaluate({ phase: "verify", availability: { backends: unavailable(["codex", "claude", "composer", "opencode", "minimax", "kimi"], NOW_MS) } });
    expect(evaluation.traversal?.exhausted).toBe(true);
    expect(evaluation.traversal?.selected).toBeNull();
    expect(explainEvaluation(evaluation, MODEL_REGISTRY).headline).toBe("Selected: none (stack exhausted)");
  });

  test("worker phases route on their own stacks; analyze is parent-local; implement needs a class", () => {
    expect(evaluate({ phase: "explore" }).traversal?.selected?.rungId).toBe("fable-5.1@high");
    expect(evaluate({ phase: "verify" }).traversal?.selected?.rungId).toBe("gpt-6-luna@max");
    expect(evaluate({ phase: "deploy" }).traversal?.selected?.rungId).toBe("gpt-5.5@low");
    expect(evaluate({ phase: "analyze" }).error?.code).toBe("parent-local-phase");
    expect(evaluate({ phase: "implement" }).error?.code).toBe("workload-class-required");
  });

  test("an explicit route pins one candidate and never inherits fallback", () => {
    const evaluation = evaluate({ phase: "implement", requestedAlias: "sol-implement" });
    expect(evaluation.stack?.automaticFallback).toBe(false);
    expect(evaluation.traversal?.steps).toHaveLength(1);
    expect(evaluation.traversal?.selected?.rungId).toBe("gpt-6-sol@none");
    expect(evaluate({ phase: "verify", requestedAlias: "sol-implement" }).error?.code).toBe("alias-route-mismatch");
    expect(evaluate({ phase: "implement", requestedAlias: "nope-implement" }).error?.code).toBe("unknown-alias");
  });
});

describe("evaluateRouting: workload evidence", () => {
  test("evidence derives the class when no explicit class is given, and the trace record says so", () => {
    const evaluation = evaluate({ phase: "implement", evidence: { scope: { packages: 2, crossPackage: true }, change: { estimatedFiles: 6, authBoundary: true } } });
    expect(evaluation.error).toBeNull();
    expect(evaluation.workloadClass).toBe("hard-medium");
    expect(evaluation.workloadClassSource).toBe("profiled");
    expect(evaluation.workloadProfileRecord?.class_source).toBe("profiled");
    expect(evaluation.workloadProfileRecord?.routed_class).toBe("hard-medium");
    expect(evaluation.stack?.workloadClass).toBe("hard-medium");
  });

  test("an explicit class wins over the profile and the disagreement is recorded", () => {
    const evaluation = evaluate({ phase: "implement", workloadClass: "easy-light", evidence: { change: { estimatedFiles: 6, authBoundary: true } } });
    expect(evaluation.workloadClass).toBe("easy-light");
    expect(evaluation.workloadClassSource).toBe("explicit");
    expect(evaluation.classDisagreement).toEqual({ explicit: "easy-light", profiled: "hard-medium" });
    expect(evaluation.workloadProfileRecord?.disagreement).toEqual({ explicit: "easy-light", profiled: "hard-medium" });
    expect(explainEvaluation(evaluation, MODEL_REGISTRY).lines.join("\n")).toContain("would have classified it hard-medium");
  });

  test("insufficient evidence fails closed instead of inventing a class", () => {
    const evaluation = evaluate({ phase: "implement", evidence: { execution: { previousFailures: 3 } } });
    expect(evaluation.error?.code).toBe("insufficient-evidence");
  });
});

describe("evaluateRouting: capability-rung selection layer", () => {
  test("floor, override, and exclusions flow through select()", () => {
    const evaluation = evaluate({ phase: "implement", workloadClass: "hard-heavy" });
    expect(evaluation.floor?.source).toBe("workload-class");
    expect(evaluation.selection?.outcome).toBe("selected");

    const overridden = evaluate({ phase: "implement", workloadClass: "hard-heavy", override: { model: "Opus 5.5", effort: "low" } });
    expect(overridden.selection?.outcome).toBe("selected");
    expect(overridden.selection?.explanation.overrideApplied).toBe(true);
    expect(overridden.selection?.outcome === "selected" && overridden.selection.stack.every((rung) => rung.stableId === "opus-5.5")).toBe(true);
    expect(evaluate({ phase: "implement", workloadClass: "hard-heavy", override: { model: "unknown-model" } }).error?.code).toBe("override-unknown-model");

    const excluded = evaluate({ phase: "verify", excludedStableId: "gpt-6-luna" });
    expect(excluded.selection?.explanation.rejected.some((entry) => entry.rungId.startsWith("gpt-6-luna@") && entry.reason === "excluded-rung")).toBe(true);
  });

  test("an exhausted budget refuses at the selection layer while the traversal still predicts a dispatch", () => {
    const evaluation = evaluate({ phase: "implement", workloadClass: "medium-medium", budget: budgetStateFor({ remaining: { cost: 0 } }) });
    expect(evaluation.selection?.outcome).toBe("refused");
    expect(evaluation.selection?.outcome === "refused" && evaluation.selection.reason).toBe("budget-exhausted");
    expect(evaluation.traversal?.selected).not.toBeNull();
  });

  test("a tiny budget constrains priced rungs and unpriced rungs survive (unknown cost is not cheap, but is not filtered)", () => {
    const evaluation = evaluate({ phase: "implement", workloadClass: "medium-medium", budget: budgetStateFor({ remaining: { cost: 0.01 } }) });
    const explanation = evaluation.selection!.explanation;
    expect(explanation.budgetConstrained.length).toBeGreaterThan(0);
    if (evaluation.selection!.outcome === "selected") {
      for (const rung of evaluation.selection!.stack) {
        expect(rung.estimatedUsd == null || rung.estimatedUsd <= 0.01).toBe(true);
      }
    }
  });

  test("an observed-zero quota pool rejects; an unobservable pool does not", () => {
    // gpt-5.5 is measured in the shipped snapshot and leads no stack, so its
    // rungs are visible to both layers on easy-light once the GLM lead is out.
    const withPool: CapabilitySnapshot = {
      ...snapshot,
      rungs: snapshot.rungs.map((rung) => (rung.stableId === "gpt-5.5" ? { ...rung, quotaPool: "codex-plan" } : rung)),
    };
    const availability = { backends: unavailable(["opencode"], NOW_MS), quotaPools: [{ pool: "codex-plan", remainingFraction: 0, resetsAtMs: null, observedAtMs: NOW_MS }] };
    const exhausted = evaluate({ phase: "implement", workloadClass: "easy-light", availability }, { snapshot: withPool });
    expect(exhausted.traversal?.steps[1]?.status).toBe("quota-exhausted");
    expect(exhausted.traversal?.selected?.rungId).toBe("cursor-grok-4.7-high@high");
    expect(exhausted.selection?.explanation.rejected.some((entry) => entry.rungId === "gpt-5.5@low" && entry.reason === "quota-pool-exhausted")).toBe(true);
    const unknown = evaluate({ phase: "implement", workloadClass: "easy-light", availability: { ...availability, quotaPools: [{ pool: "codex-plan", remainingFraction: null, resetsAtMs: null, observedAtMs: NOW_MS }] } }, { snapshot: withPool });
    expect(unknown.traversal?.selected?.rungId).toBe("gpt-5.5@low");
    expect(unknown.selection?.explanation.rejected.some((entry) => entry.reason === "quota-pool-exhausted")).toBe(false);
  });

  test("with no snapshot every rung is unranked, floors are 0, and nothing is refused for capability", () => {
    const evaluation = evaluate({ phase: "implement", workloadClass: "hard-heavy" }, { snapshot: null });
    expect(evaluation.floor?.capabilityFloor).toBe(0);
    expect(evaluation.selection?.outcome).toBe("selected");
    expect(evaluation.selection?.explanation.unranked.length).toBeGreaterThan(0);
    expect(evaluation.selection?.explanation.rejected.some((entry) => entry.reason === "below-capability-floor")).toBe(false);
    const empty = evaluate({ phase: "implement", workloadClass: "hard-heavy" }, { snapshot: emptyCapabilitySnapshot() });
    expect(empty.selection?.explanation.snapshotVersion).toBe("0000-00-00+empty");
  });

  test("unranked rungs sort behind ranked ones: unknown capability is never preferred", () => {
    const evaluation = evaluate({ phase: "implement", workloadClass: "hard-heavy" });
    if (evaluation.selection?.outcome !== "selected") throw new Error("expected selection");
    const stack = evaluation.selection.stack;
    const firstUnranked = stack.findIndex((rung) => rung.band == null);
    if (firstUnranked >= 0) {
      expect(stack.slice(firstUnranked).every((rung) => rung.band == null)).toBe(true);
    }
    const explained = explainEvaluation(evaluation, MODEL_REGISTRY, MODEL_POLICY);
    expect(renderExplanationText(explained)).toContain("capability-rung selection (routing proxy");
    expect(explained.selection.some((verdict) => verdict.verdict === "unranked")).toBe(true);
  });

  test("determinism: equal inputs produce byte-identical evaluations", () => {
    const context: RoutingContext = { phase: "implement", workloadClass: "medium-heavy", availability: { backends: unavailable(["composer"], NOW_MS) }, nowMs: NOW_MS, taskIdentity: "d" };
    const a = evaluateRouting({ policy: MODEL_POLICY, registry: MODEL_REGISTRY, snapshot, context });
    const b = evaluateRouting({ policy: MODEL_POLICY, registry: MODEL_REGISTRY, snapshot, context: JSON.parse(JSON.stringify(context)) });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

function legacyRecord(overrides: Partial<TraceRecord>): TraceRecord {
  return {
    schema: 4,
    run_id: "run-1",
    timestamp: "2026-09-20T00:00:00.000Z",
    backend: "codex",
    mode: "implement",
    phase: "implement",
    model: "gpt-6-sol",
    sandbox: "workspace-write",
    project: "abc123def456",
    label: null,
    task_class: null,
    workload_class: "hard-medium",
    route_rationale: null,
    duration_ms: 1000,
    status: "completed",
    exit_code: 0,
    changed_files: 1,
    tokens: null,
    budget: null,
    error: null,
    ...overrides,
  };
}

function v2Record(legacy: TraceRecord, overrides: Partial<RoutingTraceV2> = {}): RoutingTraceV2 {
  return {
    contract: "orchestrator-routing-trace/v2",
    schema: 2,
    timestamp: legacy.timestamp,
    status: legacy.status,
    route: { requested_public_alias: null, requested_alias_kind: null, canonical_capability_route: "implement.workspace-write.v1" },
    models: { requested: "gpt-6-sol", candidate: "gpt-6-sol", attempted: "gpt-6-sol", selected: legacy.status === "completed" ? "gpt-6-sol" : null },
    serving: { provider: "OpenAI (Codex)", provider_model_id: "gpt-6-sol", transport_backend: "codex", adapter_id: "codex-exec", adapter_version: "1", stable_id: "gpt-6-sol" },
    traversal: { candidate_index: 0, attempt_index: 0, stack_size: 6, traversal_id: "trav-1" },
    failure: { normalized_class: null, detail: null, fallback_source: null, fallback_destination: null, fallback_reason: null, terminal_reason: null },
    authorization: { override_requested: false, override_applied: false, explicit_parent_escalation: false, sol_authorized: false },
    lineage: { root_run_id: legacy.run_id, parent_run_id: null, run_id: legacy.run_id, task_id: null, depth: 0, scheduler_id: null },
    worktree: { checkout_id: "abc123def456" },
    versions: { policy: "runner-routing-v4", budget_policy: "budget-limits/v1", registry: 3, capability_routes: 1, routing_shadow: 1, routing_trace: 2 },
    budgets: {
      root: { token: { allocated: 2000000, consumed: 0, remaining: 2000000 }, wall_time_ms: { allocated: 3600000, consumed: 0, remaining: 3600000 }, call: { allocated: 25, consumed: 1, remaining: 24 }, cost: { allocated: 10, consumed: 2.5, remaining: 7.5, measurement: "unknown" }, concurrency: { allocated: 3, consumed: 1, remaining: 2 } },
      dispatch: { token: { allocated: 400000, consumed: 0, remaining: 400000 }, wall_time_ms: { allocated: 900000, consumed: 0, remaining: 900000 }, call: { allocated: 1, consumed: 1, remaining: 0 }, cost: { allocated: 2.5, consumed: 2.5, remaining: 0, measurement: "unknown" }, concurrency: { allocated: 1, consumed: 1, remaining: 0 } },
    },
    legacy,
    ...overrides,
  };
}

describe("counterfactual replay", () => {
  test("groups a traversal, reconstructs availability, and compares two policies", () => {
    const failed = legacyRecord({ run_id: "run-a1", status: "error", failure_class: "backend_unavailable", outage_reason: "usage_limit", error: "codex unavailable" });
    const recovered = legacyRecord({ run_id: "run-a2", backend: "composer", model: "cursor-grok-4.7-high", fallback_of: "run-a1" });
    const records = [
      v2Record(failed, { failure: { normalized_class: "quota_exhausted", detail: null, fallback_source: null, fallback_destination: null, fallback_reason: null, terminal_reason: null }, traversal: { candidate_index: 0, attempt_index: 0, stack_size: 6, traversal_id: "trav-a" } }),
      v2Record(recovered, { serving: { provider: "Cursor", provider_model_id: "cursor-grok-4.7-high", transport_backend: "composer", adapter_id: "cursor-agent", adapter_version: "1", stable_id: "cursor-grok-4.7-high" }, traversal: { candidate_index: 1, attempt_index: 1, stack_size: 6, traversal_id: "trav-a" } }),
      v2Record(legacyRecord({ run_id: "run-b", workload_class: "easy-light", model: "opencode-go/glm-5.3-flash", backend: "opencode" }), { serving: { provider: "OpenCode Go", provider_model_id: "opencode-go/glm-5.3-flash", transport_backend: "opencode", adapter_id: "opencode", adapter_version: "1", stable_id: "opencode-go-glm-5.3-flash" }, traversal: { candidate_index: 0, attempt_index: 0, stack_size: 6, traversal_id: "trav-b" } }),
    ];
    const reads = records.map((record) => readRoutingTrace(record)).filter((read) => read.kind !== "invalid") as never[];
    const traces = groupReplayableTraces(reads);
    expect(traces).toHaveLength(2);
    expect(traces[0]!.observed.unavailableBackends).toEqual(["codex"]);
    expect(traces[0]!.observed.selectedStableId).toBe("cursor-grok-4.7-high");
    expect(traces[0]!.observed.fallbacks).toBe(1);

    const candidate = clonePolicy(MODEL_POLICY);
    (candidate.workloadChains["hard-medium"] as string[])[0] = "opus-5.5@high";
    (candidate.workloadChains["easy-light"] as string[])[0] = "gpt-5.5@low";
    const report = replayTraces(traces, { current: MODEL_POLICY, candidate }, MODEL_REGISTRY, snapshot, { nowMs: NOW_MS });
    expect(report.rows).toHaveLength(2);
    // Current policy: codex unavailable → Grok, matching what was observed.
    expect(report.rows[0]!.current.selectedRungId).toBe("cursor-grok-4.7-high@high");
    expect(report.rows[0]!.currentMatchesObserved).toBe(true);
    expect(report.rows[0]!.current.fallback).toBe(true);
    // Candidate policy: Opus leads and claude was not unavailable → no fallback.
    expect(report.rows[0]!.candidate.selectedRungId).toBe("opus-5.5@high");
    expect(report.rows[0]!.candidate.fallback).toBe(false);
    expect(report.rows[1]!.candidate.selectedRungId).toBe("gpt-5.5@low");
    expect(report.changes).toBe(2);
    expect(report.current.fallbacks).toBe(1);
    expect(report.candidate.fallbacks).toBe(0);
    expect(report.current.backends).toEqual({ composer: 1, opencode: 1 });
    expect(report.candidate.backends).toEqual({ claude: 1, codex: 1 });
    expect(report.proxyFidelity).toEqual({ comparable: 2, matched: 2 });
    expect(report.current.estimatedCost.unpriced + report.current.estimatedCost.priced).toBe(2);
    expect(report.notes.join(" ")).toContain("No quality change is claimed");
  });

  test("a fallback chain is one traversal regardless of record order", () => {
    const first = legacyRecord({ run_id: "run-c1", status: "error", failure_class: "backend_unavailable", outage_reason: "usage_limit", timestamp: "2026-09-20T00:00:00.000Z" });
    const second = legacyRecord({ run_id: "run-c2", backend: "composer", model: "cursor-grok-4.7-high", fallback_of: "run-c1", timestamp: "2026-09-20T00:00:05.000Z" });
    const newestFirst = [second, first].map((record) => readRoutingTrace(record)) as never[];
    const traces = groupReplayableTraces(newestFirst);
    expect(traces).toHaveLength(1);
    expect(traces[0]!.observed.attempts).toBe(2);
    expect(traces[0]!.observed.unavailableBackends).toEqual(["codex"]);
    expect(traces[0]!.observed.selectedModel).toBe("cursor-grok-4.7-high");
  });

  test("a legacy-only trace without a class replays as a refusal, not a guess", () => {
    const read = readRoutingTrace(legacyRecord({ workload_class: null }));
    const traces = groupReplayableTraces([read as never]);
    const report = replayTraces(traces, { current: MODEL_POLICY, candidate: MODEL_POLICY }, MODEL_REGISTRY, snapshot, { nowMs: NOW_MS });
    expect(report.current.refusals).toBe(1);
    expect(report.rows[0]!.current.error).toContain("workload class");
  });
});
