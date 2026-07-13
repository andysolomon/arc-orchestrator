import { describe, expect, test } from "bun:test";
import { PUBLIC_ALIAS_BINDINGS } from "../plugins/fable-orchestrator/lib/capability-routes";
import {
  CANDIDATE_STACKS,
  MODEL_REGISTRY,
} from "../plugins/fable-orchestrator/lib/model-registry";
import {
  type BackendInvocationInput,
  type BackendInvocationOutput,
  executeRun,
  type InvokeBackend,
} from "../plugins/fable-orchestrator/lib/engine";
import {
  ROUTING_SHADOW_SCHEMA_VERSION,
  resolveRoutingShadow,
} from "../plugins/fable-orchestrator/lib/routing-shadow";
import type { Backend, Mode, TraceRecord } from "../plugins/fable-orchestrator/lib/trace-schema";

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

function collectStableIds(value: unknown): string[] {
  const found: string[] = [];
  const visit = (node: unknown) => {
    if (node == null || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === "stableId" && typeof child === "string") {
        found.push(child);
      }
      visit(child);
    }
  };
  visit(value);
  return found;
}

describe("routing-shadow: alias resolution", () => {
  test.each(
    PUBLIC_ALIAS_BINDINGS.map((binding) => [binding.alias, binding.capabilityRoute]),
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
      const expectedPolicy = alias.startsWith("mechanical-")
        ? "mechanical-ops-sandbox/v1"
        : "candidate-stacks/v1";
      expect(report.versions).toEqual({
        routingShadow: ROUTING_SHADOW_SCHEMA_VERSION,
        capabilityRoutes: 1,
        modelRegistry: 1,
        candidateStackPolicy: expectedPolicy,
      });
      expect(report.error).toBeUndefined();
    },
  );
});

describe("routing-shadow: candidate stacks", () => {
  test.each(
    CANDIDATE_STACKS.map((stack) => [stack.route, stack.candidates]),
  )(
    "%s candidate evaluations follow stack order",
    (routeId, candidates) => {
      const alias = PUBLIC_ALIAS_BINDINGS.find(
        (binding) => binding.capabilityRoute === routeId,
      )?.alias;
      expect(alias).toBeDefined();

      const report = resolveRoutingShadow({
        requestedAlias: alias!,
        env: empty,
      });

      expect(report.candidateEvaluations.map((entry) => entry.stableId)).toEqual(
        candidates,
      );
    },
  );

  test("composer-implement proposes composer-2.5", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "composer-implement",
      env: empty,
    });

    expect(report.proposedSelection).toEqual({
      backend: "composer",
      model: "composer-2.5",
    });
    expect(report.proposedSelectionReason).toBe("first-eligible-stack-candidate");
  });

  test("planned screenshot entries are never eligible when present in a stack", () => {
    for (const stableId of ["kimi-2.6", "haiku-4.5"]) {
      const entry = MODEL_REGISTRY.find((candidate) => candidate.stableId === stableId);
      expect(entry?.maturity).toBe("planned");
    }

    const report = resolveRoutingShadow({
      requestedAlias: "composer-implement",
      env: empty,
    });
    const plannedInReport = report.candidateEvaluations.filter((evaluation) =>
      ["kimi-2.6", "haiku-4.5"].includes(evaluation.stableId),
    );
    expect(plannedInReport).toEqual([]);
  });

  test("no GLM stableId appears anywhere in shadow report output", () => {
    for (const binding of PUBLIC_ALIAS_BINDINGS) {
      const report = resolveRoutingShadow({
        requestedAlias: binding.alias,
        env: empty,
      });
      const stableIds = collectStableIds(report);
      for (const stableId of stableIds) {
        expect(/glm/i.test(stableId)).toBe(false);
      }
    }
  });
});

describe("routing-shadow: current vs proposed comparison", () => {
  test("composer-implement matches when env defaults align", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "composer-implement",
      env: empty,
    });

    expect(report.currentSelection).toEqual({
      backend: "composer",
      model: "composer-2.5",
      role: "executing",
    });
    expect(report.comparison?.matches).toBe(true);
    expect(report.comparison?.explanation).toContain("agree");
  });

  test("grok aliases resolve current and proposed selection to grok-4.5", () => {
    const explore = resolveRoutingShadow({
      requestedAlias: "grok-explore",
      env: empty,
    });
    expect(explore.currentSelection).toEqual({
      backend: "composer",
      model: "grok-4.5",
      role: "executing",
    });
    expect(explore.proposedSelection).toEqual({
      backend: "composer",
      model: "grok-4.5",
    });
    expect(explore.candidateEvaluations.map((entry) => entry.stableId)).toEqual([
      "grok-4.5",
    ]);
    expect(explore.comparison?.matches).toBe(true);

    const check = resolveRoutingShadow({
      requestedAlias: "grok-check",
      env: empty,
    });
    expect(check.currentSelection?.model).toBe("grok-4.5");
    expect(check.proposedSelection?.model).toBe("grok-4.5");
  });

  test("codex-implement differs when env model override changes current selection", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "codex-implement",
      env: { FABLE_ORCHESTRATOR_IMPLEMENT_MODEL: "custom-implement" },
    });

    expect(report.currentSelection?.model).toBe("custom-implement");
    expect(report.proposedSelection?.model).toBe("composer-2.5");
    expect(report.comparison?.matches).toBe(false);
    expect(report.comparison?.explanation).toContain("custom-implement");
  });
});

