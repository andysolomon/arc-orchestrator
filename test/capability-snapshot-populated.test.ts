import { describe, expect, test } from "bun:test";
import {
  validateCapabilitySnapshot,
  type CapabilitySnapshot,
} from "../plugins/arc-orchestrator/lib/capability-snapshot";
import snapshotJson from "../plugins/orchestrator-core/capability-snapshot.json";

const NOW_MS = Date.parse("2026-07-26T00:00:00Z");

const snapshot = snapshotJson as CapabilitySnapshot;

describe("capability-snapshot-populated", () => {
  test("shipped snapshot passes validateCapabilitySnapshot at 2026-07-26", () => {
    const result = validateCapabilitySnapshot(snapshot, { nowMs: NOW_MS });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
