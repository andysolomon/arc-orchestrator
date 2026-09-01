import { describe, expect, test } from "bun:test";
import {
  type BackendInvocationInput,
  type BackendInvocationOutput,
  executeRun,
  type InvokeBackend,
} from "../plugins/arc-orchestrator/lib/engine";
import { MODEL_REGISTRY, MODEL_REGISTRY_ERROR } from "../plugins/arc-orchestrator/lib/model-registry";
import {
  ROLLOUT_COHORT_ID_ENV,
  ROLLOUT_COHORT_PERCENT_ENV,
  ROLLOUT_FALLBACK_DISABLE_ENV,
  ROLLOUT_HUMAN_APPROVED_ENV,
  ROLLOUT_HUMAN_APPROVED_EXACT_VALUE,
  ROLLOUT_OPT_IN_ENV,
  ROLLOUT_OPT_IN_EXACT_VALUE,
  ROLLOUT_SELECTION_DISABLE_ENV,
  ROLLOUT_STAGE_ENV,
  ROLLOUT_TRACE_V2_DISABLE_ENV,
  ROLLOUT_TRANSITION_CRITERIA,
  assertRolloutGuardrailsForStage,
  boundedCohortIdentity,
  cohortInRolloutPercent,
  deterministicCohortBucket,
  evaluateRolloutTransition,
  parseCohortPercent,
  parseRolloutStage,
  projectRolloutRuntime,
  resolveSelectionStage,
  resolveTraceV2Writing,
  validateRolloutGuardrails,
  validateRolloutTelemetry,
  LEGACY_FALLBACK_ENGINE_ENV,
  LEGACY_TRACE_V2_ENV,
} from "../plugins/arc-orchestrator/lib/rollout-gates";
import { ROUTE_SELECTION_STAGE_ENV } from "../plugins/arc-orchestrator/lib/selection-activation";
import { renderRolloutGatesSection } from "../plugins/orchestrator-core/routing-policy";

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
      stdout:
        '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2}}',
      stderr: "",
      exitCode: 0,
      resultText: JSON.stringify(completedResult),
    };
  }
  return {
    stdout: JSON.stringify({
      is_error: false,
      result: JSON.stringify(completedResult),
    }),
    stderr: "",
    exitCode: 0,
  };
}

