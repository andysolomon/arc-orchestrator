import { describe, expect, test } from "bun:test";
import {
  candidateStackForRoute,
  stackRungs,
} from "../plugins/arc-orchestrator/lib/model-registry";
import {
  normalizeWorkloadClass,
  routesContract,
  WORKLOAD_CLASSES,
} from "../plugins/arc-orchestrator/lib/routes";
import {
  resolveRoutingPolicyMarker,
  RUNNER_ROUTING_V4_POLICY,
} from "../plugins/arc-orchestrator/lib/routing-intent";

const tail = [
  "cursor-kimi-k3@high",
  "minimax-m3@high",
  "composer-2.5@none",
];
const ids = (workloadClass: string) =>
  stackRungs(
    candidateStackForRoute(
      "implement.workspace-write.v1",
      null,
      workloadClass,
      "implement",
    )!,
  ).map((rung) => `${rung.stableId}@${rung.effort}`);

describe("runner-routing-v4", () => {
  test("advertises only v4 and the nine canonical workload classes", () => {
    const contract = routesContract({});
    expect(contract.arc_delegate_workload_classes).toEqual(WORKLOAD_CLASSES);
    expect(contract.routing_policy).toMatchObject({
      label: "runner-routing-v4",
      fallback: "availability-only",
      parent_local_phases: ["analyze"],
      cli_marker: { value: "runner-routing-v4" },
    });
  });

  // The approved 2026-08-31 OpenCode Go matrix: GLM 5.3 trails the hard and
  // medium chains, GLM 5.3 Flash leads medium-light and the easy chains, and
  // the emergency tail is unchanged.
  test("uses the exact approved implementation rung matrix", () => {
    expect(ids("hard-heavy")).toEqual([
      "fable-5.1@high",
      "gpt-5.6-sol@high",
      "cursor-grok-4.6-high@high",
      "opencode-go-glm-5.3@none",
      ...tail,
    ]);
    for (const klass of ["hard-medium", "hard-light", "medium-heavy"]) {
      expect(ids(klass)).toEqual([
        "gpt-5.6-sol@high",
        "cursor-grok-4.6-high@high",
        "opencode-go-glm-5.3@none",
        ...tail,
      ]);
    }
    expect(ids("medium-medium")).toEqual([
      "opus-5@high",
      "cursor-grok-4.6-high@high",
      "opencode-go-glm-5.3@none",
      ...tail,
    ]);
    expect(ids("medium-light")).toEqual([
      "opencode-go-glm-5.3-flash@none",
      "cursor-grok-4.6-high@high",
      "opus-4.8@low",
      "gpt-5.5@high",
      "opus-5@high",
      ...tail,
    ]);
    expect(ids("easy-heavy")).toEqual([
      "opencode-go-glm-5.3-flash@none",
      "opus-5@high",
      "gpt-5.6-luna@max",
      "opus-4.8@low",
      "opus-5@low",
      "cursor-grok-4.6-high@high",
      ...tail,
    ]);
    expect(ids("easy-medium")).toEqual([
      "opencode-go-glm-5.3-flash@none",
      "gpt-5.6-luna@max",
      "opus-4.8@low",
      "gpt-5.5@low",
      "cursor-grok-4.6-high@high",
      ...tail,
    ]);
    expect(ids("easy-light")).toEqual([
      "opencode-go-glm-5.3-flash@none",
      "gpt-5.5@low",
      "cursor-grok-4.6-high@high",
      ...tail,
    ]);
  });

  test("uses approved Explore/Research/Plan and Verify chains", () => {
    for (const phase of ["explore", "research", "plan"] as const) {
      expect(
        stackRungs(
          candidateStackForRoute("explore.read-only.v1", null, null, phase)!,
        ).map((rung) => `${rung.stableId}@${rung.effort}`),
      ).toEqual([
        "fable-5.1@high",
        "gpt-5.6-sol@high",
        "gpt-5.6-luna@max",
        "opencode-go-glm-5.3@none",
        ...tail,
      ]);
    }
    expect(
      stackRungs(
        candidateStackForRoute("check.read-only.v1", null, null, "verify")!,
      ).map((rung) => `${rung.stableId}@${rung.effort}`),
    ).toEqual([
      "gpt-5.6-luna@max",
      "gpt-5.5@low",
      "opencode-go-deepseek-v4-pro@none",
      "opus-4.8@low",
      "cursor-grok-4.6-high@high",
      ...tail,
    ]);
    // Deploy is unchanged by the OpenCode Go expansion.
    expect(
      stackRungs(
        candidateStackForRoute(
          "implement.workspace-write.v1",
          null,
          null,
          "deploy",
        )!,
      ).map((rung) => `${rung.stableId}@${rung.effort}`),
    ).toEqual(["gpt-5.5@low", "opus-4.8@low", "cursor-grok-4.6-high@high", ...tail]);
    expect(
      candidateStackForRoute("explore.read-only.v1", null, null, "analyze"),
    ).toBeNull();
  });

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
    expect(stack.candidates).toEqual(["cursor-grok-4.6-high"]);
    expect(stack.automaticFallback).toBe(false);
    expect(stackRungs(stack)).toEqual([
      { stableId: "cursor-grok-4.6-high", effort: "high" },
    ]);
  });
});
