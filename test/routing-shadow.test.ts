import { describe, expect, test } from "bun:test";
import { PUBLIC_ALIAS_BINDINGS } from "../plugins/arc-orchestrator/lib/capability-routes";
import { CANDIDATE_STACKS } from "../plugins/arc-orchestrator/lib/model-registry";
import {
  type BackendInvocationInput,
  type BackendInvocationOutput,
  executeRun,
  type InvokeBackend,
} from "../plugins/arc-orchestrator/lib/engine";
import {
  ROUTING_SHADOW_SCHEMA_VERSION,
  resolveRoutingShadow,
} from "../plugins/arc-orchestrator/lib/routing-shadow";
import type {
  Backend,
  Mode,
  TraceRecord,
} from "../plugins/arc-orchestrator/lib/trace-schema";

const empty = {};

const completedResult = {
  status: "completed",
  summary: "done",
  changes: [],
  verification: [],
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
    taskClass: null,
    routeRationale: null,
    budget: { maxTokens: null, maxDurationMs: null },
    effort: null,
    fallback: null,
  };
}

describe("routing-shadow: alias resolution", () => {
  test.each(
    PUBLIC_ALIAS_BINDINGS.map((binding) => [
      binding.alias,
      binding.capabilityRoute,
    ]),
  )(
    "%s resolves to canonical route %s with fixed contract and versions",
    (alias, canonicalRoute) => {
      const report = resolveRoutingShadow({
        requestedAlias: alias,
        env: empty,
      });

      expect(report.requestedAlias).toBe(alias);
      expect(report.canonicalRouteId).toBe(canonicalRoute);
      expect(report.fixedContract).not.toBeNull();
      expect(report.fixedContract?.mode).toBeTypeOf("string");
      expect(report.fixedContract?.sandbox).toBeTypeOf("string");
      expect(report.fixedContract?.outputContract.endsWith(".v1")).toBe(true);
      expect(report.versions).toEqual({
        routingShadow: ROUTING_SHADOW_SCHEMA_VERSION,
        capabilityRoutes: 1,
        modelRegistry: 3,
        candidateStackPolicy: "runner-routing-v4",
      });
      expect(report.error).toBeUndefined();
    },
  );
});

describe("routing-shadow: candidate stacks", () => {
  test.each(
    CANDIDATE_STACKS.map((stack) => [
      stack.route,
      stack.candidates,
      stack.workloadClass ?? null,
      stack.phase ?? null,
    ]),
  )(
    "%s candidate evaluations follow stack order",
    (routeId, candidates, workloadClass, phase) => {
      // Backend-default aliases keep the automatic workload/ADR stacks; pinned
      // diagnostic aliases would collapse to a single candidate.
      const alias =
        routeId === "implement.workspace-write.v1"
          ? "fable-implement"
          : routeId === "explore.read-only.v1"
            ? "fable-explore"
            : routeId === "check.read-only.v1"
              ? "fable-check"
              : "opus-review";

      const report = resolveRoutingShadow({
        requestedAlias: alias,
        env: empty,
        workloadClass,
        phase,
        pinAlias: false,
      });

      expect(
        report.candidateEvaluations.map((entry) => entry.stableId),
      ).toEqual(candidates);
    },
  );
});

describe("routing-shadow: engine integration", () => {
  test("executeRun honors a grok requestedAlias for composer analyze", async () => {
    const fake = createFakeBackend(successFor);
    const traces: TraceRecord[] = [];

    const result = await executeRun(
      {
        ...runInput("composer", "analyze"),
        requestedAlias: "grok-explore",
      },
      {
        env: empty,
        invokeBackend: fake.invokeBackend,
        onTrace: (trace) => traces.push(trace),
        emitStderr: () => {},
      },
    );

    expect(result.success).toBe(true);
    expect(fake.invocations[0]).toMatchObject({
      backend: "composer",
      mode: "analyze",
      profile: { model: "cursor-grok-4.7-high", sandbox: "workspace-write" },
    });
    expect(traces[0]?.model).toBe("cursor-grok-4.7-high");
  });
});
