import { describe, expect, test } from "bun:test";
import {
  type BackendInvocationInput,
  type BackendInvocationOutput,
  createPrompt,
  executeRun,
  type InvokeBackend,
  resolveCodexEffort,
} from "../plugins/fable-orchestrator/lib/engine";
import type {
  Backend,
  Mode,
  RoutingTraceV2,
  TraceRecord,
} from "../plugins/fable-orchestrator/lib/trace-schema";

const completedResult = {
  status: "completed",
  summary: "done",
  changes: ["src/app.ts"],
  verification: ["checked"],
  risks: [],
  next_actions: [],
};

const genericWorkerPrompt = [
  "You are a worker reporting to Claude Fable 5. Mode: implement.",
  "do the thing",
  "Return only one valid JSON object with exactly these keys: status, summary, changes, verification, risks, next_actions.",
  'status must be "completed" or "blocked". changes, verification, risks, and next_actions must be arrays of strings.',
  "Keep the summary and evidence compact so the parent model can evaluate it cheaply.",
  "Task: ship it",
].join("\n\n");

type FakeInvocation = BackendInvocationInput & {
  response: BackendInvocationOutput;
};

function createFakeBackend(
  responder: (input: BackendInvocationInput) => BackendInvocationOutput,
): { invokeBackend: InvokeBackend; invocations: FakeInvocation[] } {
  const invocations: FakeInvocation[] = [];
  return {
    invocations,
    invokeBackend: async (input) => {
      const response = responder(input);
      invocations.push({ ...input, response });
      return response;
    },
  };
}

function successFor(input: BackendInvocationInput): BackendInvocationOutput {
  if (input.backend === "codex") {
    return {
      stdout:
        '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}',
      stderr: "",
      exitCode: 0,
      resultText: JSON.stringify(completedResult),
    };
  }

  if (input.backend === "composer") {
    return {
      stdout: JSON.stringify({
        is_error: false,
        result: JSON.stringify(completedResult),
        usage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 },
      }),
      stderr: "",
      exitCode: 0,
    };
  }

  return {
    stdout: JSON.stringify({
      is_error: false,
      structured_output: completedResult,
      usage: { inputTokens: 6, outputTokens: 7, totalTokens: 13 },
    }),
    stderr: "",
    exitCode: 0,
  };
}

function runInput(backend: Backend, mode: Mode) {
  return {
    backend,
    mode,
    task: "do work",
    cwd: process.cwd(),
    label: null,
    taskClass: backend === "codex" ? "ui" : null,
    routeRationale: null,
    budget: { maxTokens: null, maxDurationMs: null },
    effort: null,
    fallback: null,
  };
}

describe("engine/run: prompt contracts", () => {
  test("mechanical prompts omit the generic worker schema and end with the commands contract", () => {
    const prompt = createPrompt(
      "implement",
      "generic status schema should be ignored",
      "open a pull request",
      "mechanical-open-pr",
    );

    expect(prompt).not.toContain(
      "status, summary, changes, verification, risks, next_actions",
    );
    expect(prompt).not.toContain('status must be "completed" or "blocked"');
    expect(prompt).not.toContain("generic status schema should be ignored");
    expect(prompt).toContain("Mechanical operation: open-pr.");
    expect(
      prompt
        .trim()
        .endsWith(
          'Return exactly one JSON object with exactly one key, "commands", whose value is an array containing exactly one command object: {"argv":[...]}.',
        ),
    ).toBe(true);
  });

  test("mechanical prompt construction canonicalizes uppercase padded commit-push aliases", () => {
    const prompt = createPrompt(
      "implement",
      "generic status schema should be ignored",
      "commit and push the staged diff",
      " MECHANICAL-COMMIT-PUSH ",
    );

    expect(prompt).toContain("Mechanical operation: commit-push.");
    expect(prompt).not.toContain(
      "status, summary, changes, verification, risks, next_actions",
    );
    expect(
      prompt
        .trim()
        .endsWith(
          'Return exactly one JSON object with exactly one key, "commands", whose value is exactly two command objects in order: first {"argv":["git","commit",...]}, then {"argv":["git","push",...]}.',
        ),
    ).toBe(true);
  });

  test("non-mechanical prompts retain the generic worker result schema", () => {
    expect(createPrompt("implement", "do the thing", "ship it")).toBe(
      genericWorkerPrompt,
    );
  });
});

