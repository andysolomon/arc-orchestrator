import { describe, expect, test } from "bun:test";
import type {
  CapabilityBand,
  CapabilitySnapshot,
  Measurement,
  RungSnapshotEntry,
} from "../plugins/arc-orchestrator/lib/capability-snapshot";
import { CAPABILITY_SNAPSHOT_SCHEMA_VERSION } from "../plugins/arc-orchestrator/lib/capability-snapshot";
import {
  deriveLeadPolicy,
  select,
  SELECTION_POLICY_VERSION,
  type AvailabilityView,
  type LeadPolicy,
  type SelectionInputs,
  type SelectionRequest,
} from "../plugins/arc-orchestrator/lib/capability-selection";
import {
  candidateStackForRoute,
  MODEL_REGISTRY,
  type ModelRegistryEntry,
} from "../plugins/arc-orchestrator/lib/model-registry";
import type { RootBudgetLedger } from "../plugins/arc-orchestrator/lib/delegation-budget";
import type { Backend } from "../plugins/arc-orchestrator/lib/trace-schema";

const NOW_MS = Date.parse("2026-07-25T00:00:00Z");

// Four implement-eligible entries used by the compact default fixture. MiniMax
// now contributes its ARC Delegate low/high/max rungs; the other entries retain
// their transport-default `@none` rung.
const SINGLE_RUNG_MODELS = [
  "composer-2.5",
  "cursor-grok-4.6-high",
  "minimax-m3",
  "kimi-k3",
] as const;

function entriesFor(...stableIds: string[]): ModelRegistryEntry[] {
  return stableIds.map((stableId) => {
    const entry = MODEL_REGISTRY.find((row) => row.stableId === stableId);
    if (!entry) {
      throw new Error(`Missing fixture entry: ${stableId}`);
    }
    return entry;
  });
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
  options: {
    effort?: string;
    score?: number | null;
    usdPerTask?: number | null;
    quotaPool?: string | null;
  } = {},
): RungSnapshotEntry {
  const effort =
    options.effort ??
    MODEL_REGISTRY.find((entry) => entry.stableId === stableId)?.fixedEffort ??
    "none";
  return {
    rungId: `${stableId}@${effort}`,
    stableId,
    effort: effort as RungSnapshotEntry["effort"],
    measurements: options.score == null ? [] : [measurementOf(options.score)],
    costPrior:
      options.usdPerTask == null
        ? null
        : {
            source: "cursorbench.3.2",
            usdPerTask: options.usdPerTask,
            outputTokensPerTask: 20000,
            stepsPerTask: 20,
            retrievedAt: "2026-07-20",
          },
    quotaPool: options.quotaPool ?? null,
    priceBand: "$$",
  };
}

function snapshotOf(
  rungs: RungSnapshotEntry[],
  bandWidth = 0.25,
): CapabilitySnapshot {
  return {
    schemaVersion: CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
    snapshotVersion: "2026-07-25+cursorbench.3.2",
    bandWidth,
    rungs,
  };
}

// The ledger carries a clock, and `select()` is required never to call one. A
// throwing clock turns that requirement into a test rather than a comment.
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
    clock: () => {
      throw new Error("select() must not read a clock");
    },
  };
}

function availabilityOf(
  overrides: Partial<AvailabilityView> = {},
): AvailabilityView {
  return { backends: {}, quotaPools: {}, ...overrides };
}

function requestOf(
  overrides: Partial<SelectionRequest> = {},
): SelectionRequest {
  return {
    capabilityRoute: "implement.workspace-write.v1",
    axis: "agentic-edit",
    capabilityFloor: 0,
    minimumFloor: 0,
    bandCeiling: null,
    override: null,
    taskIdentity: "task-fixture",
    depth: 1,
    ...overrides,
  };
}

function leadPolicyOf(incumbentLeadBackend: Backend | null): LeadPolicy {
  return { incumbentLeadBackend, displacementRule: "band-improvement-only" };
}

function inputsOf(overrides: Partial<SelectionInputs> = {}): SelectionInputs {
  return {
    request: requestOf(),
    registry: entriesFor(...SINGLE_RUNG_MODELS),
    snapshot: snapshotOf([
      rungOf("composer-2.5", { score: 0.56, usdPerTask: 0.44 }),
      rungOf("cursor-grok-4.6-high", { score: 0.667, usdPerTask: 1.51 }),
      rungOf("minimax-m3", { score: 0.3, usdPerTask: 0.2 }),
      rungOf("kimi-k3", { score: 0.52, usdPerTask: 0.9 }),
    ]),
    ledger: ledgerWith(100),
    availability: availabilityOf(),
    policyVersion: SELECTION_POLICY_VERSION,
    nowMs: NOW_MS,
    ...overrides,
  };
}

function stackOf(decision: ReturnType<typeof select>): string[] {
  if (decision.outcome !== "selected") {
    throw new Error(`expected a selection, got refusal ${decision.reason}`);
  }
  return decision.stack.map((rung) => rung.rungId);
}

describe("select: purity and determinism", () => {
  test("is deterministic for a fixed input tuple", () => {
    const first = select(inputsOf());
    const second = select(inputsOf());
    expect(first).toEqual(second);
  });

  test("does not depend on registry iteration order", () => {
    const forward = select(inputsOf());
    const reversed = select(
      inputsOf({ registry: entriesFor(...SINGLE_RUNG_MODELS).reverse() }),
    );
    expect(stackOf(reversed)).toEqual(stackOf(forward));
  });

  test("never reads the ledger's clock", () => {
    // ledgerWith installs a throwing clock; reaching a selection at all proves
    // the only thing consulted was `remaining.cost`.
    expect(select(inputsOf()).outcome).toBe("selected");
  });
});

