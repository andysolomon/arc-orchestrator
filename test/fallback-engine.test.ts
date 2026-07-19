import { describe, expect, test } from "bun:test";
import type { OutputContractId } from "../plugins/arc-orchestrator/lib/capability-routes";
import {
  completedLowQualityDisposition,
  dispositionFor,
} from "../plugins/arc-orchestrator/lib/failure-classification";
import {
  fallbackEngineStage,
  runFallbackTraversal,
  type AttemptFn,
  type FixedFallbackContract,
} from "../plugins/arc-orchestrator/lib/fallback-engine";
import type {
  CandidateStack,
  ModelMaturity,
  ModelRegistryEntry,
  PriceBand,
} from "../plugins/arc-orchestrator/lib/model-registry";
import type { Backend, TraceSandbox } from "../plugins/arc-orchestrator/lib/trace-schema";

const ROUTE = "implement.workspace-write.v1" as const;
const CONTRACT: FixedFallbackContract = {
  mode: "implement",
  sandbox: "workspace-write",
  outputContract: "implementation-result.v1",
};

type FixtureOverrides = Partial<ModelRegistryEntry> & { stableId: string };

function createRegistryEntry(overrides: FixtureOverrides): ModelRegistryEntry {
  const {
    stableId,
    servingProvider = "openai",
    transportBackend = "codex",
    priceBand = "$$",
    maturity = "available",
    sandboxPermissionSupport = ["workspace-write"],
    outputContracts = ["implementation-result.v1"],
    providerModelId = null,
    ...rest
  } = overrides;

  return {
    stableId,
    family: "test",
    version: "1",
    publisher: "test",
    servingProvider,
    providerModelId,
    transportBackend: transportBackend as Backend,
    adapterId: "test-adapter",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "test",
    runnerSupport: ["codex:implement"],
    routeEligibility: [ROUTE],
    sandboxPermissionSupport: sandboxPermissionSupport as TraceSandbox[],
    outputContracts: outputContracts as OutputContractId[],
    maturity: maturity as ModelMaturity,
    provenance: {
      sources: ["test"],
      capturedAt: null,
      verificationResult: "verified",
      approver: null,
    },
    priceBand: priceBand as PriceBand,
    numericPricing: null,
    aliases: [],
    displayName: stableId,
    roleRestriction: null,
    evidence: {
      providerAccountAvailability: { verified: true },
      adapter: { verified: true },
      route: { verified: true },
      sandbox: { verified: true },
      output: { verified: true },
      cancellation: { verified: true },
      errorNormalization: { verified: true },
    },
    ...rest,
  };
}

function createStack(candidates: string[]): CandidateStack {
  return {
    route: ROUTE,
    policyVersion: "candidate-stacks/v1",
    candidates,
    automaticFallback: true,
  };
}

type AttemptCall = {
  stableId: string;
  attemptIndex: number;
};

function recordAttempts(
  outcomes: Array<
    | { status: "success" }
    | { status: "failure"; classification: string; detail?: string | null }
  >,
): { attemptFn: AttemptFn; calls: AttemptCall[] } {
  const calls: AttemptCall[] = [];
  let index = 0;
  const attemptFn: AttemptFn = async (candidate, attemptIndex) => {
    calls.push({ stableId: candidate.stableId, attemptIndex });
    const outcome = outcomes[index];
    index++;
    if (!outcome) {
      throw new Error(`Unexpected attempt ${index}`);
    }
    if (outcome.status === "success") {
      return { status: "success" };
    }
    return {
      status: "failure",
      disposition: dispositionFor(outcome.classification, outcome.detail),
    };
  };
  return { attemptFn, calls };
}

describe("fallback-engine: fallbackEngineStage", () => {
  test("unset, empty, and garbage values return off", () => {
    expect(fallbackEngineStage({})).toBe("off");
    expect(fallbackEngineStage({ ARC_ORCHESTRATOR_FALLBACK_ENGINE: "" })).toBe("off");
    expect(fallbackEngineStage({ ARC_ORCHESTRATOR_FALLBACK_ENGINE: "garbage" })).toBe("off");
  });

  test("shadow returns shadow", () => {
    expect(fallbackEngineStage({ ARC_ORCHESTRATOR_FALLBACK_ENGINE: "shadow" })).toBe("shadow");
  });
});

