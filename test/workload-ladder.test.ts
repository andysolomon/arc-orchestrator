import { describe, expect, it } from "bun:test";
import {
  CANDIDATE_STACKS,
  stackRungs,
} from "../plugins/arc-orchestrator/lib/model-registry";
import { WORKLOAD_CLASSES } from "../plugins/arc-orchestrator/lib/routes";

describe("runner-routing-v4 workload matrix", () => {
  it("defines exactly one implementation stack for every canonical class", () => {
    const stacks = CANDIDATE_STACKS.filter(
      (stack) =>
        stack.route === "implement.workspace-write.v1" &&
        stack.phase === "implement",
    );
    expect(stacks.map((stack) => stack.workloadClass)).toEqual(WORKLOAD_CLASSES);
  });

  it("uses stableId+effort rung identity and permits only distinct duplicates", () => {
    for (const stack of CANDIDATE_STACKS) {
      const ids = stackRungs(stack).map(
        (rung) => `${rung.stableId}@${rung.effort}`,
      );
      expect(new Set(ids).size).toBe(ids.length);
    }
    const easyHeavy = CANDIDATE_STACKS.find(
      (stack) => stack.workloadClass === "easy-heavy",
    )!;
    expect(
      stackRungs(easyHeavy)
        .filter((rung) => rung.stableId === "opus-5")
        .map((rung) => rung.effort),
    ).toEqual(["high", "low"]);
  });
});
