import { describe, expect, test } from "bun:test";
import type { OutputContractId } from "../plugins/arc-orchestrator/lib/capability-routes";
import {
  dispositionFor,
} from "../plugins/arc-orchestrator/lib/failure-classification";
import {
  runFallbackTraversal,
  type AttemptFn,
  type FixedFallbackContract,
} from "../plugins/arc-orchestrator/lib/fallback-engine";
import { createLabelRetryBudget } from "../plugins/arc-orchestrator/lib/retry-budget";
import {
  select,
  SELECTION_POLICY_VERSION,
  type AvailabilityView,
  type SelectionDecision,
  type SelectionInputs,
} from "../plugins/arc-orchestrator/lib/capability-selection";
import type {
  CapabilitySnapshot,
  Measurement,
  RungSnapshotEntry,
} from "../plugins/arc-orchestrator/lib/capability-snapshot";
import { CAPABILITY_SNAPSHOT_SCHEMA_VERSION } from "../plugins/arc-orchestrator/lib/capability-snapshot";
import type {
  CandidateStack,
  ModelMaturity,
  ModelRegistryEntry,
  PriceBand,
} from "../plugins/arc-orchestrator/lib/model-registry";
import { MODEL_REGISTRY } from "../plugins/arc-orchestrator/lib/model-registry";
import type { RootBudgetLedger } from "../plugins/arc-orchestrator/lib/delegation-budget";
import type { Backend, TraceSandbox } from "../plugins/arc-orchestrator/lib/trace-schema";
import { selectionDecisionToCandidateStack } from "./selection-stack-adapter";

const ROUTE = "implement.workspace-write.v1" as const;
const CONTRACT: FixedFallbackContract = {
  mode: "implement",
  sandbox: "workspace-write",
  outputContract: "implementation-result.v1",
};

const NOW_MS = Date.parse("2026-07-25T00:00:00Z");

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
    providerModelId = "fixture-model",
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

function measurementOf(score: number): Measurement {
  return {
    axis: "agentic-edit",
    source: "cursorbench.3.2",
    score,
    errorMargin: 0.03,
    sampleSize: 113,
    sourceUrl: "https://example.invalid/cursorbench",
    retrievedAt: "2026-07-20",
    expiresAt: "2026-10-20",
    approver: null,
  };
}

function rungOf(
  stableId: string,
  options: { effort?: string; score?: number; usdPerTask?: number } = {},
): RungSnapshotEntry {
  const effort = options.effort ?? "none";
  return {
    rungId: `${stableId}@${effort}`,
    stableId,
    effort: effort as RungSnapshotEntry["effort"],
    measurements: [measurementOf(options.score ?? 0.5)],
    costPrior: {
      source: "cursorbench.3.2",
      usdPerTask: options.usdPerTask ?? 1,
      outputTokensPerTask: 20000,
      stepsPerTask: 20,
      retrievedAt: "2026-07-20",
    },
    quotaPool: null,
    priceBand: "$$",
  };
}

function snapshotOf(rungs: RungSnapshotEntry[]): CapabilitySnapshot {
  return {
    schemaVersion: CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
    snapshotVersion: "2026-07-25+cursorbench.3.2",
    bandWidth: 0.25,
    rungs,
  };
}

function ledgerWith(remainingCost: number): RootBudgetLedger {
  const vector = {
    token: 1_000_000,
    wallTimeMs: 1_000_000,
    call: 100,
    cost: remainingCost,
    concurrency: 4,
  };
  return {
    rootIdentity: "root-fixture",
    limits: { ...vector },
    consumed: { token: 0, wallTimeMs: 0, call: 0, cost: 0, concurrency: 0 },
    remaining: { ...vector },
    reservations: new Map(),
    createdAtMs: NOW_MS,
    clock: () => NOW_MS,
  };
}

function availabilityOf(): AvailabilityView {
  return { backends: {}, quotaPools: {} };
}