describe("engine/run: backend profile consistency", () => {
  test("mechanical routes force Composer 2.5, operation task_class, and no fallback", async () => {
    const fake = createFakeBackend((input) => {
      if (fake.invocations.length === 0) {
        return {
          stdout: "",
          stderr: "usage limit reached",
          exitCode: 1,
        };
      }
      return successFor(input);
    });
    const traces: TraceRecord[] = [];
    const v2Traces: RoutingTraceV2[] = [];
    const result = await executeRun(
      {
        ...runInput("codex", "implement"),
        requestedAlias: "mechanical-open-pr",
        profileOverride: {
          model: "hostile-model",
          sandbox: "workspace-write",
          instruction: "hostile",
        },
        fallback: "claude",
      },
      {
        env: {
          FABLE_ORCHESTRATOR_COMPOSER_MODEL: "hostile-composer",
          FABLE_ORCHESTRATOR_IMPLEMENT_MODEL: "hostile-codex",
        },
        invokeBackend: fake.invokeBackend,
        onTrace: (traceRecord) => traces.push(traceRecord),
        onRoutingTraceV2: (traceRecord) => v2Traces.push(traceRecord),
        emitStderr: () => {},
      },
    );

    expect(result.success).toBe(false);
    expect(fake.invocations).toHaveLength(1);
    expect(fake.invocations[0]).toMatchObject({
      backend: "composer",
      mode: "implement",
      taskClass: "open-pr",
      requestedAlias: "mechanical-open-pr",
      profile: {
        model: "composer-2.5",
        sandbox: "workspace-write",
      },
    });
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      backend: "composer",
      mode: "implement",
      model: "composer-2.5",
      task_class: "open-pr",
    });
    expect(Object.hasOwn(traces[0], "fallback")).toBe(false);
    expect(v2Traces[0]).toMatchObject({
      route: {
        requested_public_alias: "mechanical-open-pr",
        canonical_capability_route: "mechanical-open-pr.workspace-write.v1",
      },
      models: {
        requested: "composer-2.5",
        candidate: "composer-2.5",
        selected: null,
      },
      versions: { policy: "mechanical-ops-sandbox/v1" },
      legacy: {
        backend: "composer",
        model: "composer-2.5",
        task_class: "open-pr",
      },
    });
  });

  test.each([
    ["analyze", "claude", "opus-explore", "claude-opus-4-8", "read-only"],
    ["implement", "composer", "composer-implement", "composer-2.5", "workspace-write"],
    ["review", "claude", "opus-check", "claude-opus-4-8", "read-only"],
  ] as const)(
    "Composer orchestrator mode fixes %s to the economy worker",
    async (mode, backend, route, model, sandbox) => {
      const fake = createFakeBackend(successFor);
      const traces: TraceRecord[] = [];
      const v2Traces: RoutingTraceV2[] = [];
      const result = await executeRun(
        {
          ...runInput(backend, mode),
          orchestratorIdentity: "composer",
          requestedAlias: route,
          fallback: "claude",
        },
        {
          env: {
            FABLE_ORCHESTRATOR_ROLLOUT_STAGE: "default",
            FABLE_ORCHESTRATOR_ROLLOUT_HUMAN_APPROVED: "1",
            FABLE_ORCHESTRATOR_ANALYZE_MODEL: "gpt-5.6-sol",
            FABLE_ORCHESTRATOR_IMPLEMENT_MODEL: "gpt-5.6-sol",
            FABLE_ORCHESTRATOR_REVIEW_MODEL: "gpt-5.6-sol",
            FABLE_ORCHESTRATOR_CLAUDE_MODEL: "claude-sonnet-4-6",
            FABLE_ORCHESTRATOR_COMPOSER_MODEL: "gpt-5.6-sol",
          },
          invokeBackend: fake.invokeBackend,
          onTrace: (traceRecord) => traces.push(traceRecord),
          onRoutingTraceV2: (traceRecord) => v2Traces.push(traceRecord),
          emitStderr: () => {},
        },
      );

      expect(result.success).toBe(true);
      expect(fake.invocations).toHaveLength(1);
      expect(fake.invocations[0]).toMatchObject({ backend, mode });
      expect(fake.invocations[0].profile).toMatchObject({ model, sandbox });
      expect(fake.invocations[0].prompt).not.toContain("gpt-5.6-sol");
      expect(traces[0]).toMatchObject({
        orchestrator_identity: "composer",
        backend,
        mode,
        model,
        sandbox,
        routingShadow: { requestedAlias: route },
      });
      expect(v2Traces).toHaveLength(1);
      expect(v2Traces[0]).toMatchObject({
        orchestrator_identity: "composer",
        route: {
          requested_public_alias: route,
          requested_alias_kind: "executable-route",
        },
        models: {
          requested: model,
          attempted: model,
          selected: model,
        },
        serving: {
          provider_model_id: model,
          transport_backend: backend,
        },
        legacy: { backend, mode, model, sandbox },
      });
    },
  );

  test.each([
    ["analyze", "backend-only", "codex", "opus-explore", "gpt-5.6-luna", "gpt-5.6-luna", "codex"],
    ["analyze", "alias-only", "claude", "codex-explore", "claude-opus-4-8", "opus-4.8", "claude"],
    ["analyze", "combined", "codex", "codex-explore", "gpt-5.6-luna", "gpt-5.6-luna", "codex"],
    ["implement", "backend-only", "codex", "composer-implement", "gpt-5.6-sol", "gpt-5.6-sol", "codex"],
    ["implement", "alias-only", "composer", "codex-implement", "composer-2.5", "composer-2.5", "composer"],
    ["implement", "combined", "codex", "codex-implement", "gpt-5.6-sol", "gpt-5.6-sol", "codex"],
    ["review", "backend-only", "codex", "opus-check", "gpt-5.6-sol", "gpt-5.6-sol", "codex"],
    ["review", "alias-only", "claude", "codex-check", "claude-opus-4-8", "opus-4.8", "claude"],
    ["review", "combined", "codex", "codex-check", "gpt-5.6-sol", "gpt-5.6-sol", "codex"],
  ] as const)(
    "Composer %s %s conflict preserves caller facts and invokes no backend",
    async (mode, shape, backend, requestedAlias, model, stableId, servingBackend) => {
      const canonicalRoute =
        mode === "analyze"
          ? "explore.read-only.v1"
          : mode === "implement"
            ? "implement.workspace-write.v1"
            : "check.read-only.v1";
      const fake = createFakeBackend(successFor);
      const traces: TraceRecord[] = [];
      const v2Traces: RoutingTraceV2[] = [];
      const errors: string[] = [];
      const result = await executeRun(
        {
          ...runInput(backend, mode),
          orchestratorIdentity: "composer",
          requestedAlias,
        },
        {
          env: {},
          invokeBackend: fake.invokeBackend,
          onTrace: (trace) => traces.push(trace),
          onRoutingTraceV2: (trace) => v2Traces.push(trace),
          emitStderr: (line) => errors.push(line),
        },
      );

      expect(result.success).toBe(false);
      expect(fake.invocations).toHaveLength(0);
      expect(traces).toHaveLength(1);
      expect(traces[0]).toMatchObject({
        orchestrator_identity: "composer",
        backend,
        mode,
        model,
        status: "error",
        routingShadow: { requestedAlias, canonicalRouteId: canonicalRoute },
      });
      expect(v2Traces).toHaveLength(1);
      expect(v2Traces[0]).toMatchObject({
        orchestrator_identity: "composer",
        route: {
          requested_public_alias: requestedAlias,
          requested_alias_kind: "executable-route",
          canonical_capability_route: canonicalRoute,
        },
        models: { requested: model, candidate: stableId },
        serving: {
          provider_model_id: model,
          transport_backend: servingBackend,
        },
        traversal: { candidate_index: null, attempt_index: null },
        failure: { normalized_class: "invalid_configuration" },
        legacy: { backend, mode, model, status: "error" },
      });
      expect(errors.join("\n")).toContain("Composer orchestrator mode requires");
      if (shape === "combined") {
        expect(errors.join("\n")).toContain(`backend ${backend} and route ${requestedAlias}`);
      }
    },
  );

  test.each([
    ["analyze", "claude", "opus-explore", "Claude usage limit reached", "usage_limit"],
    ["review", "claude", "opus-check", "Claude CLI not found", "missing_binary"],
    ["implement", "composer", "composer-implement", "usage limit reached", "usage_limit"],
  ] as const)(
    "Composer economy %s worker outage stays classified without fallback metadata or escalation",
    async (mode, backend, requestedAlias, outageMessage, outageReason) => {
      const fake = createFakeBackend(() => ({
        stdout: "",
        stderr: outageMessage,
        exitCode: 1,
      }));
      const stderr: string[] = [];
      const traces: TraceRecord[] = [];
      const v2Traces: RoutingTraceV2[] = [];
      const result = await executeRun(
        {
          ...runInput(backend, mode),
          orchestratorIdentity: "composer",
          requestedAlias,
          fallback: "claude",
        },
        {
          env: {
            FABLE_ORCHESTRATOR_ROLLOUT_STAGE: "default",
            FABLE_ORCHESTRATOR_ROLLOUT_HUMAN_APPROVED: "1",
          },
          invokeBackend: fake.invokeBackend,
          onTrace: (trace) => traces.push(trace),
          onRoutingTraceV2: (trace) => v2Traces.push(trace),
          emitStderr: (line) => stderr.push(line),
        },
      );

      expect(result.success).toBe(false);
      expect(fake.invocations).toHaveLength(1);
      expect(fake.invocations[0].backend).toBe(backend);
      expect(result.traces).toHaveLength(1);
      expect(traces).toHaveLength(1);
      expect(v2Traces).toHaveLength(1);
      expect(traces[0].failure_class).toBe("backend_unavailable");
      expect(traces[0].outage_reason).toBe(outageReason);
      expect(traces[0]).not.toHaveProperty("fallback");
      expect(traces[0]).not.toHaveProperty("fallback_of");
      const serialized = JSON.stringify({ result, traces, v2Traces, stderr });
      expect(serialized).not.toContain('"fallback"');
      expect(serialized).not.toContain('"fallback_of"');
      expect(v2Traces[0].failure).toMatchObject({
        fallback_source: null,
        fallback_destination: null,
        fallback_reason: null,
      });
      expect(serialized).not.toContain('"model":"grok');
      expect(stderr).not.toContainEqual(expect.stringContaining('"fallback"'));
      const serializedStderr = stderr.join("\n").toLowerCase();
      expect(serializedStderr).not.toContain("fallback");
      expect(serializedStderr).not.toContain("retrying on");
      expect(serializedStderr).not.toContain("grok");
    },
  );

  test("records orchestrator identity independently from worker backend and model", async () => {
    const fake = createFakeBackend(successFor);
    const traces: TraceRecord[] = [];
    await executeRun(
      { ...runInput("composer", "implement"), orchestratorIdentity: "sol" },
      {
        env: {},
        invokeBackend: fake.invokeBackend,
        onTrace: (trace) => traces.push(trace),
        emitStderr: () => {},
      },
    );

    expect(traces[0].orchestrator_identity).toBe("sol");
    expect(traces[0].backend).toBe("composer");
    expect(traces[0].model).toBe("composer-2.5");
  });

  test("records explicit null when orchestrator identity is not selected", async () => {
    const fake = createFakeBackend(successFor);
    const traces: TraceRecord[] = [];
    await executeRun(runInput("codex", "analyze"), {
      env: {},
      invokeBackend: fake.invokeBackend,
      onTrace: (trace) => traces.push(trace),
      emitStderr: () => {},
    });

    expect(traces[0]).toHaveProperty("orchestrator_identity", null);
  });

  test.each(["engine", "cli"])(
    "importing the %s module has no CLI side effects",
    async (moduleName) => {
    const child = Bun.spawn(
      [
        Bun.which("bun") ?? "bun",
        "--eval",
        `await import("./plugins/fable-orchestrator/lib/${moduleName}.ts")`,
      ],
      {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  test.each([
    ["codex", "implement"],
    ["composer", "implement"],
    ["claude", "review"],
  ] as const)(
    "trace model and sandbox match invokeBackend input for %s",
    async (backend, mode) => {
      const fake = createFakeBackend(successFor);
      const traces: TraceRecord[] = [];
      const result = await executeRun(runInput(backend, mode), {
        env: {
          FABLE_ORCHESTRATOR_IMPLEMENT_MODEL: "custom-implement",
          FABLE_ORCHESTRATOR_REVIEW_MODEL: "custom-review",
          FABLE_ORCHESTRATOR_COMPOSER_MODEL: "custom-composer",
          FABLE_ORCHESTRATOR_CLAUDE_MODEL: "custom-claude",
        },
        invokeBackend: fake.invokeBackend,
        onTrace: (trace) => traces.push(trace),
        emitStderr: () => {},
      });

      expect(result.success).toBe(true);
      expect(fake.invocations).toHaveLength(1);
      expect(traces).toHaveLength(1);
      expect(traces[0].model).toBe(fake.invocations[0].profile.model);
      expect(traces[0].sandbox).toBe(fake.invocations[0].profile.sandbox);
    },
  );
});

describe("engine/run: outage handling", () => {
  test("records backend_unavailable fields and emits the fallback hint", async () => {
    const fake = createFakeBackend(() => ({
      stdout: '{"type":"error","message":"You have hit your usage limit"}',
      stderr: "",
      exitCode: 1,
    }));
    const stderr: string[] = [];
    const traces: TraceRecord[] = [];

    const result = await executeRun(runInput("codex", "analyze"), {
      env: {},
      invokeBackend: fake.invokeBackend,
      onTrace: (trace) => traces.push(trace),
      emitStderr: (line) => stderr.push(line),
    });

    expect(result.success).toBe(false);
    expect(traces).toHaveLength(1);
    expect(traces[0].failure_class).toBe("backend_unavailable");
    expect(traces[0].outage_reason).toBe("usage_limit");
    expect(traces[0].fallback).toEqual({
      backend: "claude",
      model: "claude-opus-4-8",
    });
    expect(stderr).toContain(
      '{"failure_class":"backend_unavailable","outage_reason":"usage_limit","fallback":{"backend":"claude","model":"claude-opus-4-8"}}',
    );
  });

  test("records Claude outages with a composer Grok fallback hint", async () => {
    const fake = createFakeBackend(() => ({
      stdout: "",
      stderr: "Claude CLI not found",
      exitCode: 127,
    }));
    const stderr: string[] = [];
    const traces: TraceRecord[] = [];

    const result = await executeRun(runInput("claude", "review"), {
      env: { FABLE_ORCHESTRATOR_GROK_MODEL: "custom-grok" },
      invokeBackend: fake.invokeBackend,
      onTrace: (trace) => traces.push(trace),
      emitStderr: (line) => stderr.push(line),
    });

    expect(result.success).toBe(false);
    expect(fake.invocations).toHaveLength(1);
    expect(traces[0].failure_class).toBe("backend_unavailable");
    expect(traces[0].outage_reason).toBe("missing_binary");
    expect(traces[0].fallback).toEqual({
      backend: "composer",
      model: "custom-grok",
    });
    expect(stderr).toContain(
      '{"failure_class":"backend_unavailable","outage_reason":"missing_binary","fallback":{"backend":"composer","model":"custom-grok"}}',
    );
  });

  test("retries classified Codex outages on claude with fallback linkage", async () => {
    const fake = createFakeBackend((input) =>
      input.backend === "codex"
        ? {
            stdout:
              '{"type":"turn.failed","error":{"message":"usage limit reached"}}',
            stderr: "",
            exitCode: 1,
          }
        : successFor(input),
    );
    const stderr: string[] = [];
    const traces: TraceRecord[] = [];

    const result = await executeRun(
      {
        ...runInput("codex", "implement"),
        fallback: "claude",
      },
      {
        env: { FABLE_ORCHESTRATOR_CLAUDE_MODEL: "custom-claude" },
        invokeBackend: fake.invokeBackend,
        onTrace: (trace) => traces.push(trace),
        emitStderr: (line) => stderr.push(line),
      },
    );

    expect(result.success).toBe(true);
    expect(fake.invocations.map((invocation) => invocation.backend)).toEqual([
      "codex",
      "claude",
    ]);
    expect(traces).toHaveLength(2);
    expect(traces[1].fallback_of).toBe(traces[0].run_id);
    expect(traces[1].backend).toBe("claude");
    expect(traces[1].model).toBe("custom-claude");
    expect(stderr).toContain(
      "fable-orchestrator: codex unavailable (usage_limit); retrying on claude backend",
    );
  });

  test("retries Codex then Claude outages once more on composer Grok", async () => {
    const fake = createFakeBackend((input) => {
      if (input.backend === "codex") {
        return {
          stdout:
            '{"type":"turn.failed","error":{"message":"usage limit reached"}}',
          stderr: "",
          exitCode: 1,
        };
      }
      if (input.backend === "claude") {
        return {
          stdout: "",
          stderr: "Claude usage limit reached",
          exitCode: 1,
        };
      }
      return successFor(input);
    });
    const stderr: string[] = [];
    const traces: TraceRecord[] = [];

    const result = await executeRun(
      {
        ...runInput("codex", "implement"),
        orchestratorIdentity: "fable",
        fallback: "claude",
      },
      {
        env: {},
        invokeBackend: fake.invokeBackend,
        onTrace: (trace) => traces.push(trace),
        emitStderr: (line) => stderr.push(line),
      },
    );

    expect(result.success).toBe(true);
    expect(fake.invocations.map((invocation) => invocation.backend)).toEqual([
      "codex",
      "claude",
      "composer",
    ]);
    expect(fake.invocations.map((invocation) => invocation.profile.model)).toEqual([
      "gpt-5.6-sol",
      "claude-opus-4-8",
      "grok-4.5",
    ]);
    expect(traces).toHaveLength(3);
    expect(
      traces.map(({ orchestrator_identity, backend, model, sandbox }) => ({
        orchestrator_identity,
        backend,
        model,
        sandbox,
      })),
    ).toEqual([
      {
        orchestrator_identity: "fable",
        backend: "codex",
        model: "gpt-5.6-sol",
        sandbox: "workspace-write",
      },
      {
        orchestrator_identity: "fable",
        backend: "claude",
        model: "claude-opus-4-8",
        sandbox: "workspace-write",
      },
      {
        orchestrator_identity: "fable",
        backend: "composer",
        model: "grok-4.5",
        sandbox: "workspace-write",
      },
    ]);
    expect(traces[1].fallback_of).toBe(traces[0].run_id);
    expect(traces[2].fallback_of).toBe(traces[1].run_id);
    expect(traces[1].fallback).toEqual({
      backend: "composer",
      model: "grok-4.5",
    });
    expect(stderr).toContain(
      '{"failure_class":"backend_unavailable","outage_reason":"usage_limit","fallback":{"backend":"composer","model":"grok-4.5"}}',
    );
    expect(stderr).toContain(
      "fable-orchestrator: claude unavailable (usage_limit); retrying on composer backend with grok-4.5",
    );
  });

  test("keeps the Codex to Claude to Grok chain when selection is active", async () => {
    const fake = createFakeBackend((input) => {
      if (input.backend === "codex") {
        return {
          stdout:
            '{"type":"turn.failed","error":{"message":"usage limit reached"}}',
          stderr: "",
          exitCode: 1,
        };
      }
      if (input.backend === "claude") {
        return {
          stdout: "",
          stderr: "Claude usage limit reached",
          exitCode: 1,
        };
      }
      return successFor(input);
    });
    const traces: TraceRecord[] = [];

    const result = await executeRun(
      {
        ...runInput("codex", "analyze"),
        fallback: "claude",
      },
      {
        env: { FABLE_ORCHESTRATOR_ROUTE_SELECTION: "active" },
        invokeBackend: fake.invokeBackend,
        onTrace: (trace) => traces.push(trace),
        emitStderr: () => {},
      },
    );

    expect(result.success).toBe(true);
    expect(fake.invocations.map((invocation) => invocation.backend)).toEqual([
      "codex",
      "claude",
      "composer",
    ]);
    expect(fake.invocations.map((invocation) => invocation.profile.model)).toEqual([
      "gpt-5.6-luna",
      "claude-opus-4-8",
      "grok-4.5",
    ]);
    expect(traces).toHaveLength(3);
    expect(traces[1].fallback_of).toBe(traces[0].run_id);
    expect(traces[2].fallback_of).toBe(traces[1].run_id);
  });
});

describe("engine/run: codex effort defaults", () => {
  test("resolveCodexEffort defaults implement and review to high", () => {
    expect(resolveCodexEffort("codex", "implement", null)).toBe("high");
    expect(resolveCodexEffort("codex", "review", null)).toBe("high");
    expect(resolveCodexEffort("codex", "analyze", null)).toBeNull();
    expect(resolveCodexEffort("composer", "implement", null)).toBeNull();
    expect(resolveCodexEffort("codex", "implement", "low")).toBe("low");
  });

  test.each([
    ["implement", "high"],
    ["review", "high"],
  ] as const)(
    "passes model_reasoning_effort=%s to codex %s runs by default",
    async (mode, expectedEffort) => {
      const fake = createFakeBackend(successFor);
      const traces: TraceRecord[] = [];
      const result = await executeRun(
        { ...runInput("codex", mode), taskClass: null },
        {
          env: {},
          invokeBackend: fake.invokeBackend,
          onTrace: (trace) => traces.push(trace),
          emitStderr: () => {},
        },
      );

      expect(result.success).toBe(true);
      expect(fake.invocations[0].effort).toBe(expectedEffort);
      expect(traces[0].effort).toBe(expectedEffort);
    },
  );

  test("leaves analyze effort unset when --effort is omitted", async () => {
    const fake = createFakeBackend(successFor);
    const traces: TraceRecord[] = [];
    await executeRun(runInput("codex", "analyze"), {
      env: {},
      invokeBackend: fake.invokeBackend,
      onTrace: (trace) => traces.push(trace),
      emitStderr: () => {},
    });

    expect(fake.invocations[0].effort).toBeNull();
    expect(traces[0].effort).toBeUndefined();
  });
});
