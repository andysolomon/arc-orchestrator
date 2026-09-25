import { describe, expect, test } from "bun:test";
import {
  ROLLOUT_HUMAN_APPROVED_ENV,
  ROLLOUT_HUMAN_APPROVED_EXACT_VALUE,
  ROLLOUT_STAGE_ENV,
  ROLLOUT_TRACE_V2_DISABLE_ENV,
  assertRolloutGuardrailsForStage,
  resolveSelectionStage,
  resolveTraceV2Writing,
  LEGACY_TRACE_V2_ENV,
} from "../plugins/arc-orchestrator/lib/rollout-gates";

const humanApprovedEnv = {
  [ROLLOUT_HUMAN_APPROVED_ENV]: ROLLOUT_HUMAN_APPROVED_EXACT_VALUE,
};

describe("rollout-gates: legacy precedence and rollback flags", () => {
  test("legacy trace v2 env disables writing before rollout rollback reapplies", () => {
    expect(
      resolveTraceV2Writing({
        [ROLLOUT_STAGE_ENV]: "fixture",
        [LEGACY_TRACE_V2_ENV]: "0",
      }),
    ).toBe(false);
    expect(
      resolveTraceV2Writing({
        [ROLLOUT_STAGE_ENV]: "fixture",
        [LEGACY_TRACE_V2_ENV]: "1",
        [ROLLOUT_TRACE_V2_DISABLE_ENV]: "0",
      }),
    ).toBe(false);
  });

  test("human approval gates activation but not trace v2", () => {
    const env = { [ROLLOUT_STAGE_ENV]: "default" };
    expect(resolveSelectionStage(env)).toBe("off");
    expect(resolveTraceV2Writing(env)).toBe(true);
    expect(
      resolveSelectionStage({ ...env, ...humanApprovedEnv }),
    ).toBe("active");
  });
});

describe("rollout-gates: guardrails", () => {
  test("live registry and stacks pass rollout guardrails at every stage including fixture", () => {
    for (const stage of [
      null,
      "fixture",
      "shadow",
      "opt-in",
      "limited-cohort",
      "default",
    ] as const) {
      const result = assertRolloutGuardrailsForStage(stage);
      expect(result.ok).toBe(true);
      expect(result.violations).toEqual([]);
    }
  });
});
