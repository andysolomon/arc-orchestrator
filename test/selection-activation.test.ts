import { describe, expect, test } from "bun:test";
import {
  type BackendInvocationInput,
  type BackendInvocationOutput,
  executeRun,
  type InvokeBackend,
} from "../plugins/fable-orchestrator/lib/engine";
import { fallbackEngineStage } from "../plugins/fable-orchestrator/lib/fallback-engine";
import {
  ROUTE_SELECTION_STAGE_ENV,
  routeSelectionStage,
} from "../plugins/fable-orchestrator/lib/selection-activation";
import type { TraceRecord } from "../plugins/fable-orchestrator/lib/trace-schema";

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
  };
}

describe("selection activation: staged flags", () => {
  test("selection and fallback flags are exact opt-ins", () => {
    expect(routeSelectionStage({})).toBe("off");
    expect(routeSelectionStage({ [ROUTE_SELECTION_STAGE_ENV]: "shadow" })).toBe("shadow");
    expect(routeSelectionStage({ [ROUTE_SELECTION_STAGE_ENV]: " ACTIVE " })).toBe("active");
    expect(routeSelectionStage({ [ROUTE_SELECTION_STAGE_ENV]: "1" })).toBe("off");
    expect(fallbackEngineStage({ FABLE_ORCHESTRATOR_FALLBACK_ENGINE: "active" })).toBe("active");
    expect(fallbackEngineStage({ FABLE_ORCHESTRATOR_FALLBACK_ENGINE: "1" })).toBe("off");
  });

  test("active canonical selection resolves an implementation alias through the approved composer default", async () => {
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
      backend: "composer",
      mode: "implement",
      profile: { model: "composer-2.5", sandbox: "workspace-write" },
    });
    expect(traces[0]?.model).toBe("composer-2.5");
    expect(
      (traces[0] as TraceRecord & { routingShadow?: { requestedAlias: string } })
        .routingShadow?.requestedAlias,
    ).toBe("codex-implement");
  });

  test("an eligible explicit override takes precedence over the stack default", async () => {
    const invocations: BackendInvocationInput[] = [];
    const traces: TraceRecord[] = [];
    const invokeBackend: InvokeBackend = async (value) => {
      invocations.push(value);
      return successFor(value);
    };

    const result = await executeRun(input(), {
      env: {
        [ROUTE_SELECTION_STAGE_ENV]: "active",
        FABLE_ORCHESTRATOR_IMPLEMENT_MODEL: "gpt-5.5",
      },
      invokeBackend,
      onTrace: (trace) => traces.push(trace),
      emitStderr: () => {},
    });

    expect(result.success).toBe(true);
    // The override pins gpt-5.5 on codex; the composer stack head is never run.
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      backend: "codex",
      mode: "implement",
      profile: { model: "gpt-5.5", sandbox: "workspace-write" },
    });
    expect(invocations.map((entry) => entry.backend)).not.toContain("composer");
    expect(traces[0]?.model).toBe("gpt-5.5");
    expect(
      (traces[0] as TraceRecord & {
        routingShadow?: { overrideOutcome: { status: string; stableId?: string } };
      }).routingShadow?.overrideOutcome,
    ).toMatchObject({ status: "applied", stableId: "gpt-5.5" });
  });

  test("an ineligible Sol override fails closed and invokes no backend", async () => {
    const invocations: BackendInvocationInput[] = [];
    const traces: TraceRecord[] = [];
    const invokeBackend: InvokeBackend = async (value) => {
      invocations.push(value);
      return successFor(value);
    };

    const result = await executeRun(input(), {
      env: {
        [ROUTE_SELECTION_STAGE_ENV]: "active",
        FABLE_ORCHESTRATOR_IMPLEMENT_MODEL: "gpt-5.6-sol",
      },
      invokeBackend,
      onTrace: (trace) => traces.push(trace),
      emitStderr: () => {},
    });

    // Sol without an explicit-parent-authorization signal is rejected; the run
    // must fail visibly and never silently select the composer stack head.
    expect(result.success).toBe(false);
    expect(invocations).toHaveLength(0);
    expect(traces[0]?.status).toBe("error");
    expect(traces[0]?.error).toContain("override rejected");
    expect(traces[0]?.error).toContain("explicit-parent-authorization-required");
  });

  test("budget exhaustion terminates and never advances automatic fallback", async () => {
    const invocations: BackendInvocationInput[] = [];
    const invokeBackend: InvokeBackend = async (value) => {
      invocations.push(value);
      if (value.backend === "composer") {
        throw new Error("budget: run exceeded FABLE_ORCHESTRATOR_MAX_DURATION_MS");
      }
      return successFor(value);
    };

    const result = await executeRun(input(), {
      env: {
        [ROUTE_SELECTION_STAGE_ENV]: "active",
        FABLE_ORCHESTRATOR_FALLBACK_ENGINE: "active",
      },
      invokeBackend,
      emitStderr: () => {},
    });

    // A budget failure on the first candidate is terminal: fallback is active,
    // but the traversal must not advance onto the next candidate (gpt-5.5).
    expect(result.success).toBe(false);
    expect(invocations.map((entry) => entry.backend)).toEqual(["composer"]);
  });

  test("automatic fallback requires its separate active flag and never selects Sol or Fable", async () => {
    const invocations: BackendInvocationInput[] = [];
    const invokeBackend: InvokeBackend = async (value) => {
      invocations.push(value);
      if (value.backend === "composer") {
        return { stdout: "", stderr: "Cursor Agent not found\nENOENT", exitCode: 1 };
      }
      return successFor(value);
    };

    const result = await executeRun(input(), {
      env: {
        [ROUTE_SELECTION_STAGE_ENV]: "active",
        FABLE_ORCHESTRATOR_FALLBACK_ENGINE: "active",
      },
      invokeBackend,
      emitStderr: () => {},
    });

    expect(result.success).toBe(true);
    expect(invocations.map((entry) => entry.backend)).toEqual(["composer", "codex"]);
    expect(invocations.map((entry) => entry.profile.model)).toEqual([
      "composer-2.5",
      "gpt-5.5",
    ]);
    expect(invocations.map((entry) => entry.profile.model)).not.toContain("gpt-5.6-sol");
    expect(invocations.map((entry) => entry.profile.model)).not.toContain("fable-5");
  });
});