/** Tests-only: map a select() stack to ADR 0008 CandidateStack.candidates order. */
function useSelectionAdapter(
  decision: SelectionDecision,
  template: CandidateStack,
): CandidateStack {
  return selectionDecisionToCandidateStack(decision, template);
}

function recordAttempts(
  outcomes: Array<
    | { status: "success" }
    | { status: "failure"; classification: string; detail?: string | null }
  >,
): { attemptFn: AttemptFn; calls: Array<{ stableId: string; attemptIndex: number }> } {
  const calls: Array<{ stableId: string; attemptIndex: number }> = [];
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

function registryForStableIds(
  specs: Array<FixtureOverrides>,
): ModelRegistryEntry[] {
  return specs.map((spec) => {
    const shipped = MODEL_REGISTRY.find((row) => row.stableId === spec.stableId);
    if (shipped) {
      return createRegistryEntry({ ...shipped, ...spec });
    }
    return createRegistryEntry({
      transportBackend: "composer",
      runnerSupport: ["composer:implement"],
      ...spec,
    });
  });
}

function selectInputsForThreeTier(): {
  inputs: SelectionInputs;
  registry: ModelRegistryEntry[];
} {
  const registry = registryForStableIds([
    { stableId: "grok-4.5", priceBand: "$$$" },
    { stableId: "composer-2.5", priceBand: "$" },
    { stableId: "minimax-m3", priceBand: "$$$" },
  ]);
  const snapshot = snapshotOf([
    rungOf("grok-4.5", { score: 0.9, usdPerTask: 1.51 }),
    rungOf("composer-2.5", { score: 0.56, usdPerTask: 0.44 }),
    rungOf("minimax-m3", { score: 0.3, usdPerTask: 0.2 }),
  ]);
  const inputs: SelectionInputs = {
    request: {
      capabilityRoute: ROUTE,
      axis: "agentic-edit",
      capabilityFloor: 0,
      minimumFloor: 0,
      bandCeiling: null,
      override: null,
      taskIdentity: "adr-0008-parity",
      depth: 1,
    },
    registry,
    snapshot,
    ledger: ledgerWith(100),
    availability: availabilityOf(),
    policyVersion: SELECTION_POLICY_VERSION,
    nowMs: NOW_MS,
  };
  return { inputs, registry };
}

function selectInputsForTwoTier(): {
  inputs: SelectionInputs;
  registry: ModelRegistryEntry[];
} {
  const registry = registryForStableIds([
    { stableId: "grok-4.5" },
    { stableId: "composer-2.5" },
  ]);
  const snapshot = snapshotOf([
    rungOf("grok-4.5", { score: 0.9, usdPerTask: 1.51 }),
    rungOf("composer-2.5", { score: 0.56, usdPerTask: 0.44 }),
  ]);
  const inputs: SelectionInputs = {
    request: {
      capabilityRoute: ROUTE,
      axis: "agentic-edit",
      capabilityFloor: 0,
      minimumFloor: 0,
      bandCeiling: null,
      override: null,
      taskIdentity: "adr-0008-parity-two",
      depth: 1,
    },
    registry,
    snapshot,
    ledger: ledgerWith(100),
    availability: availabilityOf(),
    policyVersion: SELECTION_POLICY_VERSION,
    nowMs: NOW_MS,
  };
  return { inputs, registry };
}

describe("ADR 0008 parity: derived stack matches authored traversal", () => {
  test("shadow retry-budget evidence matches between authored and select()-derived stacks", async () => {
    const { inputs, registry } = selectInputsForTwoTier();
    const decision = select(inputs);
    const authored = createStack(["grok-4.5", "composer-2.5"]);
    const derived = useSelectionAdapter(decision, authored);
    expect(derived.candidates).toEqual(["grok-4.5", "composer-2.5"]);

    const outcomes = [
      { status: "failure" as const, classification: "rate_limit" },
      { status: "success" as const },
    ];
    for (const stack of [authored, derived]) {
      const budget = createLabelRetryBudget({}, { mode: "shadow", maxAttemptsPerWindow: 2 });
      const { attemptFn } = recordAttempts(outcomes);
      const result = await runFallbackTraversal(
        {
          route: ROUTE,
          contract: CONTRACT,
          stack,
          registry,
          retryBudget: budget,
          budgetLabel: "dispatch",
          downgradeBeforeBoundary: false,
        },
        attemptFn,
      );
      expect(result.status).toBe("selected");
      expect(result.attemptCount).toBe(2);
      const attempted = result.steps.filter((step) => step.action === "attempted");
      expect(
        attempted.map((step) =>
          step.action === "attempted" ? step.retryBudgetRemaining : null,
        ),
      ).toEqual([1, 0]);
    }
  });

  test("active sliding-window cap matches between authored and select()-derived stacks", async () => {
    const { inputs, registry } = selectInputsForThreeTier();
    const decision = select(inputs);
    const authored = createStack(["grok-4.5", "composer-2.5", "minimax-m3"]);
    const derived = useSelectionAdapter(decision, authored);
    expect(derived.candidates).toEqual(["grok-4.5", "composer-2.5", "minimax-m3"]);

    const outcomes = [
      { status: "failure" as const, classification: "rate_limit" },
      { status: "failure" as const, classification: "rate_limit" },
      { status: "success" as const },
    ];
    let clock = 2_000_000;

    for (const stack of [authored, derived]) {
      const outcomes = [
        { status: "failure" as const, classification: "rate_limit" },
        { status: "failure" as const, classification: "rate_limit" },
        { status: "success" as const },
      ];
      const budget = createLabelRetryBudget(
        {},
        { mode: "active", windowMs: 60_000, maxAttemptsPerWindow: 2, now: () => clock },
      );
      const { attemptFn, calls } = recordAttempts(outcomes);
      const result = await runFallbackTraversal(
        {
          route: ROUTE,
          contract: CONTRACT,
          stack,
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
      expect(result.status).toBe("budget-exhausted");
      expect(result.attemptCount).toBe(2);
      expect(calls).toHaveLength(2);
    }
  });

  test("active price-band downgrade evidence matches between authored and select()-derived stacks", async () => {
    const { inputs, registry } = selectInputsForThreeTier();
    const decision = select(inputs);
    const authored = createStack(["grok-4.5", "composer-2.5", "minimax-m3"]);
    const derived = useSelectionAdapter(decision, authored);

    const outcomes = [
      { status: "failure" as const, classification: "rate_limit" },
      { status: "failure" as const, classification: "rate_limit" },
      { status: "failure" as const, classification: "rate_limit" },
    ];
    const budget = createLabelRetryBudget({}, { mode: "active", maxAttemptsPerWindow: 10 });

    for (const stack of [authored, derived]) {
      const { attemptFn } = recordAttempts(outcomes);
      const result = await runFallbackTraversal(
        {
          route: ROUTE,
          contract: CONTRACT,
          stack,
          registry,
          retryBudget: budget,
          budgetLabel: "band-label",
          downgradeBeforeBoundary: true,
        },
        attemptFn,
      );
      expect(result.status).toBe("stack-exhausted");
      const attempted = result.steps.filter((step) => step.action === "attempted");
      expect(attempted).toHaveLength(3);
      expect(
        attempted.map((step) =>
          step.action === "attempted" ? step.downgrade_attempted : null,
        ),
      ).toEqual([false, false, true]);
      const third = attempted[2];
      if (third?.action === "attempted") {
        expect(third.boundary?.crossedPriceBand).toBe(true);
      }
    }
  });

  test("dominance pruning may drop same-band fallbacks; derived stack matches the survivors", async () => {
    // Same band (2): composer 0.56 @ $0.44 dominates grok 0.667 @ $1.51.
    // ADR 0008 parity must follow the actual select() stack, not the authored
    // multi-candidate preference that dominance removed.
    const registry = registryForStableIds([
      { stableId: "grok-4.5" },
      { stableId: "composer-2.5" },
    ]);
    const decision = select({
      request: {
        capabilityRoute: ROUTE,
        axis: "agentic-edit",
        capabilityFloor: 0,
        minimumFloor: 0,
        bandCeiling: null,
        override: null,
        taskIdentity: "adr-0008-dominance-prune",
        depth: 1,
      },
      registry,
      snapshot: snapshotOf([
        rungOf("grok-4.5", { score: 0.667, usdPerTask: 1.51 }),
        rungOf("composer-2.5", { score: 0.56, usdPerTask: 0.44 }),
      ]),
      ledger: ledgerWith(100),
      availability: availabilityOf(),
      policyVersion: SELECTION_POLICY_VERSION,
      nowMs: NOW_MS,
    });
    expect(decision.outcome).toBe("selected");
    if (decision.outcome !== "selected") {
      return;
    }
    expect(decision.explanation.pruned).toContainEqual({
      rungId: "grok-4.5@none",
      dominatedBy: "composer-2.5@none",
    });
    const authoredPreference = createStack(["grok-4.5", "composer-2.5"]);
    const derived = useSelectionAdapter(decision, authoredPreference);
    expect(derived.candidates).toEqual(["composer-2.5"]);
    expect(derived.candidates).not.toContain("grok-4.5");

    const outcomes = [{ status: "success" as const }];
    const authored = createStack(derived.candidates);
    for (const stack of [authored, derived]) {
      const { attemptFn, calls } = recordAttempts(outcomes);
      const result = await runFallbackTraversal(
        { route: ROUTE, contract: CONTRACT, stack, registry },
        attemptFn,
      );
      expect(result.status).toBe("selected");
      expect(result.attemptCount).toBe(1);
      expect(calls).toEqual([{ stableId: "composer-2.5", attemptIndex: 0 }]);
    }
  });

  test("registry priceBand on real models can back a select()-derived medium-work order", async () => {
    const registry = MODEL_REGISTRY.filter((entry) =>
      ["grok-4.5", "composer-2.5"].includes(entry.stableId),
    );
    const snapshot = snapshotOf([
      rungOf("grok-4.5", { score: 0.9, usdPerTask: 1.51 }),
      rungOf("composer-2.5", { score: 0.3, usdPerTask: 0.44 }),
    ]);
    const decision = select({
      request: {
        capabilityRoute: ROUTE,
        axis: "agentic-edit",
        capabilityFloor: 0,
        minimumFloor: 0,
        bandCeiling: null,
        override: null,
        taskIdentity: "real-registry-parity",
        depth: 1,
      },
      registry,
      snapshot,
      ledger: ledgerWith(100),
      availability: availabilityOf(),
      policyVersion: SELECTION_POLICY_VERSION,
      nowMs: NOW_MS,
    });
    const template = createStack(["grok-4.5", "composer-2.5"]);
    const derived = selectionDecisionToCandidateStack(decision, template);
    expect(derived.candidates[0]).toBe("grok-4.5");

    const outcomes = [
      { status: "failure" as const, classification: "rate_limit" },
      { status: "success" as const },
    ];
    const authored = createStack(derived.candidates);
    const { attemptFn: fn1, calls: calls1 } = recordAttempts(outcomes);
    const { attemptFn: fn2, calls: calls2 } = recordAttempts(outcomes);
    const [r1, r2] = await Promise.all([
      runFallbackTraversal(
        { route: ROUTE, contract: CONTRACT, stack: authored, registry },
        fn1,
      ),
      runFallbackTraversal(
        { route: ROUTE, contract: CONTRACT, stack: derived, registry },
        fn2,
      ),
    ]);
    expect(r1.status).toBe("selected");
    expect(r2.status).toBe(r1.status);
    expect(r2.attemptCount).toBe(r1.attemptCount);
    expect(calls1).toEqual(calls2);
  });
});
