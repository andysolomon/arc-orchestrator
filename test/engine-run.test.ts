import { describe, expect, test } from "bun:test";
import {
  type BackendInvocationInput,
  type BackendInvocationOutput,
  createPrompt,
  executeRun,
  type InvokeBackend,
  resolveCodexEffort,
} from "../plugins/arc-orchestrator/lib/engine";
import type {
  Backend,
  Mode,
  RoutingTraceV2,
  TraceRecord,
} from "../plugins/arc-orchestrator/lib/trace-schema";

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
  "Size caps: summary max 500 characters; changes max 8 items; verification max 8; risks max 6; next_actions max 6; each array item max 240 characters. Prefer repo-relative paths in array items.",
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

  if (input.backend === "opencode") {
    return {
      stdout: `${JSON.stringify({
        type: "text",
        part: { text: JSON.stringify(completedResult) },
      })}\n`,
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
  test("legacy mechanical aliases use the generic worker schema when prompted directly", () => {
    // Mechanical routes are removed; createPrompt no longer special-cases them.
    const prompt = createPrompt(
      "implement",
      "generic instruction",
      "post an approved comment",
      "mechanical-post-comment",
    );
    expect(prompt).toContain(
      "status, summary, changes, verification, risks, next_actions",
    );
    expect(prompt).not.toContain("Mechanical operation:");
  });

  test("non-mechanical prompts retain the generic worker result schema", () => {
    expect(createPrompt("implement", "do the thing", "ship it")).toBe(
      genericWorkerPrompt,
    );
  });
});

