import { describe, expect, test } from "bun:test";
import {
  type BackendInvocationInput,
  type BackendInvocationOutput,
  executeRun,
  type InvokeBackend,
} from "../plugins/arc-orchestrator/lib/engine";
import { ROUTE_SELECTION_STAGE_ENV } from "../plugins/arc-orchestrator/lib/selection-activation";

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

describe("selection activation: staged flags", () => {
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

    // A budget failure on the v4 medium-medium head (claude/opus-5.5) is
    // terminal: fallback is active, but the traversal must not advance onto
    // the next candidate (cursor-grok-4.7-high).
    expect(result.success).toBe(false);
    expect(invocations.map((entry) => entry.backend)).toEqual(["claude"]);
    expect(invocations.map((entry) => entry.profile.model)).toEqual([
      "claude-opus-5-5",
    ]);
  });
});