describe("select: eligibility is independent of scores", () => {
  test("a zeroed snapshot still yields only contract-satisfying dispatches", () => {
    const zeroed = snapshotOf(
      SINGLE_RUNG_MODELS.map((stableId) =>
        rungOf(stableId, { score: 0, usdPerTask: 1 }),
      ),
    );
    const decision = select(
      inputsOf({ snapshot: zeroed, registry: [...MODEL_REGISTRY] }),
    );
    expect(decision.outcome).toBe("selected");
    if (decision.outcome !== "selected") {
      return;
    }
    for (const rung of decision.stack) {
      const entry = MODEL_REGISTRY.find(
        (row) => row.stableId === rung.stableId,
      )!;
      expect(entry.routeEligibility).toContain("implement.workspace-write.v1");
      expect(entry.sandboxPermissionSupport).toContain("workspace-write");
      expect(entry.outputContracts).toContain("implementation-result.v1");
      expect(entry.roleRestriction).toBeNull();
    }
  });

  test("a zeroed snapshot rejects role-restricted clones and never selects them", () => {
    const [composer] = entriesFor("composer-2.5");
    const restricted: ModelRegistryEntry = {
      ...composer!,
      stableId: "composer-2.5-restricted-fixture",
      roleRestriction: "explicit-parent-authorization",
    };
    const zeroed = snapshotOf([
      rungOf("composer-2.5-restricted-fixture", { score: 0, usdPerTask: 0.01 }),
    ]);
    const decision = select(
      inputsOf({
        registry: [restricted],
        snapshot: zeroed,
      }),
    );
    expect(decision.outcome).toBe("refused");
    if (decision.outcome === "refused") {
      expect(decision.reason).toBe("no-eligible-rung");
    }
    expect(decision.explanation.rejected).toContainEqual({
      rungId: "composer-2.5-restricted-fixture@none",
      reason: "role-restricted",
    });
    expect(decision.explanation.eligible).toEqual([]);
  });

  test("an excluded rung is rejected as excluded-rung and never selected", () => {
    // Verification independence (ADR 0011 phase 14.3): cursor-grok-4.6-high@high leads the
    // default fixture stack, so excluding it proves the exclusion beats ranking.
    const decision = select(
      inputsOf({ request: requestOf({ excludedRung: "cursor-grok-4.6-high@high" }) }),
    );
    expect(decision.outcome).toBe("selected");
    if (decision.outcome !== "selected") {
      return;
    }
    expect(decision.stack.map((rung) => rung.rungId)).not.toContain(
      "cursor-grok-4.6-high@high",
    );
    expect(decision.explanation.rejected).toContainEqual({
      rungId: "cursor-grok-4.6-high@high",
      reason: "excluded-rung",
    });

    // No exclusion supplied (absent or null) leaves the decision unchanged.
    const baseline = select(inputsOf());
    expect(select(inputsOf({ request: requestOf({ excludedRung: null }) })))
      .toEqual(baseline);

    // The exclusion is a hard constraint: an override may not name the rung.
    const overridden = select(
      inputsOf({
        request: requestOf({
          excludedRung: "cursor-grok-4.6-high@high",
          override: { stableId: "cursor-grok-4.6-high", effort: null },
        }),
      }),
    );
    expect(overridden.outcome).toBe("refused");
    if (overridden.outcome === "refused") {
      expect(overridden.reason).toBe("override-ineligible");
    }
  });

  test("excluding a stable ID removes every effort rung", () => {
    const decision = select(
      inputsOf({
        request: requestOf({ excludedStableId: "opus-5" }),
        registry: entriesFor("opus-5", "composer-2.5"),
        snapshot: snapshotOf([
          rungOf("opus-5", { effort: "low", score: 0.9, usdPerTask: 2 }),
          rungOf("opus-5", { effort: "high", score: 0.95, usdPerTask: 4 }),
          rungOf("composer-2.5", { score: 0.4, usdPerTask: 0.4 }),
        ]),
      }),
    );
    expect(decision.outcome).toBe("selected");
    if (decision.outcome !== "selected") return;
    expect(decision.stack.map((rung) => rung.stableId)).toEqual([
      "composer-2.5",
    ]);
    const rejectedOpusRungs = decision.explanation.rejected.filter((entry) =>
      entry.rungId.startsWith("opus-5@"),
    );
    expect(rejectedOpusRungs.length).toBeGreaterThan(1);
    expect(rejectedOpusRungs.every((entry) => entry.reason === "excluded-rung"))
      .toBe(true);
  });

  test("rejects rungs the route, sandbox, or transport cannot carry", () => {
    const decision = select(
      inputsOf({ registry: [...MODEL_REGISTRY], snapshot: snapshotOf([]) }),
    );
    const reasons = new Set(
      decision.explanation.rejected.map((entry) => entry.reason),
    );
    expect(reasons.has("route-ineligible")).toBe(true);
    expect(reasons.has("maturity-not-runnable")).toBe(true);

    // `sonnet-5` is route-ineligible, so every one of its rungs is rejected for
    // this implement route and none can appear in the stack.
    const sonnet = decision.explanation.rejected.filter((entry) =>
      entry.rungId.startsWith("sonnet-5@"),
    );
    expect(sonnet.length).toBeGreaterThan(0);
    expect(sonnet.every((entry) => entry.reason === "route-ineligible")).toBe(
      true,
    );
    expect(decision.explanation.eligible).not.toContain("sonnet-5@high");
  });

  test("direct Kimi exposes only its ARC Delegate medium/high/max efforts", () => {
    // `kimi-k3-anthropic` is pinned to `max`. The shipped entry is not eligible
    // for any route, so it is cloned onto the implement route purely to observe
    // rung generation. The point is what is *absent*: no `@low` rung is rejected,
    // because none is ever produced. `effort-unsupported` is enforced at snapshot
    // validation, where an effort can be typed by hand, not here where the
    // candidate set is derived from `supportedEffortsFor`.
    const [pinned] = entriesFor("kimi-k3-anthropic");
    const eligibleClone: ModelRegistryEntry = {
      ...pinned!,
      routeEligibility: ["implement.workspace-write.v1"],
      sandboxPermissionSupport: ["workspace-write"],
      outputContracts: ["implementation-result.v1"],
    };
    const decision = select(
      inputsOf({
        registry: [eligibleClone],
        snapshot: snapshotOf([
          rungOf("kimi-k3-anthropic", {
            effort: "max",
            score: 0.6,
            usdPerTask: 1,
          }),
        ]),
      }),
    );
    expect(stackOf(decision)).toEqual([
      "kimi-k3-anthropic@max",
      "kimi-k3-anthropic@high",
      "kimi-k3-anthropic@medium",
    ]);
    const touched = [
      ...decision.explanation.eligible,
      ...decision.explanation.rejected.map((entry) => entry.rungId),
    ];
    expect(touched).toEqual([
      "kimi-k3-anthropic@max",
      "kimi-k3-anthropic@high",
      "kimi-k3-anthropic@medium",
    ]);
  });

  test("an unavailable backend rejects; a degraded one does not", () => {
    const unavailable = select(
      inputsOf({
        availability: availabilityOf({
          backends: {
            composer: {
              state: "unavailable",
              classification: null,
              observedAtMs: NOW_MS,
            },
          },
        }),
      }),
    );
    expect(stackOf(unavailable)).not.toContain("cursor-grok-4.6-high@high");
    expect(
      unavailable.explanation.rejected.some(
        (entry) =>
          entry.rungId === "cursor-grok-4.6-high@high" &&
          entry.reason === "backend-unavailable",
      ),
    ).toBe(true);

    const degraded = select(
      inputsOf({
        registry: entriesFor("cursor-grok-4.6-high"),
        snapshot: snapshotOf([
          rungOf("cursor-grok-4.6-high", { score: 0.667, usdPerTask: 1.51 }),
        ]),
        availability: availabilityOf({
          backends: {
            composer: {
              state: "degraded",
              classification: null,
              observedAtMs: NOW_MS,
            },
          },
        }),
      }),
    );
    expect(stackOf(degraded)).toContain("cursor-grok-4.6-high@high");
  });

  test("quota rejects only on an observed zero, never on an unobservable one", () => {
    // Different bands, so neither dominates the other and both reach ordering.
    const pooled = snapshotOf([
      rungOf("cursor-grok-4.6-high", {
        score: 0.667,
        usdPerTask: 1.51,
        quotaPool: "cursor",
      }),
      rungOf("kimi-k3", { score: 0.3, usdPerTask: 0.9, quotaPool: "moonshot" }),
    ]);
    const pooledRegistry = entriesFor("cursor-grok-4.6-high", "kimi-k3");

    const exhausted = select(
      inputsOf({
        snapshot: pooled,
        registry: pooledRegistry,
        availability: availabilityOf({
          quotaPools: {
            cursor: { pool: "cursor", remainingFraction: 0, resetsAtMs: null },
            moonshot: {
              pool: "moonshot",
              remainingFraction: null,
              resetsAtMs: null,
            },
          },
        }),
      }),
    );
    expect(stackOf(exhausted)).not.toContain("cursor-grok-4.6-high@high");
    expect(stackOf(exhausted)).toContain("kimi-k3@none");

    // An unobservable remainder degrades to "no preference", not to "refuse".
    const unobservable = select(
      inputsOf({
        snapshot: pooled,
        registry: pooledRegistry,
        availability: availabilityOf({
          quotaPools: {
            cursor: {
              pool: "cursor",
              remainingFraction: null,
              resetsAtMs: null,
            },
          },
        }),
      }),
    );
    expect(stackOf(unobservable)).toContain("cursor-grok-4.6-high@high");
  });
});

