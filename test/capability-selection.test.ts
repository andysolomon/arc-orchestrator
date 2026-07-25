import { describe, expect, test } from "bun:test";
import type {
  CapabilityBand,
  CapabilitySnapshot,
  Measurement,
  RungSnapshotEntry,
} from "../plugins/arc-orchestrator/lib/capability-snapshot";
import { CAPABILITY_SNAPSHOT_SCHEMA_VERSION } from "../plugins/arc-orchestrator/lib/capability-snapshot";
import {
  select,
  SELECTION_POLICY_VERSION,
  type AvailabilityView,
  type SelectionInputs,
  type SelectionRequest,
} from "../plugins/arc-orchestrator/lib/capability-selection";
import {
  MODEL_REGISTRY,
  type ModelRegistryEntry,
} from "../plugins/arc-orchestrator/lib/model-registry";
import type { RootBudgetLedger } from "../plugins/arc-orchestrator/lib/delegation-budget";

const NOW_MS = Date.parse("2026-07-25T00:00:00Z");

// Four implement-eligible entries whose transports expose no effort control, so
// each contributes exactly one `@none` rung. That keeps ordering and pruning
// assertions readable; the effort ladder is exercised separately against a
// claude-backed entry.
const SINGLE_RUNG_MODELS = [
  "composer-2.5",
  "grok-4.5",
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
  const effort = options.effort ?? "none";
  return {
    rungId: `${stableId}@${effort}`,
    stableId,
    effort: effort as RungSnapshotEntry["effort"],
    measurements:
      options.score == null ? [] : [measurementOf(options.score)],
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

function inputsOf(overrides: Partial<SelectionInputs> = {}): SelectionInputs {
  return {
    request: requestOf(),
    registry: entriesFor(...SINGLE_RUNG_MODELS),
    snapshot: snapshotOf([
      rungOf("composer-2.5", { score: 0.56, usdPerTask: 0.44 }),
      rungOf("grok-4.5", { score: 0.667, usdPerTask: 1.51 }),
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
      const entry = MODEL_REGISTRY.find((row) => row.stableId === rung.stableId)!;
      expect(entry.routeEligibility).toContain("implement.workspace-write.v1");
      expect(entry.sandboxPermissionSupport).toContain("workspace-write");
      expect(entry.outputContracts).toContain("implementation-result.v1");
      expect(entry.roleRestriction).toBeNull();
    }
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

    // `gpt-5.6-luna` is explore-only, so every one of its rungs is rejected for
    // this implement route and none can appear in the stack.
    const luna = decision.explanation.rejected.filter((entry) =>
      entry.rungId.startsWith("gpt-5.6-luna@"),
    );
    expect(luna.length).toBeGreaterThan(0);
    expect(luna.every((entry) => entry.reason === "route-ineligible")).toBe(true);
    expect(decision.explanation.eligible).not.toContain("gpt-5.6-luna@high");
  });

  test("an effort the transport cannot forward never becomes a candidate", () => {
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
          rungOf("kimi-k3-anthropic", { effort: "max", score: 0.6, usdPerTask: 1 }),
        ]),
      }),
    );
    expect(stackOf(decision)).toEqual(["kimi-k3-anthropic@max"]);
    const touched = [
      ...decision.explanation.eligible,
      ...decision.explanation.rejected.map((entry) => entry.rungId),
    ];
    expect(touched).toEqual(["kimi-k3-anthropic@max"]);
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
    expect(stackOf(unavailable)).not.toContain("grok-4.5@none");
    expect(
      unavailable.explanation.rejected.some(
        (entry) =>
          entry.rungId === "grok-4.5@none" &&
          entry.reason === "backend-unavailable",
      ),
    ).toBe(true);

    const degraded = select(
      inputsOf({
        registry: entriesFor("grok-4.5"),
        snapshot: snapshotOf([
          rungOf("grok-4.5", { score: 0.667, usdPerTask: 1.51 }),
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
    expect(stackOf(degraded)).toContain("grok-4.5@none");
  });

  test("quota rejects only on an observed zero, never on an unobservable one", () => {
    // Different bands, so neither dominates the other and both reach ordering.
    const pooled = snapshotOf([
      rungOf("grok-4.5", { score: 0.667, usdPerTask: 1.51, quotaPool: "cursor" }),
      rungOf("kimi-k3", { score: 0.3, usdPerTask: 0.9, quotaPool: "moonshot" }),
    ]);
    const pooledRegistry = entriesFor("grok-4.5", "kimi-k3");

    const exhausted = select(
      inputsOf({
        snapshot: pooled,
        registry: pooledRegistry,
        availability: availabilityOf({
          quotaPools: {
            cursor: { pool: "cursor", remainingFraction: 0, resetsAtMs: null },
            moonshot: { pool: "moonshot", remainingFraction: null, resetsAtMs: null },
          },
        }),
      }),
    );
    expect(stackOf(exhausted)).not.toContain("grok-4.5@none");
    expect(stackOf(exhausted)).toContain("kimi-k3@none");

    // An unobservable remainder degrades to "no preference", not to "refuse".
    const unobservable = select(
      inputsOf({
        snapshot: pooled,
        registry: pooledRegistry,
        availability: availabilityOf({
          quotaPools: {
            cursor: { pool: "cursor", remainingFraction: null, resetsAtMs: null },
          },
        }),
      }),
    );
    expect(stackOf(unobservable)).toContain("grok-4.5@none");
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
      "minimax-m3@none", // band 1, $0.20 — cheaper still, so not dominated
    ]);
    expect(decision.explanation.pruned).toEqual([
      { rungId: "grok-4.5@none", dominatedBy: "composer-2.5@none" },
      { rungId: "kimi-k3@none", dominatedBy: "composer-2.5@none" },
    ]);
  });

  test("a higher band survives a lower one only when it is not also cheaper", () => {
    // The frontier keeps a costlier rung when it buys a band, and drops it when
    // a cheaper rung already reaches that band.
    const decision = select(
      inputsOf({
        registry: entriesFor("composer-2.5", "grok-4.5"),
        snapshot: snapshotOf([
          rungOf("composer-2.5", { score: 0.3, usdPerTask: 0.44 }), // band 1
          rungOf("grok-4.5", { score: 0.8, usdPerTask: 1.51 }), // band 3
        ]),
      }),
    );
    expect(stackOf(decision)).toEqual(["grok-4.5@none", "composer-2.5@none"]);
    expect(decision.explanation.pruned).toEqual([]);
  });

  test("prunes a rung dominated on both band and cost", () => {
    const decision = select(
      inputsOf({
        snapshot: snapshotOf([
          rungOf("composer-2.5", { score: 0.667, usdPerTask: 0.44 }),
          // Same band, strictly more expensive, so composer dominates it.
          rungOf("grok-4.5", { score: 0.667, usdPerTask: 1.51 }),
        ]),
        registry: entriesFor("composer-2.5", "grok-4.5"),
      }),
    );
    expect(stackOf(decision)).toEqual(["composer-2.5@none"]);
    expect(decision.explanation.pruned).toEqual([
      { rungId: "grok-4.5@none", dominatedBy: "composer-2.5@none" },
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
          rungOf("grok-4.5", { score: 0.667, usdPerTask: null }),
        ]),
        registry: entriesFor("composer-2.5", "grok-4.5"),
      }),
    );
    expect(stackOf(decision)).toEqual(["composer-2.5@none", "grok-4.5@none"]);
    expect(decision.explanation.pruned).toEqual([]);
  });

  test("a scarcer quota pool sorts last among otherwise equal rungs", () => {
    const decision = select(
      inputsOf({
        snapshot: snapshotOf([
          rungOf("composer-2.5", { score: 0.6, usdPerTask: 1, quotaPool: "cursor" }),
          rungOf("kimi-k3", { score: 0.6, usdPerTask: 1, quotaPool: "moonshot" }),
        ]),
        registry: entriesFor("composer-2.5", "kimi-k3"),
        availability: availabilityOf({
          quotaPools: {
            cursor: { pool: "cursor", remainingFraction: 0.1, resetsAtMs: null },
            moonshot: { pool: "moonshot", remainingFraction: 0.9, resetsAtMs: null },
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
    expect(stackOf(decision)).toEqual(["minimax-m3@none"]);
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
          rungOf("grok-4.5", { score: null, usdPerTask: 0.1 }),
        ]),
        registry: entriesFor("composer-2.5", "grok-4.5"),
      }),
    );
    // grok is cheaper by fifty times and still sorts last: an unknown capability
    // is not a cheap capability.
    expect(stackOf(decision)).toEqual(["composer-2.5@none", "grok-4.5@none"]);
    expect(decision.explanation.unranked).toEqual(["grok-4.5@none"]);
  });

  test("an unranked rung cannot satisfy a floor above zero", () => {
    const decision = select(
      inputsOf({
        snapshot: snapshotOf([rungOf("grok-4.5", { score: null, usdPerTask: 1 })]),
        registry: entriesFor("grok-4.5"),
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
        ...rungOf("grok-4.5", { usdPerTask: 1 }),
        measurements: [{ ...measurementOf(0.9), axis: "swe", source: "deepswe.v1.1" }],
      },
    ]);
    const decision = select(
      inputsOf({ snapshot: crossAxis, registry: entriesFor("grok-4.5") }),
    );
    expect(decision.explanation.unranked).toEqual(["grok-4.5@none"]);
    expect(stackOf(decision)[0]).toBe("grok-4.5@none");
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
        registry: entriesFor("composer-2.5", "grok-4.5"),
        snapshot: snapshotOf([
          rungOf("composer-2.5", { score: 0.56, usdPerTask: 0.44 }),
          rungOf("grok-4.5", { score: 0.8, usdPerTask: 1.51 }),
        ]),
      }),
    );
    expect(stackOf(decision)).toEqual(["composer-2.5@none"]);
    expect(decision.explanation.budgetConstrained).toContain("grok-4.5@none");
  });

  test("an unpriced rung is never dropped for cost", () => {
    // cost-unknown may not disable an otherwise-eligible entry — decision 0001's
    // fail-safe, restated for capability data by decision 0005.
    const decision = select(
      inputsOf({
        ledger: ledgerWith(0.5),
        snapshot: snapshotOf([
          rungOf("grok-4.5", { score: 0.667, usdPerTask: null }),
        ]),
        registry: entriesFor("grok-4.5"),
      }),
    );
    expect(stackOf(decision)).toEqual(["grok-4.5@none"]);
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
    expect(stackOf(decision)).toEqual(["minimax-m3@none"]);
    expect(decision.explanation.overrideApplied).toBe(true);
  });

  test("an override may not bypass the capability contract", () => {
    const decision = select(
      inputsOf({
        registry: [...MODEL_REGISTRY],
        request: requestOf({
          override: { stableId: "gpt-5.6-luna", effort: "high" },
        }),
      }),
    );
    expect(decision.outcome).toBe("refused");
    if (decision.outcome === "refused") {
      expect(decision.reason).toBe("override-ineligible");
    }
    expect(decision.explanation.overrideApplied).toBe(true);
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

describe("select: snapshot freshness", () => {
  test("refuses with snapshot-expired rather than serving the fresh half", () => {
    const half = snapshotOf([
      rungOf("composer-2.5", { score: 0.56, usdPerTask: 0.44 }),
      {
        ...rungOf("grok-4.5", { score: 0.667, usdPerTask: 1.51 }),
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

describe("select: phase 13.4a seam", () => {
  test("reports the lead backend but claims no coherence check", () => {
    const decision = select(inputsOf());
    expect(decision.explanation.leadBackend).toBe("composer");
    // Absent, not false. A `false` here would attest to a stack-level check that
    // phase 13.4a has not written yet.
    expect("leadRepair" in decision.explanation).toBe(false);
    expect("leadDisplaced" in decision.explanation).toBe(false);
    expect("leadDisplacedByAvailability" in decision.explanation).toBe(false);
  });
});
