import { describe, expect, test } from "bun:test";
import {
  type BackendInvocationInput,
  type BackendInvocationOutput,
  executeRun,
  type InvokeBackend,
  resolveCodexEffort,
} from "../plugins/fable-orchestrator/lib/engine";
import type { Backend, Mode, TraceRecord } from "../plugins/fable-orchestrator/lib/trace-schema";

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

describe("engine/run: backend profile consistency", () => {
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
