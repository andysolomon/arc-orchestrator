import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CAPABILITY_FLOOR_POLICY_VERSION,
  capabilityFloorDisagreement,
  floorForWorkloadClass,
  resolveCapabilityFloor,
  workloadClassFloorTable,
  type CapabilityFloorInputs,
} from "../plugins/arc-orchestrator/lib/capability-floor";
import {
  CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
  type CapabilityBand,
  type CapabilitySnapshot,
  type Measurement,
  type RungSnapshotEntry,
} from "../plugins/arc-orchestrator/lib/capability-snapshot";
import {
  candidateStackForRoute,
  MODEL_REGISTRY,
  rungsFor,
} from "../plugins/arc-orchestrator/lib/model-registry";
import { select } from "../plugins/arc-orchestrator/lib/capability-selection";
import { WORKLOAD_CLASSES } from "../plugins/arc-orchestrator/lib/routes";
import type { RootBudgetLedger } from "../plugins/arc-orchestrator/lib/delegation-budget";

const NOW_MS = Date.parse("2026-07-26T00:00:00Z");
const IMPLEMENT = "implement.workspace-write.v1" as const;

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

// Rungs are generated from the registry rather than hand-listed so a fixture can
// never name a rung the transport does not expose — the mismatch that produced
// four bogus failures in 13.4a.
function rungsWithScore(
  stableId: string,
  score: number | null,
  usdPerTask: number | null = 1,
): RungSnapshotEntry[] {
  const entry = MODEL_REGISTRY.find((row) => row.stableId === stableId);
  if (!entry) {
    throw new Error(`Missing fixture entry: ${stableId}`);
  }
  return rungsFor(entry).map((rungId) => {
    const effort = rungId.slice(rungId.lastIndexOf("@") + 1);
    return {
      rungId,
      stableId,
      effort: effort as RungSnapshotEntry["effort"],
      measurements: score == null ? [] : [measurementOf(score)],
      costPrior:
        usdPerTask == null
          ? null
          : {
              source: "cursorbench.3.2",
              usdPerTask,
              outputTokensPerTask: 20000,
              stepsPerTask: 20,
              retrievedAt: "2026-07-20",
            },
      quotaPool: null,
      priceBand: "$$",
    } satisfies RungSnapshotEntry;
  });
}

function snapshotOf(
  rungs: RungSnapshotEntry[],
  bandWidth = 0.25,
): CapabilitySnapshot {
  return {
    schemaVersion: CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
    snapshotVersion: "2026-07-26+cursorbench.3.2",
    bandWidth,
    rungs,
  };
}

function leadFor(workloadClass: string): string {
  const stack = candidateStackForRoute(IMPLEMENT, null, workloadClass);
  if (!stack) {
    throw new Error(`No stack for ${workloadClass}`);
  }
  return stack.candidates[0]!;
}

// Every implement lead, scored so the ladder reads cleanly: the cost-pinned
// classes land in band 1, the medium classes in band 2, and the hard classes in
// band 3. Written as scores rather than bands so the banding arithmetic is
// exercised rather than bypassed.
const LADDER_SCORES: Record<string, number> = {
  "composer-2.5": 0.3, // band 1
  "grok-4.5": 0.3, // band 1
  "gpt-5.5": 0.55, // band 2
  "opus-5": 0.55, // band 2
  "fable-5": 0.8, // band 3
  "gpt-5.6-sol": 0.8, // band 3
};

function ladderSnapshot(
  overrides: Record<string, number | null> = {},
): CapabilitySnapshot {
  const scores = { ...LADDER_SCORES, ...overrides };
  return snapshotOf(
    Object.entries(scores).flatMap(([stableId, score]) =>
      rungsWithScore(stableId, score),
    ),
  );
}

function inputsOf(
  overrides: Partial<CapabilityFloorInputs> = {},
): CapabilityFloorInputs {
  return {
    capabilityRoute: IMPLEMENT,
    axis: "agentic-edit",
    snapshot: ladderSnapshot(),
    ...overrides,
  };
}