describe("fallback-engine: runFallbackTraversal", () => {
  test("success on first candidate selects providerModelId when present", async () => {
    const registry = [
      createRegistryEntry({
        stableId: "first",
        providerModelId: "provider-model-1",
      }),
    ];
    const { attemptFn, calls } = recordAttempts([{ status: "success" }]);

    const result = await runFallbackTraversal(
      { route: ROUTE, contract: CONTRACT, stack: createStack(["first"]), registry },
      attemptFn,
    );

    expect(result.status).toBe("selected");
    expect(result.attemptCount).toBe(1);
    expect(calls).toEqual([{ stableId: "first", attemptIndex: 0 }]);
    expect(result.selected).toEqual({
      stableId: "first",
      transportBackend: "codex",
      model: "provider-model-1",
    });
  });

  test("retryable failure then success attempts each candidate once with monotonic indexes", async () => {
    const registry = [
      createRegistryEntry({ stableId: "first" }),
      createRegistryEntry({ stableId: "second" }),
    ];
    const { attemptFn, calls } = recordAttempts([
      { status: "failure", classification: "rate_limit" },
      { status: "success" },
    ]);

    const result = await runFallbackTraversal(
      { route: ROUTE, contract: CONTRACT, stack: createStack(["first", "second"]), registry },
      attemptFn,
    );

    expect(result.status).toBe("selected");
    expect(result.attemptCount).toBe(2);
    expect(calls).toEqual([
      { stableId: "first", attemptIndex: 0 },
      { stableId: "second", attemptIndex: 1 },
    ]);
    expect(new Set(calls.map((call) => call.stableId)).size).toBe(2);
    expect(result.steps.filter((step) => step.action === "attempted")).toHaveLength(2);
  });

  test("terminal failure on first candidate stops without later attempts", async () => {
    const registry = [
      createRegistryEntry({ stableId: "first" }),
      createRegistryEntry({ stableId: "second" }),
    ];
    const { attemptFn, calls } = recordAttempts([
      { status: "failure", classification: "policy_denial" },
    ]);

    const result = await runFallbackTraversal(
      { route: ROUTE, contract: CONTRACT, stack: createStack(["first", "second"]), registry },
      attemptFn,
    );

    expect(result.status).toBe("terminal");
    expect(result.attemptCount).toBe(1);
    expect(calls).toEqual([{ stableId: "first", attemptIndex: 0 }]);
    expect(result.terminalDisposition).toEqual(dispositionFor("policy_denial"));
  });

  test("terminal-unclassified failure stops without fallback", async () => {
    const registry = [
      createRegistryEntry({ stableId: "first" }),
      createRegistryEntry({ stableId: "second" }),
    ];
    const { attemptFn, calls } = recordAttempts([
      { status: "failure", classification: "network_blip" },
    ]);

    const result = await runFallbackTraversal(
      { route: ROUTE, contract: CONTRACT, stack: createStack(["first", "second"]), registry },
      attemptFn,
    );

    expect(result.status).toBe("terminal");
    expect(calls).toHaveLength(1);
    expect(result.terminalDisposition?.kind).toBe("terminal-unclassified");
  });

  test("terminal-completed-low-quality stops without fallback", async () => {
    const registry = [
      createRegistryEntry({ stableId: "first" }),
      createRegistryEntry({ stableId: "second" }),
    ];
    const calls: AttemptCall[] = [];
    const attemptFn: AttemptFn = async (candidate, attemptIndex) => {
      calls.push({ stableId: candidate.stableId, attemptIndex });
      return { status: "failure", disposition: completedLowQualityDisposition() };
    };

    const result = await runFallbackTraversal(
      { route: ROUTE, contract: CONTRACT, stack: createStack(["first", "second"]), registry },
      attemptFn,
    );

    expect(result.status).toBe("terminal");
    expect(calls).toHaveLength(1);
    expect(result.terminalDisposition).toEqual(completedLowQualityDisposition());
  });

  test("planned and disabled candidates are skipped without attempts", async () => {
    const registry = [
      createRegistryEntry({ stableId: "planned", maturity: "planned" }),
      createRegistryEntry({ stableId: "disabled", maturity: "disabled" }),
      createRegistryEntry({ stableId: "ready" }),
    ];
    const { attemptFn, calls } = recordAttempts([{ status: "success" }]);

    const result = await runFallbackTraversal(
      {
        route: ROUTE,
        contract: CONTRACT,
        stack: createStack(["planned", "disabled", "ready"]),
        registry,
      },
      attemptFn,
    );

    expect(result.status).toBe("selected");
    expect(calls).toEqual([{ stableId: "ready", attemptIndex: 0 }]);
    expect(result.steps.filter((step) => step.action === "skipped-non-runnable")).toHaveLength(2);
  });

  test("all-retryable stack exhausts after one attempt per candidate", async () => {
    const registry = [
      createRegistryEntry({ stableId: "first" }),
      createRegistryEntry({ stableId: "second" }),
      createRegistryEntry({ stableId: "third" }),
    ];
    const { attemptFn, calls } = recordAttempts([
      { status: "failure", classification: "timeout" },
      { status: "failure", classification: "provider_outage" },
      { status: "failure", classification: "quota_exhausted" },
    ]);

    const result = await runFallbackTraversal(
      {
        route: ROUTE,
        contract: CONTRACT,
        stack: createStack(["first", "second", "third"]),
        registry,
      },
      attemptFn,
    );

    expect(result.status).toBe("stack-exhausted");
    expect(result.attemptCount).toBe(3);
    expect(calls).toHaveLength(3);
    expect(result.terminalDisposition).toEqual(dispositionFor("quota_exhausted"));
  });

  test("maxAttempts 1 with retryable first failure yields budget-exhausted", async () => {
    const registry = [
      createRegistryEntry({ stableId: "first" }),
      createRegistryEntry({ stableId: "second" }),
    ];
    const { attemptFn, calls } = recordAttempts([
      { status: "failure", classification: "rate_limit" },
      { status: "success" },
    ]);

    const result = await runFallbackTraversal(
      {
        route: ROUTE,
        contract: CONTRACT,
        stack: createStack(["first", "second"]),
        registry,
        maxAttempts: 1,
      },
      attemptFn,
    );

    expect(result.status).toBe("budget-exhausted");
    expect(result.attemptCount).toBe(1);
    expect(calls).toHaveLength(1);
  });

  test("cross-boundary fallback succeeds with boundary flags on attempted step", async () => {
    const registry = [
      createRegistryEntry({
        stableId: "first",
        servingProvider: "openai",
        transportBackend: "codex",
        priceBand: "$$$",
      }),
      createRegistryEntry({
        stableId: "second",
        servingProvider: "anthropic",
        transportBackend: "claude",
        priceBand: "$",
        sandboxPermissionSupport: ["read-only", "workspace-write"],
      }),
    ];
    const { attemptFn } = recordAttempts([
      { status: "failure", classification: "missing_binary" },
      { status: "success" },
    ]);

    const result = await runFallbackTraversal(
      { route: ROUTE, contract: CONTRACT, stack: createStack(["first", "second"]), registry },
      attemptFn,
    );

    expect(result.status).toBe("selected");
    const attemptedSteps = result.steps.filter((step) => step.action === "attempted");
    expect(attemptedSteps).toHaveLength(2);
    expect(attemptedSteps[0]?.action === "attempted" && attemptedSteps[0].boundary).toBeNull();
    const secondAttempt = attemptedSteps[1];
    expect(secondAttempt?.action).toBe("attempted");
    if (secondAttempt?.action === "attempted") {
      expect(secondAttempt.boundary).toEqual({
        crossedProvider: true,
        crossedBackend: true,
        crossedPriceBand: true,
      });
    }
  });

  test("stricter sandbox support allows workspace-write contract", async () => {
    const registry = [
      createRegistryEntry({
        stableId: "strict-only",
        sandboxPermissionSupport: ["read-only"],
      }),
    ];
    const { attemptFn, calls } = recordAttempts([{ status: "success" }]);

    const result = await runFallbackTraversal(
      { route: ROUTE, contract: CONTRACT, stack: createStack(["strict-only"]), registry },
      attemptFn,
    );

    expect(result.status).toBe("selected");
    expect(calls).toHaveLength(1);
  });

  test("incompatible sandbox terminates without attempt", async () => {
    const registry = [
      createRegistryEntry({
        stableId: "loose-only",
        sandboxPermissionSupport: ["workspace-write"],
      }),
    ];
    const calls: AttemptCall[] = [];
    const attemptFn: AttemptFn = async (candidate, attemptIndex) => {
      calls.push({ stableId: candidate.stableId, attemptIndex });
      return { status: "success" };
    };

    const readOnlyContract: FixedFallbackContract = {
      mode: "review",
      sandbox: "read-only",
      outputContract: "correctness-review-result.v1",
    };
    const result = await runFallbackTraversal(
      {
        route: "check.read-only.v1",
        contract: readOnlyContract,
        stack: createStack(["loose-only"]),
        registry: [
          createRegistryEntry({
            stableId: "loose-only",
            sandboxPermissionSupport: ["workspace-write"],
            outputContracts: ["correctness-review-result.v1"],
            routeEligibility: ["check.read-only.v1"],
          }),
        ],
      },
      attemptFn,
    );

    expect(result.status).toBe("terminal");
    expect(calls).toHaveLength(0);
    expect(result.terminalDisposition).toEqual(
      expect.objectContaining({ kind: "terminal", classification: "sandbox_incompatible" }),
    );
    expect(result.steps[0]?.action).toBe("terminated-incompatible");
  });

  test("output contract mismatch terminates without attempt", async () => {
    const registry = [
      createRegistryEntry({
        stableId: "wrong-contract",
        outputContracts: ["exploration-result.v1"],
      }),
    ];
    const calls: AttemptCall[] = [];
    const attemptFn: AttemptFn = async (candidate, attemptIndex) => {
      calls.push({ stableId: candidate.stableId, attemptIndex });
      return { status: "success" };
    };

    const result = await runFallbackTraversal(
      { route: ROUTE, contract: CONTRACT, stack: createStack(["wrong-contract"]), registry },
      attemptFn,
    );

    expect(result.status).toBe("terminal");
    expect(calls).toHaveLength(0);
    expect(result.terminalDisposition).toEqual(
      expect.objectContaining({ kind: "terminal", classification: "invalid_configuration" }),
    );
  });

  test("unknown candidate stableId terminates with invalid_configuration", async () => {
    const { attemptFn, calls } = recordAttempts([{ status: "success" }]);

    const result = await runFallbackTraversal(
      {
        route: ROUTE,
        contract: CONTRACT,
        stack: createStack(["missing-id"]),
        registry: [createRegistryEntry({ stableId: "other" })],
      },
      attemptFn,
    );

    expect(result.status).toBe("terminal");
    expect(calls).toHaveLength(0);
    expect(result.terminalDisposition).toEqual({
      kind: "terminal",
      classification: "invalid_configuration",
      detail: "unknown candidate: missing-id",
    });
  });

  test("duplicate stableId in stack terminates before any attempt", async () => {
    const registry = [
      createRegistryEntry({ stableId: "first" }),
      createRegistryEntry({ stableId: "second" }),
    ];
    const { attemptFn, calls } = recordAttempts([
      { status: "failure", classification: "rate_limit" },
      { status: "success" },
    ]);

    const result = await runFallbackTraversal(
      {
        route: ROUTE,
        contract: CONTRACT,
        stack: createStack(["first", "second", "first"]),
        registry,
      },
      attemptFn,
    );

    expect(result.status).toBe("terminal");
    expect(calls).toHaveLength(0);
    expect(result.terminalDisposition).toEqual({
      kind: "terminal",
      classification: "invalid_configuration",
      detail: "duplicate candidate in stack: first",
    });
    expect(result.steps).toEqual([
      {
        action: "terminated-incompatible",
        candidateIndex: 2,
        stableId: "first",
        disposition: {
          kind: "terminal",
          classification: "invalid_configuration",
          detail: "duplicate candidate in stack: first",
        },
        detail: "duplicate candidate in stack: first",
      },
    ]);
  });

  test("empty stack exhausts with no attempts", async () => {
    const { attemptFn, calls } = recordAttempts([]);

    const result = await runFallbackTraversal(
      {
        route: ROUTE,
        contract: CONTRACT,
        stack: createStack([]),
        registry: [createRegistryEntry({ stableId: "unused" })],
      },
      attemptFn,
    );

    expect(result.status).toBe("stack-exhausted");
    expect(result.attemptCount).toBe(0);
    expect(calls).toHaveLength(0);
    expect(result.terminalDisposition).toBeNull();
    expect(result.steps).toHaveLength(0);
  });

  test("all-skipped stack exhausts with recorded skips and no attempts", async () => {
    const registry = [
      createRegistryEntry({ stableId: "planned", maturity: "planned" }),
      createRegistryEntry({ stableId: "disabled", maturity: "disabled" }),
    ];
    const { attemptFn, calls } = recordAttempts([]);

    const result = await runFallbackTraversal(
      {
        route: ROUTE,
        contract: CONTRACT,
        stack: createStack(["planned", "disabled"]),
        registry,
      },
      attemptFn,
    );

    expect(result.status).toBe("stack-exhausted");
    expect(result.attemptCount).toBe(0);
    expect(calls).toHaveLength(0);
    expect(result.steps.map((step) => step.action)).toEqual([
      "skipped-non-runnable",
      "skipped-non-runnable",
    ]);
  });

  test("maxAttempts 0 yields budget-exhausted before any attempt", async () => {
    const { attemptFn, calls } = recordAttempts([{ status: "success" }]);

    const result = await runFallbackTraversal(
      {
        route: ROUTE,
        contract: CONTRACT,
        stack: createStack(["first"]),
        registry: [createRegistryEntry({ stableId: "first" })],
        maxAttempts: 0,
      },
      attemptFn,
    );

    expect(result.status).toBe("budget-exhausted");
    expect(result.attemptCount).toBe(0);
    expect(calls).toHaveLength(0);
  });

  test("boundary is computed against the last attempted candidate, skipping non-runnable ones", async () => {
    const registry = [
      createRegistryEntry({
        stableId: "first",
        servingProvider: "openai",
        transportBackend: "codex",
        priceBand: "$$",
      }),
      createRegistryEntry({
        stableId: "skipped",
        maturity: "planned",
        servingProvider: "elsewhere",
        transportBackend: "claude",
        priceBand: "premium",
      }),
      createRegistryEntry({
        stableId: "third",
        servingProvider: "openai",
        transportBackend: "codex",
        priceBand: "$$",
      }),
    ];
    const { attemptFn, calls } = recordAttempts([
      { status: "failure", classification: "timeout" },
      { status: "success" },
    ]);

    const result = await runFallbackTraversal(
      {
        route: ROUTE,
        contract: CONTRACT,
        stack: createStack(["first", "skipped", "third"]),
        registry,
      },
      attemptFn,
    );

    expect(result.status).toBe("selected");
    expect(calls).toEqual([
      { stableId: "first", attemptIndex: 0 },
      { stableId: "third", attemptIndex: 1 },
    ]);
    const attempted = result.steps.filter((step) => step.action === "attempted");
    expect(attempted).toHaveLength(2);
    expect(attempted[1]).toMatchObject({
      stableId: "third",
      boundary: {
        crossedProvider: false,
        crossedBackend: false,
        crossedPriceBand: false,
      },
    });
  });
});
