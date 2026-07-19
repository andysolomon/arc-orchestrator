import { describe, expect, test } from "bun:test";
import {
  CANDIDATE_STACKS,
  MODEL_REGISTRY,
  MODEL_REGISTRY_SCHEMA_VERSION,
  validateShippedModelRegistry,
  type ModelRegistryEntry,
} from "../plugins/fable-orchestrator/lib/model-registry";

const SCREENSHOT_ONLY_STABLE_IDS = [
  "haiku-4.5",
  "qwen-3-235b",
  "5.4-nano",
  "5.4-mini",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
] as const;

const REQUIRED_ENTRY_KEYS: Array<keyof ModelRegistryEntry> = [
  "stableId",
  "family",
  "version",
  "publisher",
  "servingProvider",
  "providerModelId",
  "transportBackend",
  "adapterId",
  "adapterVersion",
  "endpoint",
  "region",
  "authAccountScope",
  "runnerSupport",
  "routeEligibility",
  "sandboxPermissionSupport",
  "outputContracts",
  "maturity",
  "provenance",
  "priceBand",
  "numericPricing",
  "aliases",
  "displayName",
  "roleRestriction",
  "evidence",
];

function entryById(stableId: string): ModelRegistryEntry {
  const entry = MODEL_REGISTRY.find((candidate) => candidate.stableId === stableId);
  if (!entry) {
    throw new Error(`Missing registry entry: ${stableId}`);
  }
  return entry;
}

describe("model-registry: shipped data", () => {
  test("validates cleanly with zero errors", () => {
    const result = validateShippedModelRegistry();
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("uses schema version 2", () => {
    expect(MODEL_REGISTRY_SCHEMA_VERSION).toBe(2);
  });

  test("every entry carries required identity, evidence, and pricing fields", () => {
    for (const entry of MODEL_REGISTRY) {
      for (const key of REQUIRED_ENTRY_KEYS) {
        expect(Object.hasOwn(entry, key)).toBe(true);
      }
      expect(Array.isArray(entry.provenance.sources)).toBe(true);
      expect(
        entry.provenance.verificationResult === "verified" ||
          entry.provenance.verificationResult === "unverified",
      ).toBe(true);
      expect("approver" in entry.provenance).toBe(true);
      expect("capturedAt" in entry.provenance).toBe(true);
    }
  });

  test("composer-2.5 is available and eligible for explore/implement/check", () => {
    const entry = entryById("composer-2.5");
    expect(entry.maturity).toBe("available");
    expect(entry.routeEligibility).toEqual([
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
    ]);
  });

  test("grok-4.5 is available with explore, check, and implement eligibility", () => {
    const entry = entryById("grok-4.5");
    expect(entry.maturity).toBe("available");
    expect(entry.transportBackend).toBe("composer");
    expect(entry.adapterId).toBe("cursor-agent");
    expect(entry.providerModelId).toBe("grok-4.5");
    expect(entry.routeEligibility).toEqual([
      "explore.read-only.v1",
      "check.read-only.v1",
      "implement.workspace-write.v1",
    ]);
    expect(entry.sandboxPermissionSupport).toEqual([
      "read-only",
      "workspace-write",
    ]);
    expect(entry.evidence).not.toBeNull();
  });

  test("gpt-5.6-luna is eligible for explore.read-only.v1", () => {
    const entry = entryById("gpt-5.6-luna");
    expect(entry.routeEligibility).toContain("explore.read-only.v1");
  });

  test("opus-4.8 is the only taste-review-eligible entry", () => {
    const tasteEligible = MODEL_REGISTRY.filter((entry) =>
      entry.routeEligibility.includes("taste-review.read-only.v1"),
    );
    expect(tasteEligible.map((entry) => entry.stableId)).toEqual(["opus-4.8"]);
  });

  test("sonnet-5 is route-ineligible while fable-5 is ADR-eligible", () => {
    expect(entryById("sonnet-5").routeEligibility).toEqual([]);
    expect(entryById("fable-5").routeEligibility).toEqual([
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
    ]);
  });

  test("fable-5 and gpt-5.6-sol are unrestricted ADR workers", () => {
    expect(entryById("fable-5").roleRestriction).toBeNull();
    expect(entryById("gpt-5.6-sol").roleRestriction).toBeNull();
  });

  test("screenshot-only entries are planned with empty route eligibility", () => {
    for (const stableId of SCREENSHOT_ONLY_STABLE_IDS) {
      const entry = entryById(stableId);
      expect(entry.maturity).toBe("planned");
      expect(entry.routeEligibility).toEqual([]);
    }
  });

  test("no registry label or stack candidate matches /glm/i", () => {
    const labels: string[] = [];
    for (const entry of MODEL_REGISTRY) {
      labels.push(entry.stableId, entry.displayName, ...entry.aliases);
    }
    for (const stack of CANDIDATE_STACKS) {
      labels.push(...stack.candidates);
    }
    for (const label of labels) {
      expect(/glm/i.test(label)).toBe(false);
    }
  });

  test("taste-review stack has automaticFallback false and exactly opus-4.8", () => {
    const stack = CANDIDATE_STACKS.find(
      (candidate) => candidate.route === "taste-review.read-only.v1",
    );
    expect(stack).toBeDefined();
    expect(stack?.automaticFallback).toBe(false);
    expect(stack?.candidates).toEqual(["opus-4.8"]);
  });

  test("candidate stacks mirror decision 0004 runner-routing-v2", () => {
    expect(
      CANDIDATE_STACKS.every((stack) => stack.policyVersion === "runner-routing-v2"),
    ).toBe(true);
    expect(
      CANDIDATE_STACKS.filter((stack) => stack.route === "implement.workspace-write.v1")
        .map((stack) => [stack.workloadClass, stack.candidates, stack.automaticFallback]),
    ).toEqual([
      ["default", ["composer-2.5"], false],
      ["light-work", ["grok-4.5"], false],
      ["medium-light-work", ["opus-4.8", "gpt-5.5", "kimi-k3", "grok-4.5", "minimax-m3", "composer-2.5"], true],
      ["medium-work", ["gpt-5.5", "opus-4.8", "kimi-k3", "grok-4.5", "minimax-m3", "composer-2.5"], true],
      ["medium-hard-work", ["gpt-5.6-terra", "fable-5", "cursor-fable-high", "kimi-k3", "minimax-m3", "composer-2.5"], true],
      ["hard-light-work", ["gpt-5.6-sol", "fable-5", "cursor-fable-high", "kimi-k3", "minimax-m3", "composer-2.5"], true],
      ["hard-work", ["fable-5", "gpt-5.6-sol", "cursor-fable-high", "kimi-k3", "minimax-m3", "composer-2.5"], true],
    ]);
    const readOnly = ["fable-5", "gpt-5.6-sol", "kimi-k3", "cursor-fable-high", "grok-4.5", "minimax-m3", "composer-2.5"];
    expect(
      CANDIDATE_STACKS.find((stack) => stack.route === "explore.read-only.v1"),
    ).toMatchObject({ candidates: readOnly, automaticFallback: true });
    expect(
      CANDIDATE_STACKS.find((stack) => stack.route === "check.read-only.v1"),
    ).toMatchObject({ candidates: readOnly, automaticFallback: true });
    expect(CANDIDATE_STACKS.some((stack) => stack.route.includes("mechanical-"))).toBe(false);
  });

  test("numericPricing null everywhere is accepted", () => {
    for (const entry of MODEL_REGISTRY) {
      expect(entry.numericPricing).toBeNull();
    }
    expect(validateShippedModelRegistry().ok).toBe(true);
  });
});
