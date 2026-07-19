import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  type BackendInvocationInput,
  type BackendInvocationOutput,
  executeRun,
  type InvokeBackend,
} from "../plugins/fable-orchestrator/lib/engine";
import { ROUTE_SELECTION_STAGE_ENV } from "../plugins/fable-orchestrator/lib/selection-activation";
import {
  buildRoutingTraceV2,
  DISPATCH_COST_RESERVATION_V1,
  isRoutingTraceV2,
  ROUTING_TRACE_V2_CONTRACT,
  ROUTING_TRACE_V2_SCHEMA_VERSION,
  type RoutingTraceV2,
  type RoutingTraceV2BudgetScope,
  type TraceRecord,
} from "../plugins/fable-orchestrator/lib/trace-schema";
import {
  DelegationScheduler,
} from "../plugins/fable-orchestrator/lib/delegation-scheduler";
import { BUDGET_LIMITS_V1 } from "../plugins/fable-orchestrator/lib/delegation-budget";

const FIXTURE_DIR = resolve(import.meta.dir, "fixtures/trace-v2");
const projectRoot = resolve(import.meta.dir, "..");
const runner = resolve(
  projectRoot,
  "plugins/fable-orchestrator/bin/fable-orchestrator",
);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createFakeCodexFixture(): {
  executable: string;
  argumentsPath: string;
  workspace: string;
  traceDirectory: string;
} {
  const directory = mkdtempSync(`${tmpdir()}/trace-v2-cli-`);
  temporaryDirectories.push(directory);
  const executable = resolve(directory, "codex");
  const argumentsPath = resolve(directory, "arguments.json");
  const workspace = resolve(directory, "workspace");
  const traceDirectory = resolve(directory, "traces");

  Bun.spawnSync(["mkdir", "-p", workspace]);

  writeFileSync(
    executable,
    `#!/bin/sh
printf '%s\\n' "$@" | jq -R -s 'split("\\n")[:-1]' > "$FAKE_CODEX_ARGUMENTS"
output_file=""
previous=""
for argument in "$@"; do
  if [ "$previous" = "--output-last-message" ]; then
    output_file="$argument"
  fi
  previous="$argument"
done
printf '%s\\n' '{"type":"thread.started","thread_id":"fake-thread"}'
printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":1200,"cached_input_tokens":200,"output_tokens":300}}'
printf '%s\\n' '{"status":"completed","summary":"done","changes":[],"verification":[],"risks":[],"next_actions":[]}' > "$output_file"
`,
  );
  chmodSync(executable, 0o755);
  return { executable, argumentsPath, workspace, traceDirectory };
}

