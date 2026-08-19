import { describe, expect, test } from "bun:test";
import {
  CAPABILITY_FLOOR_POLICY_VERSION,
  floorForWorkloadClass,
  workloadClassFloorTable,
} from "../plugins/arc-orchestrator/lib/capability-floor";
import { WORKLOAD_CLASSES } from "../plugins/arc-orchestrator/lib/routes";

const base = {
  capabilityRoute: "implement.workspace-write.v1" as const,
  axis: "agentic-edit" as const,
  snapshot: null,
};

describe("runner-routing-v4 capability-floor seam", () => {
  test("keeps the existing floor policy version", () => {
    expect(CAPABILITY_FLOOR_POLICY_VERSION).toBe("capability-floor/v1");
  });

  test("covers exactly the nine canonical workload classes", () => {
    expect(workloadClassFloorTable(base).map((row) => row.workloadClass)).toEqual(
      WORKLOAD_CLASSES,
    );
  });

  test("fails closed for a missing or legacy implementation class", () => {
    expect(() => floorForWorkloadClass(null, base)).toThrow(
      "implement requires one of the nine canonical workload classes",
    );
    for (const legacy of ["default", "hard-hard", "easy-easy", "medium-work"]) {
      expect(() => floorForWorkloadClass(legacy, base)).toThrow(
        `unknown workload class: ${legacy}`,
      );
    }
  });

  test("snapshot deletion remains a safe floor-zero rollback", () => {
    for (const row of workloadClassFloorTable(base)) {
      expect(row.capabilityFloor).toBe(0);
      expect(row.minimumFloor).toBe(0);
      expect(row.bandCeiling).toBeNull();
      expect(row.derivedFrom).toBeNull();
    }
  });

  test("workload classes do not select a read-only phase stack", () => {
    const explore = floorForWorkloadClass("hard-heavy", {
      ...base,
      capabilityRoute: "explore.read-only.v1",
    });
    expect(explore.workloadClass).toBe("hard-heavy");
    expect(explore.capabilityFloor).toBe(0);
  });
});