function floorsByClass(
  inputs: CapabilityFloorInputs,
): Record<string, CapabilityBand> {
  return Object.fromEntries(
    workloadClassFloorTable(inputs).map((row) => [
      row.workloadClass,
      row.capabilityFloor,
    ]),
  );
}

describe("capability floor mapping", () => {
  test("pins its policy version", () => {
    expect(CAPABILITY_FLOOR_POLICY_VERSION).toBe("capability-floor/v1");
  });

  test("covers every declared workload class", () => {
    const table = workloadClassFloorTable(inputsOf());
    expect(table.map((row) => row.workloadClass)).toEqual([
      ...WORKLOAD_CLASSES,
    ]);
  });

  test("reads the floor off the class's authored lead", () => {
    for (const row of workloadClassFloorTable(inputsOf())) {
      expect({
        workloadClass: row.workloadClass,
        stableId: row.derivedFrom?.stableId ?? null,
      }).toEqual({
        workloadClass: row.workloadClass,
        stableId: leadFor(row.workloadClass),
      });
    }
  });

  test("never emits a floor no rung occupies", () => {
    const snapshot = ladderSnapshot();
    const occupied = new Set(
      workloadClassFloorTable(inputsOf({ snapshot })).map(
        (row) => row.derivedFrom?.rungId ?? null,
      ),
    );
    occupied.delete(null);
    const known = new Set(snapshot.rungs.map((rung) => rung.rungId));
    for (const rungId of occupied) {
      expect(known.has(rungId!)).toBe(true);
    }
  });
});

describe("rollback: no snapshot", () => {
  // ADR 0010's rollback is "delete the snapshot", and 13.2 kept absence a
  // supported state. `select()` rejects an unranked rung against any floor above
  // 0, so a mapping that guessed a non-zero floor without data would turn that
  // rollback into a refusal of every medium-and-up dispatch.
  test("derives floor 0 for every class", () => {
    const table = workloadClassFloorTable(inputsOf({ snapshot: null }));
    expect(table.map((row) => row.capabilityFloor)).toEqual(
      WORKLOAD_CLASSES.map(() => 0),
    );
  });

  test("claims no provenance it does not have", () => {
    const table = workloadClassFloorTable(inputsOf({ snapshot: null }));
    expect(table.map((row) => row.derivedFrom)).toEqual(
      WORKLOAD_CLASSES.map(() => null),
    );
  });

  test("leaves the cost pin unexpressed rather than guessing it", () => {
    // The honest consequence of rolling back: `default` and `light-work` lose
    // their ceiling too, because a cap is a claim about bands and no band is
    // known. The class reverts to meaning nothing, which is what "the mapping is
    // only live once a snapshot exists" costs.
    const table = workloadClassFloorTable(inputsOf({ snapshot: null }));
    expect(table.map((row) => row.bandCeiling)).toEqual(
      WORKLOAD_CLASSES.map(() => null),
    );
  });

  test("still selects a stack on a medium class", () => {
    const resolved = resolveCapabilityFloor({
      workloadClass: "medium-work",
      inputs: inputsOf({ snapshot: null }),
    });
    const decision = select({
      request: {
        capabilityRoute: IMPLEMENT,
        axis: "agentic-edit",
        capabilityFloor: resolved.capabilityFloor,
        minimumFloor: resolved.minimumFloor,
        bandCeiling: resolved.bandCeiling,
        override: null,
        taskIdentity: "rollback-fixture",
        depth: 1,
      },
      registry: MODEL_REGISTRY.filter((entry) =>
        ["composer-2.5", "grok-4.5"].includes(entry.stableId),
      ),
      snapshot: snapshotOf([]),
      ledger: ledgerWith(10),
      availability: { backends: {}, quotaPools: {} },
      policyVersion: "capability-rung/v1",
      nowMs: NOW_MS,
    });
    expect(decision.outcome).toBe("selected");
  });
});