describe("select: banding, pruning, and ordering", () => {
  test("returns the Pareto frontier, ordered by band descending", () => {
    // At bandWidth 0.25: grok 0.667 -> band 2, composer 0.56 -> 2, kimi 0.52 -> 2,
    // minimax 0.3 -> 1.
    //
    // Worth stating plainly, because it surprised the first draft of this test:
    // dominance pruning makes within-band cost ordering almost unobservable in
    // the stack. Within a band the cheapest rung dominates every costlier one, so
    // at most one priced rung per band survives, and the cost comparison shows up
    // in `pruned` rather than in the ordering. The stack is a frontier, not a
    // ranking of everything eligible.
    const decision = select(inputsOf());
    expect(stackOf(decision)).toEqual([
      "composer-2.5@none", // band 2, $0.44 — cheapest in its band
      "minimax-m3@high",
      "minimax-m3@low",
      "minimax-m3@max", // band 1, $0.20 — cheaper still, so not dominated
    ]);
    expect(decision.explanation.pruned).toEqual([
      { rungId: "cursor-grok-4.6-high@high", dominatedBy: "composer-2.5@none" },
      { rungId: "kimi-k3@none", dominatedBy: "composer-2.5@none" },
    ]);
  });

  test("a higher band survives a lower one only when it is not also cheaper", () => {
    // The frontier keeps a costlier rung when it buys a band, and drops it when
    // a cheaper rung already reaches that band.
    const decision = select(
      inputsOf({
        registry: entriesFor("composer-2.5", "cursor-grok-4.6-high"),
        snapshot: snapshotOf([
          rungOf("composer-2.5", { score: 0.3, usdPerTask: 0.44 }), // band 1
          rungOf("cursor-grok-4.6-high", { score: 0.8, usdPerTask: 1.51 }), // band 3
        ]),
      }),
    );
    expect(stackOf(decision)).toEqual(["cursor-grok-4.6-high@high", "composer-2.5@none"]);
    expect(decision.explanation.pruned).toEqual([]);
  });

  test("prunes a rung dominated on both band and cost", () => {
    const decision = select(
      inputsOf({
        snapshot: snapshotOf([
          rungOf("composer-2.5", { score: 0.667, usdPerTask: 0.44 }),
          // Same band, strictly more expensive, so composer dominates it.
          rungOf("cursor-grok-4.6-high", { score: 0.667, usdPerTask: 1.51 }),
        ]),
        registry: entriesFor("composer-2.5", "cursor-grok-4.6-high"),
      }),
    );
    expect(stackOf(decision)).toEqual(["composer-2.5@none"]);
    expect(decision.explanation.pruned).toEqual([
      { rungId: "cursor-grok-4.6-high@high", dominatedBy: "composer-2.5@none" },
    ]);
  });

  test("an unpriced rung is neither pruned nor used to prune", () => {
    // Dominance needs `usdPerTask(A) <= usdPerTask(B)`, which is unprovable when
    // either side is unknown. Assuming a value there is the estimate decision
    // 0005 forbids, so both rungs survive.
    const decision = select(
      inputsOf({
        snapshot: snapshotOf([
          rungOf("composer-2.5", { score: 0.667, usdPerTask: 0.44 }),
          rungOf("cursor-grok-4.6-high", { score: 0.667, usdPerTask: null }),
        ]),
        registry: entriesFor("composer-2.5", "cursor-grok-4.6-high"),
      }),
    );
    expect(stackOf(decision)).toEqual(["composer-2.5@none", "cursor-grok-4.6-high@high"]);
    expect(decision.explanation.pruned).toEqual([]);
  });

  test("a scarcer quota pool sorts last among otherwise equal rungs", () => {
    const decision = select(
      inputsOf({
        snapshot: snapshotOf([
          rungOf("composer-2.5", {
            score: 0.6,
            usdPerTask: 1,
            quotaPool: "cursor",
          }),
          rungOf("kimi-k3", {
            score: 0.6,
            usdPerTask: 1,
            quotaPool: "moonshot",
          }),
        ]),
        registry: entriesFor("composer-2.5", "kimi-k3"),
        availability: availabilityOf({
          quotaPools: {
            cursor: {
              pool: "cursor",
              remainingFraction: 0.1,
              resetsAtMs: null,
            },
            moonshot: {
              pool: "moonshot",
              remainingFraction: 0.9,
              resetsAtMs: null,
            },
          },
        }),
      }),
    );
    expect(stackOf(decision)).toEqual(["kimi-k3@none", "composer-2.5@none"]);
  });

  test("rungId breaks a total tie so the order is fully determined", () => {
    const decision = select(
      inputsOf({
        snapshot: snapshotOf([
          rungOf("composer-2.5", { score: 0.6, usdPerTask: 1 }),
          rungOf("kimi-k3", { score: 0.6, usdPerTask: 1 }),
        ]),
        registry: entriesFor("kimi-k3", "composer-2.5"),
      }),
    );
    expect(stackOf(decision)).toEqual(["composer-2.5@none", "kimi-k3@none"]);
  });

  test("a band ceiling drops rungs above it", () => {
    const decision = select(
      inputsOf({ request: requestOf({ bandCeiling: 1 as CapabilityBand }) }),
    );
    expect(stackOf(decision)).toEqual([
      "minimax-m3@high",
      "minimax-m3@low",
      "minimax-m3@max",
    ]);
    expect(
      decision.explanation.rejected.filter(
        (entry) => entry.reason === "above-band-ceiling",
      ).length,
    ).toBe(3);
  });
});

