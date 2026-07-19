import { describe, expect, test } from "bun:test";
import {
  type BackendInvocationInput,
  type BackendInvocationOutput,
  executeRun,
  type InvokeBackend,
} from "../plugins/fable-orchestrator/lib/engine";
import { ROUTE_SELECTION_STAGE_ENV } from "../plugins/fable-orchestrator/lib/selection-activation";
import {
  ROLLOUT_HUMAN_APPROVED_ENV,
  ROLLOUT_HUMAN_APPROVED_EXACT_VALUE,
  ROLLOUT_SELECTION_DISABLE_ENV,
  ROLLOUT_STAGE_ENV,
} from "../plugins/fable-orchestrator/lib/rollout-gates";

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

describe("selection rollback", () => {
  test("off returns to the unchanged backend/mode path while retaining shadow evidence", async () => {
    const invocations: BackendInvocationInput[] = [];
    const traces: Array<Record<string, unknown>> = [];
    const invokeBackend: InvokeBackend = async (value) => {
      invocations.push(value);
      return successFor(value);
    };

    const result = await executeRun(input(), {
      env: {
        [ROUTE_SELECTION_STAGE_ENV]: "off",
        FABLE_ORCHESTRATOR_IMPLEMENT_MODEL: "legacy-custom-model",
      },
      invokeBackend,
      onTrace: (trace) => traces.push(trace as Record<string, unknown>),
      emitStderr: () => {},
    });

    expect(result.success).toBe(true);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      backend: "codex",
      mode: "implement",
      profile: { model: "legacy-custom-model", sandbox: "workspace-write" },
    });
    expect(traces[0]?.routingShadow).toMatchObject({
      requestedAlias: "implement.workspace-write.v1",
      proposedSelection: { backend: "composer", model: "composer-2.5" },
    });
  });

  test("active mode ignores ambient model env overrides and keeps the ADR stack head", async () => {
    // Ambient FABLE_ORCHESTRATOR_*_MODEL must not rewrite automatic selection.
    // Formerly-rejected Sol/Fable/Luna env values and unknown models are ignored.
    for (const model of ["gpt-5.6-sol", "fable-5", "gpt-5.6-luna", "no-such-model"]) {
      const invocations: BackendInvocationInput[] = [];
      const invokeBackend: InvokeBackend = async (value) => {
        invocations.push(value);
        return successFor(value);
      };

      const result = await executeRun(input(), {
        env: {
          [ROUTE_SELECTION_STAGE_ENV]: "active",
          FABLE_ORCHESTRATOR_IMPLEMENT_MODEL: model,
        },
        invokeBackend,
        emitStderr: () => {},
      });

      expect(result.success).toBe(true);
      expect(invocations).toHaveLength(1);
      expect(invocations[0]?.profile.model).toBe("composer-2.5");
    }
  });

  test("disabling only fallback leaves canonical first-candidate selection active", async () => {
    const invocations: BackendInvocationInput[] = [];
    const invokeBackend: InvokeBackend = async (value) => {
      invocations.push(value);
      if (value.backend === "composer") {
        return { stdout: "", stderr: "Cursor Agent not found\nENOENT", exitCode: 1 };
      }
      return successFor(value);
    };

    const result = await executeRun(input(), {
      env: { [ROUTE_SELECTION_STAGE_ENV]: "active" },
      invokeBackend,
      emitStderr: () => {},
    });

    expect(result.success).toBe(false);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.profile.model).toBe("composer-2.5");
  });

  test("rollout selection rollback flag disables default-stage canonical selection", async () => {
    const invocations: BackendInvocationInput[] = [];
    const invokeBackend: InvokeBackend = async (value) => {
      invocations.push(value);
      return successFor(value);
    };

    const result = await executeRun(input(), {
      env: {
        [ROLLOUT_STAGE_ENV]: "default",
        [ROLLOUT_HUMAN_APPROVED_ENV]: ROLLOUT_HUMAN_APPROVED_EXACT_VALUE,
        [ROLLOUT_SELECTION_DISABLE_ENV]: "0",
        FABLE_ORCHESTRATOR_IMPLEMENT_MODEL: "legacy-rollback-model",
      },
      invokeBackend,
      emitStderr: () => {},
    });

    expect(result.success).toBe(true);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.profile.model).toBe("legacy-rollback-model");
    expect(invocations[0]?.backend).toBe("codex");
  });
});