describe("degradation latitude comes from automaticFallback", () => {
  test("a stack with automatic fallback may degrade to 0", () => {
    for (const workloadClass of WORKLOAD_CLASSES) {
      const stack = candidateStackForRoute(IMPLEMENT, null, workloadClass)!;
      if (!stack.automaticFallback) {
        continue;
      }
      expect({
        workloadClass,
        minimumFloor: floorForWorkloadClass(workloadClass, inputsOf())
          .minimumFloor,
      }).toEqual({ workloadClass, minimumFloor: 0 });
    }
  });

  test("a pinned stack does not degrade", () => {
    for (const workloadClass of WORKLOAD_CLASSES) {
      const stack = candidateStackForRoute(IMPLEMENT, null, workloadClass)!;
      if (stack.automaticFallback) {
        continue;
      }
      const floor = floorForWorkloadClass(workloadClass, inputsOf());
      expect({ workloadClass, equal: floor.minimumFloor === floor.capabilityFloor })
        .toEqual({ workloadClass, equal: true });
    }
  });

  test("the pinned classes are exactly default and light-work", () => {
    // The latitude rule reads `automaticFallback` rather than a class name, so
    // this records which classes it currently reaches. If a stack gains or loses
    // automatic fallback, this fails and the change is looked at rather than
    // absorbed.
    const pinned = WORKLOAD_CLASSES.filter(
      (workloadClass) =>
        !candidateStackForRoute(IMPLEMENT, null, workloadClass)!
          .automaticFallback,
    );
    expect(pinned).toEqual(["default", "light-work"]);
  });
});

describe("the cost pin survives as a ceiling", () => {
  test("a pinned class caps at its candidate's band", () => {
    const floor = floorForWorkloadClass("light-work", inputsOf());
    expect({
      floor: floor.capabilityFloor,
      ceiling: floor.bandCeiling,
    }).toEqual({ floor: 1, ceiling: 1 });
  });

  test("a fallback class is uncapped", () => {
    expect(floorForWorkloadClass("hard-work", inputsOf()).bandCeiling).toBeNull();
  });

  test("without a ceiling a cost-pinned class would lead with the dearest rung", () => {
    // Why the ceiling is a correctness requirement and not a nicety: floor 0
    // admits everything and `select()` orders by band descending, so dropping
    // the cap makes `light-work` lead with the most capable rung available.
    const registry = MODEL_REGISTRY.filter((entry) =>
      ["grok-4.5", "fable-5"].includes(entry.stableId),
    );
    const snapshot = ladderSnapshot();
    const requestOf = (bandCeiling: CapabilityBand | null) => ({
      capabilityRoute: IMPLEMENT,
      axis: "agentic-edit" as const,
      capabilityFloor: 0 as CapabilityBand,
      minimumFloor: 0 as CapabilityBand,
      bandCeiling,
      override: null,
      taskIdentity: "ceiling-fixture",
      depth: 1,
    });
    const common = {
      registry,
      snapshot,
      ledger: ledgerWith(100),
      availability: { backends: {}, quotaPools: {} },
      policyVersion: "capability-rung/v1",
      nowMs: NOW_MS,
    };

    const uncapped = select({ ...common, request: requestOf(null) });
    const capped = select({
      ...common,
      request: requestOf(floorForWorkloadClass("light-work", inputsOf({ snapshot }))
        .bandCeiling),
    });

    expect(uncapped.outcome === "selected" && uncapped.stack[0]!.stableId).toBe(
      "fable-5",
    );
    expect(capped.outcome === "selected" && capped.stack[0]!.stableId).toBe(
      "grok-4.5",
    );
  });
});