function readJsonl<T>(directory: string, fileName: string): T[] {
  const path = resolve(directory, fileName);
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

const v2Fixture = JSON.parse(
  readFileSync(resolve(FIXTURE_DIR, "routing-trace-v2.json"), "utf8"),
) as RoutingTraceV2;

const completedResult = {
  status: "completed",
  summary: "done",
  changes: [],
  verification: [],
  risks: [],
  next_actions: [],
};

function budgetDimensions(scope: RoutingTraceV2BudgetScope): string[] {
  return Object.keys(scope);
}

function assertRequiredV2Fields(
  record: RoutingTraceV2,
  options: { historical?: boolean } = {},
): void {
  expect(record.contract).toBe(ROUTING_TRACE_V2_CONTRACT);
  expect(record.schema).toBe(ROUTING_TRACE_V2_SCHEMA_VERSION);
  expect(record.timestamp).toBeTruthy();
  expect(record.status).toMatch(/^(completed|blocked|error)$/);

  for (const key of [
    "requested_public_alias",
    "requested_alias_kind",
    "canonical_capability_route",
  ] as const) {
    expect(record.route).toHaveProperty(key);
  }

  for (const key of ["requested", "candidate", "attempted", "selected"] as const) {
    expect(record.models).toHaveProperty(key);
  }

  for (const key of [
    "provider",
    "provider_model_id",
    "transport_backend",
    "adapter_id",
    "adapter_version",
    "stable_id",
  ] as const) {
    expect(record.serving).toHaveProperty(key);
  }

  for (const key of [
    "candidate_index",
    "attempt_index",
    "stack_size",
    "traversal_id",
  ] as const) {
    expect(record.traversal).toHaveProperty(key);
  }

  for (const key of [
    "normalized_class",
    "detail",
    "fallback_source",
    "fallback_destination",
    "fallback_reason",
    "terminal_reason",
  ] as const) {
    expect(record.failure).toHaveProperty(key);
  }

  for (const key of [
    "override_requested",
    "override_applied",
    "explicit_parent_escalation",
    "sol_authorized",
  ] as const) {
    expect(record.authorization).toHaveProperty(key);
  }

  for (const key of [
    "root_run_id",
    "parent_run_id",
    "run_id",
    "task_id",
    "depth",
    "scheduler_id",
  ] as const) {
    expect(record.lineage).toHaveProperty(key);
  }

  expect(record.worktree).toHaveProperty("checkout_id");
  if (!options.historical) {
    expect(record).toHaveProperty("orchestrator_identity");
  }
  expect(record.legacy.schema).toBe(4);

  for (const key of [
    "policy",
    "budget_policy",
    "registry",
    "capability_routes",
    "routing_shadow",
    "routing_trace",
  ] as const) {
    expect(record.versions).toHaveProperty(key);
  }

  for (const scopeName of ["root", "dispatch"] as const) {
    const scope = record.budgets[scopeName];
    expect(budgetDimensions(scope).sort()).toEqual(
      ["call", "concurrency", "cost", "token", "wall_time_ms"].sort(),
    );
    for (const dimension of budgetDimensions(scope)) {
      const budget = scope[dimension as keyof RoutingTraceV2BudgetScope];
      expect(budget).toHaveProperty("allocated");
      expect(budget).toHaveProperty("consumed");
      expect(budget).toHaveProperty("remaining");
    }
  }
}

function baselineLegacy(overrides: Partial<TraceRecord> = {}): TraceRecord {
  return {
    schema: 4,
    run_id: "run-test",
    timestamp: "2026-07-11T00:00:00.000Z",
    backend: "codex",
    orchestrator_identity: null,
    mode: "implement",
    model: "gpt-5.6-terra",
    sandbox: "workspace-write",
    project: "abc123def456",
    label: "W-000074",
    task_class: "feature",
    route_rationale: "test",
    duration_ms: 1000,
    status: "completed",
    exit_code: 0,
    changed_files: 1,
    tokens: {
      input_tokens: 10,
      cached_input_tokens: null,
      output_tokens: 20,
      total_tokens: 30,
    },
    budget: null,
    error: null,
    ...overrides,
  };
}

function successFor(input: BackendInvocationInput): BackendInvocationOutput {
  const usage =
    input.backend === "codex"
      ? { input_tokens: 10, output_tokens: 20, total_tokens: 30 }
      : { inputTokens: 15, outputTokens: 25, totalTokens: 40 };
  if (input.backend === "codex") {
    return {
      stdout: JSON.stringify({ type: "turn.completed", usage }),
      stderr: "",
      exitCode: 0,
      resultText: JSON.stringify(completedResult),
    };
  }
  return {
    stdout: JSON.stringify({
      is_error: false,
      ...(input.backend === "composer"
        ? { result: JSON.stringify(completedResult) }
        : { structured_output: completedResult }),
      usage,
    }),
    stderr: "",
    exitCode: 0,
  };
}

describe("orchestrator-routing-trace/v2 schema", () => {
  test("historical v2 fixture omitting additive identity remains dual-readable", () => {
    assertRequiredV2Fields(v2Fixture, { historical: true });
    expect(v2Fixture).not.toHaveProperty("orchestrator_identity");
    expect(v2Fixture.orchestrator_identity).toBeUndefined();
    expect(v2Fixture.legacy.run_id).toBe("run-v2-1");
    expect(isRoutingTraceV2(v2Fixture)).toBe(true);
    expect(isRoutingTraceV2({ contract: "other" })).toBe(false);
  });

  test("buildRoutingTraceV2 computes remaining budgets and embeds legacy", () => {
    const legacy = baselineLegacy({ orchestrator_identity: "fable" });
    const record = buildRoutingTraceV2({
      legacy,
      route: {
        requestedPublicAlias: "codex-implement",
        requestedAliasKind: "executable-route",
        canonicalCapabilityRoute: "implement.workspace-write.v1",
      },
      models: {
        requested: "gpt-5.6-terra",
        candidate: "composer-2.5",
        attempted: "composer-2.5",
        selected: "composer-2.5",
      },
      serving: {
        provider: "Cursor",
        providerModelId: "composer-2.5",
        transportBackend: "composer",
        adapterId: "cursor-agent",
        adapterVersion: "1",
        stableId: "composer-2.5",
      },
      traversal: {
        candidateIndex: 0,
        attemptIndex: 0,
        stackSize: 2,
        traversalId: "trav-test",
      },
      lineage: { rootRunId: legacy.run_id, depth: 0 },
      budgets: {
        root: { token: { allocated: 100, consumed: 30 } },
        dispatch: { token: { allocated: 50, consumed: 30 } },
      },
    });

    assertRequiredV2Fields(record);
    expect(record.budgets.root.token.remaining).toBe(70);
    expect(record.budgets.dispatch.token.remaining).toBe(20);
    expect(record.legacy.run_id).toBe(legacy.run_id);
    expect(record.legacy).not.toBe(legacy);
    expect(record.worktree.checkout_id).toBe(legacy.project);
    expect(record.orchestrator_identity).toBe("fable");
    expect(record.legacy.orchestrator_identity).toBe("fable");
  });

  test("delegation scheduler context feeds cumulative root and dispatch budgets", () => {
    const scheduler = new DelegationScheduler("sched-trace");
    const authority = scheduler.issueParentAuthority();
    const admitted = scheduler.admitDispatch(authority, {
      taskKey: "root-task",
      parentTaskKey: null,
      runId: "run-root",
      routing: { requestedRoute: "composer-implement" },
      checkoutRaw: "/tmp/fable-orchestrator-trace-checkout",
    });
    expect(admitted.admitted).toBe(true);
    if (!admitted.admitted) {
      return;
    }

    const context = scheduler.buildRoutingTraceV2Context(admitted.taskIdentity);
    expect(context).not.toBeNull();

    const legacy = baselineLegacy({ run_id: "run-root" });
    const record = buildRoutingTraceV2({
      legacy,
      route: {
        requestedPublicAlias: "composer-implement",
        requestedAliasKind: "executable-route",
        canonicalCapabilityRoute: "implement.workspace-write.v1",
      },
      models: {
        requested: "composer-2.5",
        candidate: "composer-2.5",
        attempted: "composer-2.5",
        selected: "composer-2.5",
      },
      serving: {
        provider: "Cursor",
        providerModelId: "composer-2.5",
        transportBackend: "composer",
        adapterId: "cursor-agent",
        adapterVersion: "1",
        stableId: "composer-2.5",
      },
      traversal: {
        candidateIndex: 0,
        attemptIndex: 0,
        stackSize: 1,
        traversalId: "trav-delegation",
      },
      lineage: {
        rootRunId: "run-root",
        depth: context!.depth ?? 0,
        schedulerId: context!.schedulerId ?? null,
      },
      budgets: {
        root: {
          token: {
            allocated: context!.rootBudget?.token?.allocated,
            consumed: (context!.rootBudget?.token?.consumed ?? 0) + 25_000,
          },
        },
        dispatch: {
          token: {
            allocated: context!.dispatchBudget?.token?.allocated,
            consumed: 25_000,
          },
          cost: {
            allocated: context!.dispatchBudget?.cost?.allocated,
            consumed: DISPATCH_COST_RESERVATION_V1,
            measurement: "unknown",
          },
        },
      },
    });

    expect(record.budgets.root.token.allocated).toBe(BUDGET_LIMITS_V1.root.token);
    expect(record.budgets.dispatch.token.allocated).toBe(BUDGET_LIMITS_V1.dispatch.token);
    expect(record.budgets.root.token.consumed).toBe(25_000);
    expect(record.budgets.root.token.remaining).toBe(
      BUDGET_LIMITS_V1.root.token - 25_000,
    );
    expect(record.budgets.dispatch.cost.measurement).toBe("unknown");
  });

  test("unknown cost reconciles at full dispatch reservation once per traversal", async () => {
    const invokeBackend: InvokeBackend = async (input) => successFor(input);
    const v2Records: RoutingTraceV2[] = [];

    await executeRun(
      {
        backend: "composer",
        mode: "implement",
        task: "do work",
        cwd: process.cwd(),
        label: null,
        taskClass: null,
        routeRationale: null,
        budget: { maxTokens: null, maxDurationMs: null },
        effort: null,
        fallback: null,
        v2: {
          dispatchBudget: { cost: { allocated: DISPATCH_COST_RESERVATION_V1 } },
        },
      },
      {
        env: {},
        invokeBackend,
        emitStderr: () => {},
        onRoutingTraceV2: (record) => v2Records.push(record),
      },
    );

    expect(v2Records).toHaveLength(1);
    const record = v2Records[0]!;
    expect(record.budgets.dispatch.cost.consumed).toBe(DISPATCH_COST_RESERVATION_V1);
    expect(record.budgets.dispatch.cost.measurement).toBe("unknown");
    expect(record.budgets.dispatch.cost.remaining).toBe(0);
    expect(record.budgets.root.cost.consumed).toBe(DISPATCH_COST_RESERVATION_V1);
    expect(record.budgets.root.cost.measurement).toBe("unknown");
  });
});

describe("engine v2 writer", () => {
  test("legacy codex→claude→grok fallback preserves identity and worker facts in every trace", async () => {
    const invocations: BackendInvocationInput[] = [];
    const invokeBackend: InvokeBackend = async (input) => {
      invocations.push(input);
      if (input.backend === "codex") {
        return {
          stdout: '{"type":"error","message":"usage limit reached"}',
          stderr: "",
          exitCode: 1,
        };
      }
      if (input.backend === "claude") {
        return { stdout: "", stderr: "Claude usage limit reached", exitCode: 1 };
      }
      return successFor(input);
    };

    const legacyRecords: TraceRecord[] = [];
    const v2Records: RoutingTraceV2[] = [];
    const result = await executeRun(
      {
        backend: "codex",
        mode: "implement",
        task: "do work",
        cwd: process.cwd(),
        label: null,
        taskClass: null,
        routeRationale: null,
        budget: { maxTokens: null, maxDurationMs: null },
        effort: null,
        orchestratorIdentity: "fable",
        fallback: "claude",
        v2: {
          rootBudget: {
            token: { allocated: 1_000, consumed: 100 },
            wallTimeMs: { allocated: 60_000, consumed: 500 },
            call: { allocated: 5, consumed: 1 },
          },
          dispatchBudget: { token: { allocated: 200 }, call: { allocated: 2 } },
        },
      },
      {
        env: { FABLE_ORCHESTRATOR_CLAUDE_MODEL: "custom-claude" },
        invokeBackend,
        emitStderr: () => {},
        onTrace: (record) => legacyRecords.push(record),
        onRoutingTraceV2: (record) => v2Records.push(record),
      },
    );

    expect(result.success).toBe(true);
    expect(v2Records).toHaveLength(3);
    expect(legacyRecords).toHaveLength(3);
    expect(
      invocations.map(({ backend, profile: { model, sandbox } }) => ({
        backend,
        model,
        sandbox,
      })),
    ).toEqual([
      { backend: "codex", model: "gpt-5.5", sandbox: "workspace-write" },
      { backend: "claude", model: "custom-claude", sandbox: "workspace-write" },
      { backend: "composer", model: "grok-4.5", sandbox: "workspace-write" },
    ]);
    expect(
      legacyRecords.map(({ orchestrator_identity, backend, model, sandbox }) => ({
        orchestrator_identity,
        backend,
        model,
        sandbox,
      })),
    ).toEqual(
      invocations.map(({ backend, profile: { model, sandbox } }) => ({
        orchestrator_identity: "fable",
        backend,
        model,
        sandbox,
      })),
    );
    for (const record of v2Records) {
      expect(record.orchestrator_identity).toBe("fable");
      expect(record.legacy.orchestrator_identity).toBe("fable");
    }

    const [first, second, third] = v2Records;
    assertRequiredV2Fields(first);
    assertRequiredV2Fields(second);
    assertRequiredV2Fields(third);

    expect(first.traversal.attempt_index).toBe(0);
    expect(second.traversal.attempt_index).toBe(1);
    expect(third.traversal.attempt_index).toBe(2);
    expect(first.traversal.traversal_id).toBe(second.traversal.traversal_id);
    expect(second.traversal.traversal_id).toBe(third.traversal.traversal_id);
    expect(first.failure.fallback_destination).toBe("claude");
    expect(first.lineage.parent_run_id).toBeNull();
    expect(second.lineage.parent_run_id).toBeNull();
    expect(second.failure.fallback_source).toBe("claude");
    expect(second.failure.fallback_destination).toBe("composer");
    expect(second.failure.fallback_reason).toBe("usage_limit");
    expect(third.failure.fallback_source).toBe("claude");
    expect(third.failure.fallback_destination).toBe("composer");
    expect(third.failure.fallback_reason).toBe("usage_limit");

    expect(third.budgets.dispatch.cost.consumed).toBe(DISPATCH_COST_RESERVATION_V1);
    expect(first.budgets.dispatch.cost.consumed).toBe(DISPATCH_COST_RESERVATION_V1);
    expect(second.budgets.dispatch.cost.measurement).toBe("unknown");
    expect(second.budgets.dispatch.token.consumed).toBeGreaterThanOrEqual(
      first.budgets.dispatch.token.consumed,
    );
    expect(third.budgets.dispatch.token.consumed).toBeGreaterThan(
      second.budgets.dispatch.token.consumed,
    );
    expect(second.budgets.root.token.consumed).toBeGreaterThanOrEqual(
      first.budgets.root.token.consumed,
    );
    expect(third.budgets.root.token.consumed).toBeGreaterThan(
      second.budgets.root.token.consumed,
    );
    expect(first.budgets.root.token.consumed).toBeGreaterThanOrEqual(100);
    expect(second.budgets.root.call.consumed).toBeGreaterThan(first.budgets.root.call.consumed);
    expect(third.budgets.root.call.consumed).toBeGreaterThan(second.budgets.root.call.consumed);
  });

  test("canonical fallback exposes transition on successful second candidate", async () => {
    const invocations: BackendInvocationInput[] = [];
    const v2Records: RoutingTraceV2[] = [];

    const invokeBackend: InvokeBackend = async (input) => {
      invocations.push(input);
      if (input.backend === "codex") {
        return { stdout: "", stderr: "Codex CLI not found\nENOENT", exitCode: 1 };
      }
      return successFor(input);
    };

    const result = await executeRun(
      {
        backend: "codex",
        mode: "implement",
        task: "do work",
        cwd: process.cwd(),
        label: null,
        taskClass: null,
        routeRationale: null,
        budget: { maxTokens: null, maxDurationMs: null },
        effort: null,
        fallback: null,
        workloadClass: "medium-work",
        v2: { rootBudget: { token: { allocated: 500_000 } } },
      },
      {
        env: {
          [ROUTE_SELECTION_STAGE_ENV]: "active",
          FABLE_ORCHESTRATOR_FALLBACK_ENGINE: "active",
        },
        invokeBackend,
        emitStderr: () => {},
        onRoutingTraceV2: (record) => v2Records.push(record),
      },
    );

    expect(result.success).toBe(true);
    const successful = v2Records.find((record) => record.status === "completed");
    expect(successful).toBeTruthy();
    expect(successful!.failure.fallback_source).toBe("gpt-5.5");
    expect(successful!.failure.fallback_destination).toBeTruthy();
    expect(successful!.failure.fallback_reason).toBeTruthy();
    expect(successful!.lineage.parent_run_id).toBeNull();
  });

  test("canonical selection with active fallback emits per-candidate v2 records", async () => {
    const invocations: BackendInvocationInput[] = [];
    const legacyRecords: TraceRecord[] = [];
    const v2Records: RoutingTraceV2[] = [];

    const invokeBackend: InvokeBackend = async (input) => {
      invocations.push(input);
      if (input.backend === "codex") {
        return { stdout: "", stderr: "Codex CLI not found\nENOENT", exitCode: 1 };
      }
      return successFor(input);
    };

    const result = await executeRun(
      {
        backend: "codex",
        mode: "implement",
        task: "do work",
        cwd: process.cwd(),
        label: null,
        taskClass: null,
        routeRationale: null,
        budget: { maxTokens: null, maxDurationMs: null },
        effort: null,
        orchestratorIdentity: "sol",
        fallback: null,
        workloadClass: "medium-work",
        v2: { rootBudget: { token: { allocated: 500_000 } } },
      },
      {
        env: {
          [ROUTE_SELECTION_STAGE_ENV]: "active",
          FABLE_ORCHESTRATOR_FALLBACK_ENGINE: "active",
        },
        invokeBackend,
        emitStderr: () => {},
        onTrace: (record) => legacyRecords.push(record),
        onRoutingTraceV2: (record) => v2Records.push(record),
      },
    );

    expect(result.success).toBe(true);
    expect(v2Records.length).toBeGreaterThanOrEqual(2);
    expect(legacyRecords).toHaveLength(v2Records.length);
    expect(
      legacyRecords.map(({ orchestrator_identity, backend, model, sandbox }) => ({
        orchestrator_identity,
        backend,
        model,
        sandbox,
      })),
    ).toEqual(
      invocations.map(({ backend, profile: { model, sandbox } }) => ({
        orchestrator_identity: "sol",
        backend,
        model,
        sandbox,
      })),
    );

    const attemptIndexes = v2Records.map((record) => record.traversal.attempt_index);
    for (let index = 1; index < attemptIndexes.length; index += 1) {
      expect(attemptIndexes[index]).toBeGreaterThan(attemptIndexes[index - 1]!);
    }

    const rootConsumed = v2Records.map((record) => record.budgets.root.token.consumed);
    for (let index = 1; index < rootConsumed.length; index += 1) {
      expect(rootConsumed[index]).toBeGreaterThanOrEqual(rootConsumed[index - 1]!);
    }

    for (const record of v2Records) {
      assertRequiredV2Fields(record);
      expect(record.route.canonical_capability_route).toBeTruthy();
      expect(record.orchestrator_identity).toBe("sol");
      expect(record.legacy.orchestrator_identity).toBe("sol");
    }
  });

  test("hostile model env cannot change automatic selection or deny via Sol override", async () => {
    const invocations: BackendInvocationInput[] = [];
    const legacyRecords: TraceRecord[] = [];
    const v2Records: RoutingTraceV2[] = [];

    const result = await executeRun(
      {
        backend: "codex",
        mode: "implement",
        task: "do work",
        cwd: process.cwd(),
        label: null,
        taskClass: null,
        routeRationale: null,
        budget: { maxTokens: null, maxDurationMs: null },
        effort: null,
        orchestratorIdentity: "fable",
        fallback: null,
      },
      {
        env: {
          [ROUTE_SELECTION_STAGE_ENV]: "active",
          FABLE_ORCHESTRATOR_IMPLEMENT_MODEL: "gpt-5.6-sol",
        },
        invokeBackend: async (input) => {
          invocations.push(input);
          return successFor(input);
        },
        emitStderr: () => {},
        onTrace: (record) => legacyRecords.push(record),
        onRoutingTraceV2: (record) => v2Records.push(record),
      },
    );

    expect(result.success).toBe(true);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.profile.model).toBe("composer-2.5");
    expect(legacyRecords).toHaveLength(1);
    expect(v2Records).toHaveLength(1);
    expect(legacyRecords[0]).toMatchObject({
      orchestrator_identity: "fable",
      backend: "composer",
      model: "composer-2.5",
      sandbox: "workspace-write",
      status: "completed",
    });
    expect(legacyRecords[0]?.fallback).toBeUndefined();
    expect(v2Records[0]).toMatchObject({
      orchestrator_identity: "fable",
      status: "completed",
      legacy: {
        orchestrator_identity: "fable",
        backend: "composer",
        model: "composer-2.5",
        sandbox: "workspace-write",
      },
    });
  });

  test("without onRoutingTraceV2 the execution path stays unchanged", async () => {
    const traces: TraceRecord[] = [];
    const result = await executeRun(
      {
        backend: "composer",
        mode: "implement",
        task: "do work",
        cwd: process.cwd(),
        label: null,
        taskClass: null,
        routeRationale: null,
        budget: { maxTokens: null, maxDurationMs: null },
        effort: null,
        fallback: null,
      },
      {
        env: {},
        invokeBackend: async (input) => successFor(input),
        emitStderr: () => {},
        onTrace: (trace) => traces.push(trace),
      },
    );

    expect(result.success).toBe(true);
    expect(traces).toHaveLength(1);
  });

  test("read-only dispatch consumes inherited root concurrency without reset", async () => {
    const v2Records: RoutingTraceV2[] = [];
    await executeRun(
      {
        backend: "codex",
        mode: "analyze",
        task: "do work",
        cwd: process.cwd(),
        label: null,
        taskClass: null,
        routeRationale: null,
        budget: { maxTokens: null, maxDurationMs: null },
        effort: null,
        fallback: null,
        v2: {
          rootBudget: { concurrency: { allocated: 3, consumed: 2 } },
          dispatchBudget: { concurrency: { allocated: 1 } },
        },
      },
      {
        env: {},
        invokeBackend: async (input) => successFor(input),
        emitStderr: () => {},
        onRoutingTraceV2: (record) => v2Records.push(record),
      },
    );

    expect(v2Records).toHaveLength(1);
    const record = v2Records[0]!;
    expect(record.budgets.dispatch.concurrency.consumed).toBe(1);
    expect(record.budgets.root.concurrency.consumed).toBe(3);
    expect(record.budgets.root.concurrency.remaining).toBe(0);
  });

  test("workspace-write dispatch also consumes one concurrency slot", async () => {
    const v2Records: RoutingTraceV2[] = [];
    await executeRun(
      {
        backend: "composer",
        mode: "implement",
        task: "do work",
        cwd: process.cwd(),
        label: null,
        taskClass: null,
        routeRationale: null,
        budget: { maxTokens: null, maxDurationMs: null },
        effort: null,
        fallback: null,
        v2: {
          rootBudget: { concurrency: { allocated: 3, consumed: 1 } },
          dispatchBudget: { concurrency: { allocated: 1 } },
        },
      },
      {
        env: {},
        invokeBackend: async (input) => successFor(input),
        emitStderr: () => {},
        onRoutingTraceV2: (record) => v2Records.push(record),
      },
    );

    expect(v2Records).toHaveLength(1);
    const record = v2Records[0]!;
    expect(record.budgets.dispatch.concurrency.consumed).toBe(1);
    expect(record.budgets.root.concurrency.consumed).toBe(2);
  });
});

