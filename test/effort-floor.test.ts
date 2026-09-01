import { describe, expect, test } from "bun:test";
import {
  derivedEffortFloorForStableId,
  type DerivedEffortFloor,
} from "../plugins/arc-orchestrator/lib/capability-floor";
import {
  CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
  type CapabilitySnapshot,
  type Measurement,
  type RungSnapshotEntry,
} from "../plugins/arc-orchestrator/lib/capability-snapshot";
import {
  MODEL_REGISTRY,
  rungsFor,
} from "../plugins/arc-orchestrator/lib/model-registry";
import snapshotJson from "../plugins/orchestrator-core/capability-snapshot.json";

const snapshot = snapshotJson as CapabilitySnapshot;

/** Pre-13.7 MODEL_RANKINGS.effortFloor at migration (#235/#237); golden map may adjudicate. */
const MIGRATION_EFFORT_FLOORS: Record<string, string> = {
  "composer-2.5": "medium",
  "gpt-5.6-luna": "high",
  "gpt-5.5": "medium",
  "gpt-5.6-sol": "medium",
  "cursor-grok-4.6-high": "low",
  "kimi-k3": "high",
  "sonnet-5": "low",
  "opus-4.8": "medium",
  "opus-5": "low",
  "fable-5": "low",
};

const GOLDEN_DERIVED_FLOORS: Record<string, string | null> = {
  "gpt-5.6-luna": "high",
  "gpt-5.5": "medium",
  "gpt-5.6-sol": "medium",
  "sonnet-5": "low",
  "opus-5": "low",
  // Retired Fable 5 keeps its historical measurement; Fable 5.1 is unmeasured.
  "fable-5": "low",
  "fable-5.1": null,
  // Measured DeepSWE peak band is only @high; migration floor was medium.
  "opus-4.8": "high",
  "composer-2.5": "none",
  "cursor-grok-4.6-high": "high",
  "kimi-k3": null,
};

function sweMeasurement(score: number): Measurement {
  return {
    axis: "swe",
    source: "deepswe.v1.1",
    score,
    errorMargin: 0.02,
    sampleSize: 100,
    sourceUrl: "https://deepswe.datacurve.ai",
    retrievedAt: "2026-07-25",
    expiresAt: "2027-01-21",
    approver: null,
  };
}

function syntheticLadder(
  stableId: string,
  scoresByEffort: Partial<Record<RungSnapshotEntry["effort"], number>>,
): CapabilitySnapshot {
  const entry = MODEL_REGISTRY.find((row) => row.stableId === stableId);
  if (!entry) {
    throw new Error(`Missing registry entry: ${stableId}`);
  }
  const rungs: RungSnapshotEntry[] = rungsFor(entry).map((rungId) => {
    const effort = rungId.slice(rungId.lastIndexOf("@") + 1) as RungSnapshotEntry["effort"];
    const score = scoresByEffort[effort];
    return {
      rungId,
      stableId,
      effort,
      measurements: score == null ? [] : [sweMeasurement(score)],
      costPrior: null,
      quotaPool: null,
      priceBand: "$$",
    };
  });
  return {
    schemaVersion: CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
    snapshotVersion: "test-synthetic",
    bandWidth: 0.25,
    rungs,
  };
}

function floorEffort(stableId: string, snap: CapabilitySnapshot): string | null {
  return derivedEffortFloorForStableId(stableId, snap)?.effort ?? null;
}

describe("derivedEffortFloorForStableId", () => {
  test("checked-in snapshot matches golden derived floors (migration pins)", () => {
    for (const [stableId, expected] of Object.entries(GOLDEN_DERIVED_FLOORS)) {
      const derived = derivedEffortFloorForStableId(stableId, snapshot);
      if (expected == null) {
        expect(derived).toBeNull();
        continue;
      }
      expect(derived?.effort).toBe(expected);
      expect(derived?.axis).toBe(
        stableId === "composer-2.5" || stableId === "cursor-grok-4.6-high"
          ? "agentic-edit"
          : "swe",
      );
      // Pin migration expectations where measured supersedes authored floor.
      const migration = MIGRATION_EFFORT_FLOORS[stableId];
      if (migration != null && migration !== expected) {
        expect(migration).not.toBe(expected);
      }
    }
  });

  test("opus-4.8 adjudication: measured peak band @high supersedes migration medium", () => {
    expect(MIGRATION_EFFORT_FLOORS["opus-4.8"]).toBe("medium");
    const derived = derivedEffortFloorForStableId("opus-4.8", snapshot);
    expect(derived).toEqual({
      effort: "high",
      axis: "swe",
      peakBand: 2,
      rungId: "opus-4.8@high",
    } satisfies DerivedEffortFloor);
  });

  test("kimi-k3 absent from snapshot returns null", () => {
    expect(
      snapshot.rungs.some((rung) => rung.stableId === "kimi-k3"),
    ).toBe(false);
    expect(derivedEffortFloorForStableId("kimi-k3", snapshot)).toBeNull();
    expect(MIGRATION_EFFORT_FLOORS["kimi-k3"]).toBe("high");
  });

  test("mutation: lowering a lower-effort score out of peak band raises derived floor effort", () => {
    const base = syntheticLadder("gpt-5.5", {
      low: 0.75,
      medium: 0.75,
      high: 0.75,
    });
    expect(floorEffort("gpt-5.5", base)).toBe("low");

    const lowered = syntheticLadder("gpt-5.5", {
      low: 0.2,
      medium: 0.75,
      high: 0.75,
    });
    expect(floorEffort("gpt-5.5", lowered)).toBe("medium");
  });

  test("mutation: lower effort entering peak band drops derived floor", () => {
    const before = syntheticLadder("sonnet-5", {
      low: 0.2,
      medium: 0.5,
      high: 0.75,
    });
    expect(floorEffort("sonnet-5", before)).toBe("high");

    const after = syntheticLadder("sonnet-5", {
      low: 0.75,
      medium: 0.5,
      high: 0.75,
    });
    expect(floorEffort("sonnet-5", after)).toBe("low");
  });

  test("capability-snapshot schema has no effortFloor or lowestEligible fields", () => {
    const raw = JSON.stringify(snapshotJson);
    expect(raw.includes("effortFloor")).toBe(false);
    expect(raw.includes("lowestEligible")).toBe(false);
    expect(snapshot.schemaVersion).toBe(1);
  });
});
