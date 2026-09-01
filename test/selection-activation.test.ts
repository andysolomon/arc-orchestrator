import { describe, expect, test } from "bun:test";
import {
  type BackendInvocationInput,
  type BackendInvocationOutput,
  executeRun,
  type InvokeBackend,
} from "../plugins/arc-orchestrator/lib/engine";
import { fallbackEngineStage } from "../plugins/arc-orchestrator/lib/fallback-engine";
import {
  ROLLOUT_HUMAN_APPROVED_ENV,
  ROLLOUT_HUMAN_APPROVED_EXACT_VALUE,
  ROLLOUT_OPT_IN_ENV,
  ROLLOUT_OPT_IN_EXACT_VALUE,
  ROLLOUT_STAGE_ENV,
  resolveSelectionStage,
} from "../plugins/arc-orchestrator/lib/rollout-gates";
import {
  ROUTE_SELECTION_STAGE_ENV,
  routeSelectionStage,
} from "../plugins/arc-orchestrator/lib/selection-activation";
import type { TraceRecord } from "../plugins/arc-orchestrator/lib/trace-schema";

const completedResult = {
  status: "completed",
  summary: "done",
  changes: [],
  verification: [],
  risks: [],
  next_actions: [],
};

function successFor(input: BackendInvocationInput): BackendInvocationOutput {
  if (input.backend === "codex") {
    return {
      stdout: '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2}}',
      stderr: "",
      exitCode: 0,
      resultText: JSON.stringify(completedResult),
    };
  }
  if (input.backend === "opencode") {
    // OpenCode streams JSONL parts; the structured result arrives as assistant
    // text and usage rides the closing step event.
    return {
      stdout: [
        JSON.stringify({ type: "step.start", part: { step: 0 } }),
        JSON.stringify({ type: "text", part: { text: "Applying the change." } }),
        JSON.stringify({
          type: "text",
          part: { text: JSON.stringify(completedResult) },
        }),
        JSON.stringify({
          type: "step.finish",
          usage: { inputTokens: 8, outputTokens: 9, totalTokens: 17 },
        }),
        "",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    };
  }
  return {
    stdout: JSON.stringify({
      is_error: false,
      ...(input.backend === "composer"
        ? { result: JSON.stringify(completedResult) }
        : { structured_output: completedResult }),
    }),
    stderr: "",
    exitCode: 0,
  };
}

function input() {
  return {
    backend: "codex" as const,
    mode: "implement" as const,
    task: "do work",
    cwd: process.cwd(),
    label: null,
    taskClass: null,
    routeRationale: null,
    budget: { maxTokens: null, maxDurationMs: null },
    effort: null,
    fallback: null,
    workloadClass: "easy-light",
  };
}

const humanApprovedEnv = {
  [ROLLOUT_HUMAN_APPROVED_ENV]: ROLLOUT_HUMAN_APPROVED_EXACT_VALUE,
};

describe("selection activation: staged flags", () => {
  test("selection and fallback flags are exact opt-ins", () => {
    expect(routeSelectionStage({})).toBe("off");
    expect(routeSelectionStage({ [ROUTE_SELECTION_STAGE_ENV]: "shadow" })).toBe("shadow");
    expect(routeSelectionStage({ [ROUTE_SELECTION_STAGE_ENV]: " ACTIVE " })).toBe("active");
    expect(routeSelectionStage({ [ROUTE_SELECTION_STAGE_ENV]: "1" })).toBe("off");
    expect(fallbackEngineStage({ ARC_ORCHESTRATOR_FALLBACK_ENGINE: "active" })).toBe("active");
    expect(fallbackEngineStage({ ARC_ORCHESTRATOR_FALLBACK_ENGINE: "1" })).toBe("off");
  });

  test("active canonical selection resolves the approved easy-light lead", async () => {
    const invocations: BackendInvocationInput[] = [];
    const traces: TraceRecord[] = [];
    const invokeBackend: InvokeBackend = async (value) => {
      invocations.push(value);
      return successFor(value);
    };

    const result = await executeRun(input(), {
      env: {
        [ROUTE_SELECTION_STAGE_ENV]: "active",
      },
      invokeBackend,
      onTrace: (trace) => traces.push(trace),
      emitStderr: () => {},
    });

    expect(result.success).toBe(true);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      backend: "opencode",
      mode: "implement",
      profile: {
        model: "opencode-go/glm-5.3-flash",
        sandbox: "workspace-write",
      },
    });
    expect(traces[0]?.model).toBe("opencode-go/glm-5.3-flash");
    expect(
      (traces[0] as TraceRecord & { routingShadow?: { requestedAlias: string } })
        .routingShadow?.requestedAlias,
    ).toBe("implement.workspace-write.v1");
  });

  test("ambient model env overrides do not change automatic stack selection", async () => {
    const invocations: BackendInvocationInput[] = [];
    const traces: TraceRecord[] = [];
    const invokeBackend: InvokeBackend = async (value) => {
      invocations.push(value);
      return successFor(value);
    };

    const result = await executeRun(input(), {
      env: {
        [ROUTE_SELECTION_STAGE_ENV]: "active",
        ARC_ORCHESTRATOR_IMPLEMENT_MODEL: "gpt-5.5",
        ARC_ORCHESTRATOR_ANALYZE_MODEL: "hostile-analyze",
        ARC_ORCHESTRATOR_REVIEW_MODEL: "hostile-review",
      },
      invokeBackend,
      onTrace: (trace) => traces.push(trace),
      emitStderr: () => {},
    });

    expect(result.success).toBe(true);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      backend: "opencode",
      mode: "implement",
      profile: {
        model: "opencode-go/glm-5.3-flash",
        sandbox: "workspace-write",
      },
    });
    expect(traces[0]?.model).toBe("opencode-go/glm-5.3-flash");
    expect(
      (traces[0] as TraceRecord & {
        routingShadow?: { overrideOutcome: { status: string } };
      }).routingShadow?.overrideOutcome,
    ).toMatchObject({ status: "not-requested" });
  });

  test("hostile Sol env override cannot change automatic selection", async () => {
    const invocations: BackendInvocationInput[] = [];
    const traces: TraceRecord[] = [];
    const invokeBackend: InvokeBackend = async (value) => {
      invocations.push(value);
      return successFor(value);
    };

    const result = await executeRun(input(), {
      env: {
        [ROUTE_SELECTION_STAGE_ENV]: "active",
        ARC_ORCHESTRATOR_IMPLEMENT_MODEL: "gpt-5.6-sol",
      },
      invokeBackend,
      onTrace: (trace) => traces.push(trace),
      emitStderr: () => {},
    });

    expect(result.success).toBe(true);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.backend).toBe("opencode");
    expect(invocations[0]?.profile.model).toBe("opencode-go/glm-5.3-flash");
    expect(traces[0]?.model).toBe("opencode-go/glm-5.3-flash");
    expect(traces[0]?.status).toBe("completed");
  });

  test("budget exhaustion terminates and never advances automatic fallback", async () => {
    const invocations: BackendInvocationInput[] = [];
    const invokeBackend: InvokeBackend = async (value) => {
      invocations.push(value);
      if (value.backend === "claude") {
        throw new Error("budget: run exceeded ARC_ORCHESTRATOR_MAX_DURATION_MS");
      }
      return successFor(value);
    };

    const result = await executeRun(
      { ...input(), workloadClass: "medium-medium" },
      {
        env: {
          [ROUTE_SELECTION_STAGE_ENV]: "active",
          ARC_ORCHESTRATOR_FALLBACK_ENGINE: "active",
        },
        invokeBackend,
        emitStderr: () => {},
      },
    );

    // A budget failure on the v4 medium-medium head (claude/opus-5) is
    // terminal: fallback is active, but the traversal must not advance onto
    // the next candidate (cursor-grok-4.6-high).
    expect(result.success).toBe(false);
    expect(invocations.map((entry) => entry.backend)).toEqual(["claude"]);
    expect(invocations.map((entry) => entry.profile.model)).toEqual([
      "claude-opus-5",
    ]);
  });

  test("automatic fallback requires its separate active flag and never selects Sol or Fable", async () => {
    const invocations: BackendInvocationInput[] = [];
    const invokeBackend: InvokeBackend = async (value) => {
      invocations.push(value);
      if (value.backend === "claude") {
        return { stdout: "", stderr: "Claude CLI not found\nENOENT", exitCode: 1 };
      }
      return successFor(value);
    };

    const result = await executeRun(
      { ...input(), workloadClass: "medium-medium" },
      {
        env: {
          [ROUTE_SELECTION_STAGE_ENV]: "active",
          ARC_ORCHESTRATOR_FALLBACK_ENGINE: "active",
        },
        invokeBackend,
        emitStderr: () => {},
      },
    );

    expect(result.success).toBe(true);
    expect(invocations.map((entry) => entry.backend)).toEqual([
      "claude",
      "composer",
    ]);
    expect(invocations.map((entry) => entry.profile.model)).toEqual([
      "claude-opus-5",
      "cursor-grok-4.6-high",
    ]);
    expect(invocations.map((entry) => entry.profile.model)).not.toContain("gpt-5.6-sol");
    expect(invocations.map((entry) => entry.profile.model)).not.toContain("fable-5.1");
  });

  test("default rollout stage activates canonical selection with human approval", async () => {
    const invocations: BackendInvocationInput[] = [];
    const invokeBackend: InvokeBackend = async (value) => {
      invocations.push(value);
      return successFor(value);
    };

    const blocked = await executeRun(input(), {
      env: { [ROLLOUT_STAGE_ENV]: "default" },
      invokeBackend,
      emitStderr: () => {},
    });
    expect(blocked.success).toBe(true);
    expect(invocations[0]?.profile.model).not.toBe("opencode-go/glm-5.3-flash");

    invocations.length = 0;
    const result = await executeRun(input(), {
      env: { [ROLLOUT_STAGE_ENV]: "default", ...humanApprovedEnv },
      invokeBackend,
      emitStderr: () => {},
    });

    expect(result.success).toBe(true);
    expect(invocations[0]?.profile.model).toBe("opencode-go/glm-5.3-flash");
    expect(
      resolveSelectionStage({
        [ROLLOUT_STAGE_ENV]: "default",
        ...humanApprovedEnv,
      }),
    ).toBe("active");
  });

  test("opt-in rollout stage requires exact opt-in flag and human approval for activation", async () => {
    const invocations: BackendInvocationInput[] = [];
    const invokeBackend: InvokeBackend = async (value) => {
      invocations.push(value);
      return successFor(value);
    };

    const blocked = await executeRun(input(), {
      env: { [ROLLOUT_STAGE_ENV]: "opt-in" },
      invokeBackend,
      emitStderr: () => {},
    });
    expect(blocked.success).toBe(true);
    expect(invocations[0]?.profile.model).not.toBe("opencode-go/glm-5.3-flash");

    invocations.length = 0;
    const active = await executeRun(input(), {
      env: {
        [ROLLOUT_STAGE_ENV]: "opt-in",
        ...humanApprovedEnv,
        [ROLLOUT_OPT_IN_ENV]: ROLLOUT_OPT_IN_EXACT_VALUE,
      },
      invokeBackend,
      emitStderr: () => {},
    });
    expect(active.success).toBe(true);
    expect(invocations[0]?.profile.model).toBe("opencode-go/glm-5.3-flash");
  });
});
