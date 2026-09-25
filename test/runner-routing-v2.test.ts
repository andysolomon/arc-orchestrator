import { describe, expect, test } from "bun:test";
import {
  candidateStackForRoute,
  stackRungs,
} from "../plugins/arc-orchestrator/lib/model-registry";
import { normalizeWorkloadClass } from "../plugins/arc-orchestrator/lib/routes";
import {
  resolveRoutingPolicyMarker,
  RUNNER_ROUTING_V4_POLICY,
} from "../plugins/arc-orchestrator/lib/routing-intent";

describe("runner-routing-v4", () => {
  test("rejects v2/v3 markers and accepts v4 only for automatic intent", () => {
    for (const marker of ["runner-routing-v2", "runner-routing-v3"]) {
      expect(
        resolveRoutingPolicyMarker({
          routingPolicy: marker,
          routingIntent: "automatic",
        }).ok,
      ).toBe(false);
    }
    expect(
      resolveRoutingPolicyMarker({
        routingPolicy: RUNNER_ROUTING_V4_POLICY,
        routingIntent: "automatic",
      }),
    ).toEqual({ ok: true, marker: RUNNER_ROUTING_V4_POLICY });
  });

  test("fails closed on parent-local Analyze and legacy classes", () => {
    expect(
      candidateStackForRoute("explore.read-only.v1", null, null, "analyze"),
    ).toBeNull();
    for (const legacy of ["default", "hard-hard", "easy-easy"]) {
      expect(normalizeWorkloadClass(legacy)).toBeNull();
    }
  });

  test("explicit aliases pin one candidate with no inherited fallback", () => {
    const stack = candidateStackForRoute(
      "implement.workspace-write.v1",
      "grok-implement",
      "hard-heavy",
      "implement",
    )!;
    expect(stack.candidates).toEqual(["cursor-grok-4.7-high"]);
    expect(stack.automaticFallback).toBe(false);
    expect(stackRungs(stack)).toEqual([
      { stableId: "cursor-grok-4.7-high", effort: "high" },
    ]);
  });
});
