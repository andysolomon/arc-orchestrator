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
  "minimax-m3",
  "kimi-2.6",
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

  test("uses schema version 1", () => {
    expect(MODEL_REGISTRY_SCHEMA_VERSION).toBe(1);
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

  test("composer-2.5 is available and eligible for implement plus mechanical routes", () => {
    const entry = entryById("composer-2.5");
    expect(entry.maturity).toBe("available");
    expect(entry.routeEligibility).toContain("implement.workspace-write.v1");
    expect(entry.routeEligibility).toEqual(
      expect.arrayContaining([
        "mechanical-post-comment.workspace-write.v1",
        "mechanical-commit-push.workspace-write.v1",
        "mechanical-merge.workspace-write.v1",
      ]),
    );
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

  test("fable-5 and sonnet-5 are route-ineligible", () => {
    expect(entryById("fable-5").routeEligibility).toEqual([]);
    expect(entryById("sonnet-5").routeEligibility).toEqual([]);
  });

  test("fable-5 is parent-only", () => {
    expect(entryById("fable-5").roleRestriction).toBe("parent-only");
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

  test("candidate stacks mirror decision 0002 exactly", () => {
    const byRoute = Object.fromEntries(
      CANDIDATE_STACKS.map((stack) => [
        stack.route,
        { candidates: stack.candidates, automaticFallback: stack.automaticFallback },
      ]),
    );
    expect(byRoute).toEqual({
      "implement.workspace-write.v1": {
        candidates: ["composer-2.5", "gpt-5.5", "opus-4.8"],
        automaticFallback: true,
      },
      "explore.read-only.v1": {
        candidates: ["gpt-5.6-luna", "opus-4.8"],
        automaticFallback: true,
      },
      "check.read-only.v1": {
        candidates: ["gpt-5.5", "opus-4.8"],
        automaticFallback: true,
      },
      "taste-review.read-only.v1": {
        candidates: ["opus-4.8"],
        automaticFallback: false,
      },
      "mechanical-post-comment.workspace-write.v1": {
        candidates: ["composer-2.5"],
        automaticFallback: false,
      },
      "mechanical-commit-push.workspace-write.v1": {
        candidates: ["composer-2.5"],
        automaticFallback: false,
      },
      "mechanical-merge.workspace-write.v1": {
        candidates: ["composer-2.5"],
        automaticFallback: false,
      },
    });
    for (const stack of CANDIDATE_STACKS.filter(
      (candidate) => !candidate.route.startsWith("mechanical-"),
    )) {
      expect(stack.policyVersion).toBe("candidate-stacks/v1");
    }
    for (const stack of CANDIDATE_STACKS.filter((candidate) =>
      candidate.route.startsWith("mechanical-"),
    )) {
      expect(stack.policyVersion).toBe("mechanical-ops-sandbox/v1");
    }
  });

  test("numericPricing null everywhere is accepted", () => {
    for (const entry of MODEL_REGISTRY) {
      expect(entry.numericPricing).toBeNull();
    }
    expect(validateShippedModelRegistry().ok).toBe(true);
  });
});
