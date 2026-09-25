import { describe, expect, test } from "bun:test";
import type { OutputContractId } from "../plugins/arc-orchestrator/lib/capability-routes";
import { dispositionFor } from "../plugins/arc-orchestrator/lib/failure-classification";
import {
  runFallbackTraversal,
  type AttemptFn,
  type FixedFallbackContract,
} from "../plugins/arc-orchestrator/lib/fallback-engine";
import { createLabelRetryBudget } from "../plugins/arc-orchestrator/lib/retry-budget";
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

describe("fallback-engine: runFallbackTraversal", () => {
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
});

describe("fallback-engine: retry budget", () => {
  test("active policy enforces the 60s two-attempt-per-label cap", async () => {
    const registry = [
      createRegistryEntry({ stableId: "first" }),
      createRegistryEntry({ stableId: "second" }),
      createRegistryEntry({ stableId: "third" }),
    ];
    const { attemptFn, calls } = recordAttempts([
      { status: "failure", classification: "rate_limit" },
      { status: "failure", classification: "rate_limit" },
      { status: "success" },
    ]);
    let clock = 2_000_000;
    const budget = createLabelRetryBudget(
      {},
      { mode: "active", windowMs: 60_000, maxAttemptsPerWindow: 2, now: () => clock },
    );

    const result = await runFallbackTraversal(
      {
        route: ROUTE,
        contract: CONTRACT,
        stack: createStack(["first", "second", "third"]),
        registry,
        retryBudget: budget,
        budgetLabel: "same-label",
        downgradeBeforeBoundary: true,
      },
      (candidate, attemptIndex) => {
        clock += 5_000;
        return attemptFn(candidate, attemptIndex);
      },
    );

    // Third attempt of the same label inside the sliding window is blocked.
    expect(result.status).toBe("budget-exhausted");
    expect(result.attemptCount).toBe(2);
    expect(calls).toHaveLength(2);
    const attempted = result.steps.filter((step) => step.action === "attempted");
    expect(attempted).toHaveLength(2);
    expect(
      attempted.map((step) =>
        step.action === "attempted" ? step.retryBudgetRemaining : null,
      ),
    ).toEqual([1, 0]);
  });
});