function runInput() {
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

const passingTelemetry = {
  sampleSize: 3_000,
  selectionMatchRate: 0.995,
  selectionCoverageRate: 0.99,
  errorRate: 0.001,
  availabilityFallbackRate: 0.01,
  redactionViolations: 0,
  schemaViolations: 0,
  budgetResetViolations: 0,
  guardrailViolations: 0,
};

const humanApprovedEnv = {
  [ROLLOUT_HUMAN_APPROVED_ENV]: ROLLOUT_HUMAN_APPROVED_EXACT_VALUE,
};

describe("rollout-gates: stage parsing", () => {
  test("unset or invalid stage preserves off projection", () => {
    expect(parseRolloutStage({})).toBeNull();
    expect(parseRolloutStage({ [ROLLOUT_STAGE_ENV]: "garbage" })).toBeNull();
    expect(projectRolloutRuntime({}).effectiveStage).toBe("off");
    expect(resolveSelectionStage({})).toBe("off");
    expect(resolveTraceV2Writing({})).toBe(true);
  });

  test("fixture stage keeps selection and fallback off with trace v2 on", () => {
    const projection = projectRolloutRuntime({
      [ROLLOUT_STAGE_ENV]: "fixture",
    });
    expect(projection.effectiveStage).toBe("fixture");
    expect(projection.selectionStage).toBe("off");
    expect(projection.fallbackStage).toBe("off");
    expect(projection.traceV2Writing).toBe(true);
  });

  test("shadow stage requires human approval before shadow projection", () => {
    expect(
      projectRolloutRuntime({ [ROLLOUT_STAGE_ENV]: "shadow" }).selectionStage,
    ).toBe("off");
    const projection = projectRolloutRuntime({
      [ROLLOUT_STAGE_ENV]: "shadow",
      ...humanApprovedEnv,
    });
    expect(projection.selectionStage).toBe("shadow");
    expect(projection.fallbackStage).toBe("shadow");
    expect(projection.traceV2Writing).toBe(true);
    expect(
      resolveSelectionStage({
        [ROLLOUT_STAGE_ENV]: "shadow",
        ...humanApprovedEnv,
      }),
    ).toBe("shadow");
  });

  test("opt-in stage requires exact opt-in flag and human approval", () => {
    expect(
      resolveSelectionStage({ [ROLLOUT_STAGE_ENV]: "opt-in" }),
    ).toBe("off");
    expect(
      resolveSelectionStage({
        [ROLLOUT_STAGE_ENV]: "opt-in",
        ...humanApprovedEnv,
      }),
    ).toBe("off");
    expect(
      resolveSelectionStage({
        [ROLLOUT_STAGE_ENV]: "opt-in",
        ...humanApprovedEnv,
        [ROLLOUT_OPT_IN_ENV]: ROLLOUT_OPT_IN_EXACT_VALUE,
      }),
    ).toBe("active");
    expect(
      resolveSelectionStage({
        [ROLLOUT_STAGE_ENV]: "opt-in",
        ...humanApprovedEnv,
        [ROLLOUT_OPT_IN_ENV]: "true",
      }),
    ).toBe("off");
  });

  test("limited-cohort hashes identity and uses deterministic percent", () => {
    const rawIdentity = "team-alpha";
    const identity = boundedCohortIdentity({}, rawIdentity)!;
    expect(identity).toMatch(/^[a-f0-9]{12}$/);
    expect(identity).not.toContain("team");
    expect(boundedCohortIdentity({}, identity)).toBe(identity);

    const bucket = deterministicCohortBucket(identity);
    const percent = bucket + 1;
    expect(cohortInRolloutPercent(identity, percent)).toBe(true);
    expect(cohortInRolloutPercent(identity, bucket)).toBe(bucket === 0);

    const projection = projectRolloutRuntime(
      {
        [ROLLOUT_STAGE_ENV]: "limited-cohort",
        [ROLLOUT_COHORT_PERCENT_ENV]: String(percent),
        ...humanApprovedEnv,
      },
      rawIdentity,
    );
    expect(projection.cohortEligible).toBe(true);
    expect(projection.selectionStage).toBe("active");
    expect(
      projectRolloutRuntime({
        [ROLLOUT_STAGE_ENV]: "limited-cohort",
        [ROLLOUT_COHORT_PERCENT_ENV]: String(percent),
      }, rawIdentity).selectionStage,
    ).toBe("off");
  });

  test("parseCohortPercent accepts whole numeric strings only", () => {
    expect(parseCohortPercent({})).toBe(10);
    expect(parseCohortPercent({ [ROLLOUT_COHORT_PERCENT_ENV]: "25" })).toBe(25);
    expect(parseCohortPercent({ [ROLLOUT_COHORT_PERCENT_ENV]: "10.5" })).toBe(10);
    expect(parseCohortPercent({ [ROLLOUT_COHORT_PERCENT_ENV]: "101" })).toBe(10);
    expect(parseCohortPercent({ [ROLLOUT_COHORT_PERCENT_ENV]: "-1" })).toBe(10);
    expect(parseCohortPercent({ [ROLLOUT_COHORT_PERCENT_ENV]: "10abc" })).toBe(10);
  });

  test("default stage activates canonical selection with human approval", () => {
    expect(
      projectRolloutRuntime({ [ROLLOUT_STAGE_ENV]: "default" }).selectionStage,
    ).toBe("off");
    const projection = projectRolloutRuntime({
      [ROLLOUT_STAGE_ENV]: "default",
      ...humanApprovedEnv,
    });
    expect(projection.selectionStage).toBe("active");
    expect(projection.fallbackStage).toBe("active");
    expect(projection.traceV2Writing).toBe(true);
    expect(projection.delegationEnabled).toBe(true);
  });

  test("trace v2 stays on across stages unless legacy or rollout rollback disables it", () => {
    for (const stage of [
      null,
      "fixture",
      "shadow",
      "opt-in",
      "limited-cohort",
      "default",
    ] as const) {
      const env =
        stage == null ? {} : { [ROLLOUT_STAGE_ENV]: stage, ...humanApprovedEnv };
      expect(resolveTraceV2Writing(env)).toBe(true);
    }
    expect(
      resolveTraceV2Writing({
        [ROLLOUT_STAGE_ENV]: "default",
        ...humanApprovedEnv,
        [ROLLOUT_TRACE_V2_DISABLE_ENV]: "0",
      }),
    ).toBe(false);
    expect(
      resolveTraceV2Writing({
        [ROLLOUT_STAGE_ENV]: "fixture",
        [LEGACY_TRACE_V2_ENV]: "0",
      }),
    ).toBe(false);
  });
});

describe("rollout-gates: legacy precedence and rollback flags", () => {
  test("legacy route selection env retains precedence when stage unset or approved", () => {
    expect(
      resolveSelectionStage({
        [ROUTE_SELECTION_STAGE_ENV]: "active",
      }),
    ).toBe("active");
    expect(
      resolveSelectionStage({
        [ROLLOUT_STAGE_ENV]: "default",
        ...humanApprovedEnv,
        [ROUTE_SELECTION_STAGE_ENV]: "shadow",
      }),
    ).toBe("shadow");
  });

  test("configured default with legacy active and no approval stays blocked", () => {
    const projection = projectRolloutRuntime({
      [ROLLOUT_STAGE_ENV]: "default",
      [ROUTE_SELECTION_STAGE_ENV]: "active",
      [LEGACY_FALLBACK_ENGINE_ENV]: "active",
    });
    expect(projection.selectionStage).toBe("off");
    expect(projection.fallbackStage).toBe("off");
    expect(projection.delegationEnabled).toBe(false);
    expect(projection.traceV2Writing).toBe(true);
  });

  test("configured shadow with legacy active and no approval stays blocked", () => {
    const projection = projectRolloutRuntime({
      [ROLLOUT_STAGE_ENV]: "shadow",
      [ROUTE_SELECTION_STAGE_ENV]: "active",
      [LEGACY_FALLBACK_ENGINE_ENV]: "active",
    });
    expect(projection.selectionStage).toBe("off");
    expect(projection.fallbackStage).toBe("off");
    expect(projection.delegationEnabled).toBe(false);
    expect(projection.traceV2Writing).toBe(true);
  });

  test("unset stage with legacy active still works without rollout approval", () => {
    expect(
      resolveSelectionStage({
        [ROUTE_SELECTION_STAGE_ENV]: "active",
        [LEGACY_FALLBACK_ENGINE_ENV]: "active",
      }),
    ).toBe("active");
    expect(
      projectRolloutRuntime({
        [ROUTE_SELECTION_STAGE_ENV]: "active",
        [LEGACY_FALLBACK_ENGINE_ENV]: "active",
      }).fallbackStage,
    ).toBe("active");
    expect(resolveTraceV2Writing({ [ROUTE_SELECTION_STAGE_ENV]: "active" })).toBe(
      true,
    );
  });

  test("rollout rollback flags win over legacy migration controls", () => {
    const env = {
      [ROLLOUT_STAGE_ENV]: "default",
      ...humanApprovedEnv,
      [ROUTE_SELECTION_STAGE_ENV]: "active",
      [LEGACY_FALLBACK_ENGINE_ENV]: "active",
      [LEGACY_TRACE_V2_ENV]: "1",
    };
    expect(
      resolveSelectionStage({
        ...env,
        [ROLLOUT_SELECTION_DISABLE_ENV]: "0",
      }),
    ).toBe("off");
    expect(
      resolveTraceV2Writing({
        ...env,
        [ROLLOUT_TRACE_V2_DISABLE_ENV]: "0",
      }),
    ).toBe(false);
    expect(
      projectRolloutRuntime({
        ...env,
        [ROLLOUT_FALLBACK_DISABLE_ENV]: "0",
      }).fallbackStage,
    ).toBe("off");
  });

  test("legacy trace v2 env disables writing before rollout rollback reapplies", () => {
    expect(
      resolveTraceV2Writing({
        [ROLLOUT_STAGE_ENV]: "fixture",
        [LEGACY_TRACE_V2_ENV]: "0",
      }),
    ).toBe(false);
    expect(
      resolveTraceV2Writing({
        [ROLLOUT_STAGE_ENV]: "fixture",
        [LEGACY_TRACE_V2_ENV]: "1",
        [ROLLOUT_TRACE_V2_DISABLE_ENV]: "0",
      }),
    ).toBe(false);
  });

  test("human approval gates activation but not trace v2", () => {
    const env = { [ROLLOUT_STAGE_ENV]: "default" };
    expect(resolveSelectionStage(env)).toBe("off");
    expect(resolveTraceV2Writing(env)).toBe(true);
    expect(
      resolveSelectionStage({ ...env, ...humanApprovedEnv }),
    ).toBe("active");
  });
});

describe("rollout-gates: transition telemetry", () => {
  test("named criteria block transitions until thresholds and human approval pass", () => {
    const transition = "limited-cohort-to-default";
    const criteria = ROLLOUT_TRANSITION_CRITERIA[transition];

    const blocked = evaluateRolloutTransition(
      transition,
      {
        ...passingTelemetry,
        sampleSize: criteria.minSampleSize - 1,
      },
      true,
    );
    expect(blocked.ready).toBe(false);
    expect(blocked.unmetReasons.some((reason) => reason.startsWith("sampleSize"))).toBe(
      true,
    );

    const noApproval = evaluateRolloutTransition(
      transition,
      passingTelemetry,
      false,
    );
    expect(noApproval.ready).toBe(false);
    expect(noApproval.unmetReasons).toContain(
      "humanApproved: explicit human approval required",
    );

    const ready = evaluateRolloutTransition(
      transition,
      passingTelemetry,
      true,
    );
    expect(ready.ready).toBe(true);
    expect(ready.unmetReasons).toEqual([]);
  });

  test("invalid telemetry values produce named unmet reasons before threshold checks", () => {
    const invalid = evaluateRolloutTransition(
      "fixture-to-shadow",
      {
        ...passingTelemetry,
        selectionMatchRate: Number.NaN,
        errorRate: 1.5,
        redactionViolations: -1,
        sampleSize: 2.5,
      },
      true,
    );
    expect(invalid.ready).toBe(false);
    expect(invalid.unmetReasons).toContain(
      "selectionMatchRate: NaN is not finite",
    );
    expect(invalid.unmetReasons).toContain("errorRate: 1.5 exceeds 1");
    expect(invalid.unmetReasons).toContain("redactionViolations: -1 is negative");
    expect(invalid.unmetReasons).toContain("sampleSize: 2.5 must be an integer");
    expect(
      invalid.unmetReasons.some((reason) => reason.includes("required")),
    ).toBe(false);

    expect(
      validateRolloutTelemetry({
        ...passingTelemetry,
        availabilityFallbackRate: Number.POSITIVE_INFINITY,
      }),
    ).toContain("availabilityFallbackRate: Infinity is not finite");
  });
});

describe("rollout-gates: guardrails", () => {
  test("live registry and stacks pass rollout guardrails at every stage including fixture", () => {
    for (const stage of [
      null,
      "fixture",
      "shadow",
      "opt-in",
      "limited-cohort",
      "default",
    ] as const) {
      const result = assertRolloutGuardrailsForStage(stage);
      expect(result.ok).toBe(true);
      expect(result.violations).toEqual([]);
    }
  });

  test("completed-low-quality disposition guardrail is terminal at every stage", () => {
    for (const stage of [
      null,
      "fixture",
      "shadow",
      "opt-in",
      "limited-cohort",
      "default",
    ] as const) {
      const result = assertRolloutGuardrailsForStage(stage);
      expect(
        result.violations.some((violation) =>
          violation.includes("completed-low-quality"),
        ),
      ).toBe(false);
    }
    const guardrails = validateRolloutGuardrails();
    expect(guardrails.ok).toBe(true);
  });

  test("planned inventory cannot become runnable and GLM is OpenCode Go only", () => {
    const planned = MODEL_REGISTRY.find((entry) => entry.maturity === "planned");
    expect(planned).toBeDefined();
    expect(planned!.routeEligibility).toEqual([]);

    const guardrails = validateRolloutGuardrails();
    expect(guardrails.ok).toBe(true);
    // GLM is reachable only through provider-qualified OpenCode Go identities;
    // there is still no direct Z.AI provider, adapter, or probe.
    const glmEntries = MODEL_REGISTRY.filter((entry) =>
      entry.stableId.toLowerCase().includes("glm"),
    );
    expect(glmEntries.length).toBeGreaterThan(0);
    for (const entry of glmEntries) {
      expect(entry.stableId.startsWith("opencode-go-glm-")).toBe(true);
      expect(entry.transportBackend).toBe("opencode");
      expect(entry.providerModelId?.startsWith("opencode-go/glm-")).toBe(true);
    }
  });

  test("guardrail validation rejects planned route eligibility", () => {
    const planned = MODEL_REGISTRY.find((entry) => entry.maturity === "planned");
    const violated = validateRolloutGuardrails({
      registry: [
        {
          ...planned!,
          routeEligibility: ["implement.workspace-write.v1"],
        },
      ],
    });
    expect(violated.ok).toBe(false);
    expect(
      violated.violations.some((violation) =>
        violation.includes("planned or disabled entry is route-eligible"),
      ),
    ).toBe(true);
  });

  test("guardrail validation rejects direct GLM and wrong OpenCode Go path", () => {
    const directGlm = {
      ...MODEL_REGISTRY.find((entry) => entry.stableId === "opencode-go-glm-5.3")!,
      stableId: "glm-5.3-direct",
      providerModelId: "glm-5.3",
      transportBackend: "codex" as const,
      adapterId: "codex-exec",
      servingProvider: "Zhipu AI",
    };
    const wrongAdapter = {
      ...MODEL_REGISTRY.find((entry) => entry.stableId === "opencode-go-glm-5.3-flash")!,
      adapterId: "cursor-agent",
    };
    const malformedProvider = {
      ...MODEL_REGISTRY.find((entry) => entry.stableId === "opencode-go-glm-5.2")!,
      providerModelId: "opencode-go/not-glm",
    };

    for (const entry of [directGlm, wrongAdapter, malformedProvider]) {
      const result = validateRolloutGuardrails({ registry: [entry] });
      expect(result.ok).toBe(false);
      expect(
        result.violations.some((violation) =>
          violation.includes(MODEL_REGISTRY_ERROR.GLM_PROVIDER_BOUNDARY),
        ),
      ).toBe(true);
    }
  });

  test("guardrail validation rejects a GLM provider id smuggled onto a non-OpenCode identity", () => {
    const smuggled = {
      ...MODEL_REGISTRY.find((entry) => entry.stableId === "composer-2.5")!,
      stableId: "bulk-implementer",
      family: "composer",
      displayName: "Bulk Implementer",
      aliases: [],
      providerModelId: "opencode-go/glm-5.3",
    };
    const result = validateRolloutGuardrails({ registry: [smuggled] });
    expect(result.ok).toBe(false);
    expect(
      result.violations.some((violation) =>
        violation.includes(MODEL_REGISTRY_ERROR.GLM_PROVIDER_BOUNDARY),
      ),
    ).toBe(true);
    expect(
      result.violations.some((violation) =>
        violation.includes("transportBackend must be opencode"),
      ),
    ).toBe(true);
    expect(
      result.violations.some((violation) =>
        violation.includes("stableId must be opencode-go-glm-5.3"),
      ),
    ).toBe(true);
  });

  test("guardrail validation accepts approved OpenCode Go GLM entries", () => {
    const approved = MODEL_REGISTRY.filter((entry) =>
      entry.stableId.startsWith("opencode-go-glm-"),
    );
    expect(approved.length).toBeGreaterThan(0);
    for (const entry of approved) {
      const result = validateRolloutGuardrails({ registry: [entry] });
      expect(
        result.violations.some((violation) =>
          violation.includes(MODEL_REGISTRY_ERROR.GLM_PROVIDER_BOUNDARY),
        ),
      ).toBe(false);
    }
  });

  test("guardrail validation preserves planned non-routable GLM records", () => {
    const plannedGlm = {
      ...MODEL_REGISTRY.find((entry) => entry.maturity === "planned")!,
      stableId: "glm-5.4-planned",
      family: "glm",
      displayName: "GLM 5.4 (planned)",
      aliases: ["GLM 5.4"],
    };
    const result = validateRolloutGuardrails({ registry: [plannedGlm] });
    expect(result.ok).toBe(true);
  });
});

describe("rollout-gates: shadow execution", () => {
  test("shadow stage invokes legacy backend while recording proposed selection", async () => {
    const invocations: BackendInvocationInput[] = [];
    const invokeBackend: InvokeBackend = async (value) => {
      invocations.push(value);
      return successFor(value);
    };

    const result = await executeRun(runInput(), {
      env: {
        [ROLLOUT_STAGE_ENV]: "shadow",
        ...humanApprovedEnv,
        ARC_ORCHESTRATOR_IMPLEMENT_MODEL: "legacy-shadow-model",
      },
      invokeBackend,
      emitStderr: () => {},
    });

    expect(result.success).toBe(true);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      backend: "codex",
      profile: { model: "legacy-shadow-model" },
    });
    expect(
      (result.trace as { routingShadow?: { proposedSelection?: unknown } })
        .routingShadow?.proposedSelection,
    ).toBeDefined();
  });
});

describe("rollout-gates: generated rollout docs", () => {
  test("renderRolloutGatesSection derives model defaults from capabilities", () => {
    const section = renderRolloutGatesSection();
    expect(section).toContain("## Staged routing rollout");
    expect(section).toContain("Composer 2.5");
    expect(section).toContain("`gpt-5.6-luna`");
    expect(section).toContain("humanApproved=true");
    expect(section).toContain("ARC_ORCHESTRATOR_ROLLOUT_HUMAN_APPROVED=1");
    expect(section).toContain("ARC_ORCHESTRATOR_ROUTE_SELECTION");
    expect(section).not.toContain("GPT-5.6 Terra remains the default");
  });
});
