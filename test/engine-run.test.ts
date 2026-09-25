import { describe, expect, test } from "bun:test";
import {
  type BackendInvocationInput,
  type BackendInvocationOutput,
  executeRun,
  executeRunAttempt,
  type InvokeBackend,
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
  test.each([
    [
      "implement",
      "composer",
      "composer-implement",
      "composer-2.5",
      "workspace-write",
    ],
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
            ARC_ORCHESTRATOR_ANALYZE_MODEL: "gpt-6-sol",
            ARC_ORCHESTRATOR_IMPLEMENT_MODEL: "gpt-6-sol",
            ARC_ORCHESTRATOR_REVIEW_MODEL: "gpt-6-sol",
            ARC_ORCHESTRATOR_CLAUDE_MODEL: "claude-sonnet-4-6",
            ARC_ORCHESTRATOR_COMPOSER_MODEL: "gpt-6-sol",
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
      expect(fake.invocations[0].prompt).not.toContain("gpt-6-sol");
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
    [
      "analyze",
      "claude",
      "opus-explore",
      "cursor-auto-explore",
      "Claude usage limit reached",
      "usage_limit",
    ],
    [
      "implement",
      "composer",
      "composer-implement",
      "cursor-auto-implement",
      "usage limit reached",
      "usage_limit",
    ],
  ] as const)(
    "Eco %s availability outage retries once on %s",
    async (
      mode,
      backend,
      requestedAlias,
      backupAlias,
      outageMessage,
      outageReason,
    ) => {
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
      expect(fake.invocations[1].profile.model).toBe("auto");
      expect(result.traces).toHaveLength(2);
      expect(traces).toHaveLength(2);
      expect(v2Traces).toHaveLength(2);
      expect(traces[0].failure_class).toBe("backend_unavailable");
      expect(traces[0].outage_reason).toBe(outageReason);
      expect(traces[0]).not.toHaveProperty("fallback");
      expect(traces[1].fallback_of).toBe(traces[0].run_id);
      expect(traces[1].routingShadow?.requestedAlias).toBe(backupAlias);
      expect(stderr.join("\n")).toContain(
        `eco availability backup ${backupAlias}`,
      );
      expect(stderr.join("\n")).not.toMatch(
        /codex-explore|terra-implement|sol-implement/i,
      );
    },
  );

  test("Eco review backup resolves read-only on the composer transport", async () => {
    let calls = 0;
    const fake = createFakeBackend((input) => {
      calls += 1;
      if (calls === 1) {
        return { stdout: "", stderr: "Claude usage limit reached", exitCode: 1 };
      }
      return successFor(input);
    });
    const result = await executeRun(
      {
        ...runInput("claude", "review"),
        orchestratorIdentity: "eco",
        requestedAlias: "opus-check",
        fallback: "claude",
      },
      {
        env: {
          ARC_ORCHESTRATOR_ROLLOUT_STAGE: "default",
          ARC_ORCHESTRATOR_ROLLOUT_HUMAN_APPROVED: "1",
        },
        invokeBackend: fake.invokeBackend,
        onTrace: () => {},
        onRoutingTraceV2: () => {},
        emitStderr: () => {},
      },
    );

    expect(result.success).toBe(true);
    expect(fake.invocations).toHaveLength(2);
    // Review is read-only on every transport, primary and backup alike.
    expect(fake.invocations[0].profile.sandbox).toBe("read-only");
    expect(fake.invocations[1]).toMatchObject({
      backend: "composer",
      mode: "review",
      profile: { model: "auto", sandbox: "read-only" },
    });
  });
});