describe("CLI routing-trace-v2 sidecar", () => {
  test("dual-writes v2 sidecar by default when tracing is enabled", async () => {
    const fixture = createFakeCodexFixture();
    const process = Bun.spawn(
      [
        runner,
        "run",
        "--backend",
        "codex",
        "--mode",
        "analyze",
        "--task",
        "Complete the bounded task",
        "--cwd",
        fixture.workspace,
      ],
      {
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          FABLE_ORCHESTRATOR_CODEX_BIN: fixture.executable,
          FAKE_CODEX_ARGUMENTS: fixture.argumentsPath,
          FABLE_ORCHESTRATOR_TRACE: "1",
          FABLE_ORCHESTRATOR_TRACE_DIR: fixture.traceDirectory,
          FABLE_ORCHESTRATOR_LAMINAR: "0",
        },
      },
    );
    expect(await process.exited).toBe(0);

    const legacy = readJsonl<TraceRecord>(fixture.traceDirectory, "runs.jsonl");
    const v2 = readJsonl<RoutingTraceV2>(
      fixture.traceDirectory,
      "routing-trace-v2.jsonl",
    );
    expect(legacy).toHaveLength(1);
    expect(v2).toHaveLength(1);
    expect(v2[0]!.contract).toBe(ROUTING_TRACE_V2_CONTRACT);
    expect(v2[0]!.legacy.run_id).toBe(legacy[0]!.run_id);
  });

  test("FABLE_ORCHESTRATOR_TRACE_V2=0 rolls back v2 sidecar while keeping runs.jsonl", async () => {
    const fixture = createFakeCodexFixture();
    const process = Bun.spawn(
      [
        runner,
        "run",
        "--backend",
        "codex",
        "--mode",
        "analyze",
        "--task",
        "Complete the bounded task",
        "--cwd",
        fixture.workspace,
      ],
      {
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          FABLE_ORCHESTRATOR_CODEX_BIN: fixture.executable,
          FAKE_CODEX_ARGUMENTS: fixture.argumentsPath,
          FABLE_ORCHESTRATOR_TRACE: "1",
          FABLE_ORCHESTRATOR_TRACE_V2: "0",
          FABLE_ORCHESTRATOR_TRACE_DIR: fixture.traceDirectory,
          FABLE_ORCHESTRATOR_LAMINAR: "0",
        },
      },
    );
    expect(await process.exited).toBe(0);

    expect(
      readJsonl(fixture.traceDirectory, "runs.jsonl"),
    ).toHaveLength(1);
    expect(
      existsSync(resolve(fixture.traceDirectory, "routing-trace-v2.jsonl")),
    ).toBe(false);
  });

  test("FABLE_ORCHESTRATOR_TRACE=0 disables all local traces including v2", async () => {
    const fixture = createFakeCodexFixture();
    const process = Bun.spawn(
      [
        runner,
        "run",
        "--backend",
        "codex",
        "--mode",
        "analyze",
        "--task",
        "Complete the bounded task",
        "--cwd",
        fixture.workspace,
      ],
      {
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          FABLE_ORCHESTRATOR_CODEX_BIN: fixture.executable,
          FAKE_CODEX_ARGUMENTS: fixture.argumentsPath,
          FABLE_ORCHESTRATOR_TRACE: "0",
          FABLE_ORCHESTRATOR_TRACE_DIR: fixture.traceDirectory,
          FABLE_ORCHESTRATOR_LAMINAR: "0",
        },
      },
    );
    expect(await process.exited).toBe(0);
    expect(existsSync(resolve(fixture.traceDirectory, "runs.jsonl"))).toBe(
      false,
    );
    expect(
      existsSync(resolve(fixture.traceDirectory, "routing-trace-v2.jsonl")),
    ).toBe(false);
  });
});