describe("select: unranked rungs", () => {
  test("a rung with no measurement on the axis is kept but sorts last", () => {
    const decision = select(
      inputsOf({
        snapshot: snapshotOf([
          rungOf("composer-2.5", { score: 0.3, usdPerTask: 5 }),
          rungOf("cursor-grok-4.6-high", { score: null, usdPerTask: 0.1 }),
        ]),
        registry: entriesFor("composer-2.5", "cursor-grok-4.6-high"),
      }),
    );
    // grok is cheaper by fifty times and still sorts last: an unknown capability
    // is not a cheap capability.
    expect(stackOf(decision)).toEqual(["composer-2.5@none", "cursor-grok-4.6-high@high"]);
    expect(decision.explanation.unranked).toEqual(["cursor-grok-4.6-high@high"]);
  });

  test("an unranked rung cannot satisfy a floor above zero", () => {
    const decision = select(
      inputsOf({
        snapshot: snapshotOf([
          rungOf("cursor-grok-4.6-high", { score: null, usdPerTask: 1 }),
        ]),
        registry: entriesFor("cursor-grok-4.6-high"),
        request: requestOf({
          capabilityFloor: 2 as CapabilityBand,
          minimumFloor: 2 as CapabilityBand,
        }),
      }),
    );
    expect(decision.outcome).toBe("refused");
    if (decision.outcome === "refused") {
      expect(decision.reason).toBe("no-eligible-rung");
    }
  });

  test("a rung measured only on another axis is unranked, not substituted", () => {
    const crossAxis = snapshotOf([
      {
        ...rungOf("cursor-grok-4.6-high", { usdPerTask: 1 }),
        measurements: [
          { ...measurementOf(0.9), axis: "swe", source: "deepswe.v1.1" },
        ],
      },
    ]);
    const decision = select(
      inputsOf({ snapshot: crossAxis, registry: entriesFor("cursor-grok-4.6-high") }),
    );
    expect(decision.explanation.unranked).toEqual(["cursor-grok-4.6-high@high"]);
    expect(stackOf(decision)[0]).toBe("cursor-grok-4.6-high@high");
    if (decision.outcome === "selected") {
      expect(decision.stack[0]?.band).toBeNull();
    }
  });
});

describe("select: floor degradation", () => {
  test("degrades toward minimumFloor and records that it did", () => {
    const decision = select(
      inputsOf({
        request: requestOf({
          capabilityFloor: 3 as CapabilityBand,
          minimumFloor: 1 as CapabilityBand,
        }),
      }),
    );
    expect(decision.outcome).toBe("selected");
    expect(decision.explanation.requestedFloor).toBe(3);
    expect(decision.explanation.effectiveFloor).toBe(2);
    expect(decision.explanation.floorLowered).toBe(true);
  });

  test("the explanation describes the floor actually used, not the one abandoned", () => {
    // Recording rejections while walking the floor down would leave the trace
    // asserting `below-capability-floor` against rungs that are in the returned
    // stack. Every eligible rung must be absent from the rejection list.
    const decision = select(
      inputsOf({
        request: requestOf({
          capabilityFloor: 3 as CapabilityBand,
          minimumFloor: 0 as CapabilityBand,
        }),
      }),
    );
    const belowFloor = new Set(
      decision.explanation.rejected
        .filter((entry) => entry.reason === "below-capability-floor")
        .map((entry) => entry.rungId),
    );
    for (const rungId of decision.explanation.eligible) {
      expect(belowFloor.has(rungId)).toBe(false);
    }
  });

  test("refuses rather than silently lowering when the floor is fixed", () => {
    const decision = select(
      inputsOf({
        request: requestOf({
          capabilityFloor: 4 as CapabilityBand,
          minimumFloor: 4 as CapabilityBand,
        }),
      }),
    );
    expect(decision.outcome).toBe("refused");
    expect(decision.explanation.floorLowered).toBe(false);
    expect(decision.explanation.effectiveFloor).toBe(4);
  });
});

describe("select: budget", () => {
  test("drops rungs it cannot afford and records them", () => {
    // grok holds a higher band than composer and costs more, so it survives
    // pruning and reaches the budget filter, where $1.51 exceeds the $1.00 left.
    const decision = select(
      inputsOf({
        ledger: ledgerWith(1),
        registry: entriesFor("composer-2.5", "cursor-grok-4.6-high"),
        snapshot: snapshotOf([
          rungOf("composer-2.5", { score: 0.56, usdPerTask: 0.44 }),
          rungOf("cursor-grok-4.6-high", { score: 0.8, usdPerTask: 1.51 }),
        ]),
      }),
    );
    expect(stackOf(decision)).toEqual(["composer-2.5@none"]);
    expect(decision.explanation.budgetConstrained).toContain("cursor-grok-4.6-high@high");
  });

  test("an unpriced rung is never dropped for cost", () => {
    // cost-unknown may not disable an otherwise-eligible entry — decision 0001's
    // fail-safe, restated for capability data by decision 0005.
    const decision = select(
      inputsOf({
        ledger: ledgerWith(0.5),
        snapshot: snapshotOf([
          rungOf("cursor-grok-4.6-high", { score: 0.667, usdPerTask: null }),
        ]),
        registry: entriesFor("cursor-grok-4.6-high"),
      }),
    );
    expect(stackOf(decision)).toEqual(["cursor-grok-4.6-high@high"]);
    expect(decision.explanation.budgetConstrained).toEqual([]);
  });

  test("an exhausted ledger refuses with budget-exhausted", () => {
    const decision = select(inputsOf({ ledger: ledgerWith(0) }));
    expect(decision.outcome).toBe("refused");
    if (decision.outcome === "refused") {
      expect(decision.reason).toBe("budget-exhausted");
    }
  });

  test("an affordable-but-unreachable floor refuses with floor-unreachable-in-budget", () => {
    const decision = select(
      inputsOf({
        ledger: ledgerWith(0.3),
        request: requestOf({
          capabilityFloor: 2 as CapabilityBand,
          minimumFloor: 2 as CapabilityBand,
        }),
      }),
    );
    expect(decision.outcome).toBe("refused");
    if (decision.outcome === "refused") {
      expect(decision.reason).toBe("floor-unreachable-in-budget");
    }
    expect(decision.explanation.budgetConstrained.length).toBeGreaterThan(0);
  });
});