describe("engine/run: outage handling", () => {
  test("keeps availability fallback across the explore stack when selection is active", async () => {
    // Every rung ahead of MiniMax is availability-failed, including the
    // OpenCode Go GLM 5.3 rung that now trails the explore chain, so the
    // traversal has to cross four transports before it succeeds.
    const fake = createFakeBackend((input) => {
      if (
        input.backend === "codex" ||
        input.backend === "claude" ||
        input.backend === "opencode"
      ) {
        return {
          stdout:
            input.backend === "codex"
              ? '{"type":"turn.failed","error":{"message":"usage limit reached"}}'
              : "",
          stderr:
            input.backend === "codex"
              ? ""
              : `${input.backend} usage limit reached`,
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
    // Explore chain plus the shared emergency tail.
    expect(fake.invocations.map((invocation) => invocation.backend)).toEqual([
      "claude",
      "codex",
      "codex",
      "opencode",
      "opencode",
      "minimax",
    ]);
    expect(
      fake.invocations.map((invocation) => invocation.profile.model),
    ).toEqual([
      "claude-fable-5-1",
      "gpt-6-sol",
      "gpt-6-luna",
      "opencode-go/glm-5.3",
      "opencode-go/kimi-k3",
      "MiniMax-M3",
    ]);
    expect(traces.length).toBeGreaterThanOrEqual(3);
    // Canonical traversal must not emit legacy hard-coded next-hop hints.
    for (const trace of traces) {
      expect(trace.fallback).toBeUndefined();
    }
    expect(stderr.some((line) => line.includes('"fallback":{"backend"'))).toBe(
      false,
    );
  });

  test("automatic hard-heavy traversal advances from opaque Fable exit to Sol", async () => {
    const fake = createFakeBackend((input) => {
      if (input.backend === "claude") {
        return {
          stdout: "",
          stderr: "",
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
        backendExplicit: false,
        taskClass: null,
        workloadClass: "hard-heavy",
      },
      {
        env: {
          ARC_ORCHESTRATOR_ROUTE_SELECTION: "active",
        },
        invokeBackend: fake.invokeBackend,
        onTrace: (trace) => traces.push(trace),
        onRoutingTraceV2: (trace) => v2Traces.push(trace),
        emitStderr: () => {},
      },
    );

    expect(result.success).toBe(true);
    expect(
      fake.invocations.map((invocation) => invocation.profile.model),
    ).toEqual(["claude-fable-5-1", "gpt-6-sol"]);
    expect(fake.invocations.map((invocation) => invocation.backend)).toEqual([
      "claude",
      "codex",
    ]);
    expect(traces[0].failure_class).toBe("backend_unavailable");
    expect(traces[0].outage_reason).toBe("process_failure");
    expect(v2Traces.map((trace) => trace.models.candidate)).toEqual([
      "fable-5.1",
      "gpt-6-sol",
    ]);
    expect(v2Traces[1].failure.fallback_source).toBe("fable-5.1");
    expect(v2Traces[1].failure.fallback_destination).toBe("gpt-6-sol");
  });

  test("explicit alias ignores hostile model env overrides", async () => {
    const fake = createFakeBackend(successFor);
    const v2: Array<{ models?: { requested?: string; attempted?: string } }> =
      [];
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
      profile: { model: "claude-fable-5-1" },
    });
    expect(v2[0]?.models).toMatchObject({
      requested: "claude-fable-5-1",
      attempted: "claude-fable-5-1",
    });
  });
});

describe("engine/run: codex effort defaults", () => {
  test("automatic phase stacks apply their candidate-specific effort", async () => {
    const fake = createFakeBackend(successFor);
    const result = await executeRun(
      {
        ...runInput("codex", "implement"),
        backendExplicit: false,
        phase: "implement",
        workloadClass: "hard-light",
      },
      {
        env: { ARC_ORCHESTRATOR_ROUTE_SELECTION: "active" },
        invokeBackend: fake.invokeBackend,
        emitStderr: () => {},
      },
    );

    expect(result.success).toBe(true);
    expect(fake.invocations[0]).toMatchObject({
      backend: "codex",
      phase: "implement",
      effort: "high",
      profile: { model: "gpt-6-sol" },
    });
    expect(result.trace).toMatchObject({
      phase: "implement",
      effort: "high",
    });
  });
});

describe("engine/run: escalation_of trace link (phase 14.6)", () => {
  function attemptOptions(invokeBackend: InvokeBackend) {
    return {
      env: {},
      invokeBackend,
      emitStderr: () => {},
    };
  }

  function baseAttemptInput() {
    return {
      backend: "codex" as const,
      mode: "implement" as const,
      task: "escalation link test",
      cwd: process.cwd(),
      label: null,
      taskClass: null,
      routeRationale: null,
      budget: { maxTokens: null, maxDurationMs: null },
      effort: null,
    };
  }

  test("escalationOf writes escalation_of and not fallback_of", async () => {
    const fake = createFakeBackend(successFor);
    const priorRunId = "superseded-run-abc";
    const result = await executeRunAttempt(
      { ...baseAttemptInput(), escalationOf: priorRunId },
      attemptOptions(fake.invokeBackend),
    );

    expect(result.trace.escalation_of).toBe(priorRunId);
    expect(result.trace).not.toHaveProperty("fallback_of");
  });

  test("prefers fallback_of when both fallbackOf and escalationOf are set", async () => {
    const fake = createFakeBackend(successFor);
    const result = await executeRunAttempt(
      {
        ...baseAttemptInput(),
        fallbackOf: "prior-fallback",
        escalationOf: "prior-escalation",
      },
      attemptOptions(fake.invokeBackend),
    );

    expect(result.trace.fallback_of).toBe("prior-fallback");
    expect(result.trace).not.toHaveProperty("escalation_of");
  });
});