describe("routing-shadow: role guardrails", () => {
  test("fable-5 is never eligible or proposed via override", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "composer-implement",
      env: empty,
      override: { model: "fable-5" },
    });

    expect(
      report.candidateEvaluations.some((entry) => entry.stableId === "fable-5"),
    ).toBe(false);
    expect(report.overrideOutcome).toMatchObject({
      status: "rejected",
      model: "fable-5",
      reasons: expect.arrayContaining(["parent-only-role-restriction"]),
    });
    expect(report.proposedSelection).toBeNull();
    expect(report.proposedSelectionReason).toBe("override-rejected");
  });

  test("gpt-5.6-sol is never proposed without explicit parent authorization", () => {
    const withoutAuth = resolveRoutingShadow({
      requestedAlias: "codex-implement",
      env: empty,
      override: { model: "gpt-5.6-sol" },
    });
    expect(withoutAuth.overrideOutcome).toEqual({
      status: "rejected",
      model: "gpt-5.6-sol",
      reasons: ["explicit-parent-authorization-required"],
    });
    expect(withoutAuth.proposedSelection).toBeNull();
    expect(withoutAuth.proposedSelectionReason).toBe("override-rejected");

    const withAuth = resolveRoutingShadow({
      requestedAlias: "codex-implement",
      env: empty,
      override: {
        model: "gpt-5.6-sol",
        explicitParentAuthorization: true,
      },
    });
    expect(withAuth.overrideOutcome).toMatchObject({
      status: "applied",
      stableId: "gpt-5.6-sol",
      explicitParentAuthorization: true,
    });
    expect(withAuth.proposedSelection?.model).toBe("gpt-5.6-sol");
  });
});

describe("routing-shadow: input normalization", () => {
  test("alias lookup tolerates case and surrounding whitespace", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "  Composer-Implement  ",
      env: empty,
    });
    expect(report.error).toBeUndefined();
    expect(report.requestedAlias).toBe("composer-implement");
    expect(report.canonicalRouteId).toBe("implement.workspace-write.v1");
  });

  test("authorized sol override resolves through display-label lookup", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "codex-implement",
      env: empty,
      override: {
        model: "GPT-5.6 Sol",
        explicitParentAuthorization: true,
      },
    });
    expect(report.overrideOutcome).toMatchObject({
      status: "applied",
      stableId: "gpt-5.6-sol",
    });
  });
});

describe("routing-shadow: unknown inputs never throw", () => {
  test("unknown alias becomes a structured error field", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "not-a-route",
      env: empty,
    });
    expect(report.error).toBe("unknown-alias");
    expect(report.canonicalRouteId).toBeNull();
  });

  test("resolver never throws for malformed override input", () => {
    expect(() =>
      resolveRoutingShadow({
        requestedAlias: "composer-implement",
        env: empty,
        override: { model: "   " },
      }),
    ).not.toThrow();
  });
});

describe("routing-shadow: engine integration", () => {
  test("executeRun trace carries routingShadow without changing backend input", async () => {
    const fake = createFakeBackend(successFor);
    const traces: TraceRecord[] = [];

    const result = await executeRun(runInput("composer", "implement"), {
      env: empty,
      invokeBackend: fake.invokeBackend,
      onTrace: (trace) => traces.push(trace),
      emitStderr: () => {},
    });

    expect(result.success).toBe(true);
    expect(traces).toHaveLength(1);
    const trace = traces[0] as TraceRecord & {
      routingShadow?: ReturnType<typeof resolveRoutingShadow>;
    };
    expect(trace.routingShadow).toBeDefined();
    expect(trace.routingShadow?.requestedAlias).toBe("composer-implement");
    expect(trace.routingShadow?.comparison?.matches).toBe(true);
    expect(fake.invocations).toHaveLength(1);
    expect(fake.invocations[0].backend).toBe("composer");
    expect(fake.invocations[0].profile.model).toBe("composer-2.5");
  });

  test("fake backend invocation input matches a control run profile", async () => {
    const fake = createFakeBackend(successFor);
    const traces: TraceRecord[] = [];

    await executeRun(runInput("codex", "analyze"), {
      env: empty,
      invokeBackend: fake.invokeBackend,
      onTrace: (trace) => traces.push(trace),
      emitStderr: () => {},
    });

    const trace = traces[0] as TraceRecord & {
      routingShadow?: ReturnType<typeof resolveRoutingShadow>;
    };
    expect(trace.routingShadow).toBeDefined();
    expect(fake.invocations[0].profile.model).toBe("gpt-5.6-luna");
    expect(fake.invocations[0].prompt).toContain("Mode: analyze");
    expect(trace.model).toBe(fake.invocations[0].profile.model);
  });

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
      profile: { model: "grok-4.5", sandbox: "read-only" },
    });
    expect(traces[0]?.model).toBe("grok-4.5");
  });

  test("executeRun succeeds when shadow reports unknown alias without aborting", async () => {
    const fake = createFakeBackend(successFor);
    const traces: TraceRecord[] = [];

    const result = await executeRun(
      {
        ...runInput("composer", "implement"),
        label: "shadow-observability-only",
      },
      {
        env: empty,
        invokeBackend: fake.invokeBackend,
        onTrace: (trace) => traces.push(trace),
        emitStderr: () => {},
      },
    );

    expect(result.success).toBe(true);
    expect(traces[0]).toBeDefined();
    expect(
      (traces[0] as TraceRecord & { routing_shadow_error?: string })
        .routing_shadow_error,
    ).toBeUndefined();
  });
});