describe("select: overrides", () => {
  test("an eligible override bypasses ordering and banding", () => {
    const decision = select(
      inputsOf({
        request: requestOf({
          override: { stableId: "minimax-m3", effort: null },
          capabilityFloor: 2 as CapabilityBand,
          minimumFloor: 2 as CapabilityBand,
        }),
      }),
    );
    // minimax sits in band 1, below the requested floor, and still wins.
    expect(stackOf(decision)).toEqual([
      "minimax-m3@high",
      "minimax-m3@low",
      "minimax-m3@max",
    ]);
    expect(decision.explanation.overrideApplied).toBe(true);
  });

  test("an override may not bypass the capability contract", () => {
    const decision = select(
      inputsOf({
        registry: [...MODEL_REGISTRY],
        request: requestOf({
          override: { stableId: "sonnet-5", effort: "high" },
        }),
      }),
    );
    expect(decision.outcome).toBe("refused");
    if (decision.outcome === "refused") {
      expect(decision.reason).toBe("override-ineligible");
    }
    expect(decision.explanation.overrideApplied).toBe(true);
  });

  test("an eligible override bypasses budget and band ordering for a costly low-band rung", () => {
    const decision = select(
      inputsOf({
        ledger: ledgerWith(0.05),
        registry: entriesFor("composer-2.5", "minimax-m3"),
        snapshot: snapshotOf([
          rungOf("composer-2.5", { score: 0.8, usdPerTask: 0.44 }),
          rungOf("minimax-m3", { score: 0.3, usdPerTask: 5 }),
        ]),
        request: requestOf({
          override: { stableId: "minimax-m3", effort: null },
          capabilityFloor: 2 as CapabilityBand,
          minimumFloor: 2 as CapabilityBand,
        }),
      }),
    );
    expect(stackOf(decision)).toEqual([
      "minimax-m3@high",
      "minimax-m3@low",
      "minimax-m3@max",
    ]);
    expect(decision.explanation.overrideApplied).toBe(true);
    expect(decision.explanation.budgetConstrained).toEqual([]);
  });

  test("an override refuses a role-restricted entry with override-ineligible", () => {
    const [composer] = entriesFor("composer-2.5");
    const restricted: ModelRegistryEntry = {
      ...composer!,
      stableId: "composer-2.5-restricted-override",
      roleRestriction: "explicit-parent-authorization",
    };
    const decision = select(
      inputsOf({
        registry: [restricted, composer!],
        snapshot: snapshotOf([
          rungOf("composer-2.5-restricted-override", { score: 0.6, usdPerTask: 1 }),
          rungOf("composer-2.5", { score: 0.5, usdPerTask: 1 }),
        ]),
        request: requestOf({
          override: { stableId: "composer-2.5-restricted-override", effort: null },
        }),
      }),
    );
    expect(decision.outcome).toBe("refused");
    if (decision.outcome === "refused") {
      expect(decision.reason).toBe("override-ineligible");
    }
    expect(decision.explanation.overrideApplied).toBe(true);
    expect(decision.explanation.rejected).toContainEqual({
      rungId: "composer-2.5-restricted-override@none",
      reason: "role-restricted",
    });
  });

  test("an override naming no effort takes every eligible rung of that model", () => {
    const decision = select(
      inputsOf({
        registry: entriesFor("opus-5"),
        snapshot: snapshotOf([
          rungOf("opus-5", { effort: "high", score: 0.667, usdPerTask: 3.91 }),
          rungOf("opus-5", { effort: "low", score: 0.628, usdPerTask: 2.55 }),
        ]),
        request: requestOf({ override: { stableId: "opus-5", effort: null } }),
      }),
    );
    const stack = stackOf(decision);
    // Both rungs land in band 2, so the cheaper one leads — the override skips
    // banding and pruning, but not the ordering comparator, which is why `@low`
    // at $2.55 comes out ahead of `@high` at $3.91.
    expect(stack[0]).toBe("opus-5@low");
    expect(stack[1]).toBe("opus-5@high");
    // The model's unmeasured rungs come along too, ranked last.
    expect(decision.explanation.unranked.length).toBeGreaterThan(0);
    expect(stack.slice(2).every((rungId) => rungId.startsWith("opus-5@"))).toBe(
      true,
    );
  });
});

describe("select: refusal outcomes", () => {
  test("refuses with no-eligible-rung when every registry entry fails step 1", () => {
    const decision = select(
      inputsOf({
        registry: entriesFor("sonnet-5"),
        snapshot: snapshotOf([
          rungOf("sonnet-5", { effort: "high", score: 0.9, usdPerTask: 1 }),
        ]),
      }),
    );
    expect(decision.outcome).toBe("refused");
    if (decision.outcome === "refused") {
      expect(decision.reason).toBe("no-eligible-rung");
    }
    expect(decision.explanation.eligible).toEqual([]);
    expect(
      decision.explanation.rejected.every((entry) => entry.reason === "route-ineligible"),
    ).toBe(true);
  });

  test("records quota-pool-exhausted on every candidate when all pools are empty", () => {
    const decision = select(
      inputsOf({
        registry: entriesFor("cursor-grok-4.6-high", "composer-2.5"),
        snapshot: snapshotOf([
          rungOf("cursor-grok-4.6-high", { score: 0.6, usdPerTask: 1, quotaPool: "cursor" }),
          rungOf("composer-2.5", { score: 0.5, usdPerTask: 1, quotaPool: "cursor" }),
        ]),
        availability: availabilityOf({
          quotaPools: {
            cursor: { pool: "cursor", remainingFraction: 0, resetsAtMs: null },
          },
        }),
      }),
    );
    expect(decision.outcome).toBe("refused");
    if (decision.outcome === "refused") {
      expect(decision.reason).toBe("no-eligible-rung");
    }
    const exhausted = decision.explanation.rejected.filter(
      (entry) => entry.reason === "quota-pool-exhausted",
    );
    expect(exhausted.map((entry) => entry.rungId).sort()).toEqual([
      "composer-2.5@none",
      "cursor-grok-4.6-high@high",
    ]);
  });
});