describe("what the class vocabulary can and cannot express", () => {
  test("classes sharing a lead cannot be separated by any snapshot", () => {
    // `medium-hard-work` and `hard-work` both lead with fable-5, so no data can
    // give them different floors. Recorded here rather than asserted as a
    // coincidence: if the stacks diverge, this fails and the mapping gains a
    // distinction it did not have.
    expect(leadFor("medium-hard-work")).toBe(leadFor("hard-work"));
    const floors = floorsByClass(inputsOf());
    expect(floors["medium-hard-work"]).toBe(floors["hard-work"]!);
  });

  test("the light/heavy pairs hold identical candidate sets", () => {
    const setFor = (workloadClass: string) =>
      [...candidateStackForRoute(IMPLEMENT, null, workloadClass)!.candidates]
        .sort();
    expect(setFor("medium-light-work")).toEqual(setFor("medium-work"));
    expect(setFor("hard-light-work")).toEqual(setFor("hard-work"));
  });

  test("the lighter class may outrank the heavier one, and that is the trade", () => {
    // The documented exception `test/workload-ladder.test.ts` excuses: the pair
    // shares candidates and swaps the lead, buying a dearer model for small
    // tasks. Derived floors surface it instead of smoothing it away.
    const floors = floorsByClass(
      inputsOf({ snapshot: ladderSnapshot({ "opus-5": 0.8 }) }),
    );
    expect(floors["medium-light-work"]!).toBeGreaterThan(floors["medium-work"]!);
  });

  test("the ladder is otherwise non-decreasing", () => {
    const floors = floorsByClass(inputsOf());
    const ladder = WORKLOAD_CLASSES.filter(
      (workloadClass) => workloadClass !== "medium-light-work",
    );
    const inversions: string[] = [];
    for (let index = 1; index < ladder.length; index += 1) {
      const previous = ladder[index - 1]!;
      const current = ladder[index]!;
      if (floors[current]! < floors[previous]!) {
        inversions.push(
          `${current} (${floors[current]}) below ${previous} (${floors[previous]})`,
        );
      }
    }
    expect(inversions).toEqual([]);
  });
});

describe("the class only means something on the implement route", () => {
  test("every class resolves to the same floor on a read-only route", () => {
    for (const route of [
      "explore.read-only.v1",
      "check.read-only.v1",
      "taste-review.read-only.v1",
    ] as const) {
      const floors = new Set(
        workloadClassFloorTable(inputsOf({ capabilityRoute: route })).map(
          (row) => row.capabilityFloor,
        ),
      );
      expect({ route, distinct: floors.size }).toEqual({ route, distinct: 1 });
    }
  });

  test("a read-only route derives from its own stack, not the class's", () => {
    const floor = floorForWorkloadClass("hard-work", {
      capabilityRoute: "explore.read-only.v1",
      axis: "agentic-edit",
      snapshot: ladderSnapshot(),
    });
    expect(floor.derivedFrom?.stableId).toBe(
      candidateStackForRoute("explore.read-only.v1", null, "hard-work")!
        .candidates[0],
    );
  });

  test("the single-candidate taste route keeps its cap", () => {
    const floor = floorForWorkloadClass("default", {
      capabilityRoute: "taste-review.read-only.v1",
      axis: "agentic-edit",
      snapshot: ladderSnapshot(),
    });
    expect(floor.bandCeiling).not.toBeNull();
  });
});

describe("the lowest rung of the lead sets the floor", () => {
  test("a multi-rung lead floors at its weakest ranked rung", () => {
    const entry = MODEL_REGISTRY.find((row) => row.stableId === "opus-5")!;
    const rungs = rungsFor(entry);
    expect(rungs.length).toBeGreaterThan(1);
    const spread = rungs.map((rungId, index) => ({
      rungId,
      stableId: "opus-5",
      effort: rungId.slice(rungId.lastIndexOf("@") + 1) as
        RungSnapshotEntry["effort"],
      measurements: [measurementOf(index === 0 ? 0.3 : 0.9)],
      costPrior: null,
      quotaPool: null,
      priceBand: "$$" as const,
    }));
    const floor = floorForWorkloadClass(
      "medium-light-work",
      inputsOf({ snapshot: snapshotOf(spread) }),
    );
    // 0.3 / 0.25 = band 1; 0.9 / 0.25 = band 3. The floor takes the lower,
    // because today's dispatcher may run either.
    expect({ floor: floor.capabilityFloor, rung: floor.derivedFrom?.rungId }).toEqual({
      floor: 1,
      rung: rungs[0],
    });
  });

  test("an unranked lead yields no floor", () => {
    const floor = floorForWorkloadClass(
      "hard-work",
      inputsOf({ snapshot: ladderSnapshot({ "fable-5": null }) }),
    );
    expect({
      floor: floor.capabilityFloor,
      derivedFrom: floor.derivedFrom,
    }).toEqual({ floor: 0, derivedFrom: null });
  });
});