describe("engine/run: compact worker results", () => {
  test("returns compacted structured results to callers", async () => {
    const longSummary = "s".repeat(600);
    const oversizedResult = {
      status: "completed",
      summary: longSummary,
      changes: Array.from({ length: 10 }, (_, index) => `change-${index}`),
      verification: [],
      risks: [],
      next_actions: [],
    };
    const fake = createFakeBackend((input) => {
      if (input.backend === "codex") {
        return {
          stdout:
            '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}',
          stderr: "",
          exitCode: 0,
          resultText: JSON.stringify(oversizedResult),
        };
      }
      return successFor(input);
    });

    const result = await executeRun(runInput("codex", "implement"), {
      env: {},
      invokeBackend: fake.invokeBackend,
      emitStderr: () => {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(String(result.result.summary).length).toBe(500);
      expect(result.result.changes).toHaveLength(8);
    }
  });
});

describe("engine/run: backend profile consistency", () => {
  test("legacy mechanical aliases are rejected as unknown routes", async () => {
    const fake = createFakeBackend(successFor);
    const traces: TraceRecord[] = [];
    const v2Traces: RoutingTraceV2[] = [];
    const result = await executeRun(
      {
        ...runInput("codex", "implement"),
        requestedAlias: "mechanical-post-comment",
        fallback: "claude",
      },
      {
        env: {},
        invokeBackend: fake.invokeBackend,
        onTrace: (traceRecord) => traces.push(traceRecord),
        onRoutingTraceV2: (traceRecord) => v2Traces.push(traceRecord),
        emitStderr: () => {},
      },
    );

    expect(result.success).toBe(false);
    expect(fake.invocations).toHaveLength(0);
    expect(traces[0]?.error).toContain("unknown-alias");
    expect(v2Traces[0]?.failure.normalized_class).toBe("invalid_configuration");
  });

  test.each([
    ["analyze", "claude", "opus-explore", "claude-opus-4-8", "read-only"],
    ["implement", "composer", "composer-implement", "composer-2.5", "workspace-write"],
    ["review", "claude", "opus-check", "claude-opus-4-8", "read-only"],
  ] as const)(
    "Eco orchestrator mode fixes %s to the economy worker",
    async (mode, backend, route, model, sandbox) => {
      const fake = createFakeBackend(successFor);
      const traces: TraceRecord[] = [];
      const v2Traces: RoutingTraceV2[] = [];
      const result = await executeRun(
        {
          ...runInput(backend, mode),
          orchestratorIdentity: "eco",
          requestedAlias: route,
          fallback: "claude",
        },
        {
          env: {
            ARC_ORCHESTRATOR_ROLLOUT_STAGE: "default",
            ARC_ORCHESTRATOR_ROLLOUT_HUMAN_APPROVED: "1",
            ARC_ORCHESTRATOR_ANALYZE_MODEL: "gpt-5.6-sol",
            ARC_ORCHESTRATOR_IMPLEMENT_MODEL: "gpt-5.6-sol",
            ARC_ORCHESTRATOR_REVIEW_MODEL: "gpt-5.6-sol",
            ARC_ORCHESTRATOR_CLAUDE_MODEL: "claude-sonnet-4-6",
            ARC_ORCHESTRATOR_COMPOSER_MODEL: "gpt-5.6-sol",
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
        orchestrator_identity: "eco",
        backend,
        mode,
        model,
        sandbox,
        routingShadow: { requestedAlias: route },
      });
      expect(v2Traces).toHaveLength(1);
      expect(v2Traces[0]).toMatchObject({
        orchestrator_identity: "eco",
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
    ["analyze", "backend-only", "codex", null, "gpt-5.6-luna", "gpt-5.6-luna", "codex"],
    ["analyze", "alias-only", "claude", "fable-explore", "claude-opus-4-8", "opus-4.8", "claude"],
    ["analyze", "combined", "codex", "fable-explore", "gpt-5.6-luna", "gpt-5.6-luna", "codex"],
    ["implement", "backend-only", "codex", null, "gpt-5.5", "gpt-5.5", "codex"],
    ["implement", "alias-only", "composer", "fable-implement", "composer-2.5", "composer-2.5", "composer"],
    ["implement", "combined", "codex", "fable-implement", "gpt-5.5", "gpt-5.5", "codex"],
    ["review", "backend-only", "codex", null, "gpt-5.5", "gpt-5.5", "codex"],
    ["review", "alias-only", "claude", "fable-check", "claude-opus-4-8", "opus-4.8", "claude"],
    ["review", "combined", "codex", "fable-check", "gpt-5.5", "gpt-5.5", "codex"],
  ] as const)(
    "Eco %s %s conflict preserves caller facts and invokes no backend",
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
          orchestratorIdentity: "eco",
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
        orchestrator_identity: "eco",
        backend,
        mode,
        model,
        status: "error",
        ...(requestedAlias
          ? { routingShadow: { requestedAlias, canonicalRouteId: canonicalRoute } }
          : {}),
      });
      expect(v2Traces).toHaveLength(1);
      expect(v2Traces[0]).toMatchObject({
        orchestrator_identity: "eco",
        route: {
          requested_public_alias: requestedAlias,
          requested_alias_kind: requestedAlias ? "executable-route" : null,
          canonical_capability_route: requestedAlias ? canonicalRoute : null,
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
      expect(errors.join("\n")).toContain("Eco orchestrator mode requires");
      if (shape === "combined") {
        expect(errors.join("\n")).toContain(`backend ${backend} and route ${requestedAlias}`);
      }
    },
  );

  test.each([
    ["analyze", "claude", "opus-explore", "grok-explore", "Claude usage limit reached", "usage_limit"],
    ["review", "claude", "opus-check", "grok-check", "Claude CLI not found", "missing_binary"],
  ] as const)(
    "Eco %s availability outage retries once on %s",
    async (mode, backend, requestedAlias, backupAlias, outageMessage, outageReason) => {
      let calls = 0;
      const fake = createFakeBackend((input) => {
        calls += 1;
        if (calls === 1) {
          return { stdout: "", stderr: outageMessage, exitCode: 1 };
        }
        return successFor(input);
      });
      const stderr: string[] = [];
      const traces: TraceRecord[] = [];
      const v2Traces: RoutingTraceV2[] = [];
      const result = await executeRun(
        {
          ...runInput(backend, mode),
          orchestratorIdentity: "eco",
          requestedAlias,
          fallback: "claude",
        },
        {
          env: {
            ARC_ORCHESTRATOR_ROLLOUT_STAGE: "default",
            ARC_ORCHESTRATOR_ROLLOUT_HUMAN_APPROVED: "1",
          },
          invokeBackend: fake.invokeBackend,
          onTrace: (trace) => traces.push(trace),
          onRoutingTraceV2: (trace) => v2Traces.push(trace),
          emitStderr: (line) => stderr.push(line),
        },
      );

      expect(result.success).toBe(true);
      expect(fake.invocations).toHaveLength(2);
      expect(fake.invocations[0].backend).toBe(backend);
      expect(fake.invocations[1].backend).toBe("composer");
      expect(fake.invocations[1].profile.model).toBe("grok-4.5");
      expect(result.traces).toHaveLength(2);
      expect(traces).toHaveLength(2);
      expect(v2Traces).toHaveLength(2);
      expect(traces[0].failure_class).toBe("backend_unavailable");
      expect(traces[0].outage_reason).toBe(outageReason);
      expect(traces[0]).not.toHaveProperty("fallback");
      expect(traces[1].fallback_of).toBe(traces[0].run_id);
      expect(traces[1].routingShadow?.requestedAlias).toBe(backupAlias);
      expect(stderr.join("\n")).toContain(`eco availability backup ${backupAlias}`);
      expect(stderr.join("\n")).not.toMatch(/codex-explore|terra-implement|sol-implement/i);
    },
  );

  test("Eco implement outage stays classified without Grok backup or Fable/Sol escalation", async () => {
    const fake = createFakeBackend(() => ({
      stdout: "",
      stderr: "usage limit reached",
      exitCode: 1,
    }));
    const stderr: string[] = [];
    const traces: TraceRecord[] = [];
    const v2Traces: RoutingTraceV2[] = [];
    const result = await executeRun(
      {
        ...runInput("composer", "implement"),
        orchestratorIdentity: "eco",
        requestedAlias: "composer-implement",
        fallback: "claude",
      },
      {
        env: {
          ARC_ORCHESTRATOR_ROLLOUT_STAGE: "default",
          ARC_ORCHESTRATOR_ROLLOUT_HUMAN_APPROVED: "1",
        },
        invokeBackend: fake.invokeBackend,
        onTrace: (trace) => traces.push(trace),
        onRoutingTraceV2: (trace) => v2Traces.push(trace),
        emitStderr: (line) => stderr.push(line),
      },
    );

    expect(result.success).toBe(false);
    expect(fake.invocations).toHaveLength(1);
    expect(result.traces).toHaveLength(1);
    expect(traces[0].failure_class).toBe("backend_unavailable");
    expect(traces[0].outage_reason).toBe("usage_limit");
    expect(traces[0]).not.toHaveProperty("fallback_of");
    const serialized = JSON.stringify({ result, traces, v2Traces, stderr });
    expect(serialized).not.toContain('"model":"grok');
    expect(stderr.join("\n").toLowerCase()).not.toContain("eco availability backup");
  });

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
        `await import("./plugins/arc-orchestrator/lib/${moduleName}.ts")`,
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
          ARC_ORCHESTRATOR_IMPLEMENT_MODEL: "custom-implement",
          ARC_ORCHESTRATOR_REVIEW_MODEL: "custom-review",
          ARC_ORCHESTRATOR_COMPOSER_MODEL: "custom-composer",
          ARC_ORCHESTRATOR_CLAUDE_MODEL: "custom-claude",
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
      "arc-orchestrator: codex unavailable (usage_limit)",
    );
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
      env: { ARC_ORCHESTRATOR_GROK_MODEL: "custom-grok" },
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
        env: { ARC_ORCHESTRATOR_CLAUDE_MODEL: "custom-claude" },
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
      "arc-orchestrator: codex unavailable (usage_limit); retrying on claude backend",
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
      "gpt-5.5",
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
        model: "gpt-5.5",
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
      "arc-orchestrator: claude unavailable (usage_limit); retrying on composer backend with grok-4.5",
    );
  });

  test("keeps availability fallback across the explore stack when selection is active", async () => {
    const fake = createFakeBackend((input) => {
      if (input.backend === "codex" || input.backend === "claude") {
        return {
          stdout:
            input.backend === "codex"
              ? '{"type":"turn.failed","error":{"message":"usage limit reached"}}'
              : "",
          stderr: input.backend === "claude" ? "Claude usage limit reached" : "",
          exitCode: 1,
        };
      }
      return successFor(input);
    });
    const traces: TraceRecord[] = [];
    const stderr: string[] = [];

    const result = await executeRun(
      {
        ...runInput("codex", "analyze"),
        taskClass: null,
        fallback: "claude",
      },
      {
        env: {
          ARC_ORCHESTRATOR_ROUTE_SELECTION: "active",
          ARC_ORCHESTRATOR_FALLBACK_ENGINE: "active",
          ARC_ORCHESTRATOR_ANALYZE_MODEL: "hostile-analyze-model",
          ARC_ORCHESTRATOR_IMPLEMENT_MODEL: "hostile-implement-model",
          ARC_ORCHESTRATOR_REVIEW_MODEL: "hostile-review-model",
        },
        invokeBackend: fake.invokeBackend,
        onTrace: (trace) => traces.push(trace),
        emitStderr: (line) => stderr.push(line),
      },
    );

    expect(result.success).toBe(true);
    // Explore ADR chain: Fable → Sol → Kimi …
    expect(fake.invocations.map((invocation) => invocation.backend)).toEqual([
      "claude",
      "codex",
      "opencode",
    ]);
    expect(fake.invocations.map((invocation) => invocation.profile.model)).toEqual([
      "claude-fable-5",
      "gpt-5.6-sol",
      "moonshotai/kimi-k3",
    ]);
    expect(traces.length).toBeGreaterThanOrEqual(3);
    // Canonical traversal must not emit legacy hard-coded next-hop hints.
    for (const trace of traces) {
      expect(trace.fallback).toBeUndefined();
    }
    expect(
      stderr.some((line) => line.includes('"fallback":{"backend"')),
    ).toBe(false);
  });

  test("explicit alias ignores hostile model env overrides", async () => {
    const fake = createFakeBackend(successFor);
    const v2: Array<{ models?: { requested?: string; attempted?: string } }> = [];
    const result = await executeRun(
      {
        ...runInput("claude", "implement"),
        requestedAlias: "fable-implement",
        routingIntent: "explicit",
        backendExplicit: false,
      },
      {
        env: {
          ARC_ORCHESTRATOR_ROUTE_SELECTION: "active",
          ARC_ORCHESTRATOR_ANALYZE_MODEL: "hostile-analyze-model",
          ARC_ORCHESTRATOR_IMPLEMENT_MODEL: "hostile-implement-model",
          ARC_ORCHESTRATOR_REVIEW_MODEL: "hostile-review-model",
          ARC_ORCHESTRATOR_CLAUDE_MODEL: "hostile-claude-model",
          ARC_ORCHESTRATOR_COMPOSER_MODEL: "hostile-composer-model",
        },
        invokeBackend: fake.invokeBackend,
        emitStderr: () => {},
        onRoutingTraceV2: (record) => v2.push(record),
      },
    );

    expect(result.success).toBe(true);
    expect(fake.invocations).toHaveLength(1);
    expect(fake.invocations[0]).toMatchObject({
      backend: "claude",
      profile: { model: "claude-fable-5" },
    });
    expect(v2[0]?.models).toMatchObject({
      requested: "claude-fable-5",
      attempted: "claude-fable-5",
    });
  });

  test("explicit fable alias ignores hostile model env overrides", async () => {
    const fake = createFakeBackend(successFor);
    const result = await executeRun(
      {
        ...runInput("claude", "implement"),
        requestedAlias: "fable-implement",
        routingIntent: "explicit",
        backendExplicit: false,
      },
      {
        env: {
          ARC_ORCHESTRATOR_ROUTE_SELECTION: "active",
          ARC_ORCHESTRATOR_IMPLEMENT_MODEL: "hostile-implement-model",
        },
        invokeBackend: fake.invokeBackend,
        emitStderr: () => {},
      },
    );

    expect(result.success).toBe(true);
    expect(fake.invocations).toHaveLength(1);
    expect(fake.invocations[0]).toMatchObject({
      backend: "claude",
      profile: { model: "claude-fable-5" },
    });
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
