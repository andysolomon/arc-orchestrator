import { describe, expect, test } from "bun:test";
import {
  MODEL_REGISTRY,
  MODEL_REGISTRY_ERROR,
  parseRungId,
  rungsFor,
  supportedEffortsFor,
  validateModelRegistry,
  validateShippedModelRegistry,
  type ModelRegistryEntry,
} from "../plugins/arc-orchestrator/lib/model-registry";

describe("model-registry: shipped data", () => {
  test("validates cleanly with zero errors", () => {
    const result = validateShippedModelRegistry();
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
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

  test.each([
    ["unknown effort", "gpt-6-sol@turbo"],
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

  test("transport-default and fixed-profile models each expose one honest rung", () => {
    expect(rungsFor(entryFor("composer-2.5"))).toEqual(["composer-2.5@none"]);
    expect(rungsFor(entryFor("cursor-grok-4.7-high"))).toEqual([
      "cursor-grok-4.7-high@high",
    ]);
  });

  test("an override may narrow adapter support", () => {
    const narrowed: ModelRegistryEntry = {
      ...entryFor("gpt-6-sol"),
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
      ...entryFor("gpt-6-sol"),
      stableId: "invalid",
      displayName: "Invalid",
      aliases: [],
      supportedEfforts: efforts,
    } as unknown as ModelRegistryEntry;
    const result = validateModelRegistry([entry], []);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain(expected);
  });
});