describe("select: taste-review structural invariant", () => {
  // Include cheaper non-taste models so ranking cannot "accidentally" look
  // correct merely because the registry fixture was already filtered to opus-5.
  const tasteRegistry = entriesFor("opus-5", "composer-2.5", "cursor-grok-4.6-high");

  function tasteInputs(snapshot: CapabilitySnapshot) {
    return inputsOf({
      registry: tasteRegistry,
      snapshot,
      request: requestOf({
        capabilityRoute: "taste-review.read-only.v1",
        capabilityFloor: 0,
        minimumFloor: 0,
      }),
    });
  }

  test("selects exactly opus-5 on a zeroed snapshot", () => {
    const zeroed = snapshotOf([
      rungOf("opus-5", { effort: "high", score: 0, usdPerTask: 1 }),
      rungOf("composer-2.5", { score: 0, usdPerTask: 0.01 }),
      rungOf("cursor-grok-4.6-high", { score: 0, usdPerTask: 0.01 }),
    ]);
    const decision = select(tasteInputs(zeroed));
    expect(decision.outcome).toBe("selected");
    if (decision.outcome !== "selected") {
      return;
    }
    expect(new Set(decision.stack.map((rung) => rung.stableId))).toEqual(
      new Set(["opus-5"]),
    );
    expect(
      decision.explanation.rejected.some(
        (entry) =>
          entry.rungId.startsWith("composer-2.5@") &&
          entry.reason === "route-ineligible",
      ),
    ).toBe(true);
  });

  test("selects exactly opus-5 even when cheaper models score higher on agentic-edit", () => {
    const decision = select(
      tasteInputs(
        snapshotOf([
          rungOf("opus-5", { effort: "high", score: 0.5, usdPerTask: 10 }),
          rungOf("composer-2.5", { score: 0.95, usdPerTask: 0.01 }),
          rungOf("cursor-grok-4.6-high", { score: 0.9, usdPerTask: 0.5 }),
        ]),
      ),
    );
    expect(decision.outcome).toBe("selected");
    if (decision.outcome !== "selected") {
      return;
    }
    expect(new Set(decision.stack.map((rung) => rung.stableId))).toEqual(
      new Set(["opus-5"]),
    );
    expect(decision.stack.some((rung) => rung.stableId === "composer-2.5")).toBe(
      false,
    );
    expect(decision.stack.some((rung) => rung.stableId === "cursor-grok-4.6-high")).toBe(
      false,
    );
  });
});

describe("select: snapshot-deletion rollback at select()", () => {
  test("selects with an empty snapshot when the floor mapping rolled back to zero", () => {
    const decision = select(
      inputsOf({
        registry: MODEL_REGISTRY.filter((entry) =>
          ["composer-2.5", "cursor-grok-4.6-high"].includes(entry.stableId),
        ),
        snapshot: snapshotOf([]),
        request: requestOf({
          capabilityFloor: 0,
          minimumFloor: 0,
          bandCeiling: null,
        }),
      }),
    );
    expect(decision.outcome).toBe("selected");
    expect(stackOf(decision).length).toBeGreaterThan(0);
  });
});

describe("select: snapshot freshness", () => {
  test("refuses with snapshot-expired rather than serving the fresh half", () => {
    const half = snapshotOf([
      rungOf("composer-2.5", { score: 0.56, usdPerTask: 0.44 }),
      {
        ...rungOf("cursor-grok-4.6-high", { score: 0.667, usdPerTask: 1.51 }),
        measurements: [{ ...measurementOf(0.667), expiresAt: "2026-07-01" }],
      },
    ]);
    const decision = select(inputsOf({ snapshot: half }));
    expect(decision.outcome).toBe("refused");
    if (decision.outcome === "refused") {
      expect(decision.reason).toBe("snapshot-expired");
    }
  });

  test("the same snapshot selects before its expiry", () => {
    const decision = select(
      inputsOf({ nowMs: Date.parse("2026-10-19T00:00:00Z") }),
    );
    expect(decision.outcome).toBe("selected");
  });
});