describe("dual acceptance", () => {
  test("an explicit floor wins", () => {
    const resolved = resolveCapabilityFloor({
      explicit: { capabilityFloor: 4, minimumFloor: 4 },
      workloadClass: "light-work",
      inputs: inputsOf(),
    });
    expect({ floor: resolved.capabilityFloor, source: resolved.source }).toEqual({
      floor: 4,
      source: "explicit",
    });
  });

  test("the class is recorded even when it did not win", () => {
    const resolved = resolveCapabilityFloor({
      explicit: { capabilityFloor: 4, minimumFloor: 4 },
      workloadClass: "light-work",
      inputs: inputsOf(),
    });
    expect(resolved.workloadClass).toBe("light-work");
    expect(resolved.derived.capabilityFloor).toBe(1);
  });

  test("an explicit floor does not inherit the class's ceiling", () => {
    const resolved = resolveCapabilityFloor({
      explicit: { capabilityFloor: 2, minimumFloor: 0 },
      workloadClass: "light-work",
      inputs: inputsOf(),
    });
    expect(resolved.bandCeiling).toBeNull();
    expect(resolved.derived.bandCeiling).toBe(1);
  });

  test("with no explicit floor the class supplies all three", () => {
    const resolved = resolveCapabilityFloor({
      workloadClass: "light-work",
      inputs: inputsOf(),
    });
    expect({
      floor: resolved.capabilityFloor,
      minimum: resolved.minimumFloor,
      ceiling: resolved.bandCeiling,
      source: resolved.source,
    }).toEqual({ floor: 1, minimum: 1, ceiling: 1, source: "workload-class" });
  });

  test("disagreement is reported, not resolved silently", () => {
    const resolved = resolveCapabilityFloor({
      explicit: { capabilityFloor: 3, minimumFloor: 0 },
      workloadClass: "light-work",
      inputs: inputsOf(),
    });
    expect(capabilityFloorDisagreement(resolved)).toEqual({
      explicit: 3,
      derived: 1,
    });
  });

  test("agreement reports nothing", () => {
    const resolved = resolveCapabilityFloor({
      explicit: { capabilityFloor: 1, minimumFloor: 0 },
      workloadClass: "light-work",
      inputs: inputsOf(),
    });
    expect(capabilityFloorDisagreement(resolved)).toBeNull();
  });

  test("a derived floor cannot disagree with itself", () => {
    const resolved = resolveCapabilityFloor({
      workloadClass: "hard-work",
      inputs: inputsOf(),
    });
    expect(capabilityFloorDisagreement(resolved)).toBeNull();
  });
});

describe("class normalization", () => {
  test("absent and empty become default", () => {
    for (const value of [null, undefined, "", "   "]) {
      expect(floorForWorkloadClass(value, inputsOf()).workloadClass).toBe(
        "default",
      );
    }
  });

  test("case and padding are tolerated", () => {
    expect(floorForWorkloadClass("  Hard-Work ", inputsOf()).workloadClass).toBe(
      "hard-work",
    );
  });

  test("an unknown class throws rather than becoming default", () => {
    // A typo silently becoming `default` would route hard work onto the cheapest
    // pinned stack while every record showed a class that was asked for.
    expect(() => floorForWorkloadClass("hardwork", inputsOf())).toThrow(
      /unknown workload class/,
    );
  });
});

describe("workload_class is demoted to metadata", () => {
  test("selection never reads it", () => {
    // The demotion in one assertion: past the mapping boundary the class is
    // carried, never consulted. This is the prose-drift guard ADR 0011 asks for,
    // applied to code — the failure mode is not that selection breaks, it is
    // that a second reader of the class appears and quietly re-promotes it.
    const source = readFileSync(
      new URL(
        "../plugins/arc-orchestrator/lib/capability-selection.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).not.toMatch(/workloadClass|workload_class/);
  });
});

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
