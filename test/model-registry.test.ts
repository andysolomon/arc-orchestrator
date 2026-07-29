import { describe, expect, test } from "bun:test";
import {
  CANDIDATE_STACKS,
  MODEL_REGISTRY,
  MODEL_REGISTRY_ERROR,
  MODEL_REGISTRY_SCHEMA_VERSION,
  effortsSupportedOnBackend,
  parseRungId,
  rungId,
  rungsFor,
  supportedEffortsFor,
  validateModelRegistry,
  validateShippedModelRegistry,
  type ModelRegistryEntry,
} from "../plugins/arc-orchestrator/lib/model-registry";
import { EFFORT_LEVELS } from "../plugins/arc-orchestrator/lib/trace-schema";

const SCREENSHOT_ONLY_STABLE_IDS = [
  "haiku-4.5",
  "qwen-3-235b",
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
  const entry = MODEL_REGISTRY.find(
    (candidate) => candidate.stableId === stableId,
  );
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

  test("Cursor Grok 4.5 High is available with explore, implement, and check eligibility", () => {
    const entry = entryById("cursor-grok-4.5-high");
    expect(entry.maturity).toBe("available");
    expect(entry.transportBackend).toBe("composer");
    expect(entry.adapterId).toBe("cursor-agent");
    expect(entry.providerModelId).toBe("cursor-grok-4.5-high");
    expect(entry.routeEligibility).toEqual([
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
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

  test("opus-5 is the only taste-review-eligible entry", () => {
    const tasteEligible = MODEL_REGISTRY.filter((entry) =>
      entry.routeEligibility.includes("taste-review.read-only.v1"),
    );
    expect(tasteEligible.map((entry) => entry.stableId)).toEqual(["opus-5"]);
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

  test("kimi-k3 remains an explicit OpenCode route while direct Moonshot Kimi powers automatic phase stacks", () => {
    const openCode = entryById("kimi-k3");
    expect(openCode.maturity).toBe("available");
    expect(openCode.transportBackend).toBe("opencode");
    expect(openCode.providerModelId).toBe("moonshotai/kimi-k3");
    expect(openCode.adapterId).toBe("opencode");
    expect(openCode.routeEligibility).toEqual([
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
    ]);
    expect(openCode.aliases).toEqual(
      expect.arrayContaining(["Kimi K3", "moonshotai/kimi-k3"]),
    );

    const anthropic = entryById("kimi-k3-anthropic");
    expect(anthropic.maturity).toBe("available");
    expect(anthropic.routeEligibility).toEqual([
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
    ]);
    expect(anthropic.transportBackend).toBe("kimi");
    expect(anthropic.providerModelId).toBe("kimi-k3[1m]");
    expect(anthropic.adapterId).toBe("claude-cli");
    expect(anthropic.displayName).toBe("Kimi K3 Anthropic");
    expect(anthropic.aliases).toEqual(
      expect.arrayContaining(["kimi-k3[1m]", "Kimi K3 Anthropic"]),
    );
    expect(
      CANDIDATE_STACKS.some((stack) =>
        stack.candidates.includes("kimi-k3-anthropic"),
      ),
    ).toBe(true);
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

  test("taste-review stack has automaticFallback false and exactly opus-5", () => {
    const stack = CANDIDATE_STACKS.find(
      (candidate) => candidate.route === "taste-review.read-only.v1",
    );
    expect(stack).toBeDefined();
    expect(stack?.automaticFallback).toBe(false);
    expect(stack?.candidates).toEqual(["opus-5"]);
  });

  test("candidate stacks mirror the phase-aware ARC Delegate directives", () => {
    expect(
      CANDIDATE_STACKS.every(
        (stack) => stack.policyVersion === "runner-routing-v3",
      ),
    ).toBe(true);
    expect(
      CANDIDATE_STACKS.filter(
        (stack) =>
          stack.route === "implement.workspace-write.v1" &&
          stack.phase === "implement" &&
          stack.workloadClass !== "default" &&
          !stack.workloadClass?.endsWith("-work"),
      ).map((stack) => [stack.workloadClass, stack.candidates]),
    ).toEqual([
      [
        "hard-hard",
        [
          "fable-5",
          "gpt-5.6-sol",
          "cursor-fable-high",
          "kimi-k3-anthropic",
          "cursor-grok-4.5-high",
        ],
      ],
      [
        "hard-medium",
        ["gpt-5.6-sol", "fable-5", "cursor-fable-high", "kimi-k3-anthropic"],
      ],
      [
        "hard-easy",
        ["gpt-5.6-sol", "fable-5", "cursor-fable-medium", "kimi-k3-anthropic"],
      ],
      [
        "medium-hard",
        [
          "gpt-5.6-sol",
          "kimi-k3-anthropic",
          "opus-5",
          "cursor-sol-high",
          "cursor-grok-4.5-high",
        ],
      ],
      [
        "medium-medium",
        ["opus-5", "kimi-k3-anthropic", "gpt-5.6-sol", "cursor-grok-4.5-high"],
      ],
      [
        "medium-easy",
        [
          "opus-5",
          "kimi-k3-anthropic",
          "gpt-5.6-terra",
          "cursor-grok-4.5-high",
        ],
      ],
      [
        "easy-hard",
        ["gpt-5.6-terra", "kimi-k3-anthropic", "cursor-grok-4.5-high"],
      ],
      ["easy-medium", ["gpt-5.5", "opus-4.8", "composer-2.5"]],
      ["easy-easy", ["gpt-5.5", "opus-4.8", "minimax-m3", "composer-2.5"]],
    ]);
    expect(
      CANDIDATE_STACKS.find((stack) => stack.phase === "explore"),
    ).toMatchObject({
      candidates: [
        "opus-5",
        "kimi-k3-anthropic",
        "cursor-grok-4.5-high",
        "gpt-5.6-sol",
      ],
      automaticFallback: true,
    });
    expect(
      CANDIDATE_STACKS.find((stack) => stack.phase === "verify"),
    ).toMatchObject({
      candidates: [
        "opus-5",
        "opus-4.8",
        "gpt-5.5",
        "cursor-grok-4.5-low",
        "minimax-m3",
        "composer-2.5",
      ],
      automaticFallback: true,
    });
    expect(
      CANDIDATE_STACKS.some((stack) => stack.route.includes("mechanical-")),
    ).toBe(false);
  });

  test("numericPricing null everywhere is accepted", () => {
    for (const entry of MODEL_REGISTRY) {
      expect(entry.numericPricing).toBeNull();
    }
    expect(validateShippedModelRegistry().ok).toBe(true);
  });
});

// ADR 0010 phase 13.1. Rungs are declared but nothing selects on them yet.
describe("rungs and effort support", () => {
  const entryFor = (stableId: string): ModelRegistryEntry => {
    const entry = MODEL_REGISTRY.find((e) => e.stableId === stableId);
    if (!entry) {
      throw new Error(`missing registry entry: ${stableId}`);
    }
    return entry;
  };

  test("rungId and parseRungId round-trip", () => {
    expect(rungId("gpt-5.6-sol", "max")).toBe("gpt-5.6-sol@max");
    expect(parseRungId("gpt-5.6-sol@max")).toEqual({
      stableId: "gpt-5.6-sol",
      effort: "max",
    });
  });

  test.each([
    ["no separator", "gpt-5.6-sol"],
    ["unknown effort", "gpt-5.6-sol@turbo"],
    ["empty effort", "gpt-5.6-sol@"],
    ["empty stableId", "@max"],
  ])("parseRungId rejects %s", (_label, id) => {
    expect(parseRungId(id)).toBeNull();
  });

  test("stableIds containing @ split on the last separator", () => {
    expect(parseRungId("weird@name@high")).toEqual({
      stableId: "weird@name",
      effort: "high",
    });
  });

  test("codex and claude expose the whole ladder; other transports expose none", () => {
    expect(supportedEffortsFor(entryFor("gpt-5.6-sol"))).toEqual([
      ...EFFORT_LEVELS,
    ]);
    // Phase 13.1b wired CLAUDE_CODE_EFFORT_LEVEL on the claude branch, so opus-5
    // — ADR 0010's headline example — finally has a selectable ladder.
    expect(supportedEffortsFor(entryFor("opus-5"))).toEqual([...EFFORT_LEVELS]);
    // Claimed support must track what spawn-adapter actually forwards. Cursor
    // sets no effort flag at all, so declaring support for these would assert a
    // capability the runner does not have.
    expect(supportedEffortsFor(entryFor("composer-2.5"))).toEqual([]);
    expect(supportedEffortsFor(entryFor("cursor-grok-4.5-high"))).toEqual([]);
  });

  // ARC Delegate uses only the MiniMax efforts requested by phase stacks.
  test("minimax exposes its ARC Delegate effort subset", () => {
    expect(effortsSupportedOnBackend("minimax")).toEqual([
      "low",
      "high",
      "max",
    ]);
  });

  test("direct kimi exposes the phase policy effort ladder", () => {
    expect(supportedEffortsFor(entryFor("kimi-k3-anthropic"))).toEqual([
      "medium",
      "high",
      "max",
    ]);
  });

  test("a model with no selectable effort still has exactly one rung, at @none", () => {
    expect(rungsFor(entryFor("composer-2.5"))).toEqual(["composer-2.5@none"]);
    expect(rungsFor(entryFor("cursor-grok-4.5-high"))).toEqual([
      "cursor-grok-4.5-high@none",
    ]);
  });

  // Note the shape difference from grok-4.5 above: both entries list `@none`,
  // but for grok it is the fallback name for "no effort is selectable", while
  // for opus-5 it is a level the transport genuinely accepts.
  test("opus-5 now has the full ladder ADR 0010 selects over", () => {
    expect(rungsFor(entryFor("opus-5"))).toEqual([
      "opus-5@none",
      "opus-5@low",
      "opus-5@medium",
      "opus-5@high",
      "opus-5@xhigh",
      "opus-5@max",
    ]);
  });

  test("a codex model has one rung per effort level", () => {
    expect(rungsFor(entryFor("gpt-5.6-sol"))).toEqual([
      "gpt-5.6-sol@none",
      "gpt-5.6-sol@low",
      "gpt-5.6-sol@medium",
      "gpt-5.6-sol@high",
      "gpt-5.6-sol@xhigh",
      "gpt-5.6-sol@max",
    ]);
  });

  test("every shipped entry produces at least one rung", () => {
    for (const entry of MODEL_REGISTRY) {
      expect(rungsFor(entry).length).toBeGreaterThan(0);
    }
  });

  test("effortsSupportedOnBackend is derived, not hardcoded", () => {
    expect(effortsSupportedOnBackend("codex")).toEqual([...EFFORT_LEVELS]);
    expect(effortsSupportedOnBackend("claude")).toEqual([...EFFORT_LEVELS]);
    expect(effortsSupportedOnBackend("kimi")).toEqual([
      "medium",
      "high",
      "max",
    ]);
    expect(effortsSupportedOnBackend("minimax")).toEqual([
      "low",
      "high",
      "max",
    ]);
    for (const backend of ["composer", "opencode"] as const) {
      expect(effortsSupportedOnBackend(backend)).toEqual([]);
    }
  });

  test("an override may narrow adapter support", () => {
    const narrowed: ModelRegistryEntry = {
      ...entryFor("gpt-5.6-sol"),
      stableId: "narrowed",
      displayName: "Narrowed",
      aliases: [],
      supportedEfforts: ["high", "max"],
    };
    expect(supportedEffortsFor(narrowed)).toEqual(["high", "max"]);
    expect(validateModelRegistry([narrowed], []).ok).toBe(true);
  });

  test("an override may not widen beyond what the adapter can forward", () => {
    const widened: ModelRegistryEntry = {
      ...entryFor("composer-2.5"),
      stableId: "widened",
      displayName: "Widened",
      aliases: [],
      supportedEfforts: ["max"],
    };
    const result = validateModelRegistry([widened], []);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain(
      MODEL_REGISTRY_ERROR.EFFORT_UNSUPPORTED_BY_BACKEND,
    );
  });

  test.each([
    ["unknown level", ["turbo"], MODEL_REGISTRY_ERROR.UNKNOWN_EFFORT_LEVEL],
    [
      "duplicate level",
      ["high", "high"],
      MODEL_REGISTRY_ERROR.DUPLICATE_EFFORT_LEVEL,
    ],
  ])("validation rejects %s", (_label, efforts, expected) => {
    const entry = {
      ...entryFor("gpt-5.6-sol"),
      stableId: "invalid",
      displayName: "Invalid",
      aliases: [],
      supportedEfforts: efforts,
    } as unknown as ModelRegistryEntry;
    const result = validateModelRegistry([entry], []);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain(expected);
  });

  test("the shipped registry validates with effort declarations in place", () => {
    expect(validateShippedModelRegistry().ok).toBe(true);
  });
});
