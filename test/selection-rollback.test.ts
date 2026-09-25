import { describe, expect, test } from "bun:test";
import {
  type BackendInvocationInput,
  type BackendInvocationOutput,
  executeRun,
  type InvokeBackend,
} from "../plugins/arc-orchestrator/lib/engine";
import { ROUTE_SELECTION_STAGE_ENV } from "../plugins/arc-orchestrator/lib/selection-activation";
import { ROLLOUT_FALLBACK_DISABLE_ENV } from "../plugins/arc-orchestrator/lib/rollout-gates";

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
      stdout: '{"type":"turn.completed"}',
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

describe("selection rollback", () => {
  test("legacy fallback rollback cannot disable the v4 availability stack", async () => {
    const invocations: BackendInvocationInput[] = [];
    // easy-light leads with OpenCode Go GLM 5.3 Flash and then GPT-5.5; failing
    // both proves the legacy disable flag cannot stop the v4 traversal before
    // it crosses to the Cursor rung.
    const invokeBackend: InvokeBackend = async (value) => {
      invocations.push(value);
      if (value.backend === "opencode" || value.backend === "codex") {
        return {
          stdout: "",
          stderr: `${value.backend} CLI not found\nENOENT`,
          exitCode: 1,
        };
      }
      return successFor(value);
    };

    const result = await executeRun(input(), {
      env: {
        [ROUTE_SELECTION_STAGE_ENV]: "active",
        [ROLLOUT_FALLBACK_DISABLE_ENV]: "0",
      },
      invokeBackend,
      emitStderr: () => {},
    });

    expect(result.success).toBe(true);
    expect(invocations).toHaveLength(3);
    expect(invocations.map((entry) => entry.backend)).toEqual([
      "opencode",
      "codex",
      "composer",
    ]);
    expect(invocations[0]?.profile.model).toBe("opencode-go/glm-5.3-flash");
    expect(invocations[1]?.profile.model).toBe("gpt-5.5");
    expect(invocations[2]?.profile.model).toBe("cursor-grok-4.7-high");
  });
});
