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

  test("no grok-4.5 measurement is sourced from deepswe.v1.1 (A-0001)", () => {
    const grokRungs = snapshot.rungs.filter((r) => r.stableId === "grok-4.5");
    for (const rung of grokRungs) {
      for (const m of rung.measurements) {
        expect(m.source).not.toBe("deepswe.v1.1");
      }
    }
  });

  test("grok-4.5@none has editorial agentic-edit and null costPrior", () => {
    const grok = snapshot.rungs.find((r) => r.rungId === "grok-4.5@none");
    expect(grok).toBeDefined();
    expect(grok!.costPrior).toBeNull();
    const agentic = grok!.measurements.find((m) => m.axis === "agentic-edit");
    expect(agentic).toBeDefined();
    expect(agentic!.source).toBe("editorial");
    expect(agentic!.approver).toBe("Andrew Solomon");
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

  test("at least one costPrior is present and grok-4.5@none stays null", () => {
    const withCost = snapshot.rungs.filter((r) => r.costPrior !== null);
    expect(withCost.length).toBeGreaterThan(0);
    const grok = snapshot.rungs.find((r) => r.rungId === "grok-4.5@none");
    expect(grok?.costPrior).toBeNull();
  });
});