describe("select: step 7 lead-backend coherence", () => {
  test("without a leadPolicy the stage does not run and claims nothing", () => {
    const decision = select(inputsOf());
    expect(decision.explanation.leadBackend).toBe("composer");
    // Absent, not false. `false` would attest to a stack-level check that never
    // ran, and an unmigrated caller is exactly who must not be told it passed.
    expect("leadRepair" in decision.explanation).toBe(false);
    expect("leadDisplaced" in decision.explanation).toBe(false);
    expect("leadDisplacedByAvailability" in decision.explanation).toBe(false);
  });

  test("a coherent lead records that the check ran and found nothing", () => {
    const decision = select(
      inputsOf({
        request: requestOf({ leadPolicy: leadPolicyOf("composer") }),
      }),
    );
    expect(decision.explanation.leadBackend).toBe("composer");
    expect(decision.explanation.leadRepair).toBeNull();
    expect(decision.explanation.leadDisplaced).toBe(false);
    expect(decision.explanation.leadDisplacedByAvailability).toBe(false);
  });

  test("a route with no incumbent constrains nothing", () => {
    const decision = select(
      inputsOf({ request: requestOf({ leadPolicy: leadPolicyOf(null) }) }),
    );
    expect(stackOf(decision)[0]).toBe("composer-2.5@none");
    expect(decision.explanation.leadRepair).toBeNull();
    expect(decision.explanation.leadDisplaced).toBe(false);
  });

  test("cursor-grok-4.6-high does not take the medium-medium lead from gpt-5.5 on 8.3 points", () => {
    // #237's live case, with its published CursorBench 3.2 @high figures: grok
    // 66.7% at $1.51 against gpt-5.5 58.4% at $2.05. At bandWidth 0.25 both land
    // in band 2, so the 8.3-point margin buys no band, and grok is cheaper — which
    // means gpt-5.5 is not merely out-ranked but *dominance-pruned*. Reinstating
    // it is the whole reason step 7 sees the pruned set: leading would make the
    // class Cursor-led and every Codex-model preference in it would hard-fail with
    // provider-switch-not-authorized-without-rate-limit. "A usage regression, not
    // a test to update."
    const decision = select(
      inputsOf({
        registry: entriesFor("gpt-5.5", "cursor-grok-4.6-high"),
        snapshot: snapshotOf([
          rungOf("cursor-grok-4.6-high", { score: 0.667, usdPerTask: 1.51 }),
          rungOf("gpt-5.5", { effort: "high", score: 0.584, usdPerTask: 2.05 }),
        ]),
        request: requestOf({ leadPolicy: leadPolicyOf("codex") }),
      }),
    );
    const stack = stackOf(decision);
    expect(stack[0]).toBe("gpt-5.5@high");
    expect(decision.explanation.leadBackend).toBe("codex");
    expect(decision.explanation.leadRepair).toEqual({
      from: "cursor-grok-4.6-high@high",
      to: "gpt-5.5@high",
      reason: "lead-backend-coherence",
    });
    expect(decision.explanation.leadDisplaced).toBe(false);
    expect(decision.explanation.leadDisplacedByAvailability).toBe(false);
    // Repaired, not refused: grok is still in the stack, just not leading it.
    expect(stack).toContain("cursor-grok-4.6-high@high");
    // The pruning record survives the reinstatement. Both statements are true —
    // dominance did find gpt-5.5, and step 7 brought it back — and `leadRepair`
    // is what lets a reader put them together.
    expect(decision.explanation.pruned).toEqual([
      { rungId: "gpt-5.5@high", dominatedBy: "cursor-grok-4.6-high@high" },
    ]);
  });

  test("cursor-grok-4.6-high does not take a lead from opus-5 where the two tie", () => {
    // medium-light. CursorBench @high scores both at 66.7%; grok costs $1.51
    // against $3.91. Same band, so cost alone may not move the lead.
    const decision = select(
      inputsOf({
        registry: entriesFor("opus-5", "cursor-grok-4.6-high"),
        snapshot: snapshotOf([
          rungOf("cursor-grok-4.6-high", { score: 0.667, usdPerTask: 1.51 }),
          rungOf("opus-5", { effort: "high", score: 0.667, usdPerTask: 3.91 }),
        ]),
        request: requestOf({ leadPolicy: leadPolicyOf("claude") }),
      }),
    );
    expect(stackOf(decision)[0]).toBe("opus-5@high");
    expect(decision.explanation.leadRepair?.to).toBe("opus-5@high");
    expect(decision.explanation.leadDisplaced).toBe(false);
  });

  test("a strictly higher band displaces the incumbent lead", () => {
    const decision = select(
      inputsOf({
        registry: entriesFor("gpt-5.5", "cursor-grok-4.6-high"),
        snapshot: snapshotOf([
          rungOf("cursor-grok-4.6-high", { score: 0.9, usdPerTask: 1.51 }), // band 3
          rungOf("gpt-5.5", { effort: "high", score: 0.584, usdPerTask: 2.05 }), // band 2
        ]),
        request: requestOf({ leadPolicy: leadPolicyOf("codex") }),
      }),
    );
    expect(stackOf(decision)[0]).toBe("cursor-grok-4.6-high@high");
    expect(decision.explanation.leadBackend).toBe("composer");
    expect(decision.explanation.leadDisplaced).toBe(true);
    expect(decision.explanation.leadRepair).toBeNull();
    expect(decision.explanation.leadDisplacedByAvailability).toBe(false);
  });

  test("an unranked lead never displaces the incumbent", () => {
    // Nothing is measured here, so no band improvement can be shown. Unknown
    // capability must not take a lead that a known one holds.
    const decision = select(
      inputsOf({
        registry: entriesFor("cursor-grok-4.6-high", "kimi-k3"),
        snapshot: snapshotOf([]),
        request: requestOf({ leadPolicy: leadPolicyOf("opencode") }),
      }),
    );
    // The whole stack, not just its head: here the promoted rung was already in
    // the stack, so a repair that prepended instead of moving would leave a
    // duplicate for ADR 0008 traversal to try twice.
    expect(stackOf(decision)).toEqual(["kimi-k3@none", "cursor-grok-4.6-high@high"]);
    expect(decision.explanation.leadRepair?.from).toBe("cursor-grok-4.6-high@high");
    expect(decision.explanation.leadDisplaced).toBe(false);
  });

  test("the repair moves the promoted rung rather than copying it", () => {
    // A follower being promoted is the case where prepend-without-remove looks
    // right and is not: every rung must appear exactly once, in the stack and in
    // the explanation alike.
    const decision = select(
      inputsOf({
        registry: entriesFor("cursor-grok-4.6-high", "kimi-k3", "minimax-m3"),
        snapshot: snapshotOf([
          rungOf("cursor-grok-4.6-high", { score: 0.667, usdPerTask: 1.0 }), // band 2
          rungOf("kimi-k3", { score: 0.6, usdPerTask: null }), // band 2, unpriced
          rungOf("minimax-m3", { score: 0.3, usdPerTask: 0.2 }), // band 1
        ]),
        request: requestOf({ leadPolicy: leadPolicyOf("opencode") }),
      }),
    );
    const stack = stackOf(decision);
    // Unpriced, so kimi is neither pruned nor a pruner: it reaches step 7 inside
    // the ordered stack rather than through the reinstatable set.
    expect(decision.explanation.pruned).toEqual([]);
    expect(stack).toEqual([
      "kimi-k3@none",
      "cursor-grok-4.6-high@high",
      "minimax-m3@high",
      "minimax-m3@low",
      "minimax-m3@max",
    ]);
    expect(new Set(stack).size).toBe(stack.length);
    expect(decision.explanation.eligible).toEqual(stack);
  });

  test("the repair promotes the best incumbent rung, not the first one found", () => {
    // `gpt-5.5@high` sorts ahead of `gpt-5.5@low` on rungId, and `@low` is the
    // better rung here. The repair searches with the full comparator, so the
    // ordering rules are not quietly bypassed for the lead.
    const decision = select(
      inputsOf({
        registry: entriesFor("gpt-5.5", "cursor-grok-4.6-high"),
        snapshot: snapshotOf([
          rungOf("cursor-grok-4.6-high", { score: 0.9, usdPerTask: 1.51 }), // band 3
          rungOf("gpt-5.5", { effort: "low", score: 0.9, usdPerTask: 2.05 }), // band 3
          rungOf("gpt-5.5", { effort: "high", score: 0.3, usdPerTask: 2.05 }), // band 1
        ]),
        request: requestOf({ leadPolicy: leadPolicyOf("codex") }),
      }),
    );
    expect(stackOf(decision)[0]).toBe("gpt-5.5@low");
  });

  test("the repair preserves the order of everything behind the lead", () => {
    const decision = select(
      inputsOf({
        registry: entriesFor("cursor-grok-4.6-high", "kimi-k3", "minimax-m3"),
        snapshot: snapshotOf([
          rungOf("cursor-grok-4.6-high", { score: 0.667, usdPerTask: 1.0 }), // band 2
          rungOf("kimi-k3", { score: 0.667, usdPerTask: 2.0 }), // band 2, pruned
          rungOf("minimax-m3", { score: 0.3, usdPerTask: 0.2 }), // band 1
        ]),
        request: requestOf({ leadPolicy: leadPolicyOf("opencode") }),
      }),
    );
    expect(stackOf(decision)).toEqual([
      "kimi-k3@none",
      "cursor-grok-4.6-high@high",
      "minimax-m3@high",
      "minimax-m3@low",
      "minimax-m3@max",
    ]);
  });

  test("an unavailable incumbent backend displaces the lead and says which cause", () => {
    const decision = select(
      inputsOf({
        registry: entriesFor("cursor-grok-4.6-high", "kimi-k3"),
        snapshot: snapshotOf([
          rungOf("cursor-grok-4.6-high", { score: 0.667, usdPerTask: 1.51 }),
          rungOf("kimi-k3", { score: 0.6, usdPerTask: 0.9 }),
        ]),
        availability: availabilityOf({
          backends: {
            opencode: {
              state: "unavailable",
              classification: null,
              observedAtMs: NOW_MS,
            },
          },
        }),
        request: requestOf({ leadPolicy: leadPolicyOf("opencode") }),
      }),
    );
    expect(stackOf(decision)).toEqual(["cursor-grok-4.6-high@high"]);
    expect(decision.explanation.leadDisplacedByAvailability).toBe(true);
    expect(decision.explanation.leadDisplaced).toBe(false);
    expect(decision.explanation.leadRepair).toBeNull();
  });

  test("an unaffordable incumbent does not lead, even from a higher band", () => {
    // A rung the budget removed cannot be dispatched, so promoting it would make
    // step 7 a way around `budget-limits/v1`. kimi has the strictly higher band
    // here, so it is the lead on capability alone and still does not get it.
    const decision = select(
      inputsOf({
        registry: entriesFor("cursor-grok-4.6-high", "kimi-k3"),
        snapshot: snapshotOf([
          rungOf("cursor-grok-4.6-high", { score: 0.667, usdPerTask: 1.51 }), // band 2
          rungOf("kimi-k3", { score: 0.9, usdPerTask: 50 }), // band 3
        ]),
        ledger: ledgerWith(10),
        request: requestOf({ leadPolicy: leadPolicyOf("opencode") }),
      }),
    );
    expect(stackOf(decision)).toEqual(["cursor-grok-4.6-high@high"]);
    expect(decision.explanation.budgetConstrained).toEqual(["kimi-k3@none"]);
    expect(decision.explanation.leadDisplacedByAvailability).toBe(true);
  });

  test("a pruned incumbent that is also unaffordable is not reinstated", () => {
    // Reinstatement runs the same budget predicate over the pruned set, so the
    // two removals compose. `budgetConstrained` stays empty on purpose: dominance
    // had already taken this rung out, and listing it there would say the budget
    // is what made the floor unreachable when it was not.
    const decision = select(
      inputsOf({
        registry: entriesFor("cursor-grok-4.6-high", "kimi-k3"),
        snapshot: snapshotOf([
          rungOf("cursor-grok-4.6-high", { score: 0.667, usdPerTask: 1.51 }),
          rungOf("kimi-k3", { score: 0.667, usdPerTask: 50 }), // same band, costlier
        ]),
        ledger: ledgerWith(10),
        request: requestOf({ leadPolicy: leadPolicyOf("opencode") }),
      }),
    );
    expect(stackOf(decision)).toEqual(["cursor-grok-4.6-high@high"]);
    expect(decision.explanation.pruned).toEqual([
      { rungId: "kimi-k3@none", dominatedBy: "cursor-grok-4.6-high@high" },
    ]);
    expect(decision.explanation.budgetConstrained).toEqual([]);
    expect(decision.explanation.leadDisplacedByAvailability).toBe(true);
  });

  test("an incumbent below the floor is not reinstated", () => {
    const decision = select(
      inputsOf({
        registry: entriesFor("cursor-grok-4.6-high", "kimi-k3"),
        snapshot: snapshotOf([
          rungOf("cursor-grok-4.6-high", { score: 0.667, usdPerTask: 1.51 }), // band 2
          rungOf("kimi-k3", { score: 0.1, usdPerTask: 0.9 }), // band 0
        ]),
        request: requestOf({
          capabilityFloor: 2 as CapabilityBand,
          minimumFloor: 2 as CapabilityBand,
          leadPolicy: leadPolicyOf("opencode"),
        }),
      }),
    );
    expect(stackOf(decision)).toEqual(["cursor-grok-4.6-high@high"]);
    expect(decision.explanation.rejected).toContainEqual({
      rungId: "kimi-k3@none",
      reason: "below-capability-floor",
    });
    expect(decision.explanation.leadDisplacedByAvailability).toBe(true);
  });

  test("an override does not evaluate step 7", () => {
    // Every rung of one `stableId` shares its transport, so the stage could only
    // ever answer "no repair" — a check with no way to fail. `overrideApplied`
    // beside `leadBackend` is what records that the operator moved the lead.
    const decision = select(
      inputsOf({
        request: requestOf({
          override: { stableId: "minimax-m3", effort: null },
          leadPolicy: leadPolicyOf("codex"),
        }),
      }),
    );
    expect(decision.explanation.overrideApplied).toBe(true);
    expect(decision.explanation.leadBackend).toBe("minimax");
    expect("leadDisplaced" in decision.explanation).toBe(false);
  });

  test("a refusal claims no coherence check, because no stack existed", () => {
    const decision = select(
      inputsOf({
        ledger: ledgerWith(0),
        request: requestOf({ leadPolicy: leadPolicyOf("codex") }),
      }),
    );
    expect(decision.outcome).toBe("refused");
    expect("leadDisplaced" in decision.explanation).toBe(false);
  });

  test("step 7 keeps the decision deterministic", () => {
    const inputs = () =>
      inputsOf({
        registry: entriesFor("gpt-5.5", "cursor-grok-4.6-high"),
        snapshot: snapshotOf([
          rungOf("cursor-grok-4.6-high", { score: 0.667, usdPerTask: 1.51 }),
          rungOf("gpt-5.5", { effort: "high", score: 0.584, usdPerTask: 2.05 }),
        ]),
        request: requestOf({ leadPolicy: leadPolicyOf("codex") }),
      });
    expect(select(inputs())).toEqual(select(inputs()));
  });
});

