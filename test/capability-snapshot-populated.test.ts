import { describe, expect, test } from "bun:test";
import {
  validateCapabilitySnapshot,
  type CapabilitySnapshot,
  type Measurement,
} from "../plugins/arc-orchestrator/lib/capability-snapshot";
import snapshotJson from "../plugins/orchestrator-core/capability-snapshot.json";

const NOW_MS = Date.parse("2026-07-26T00:00:00Z");
const DEEPSWE_URL = "https://deepswe.datacurve.ai";
const CURSORBENCH_URL = "https://cursor.com/cursorbench";

const snapshot = snapshotJson as CapabilitySnapshot;

function benchmarkMeasurements(
  s: CapabilitySnapshot,
): Measurement[] {
  const out: Measurement[] = [];
  for (const rung of s.rungs) {
    for (const m of rung.measurements) {
      if (m.source === "deepswe.v1.1" || m.source === "cursorbench.3.2") {
        out.push(m);
      }
    }
  }
  return out;
}

describe("capability-snapshot-populated", () => {
  test("shipped snapshot passes validateCapabilitySnapshot at 2026-07-26", () => {
    const result = validateCapabilitySnapshot(snapshot, { nowMs: NOW_MS });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("snapshotVersion pins both benchmarks and the 2026-07-25 retrieval date", () => {
    expect(snapshot.snapshotVersion).toBe(
      "2026-07-25+deepswe.v1.1+cursorbench.3.2",
    );
  });

  test("every benchmark measurement uses the canonical suite URLs", () => {
    for (const m of benchmarkMeasurements(snapshot)) {
      if (m.source === "deepswe.v1.1") {
        expect(m.sourceUrl).toBe(DEEPSWE_URL);
      } else if (m.source === "cursorbench.3.2") {
        expect(m.sourceUrl).toBe(CURSORBENCH_URL);
      }
    }
  });

  test("obsolete Grok 4.5 identities carry no snapshot rungs (runner-routing-v4)", () => {
    expect(
      snapshot.rungs.some((r) => r.stableId.includes("grok-4.5")),
    ).toBe(false);
  });

  test("Terra carries no live v4 snapshot rungs", () => {
    expect(snapshot.rungs.some((r) => /terra/i.test(r.stableId))).toBe(false);
  });

  test("composer-2.5 has no swe-axis measurement", () => {
    const composerRungs = snapshot.rungs.filter(
      (r) => r.stableId === "composer-2.5",
    );
    expect(composerRungs.length).toBeGreaterThan(0);
    for (const rung of composerRungs) {
      expect(rung.measurements.some((m) => m.axis === "swe")).toBe(false);
    }
  });

  test("sonnet-5 has at least one deepswe.v1.1 swe measurement", () => {
    const sonnetRungs = snapshot.rungs.filter((r) => r.stableId === "sonnet-5");
    const sweDeepswe = sonnetRungs.flatMap((r) =>
      r.measurements.filter(
        (m) => m.axis === "swe" && m.source === "deepswe.v1.1",
      ),
    );
    expect(sweDeepswe.length).toBeGreaterThan(0);
  });

  test("at least one costPrior is present", () => {
    const withCost = snapshot.rungs.filter((r) => r.costPrior !== null);
    expect(withCost.length).toBeGreaterThan(0);
  });
});
