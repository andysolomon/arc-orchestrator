import { describe, expect, test } from "bun:test";
import { handoffSchema, validateHandoff } from "arc-contracts";
import rawHandoffSchema from "arc-contracts/schema/handoff.schema.json";

describe("handoff parity", () => {
  test("embedded handoffSchema matches handoff.schema.json", () => {
    expect(handoffSchema).toEqual(rawHandoffSchema as Record<string, unknown>);
  });

  test("accepts valid completed handoff", () => {
    const sample = {
      status: "completed",
      summary: "Added arc-contracts dependency and handoff parity test.",
      changes: ["plugins/arc-orchestrator/bin/arc-orchestrator"],
      verification: ["bun test passed"],
      risks: [],
      next_actions: [],
    };
    expect(validateHandoff(sample)).toBe(true);
  });

  test("accepts valid blocked handoff", () => {
    const sample = {
      status: "blocked",
      summary: "Cannot resolve arc-contracts link on this machine.",
      changes: [],
      verification: [],
      risks: ["arc-contracts not linked globally"],
      next_actions: [
        "Run bun link inside arc-board arc-contracts package",
        "Run bun install in arc-orchestrator",
      ],
    };
    expect(validateHandoff(sample)).toBe(true);
  });
});