describe("deriveLeadPolicy", () => {
  function stackFor(workloadClass: string) {
    const stack = candidateStackForRoute(
      "implement.workspace-write.v1",
      null,
      workloadClass,
    );
    if (!stack) {
      throw new Error(`no authored stack for ${workloadClass}`);
    }
    return stack;
  }

  test("records what leads today rather than authoring a new preference", () => {
    // Read straight from CANDIDATE_STACKS, so a stack reorder changes the derived
    // incumbent instead of leaving a hand-copied backend behind.
    expect(
      deriveLeadPolicy(stackFor("medium-medium"), MODEL_REGISTRY)
        .incumbentLeadBackend,
    ).toBe("claude");
    expect(
      deriveLeadPolicy(stackFor("medium-light"), MODEL_REGISTRY)
        .incumbentLeadBackend,
    ).toBe("opencode");
    expect(
      deriveLeadPolicy(stackFor("easy-heavy"), MODEL_REGISTRY)
        .incumbentLeadBackend,
    ).toBe("opencode");
    expect(
      deriveLeadPolicy(stackFor("easy-medium"), MODEL_REGISTRY)
        .incumbentLeadBackend,
    ).toBe("opencode");
    expect(
      deriveLeadPolicy(stackFor("easy-light"), MODEL_REGISTRY)
        .incumbentLeadBackend,
    ).toBe("opencode");
  });

  test("an empty stack has no incumbent", () => {
    expect(
      deriveLeadPolicy({ candidates: [] }, MODEL_REGISTRY).incumbentLeadBackend,
    ).toBeNull();
  });

  test("an unresolvable lead throws rather than reporting no incumbent", () => {
    // `null` means "this route has no incumbent". A typo must not become that.
    expect(() =>
      deriveLeadPolicy({ candidates: ["gpt-5.5-typo"] }, MODEL_REGISTRY),
    ).toThrow(/not in the registry/);
  });
});
