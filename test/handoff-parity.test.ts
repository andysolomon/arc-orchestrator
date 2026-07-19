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

  test("accepts valid failed handoff", () => {
    const sample = {
      status: "failed",
      summary: "Runner attempt errored before emitting structured output.",
      changes: [],
      verification: [],
      risks: ["Worker subprocess exited non-zero"],
      next_actions: ["Inspect runner stderr and retry with a narrower task"],
    };
    expect(validateHandoff(sample)).toBe(true);
  });

  test("rejects handoff missing a required key", () => {
    const bad = {
      status: "completed",
      summary: "Missing verification array.",
      changes: [],
      risks: [],
      next_actions: [],
    };
    expect(() => validateHandoff(bad)).toThrow(/Invalid Handoff/);
  });

  test("rejects handoff with status outside enum", () => {
    const bad = {
      status: "done",
      summary: "Invalid status value.",
      changes: [],
      verification: [],
      risks: [],
      next_actions: [],
    };
    expect(() => validateHandoff(bad)).toThrow(/Invalid Handoff/);
  });

  test("rejects handoff with extra property", () => {
    const bad = {
      status: "completed",
      summary: "Extra property forbidden by schema.",
      changes: [],
      verification: [],
      risks: [],
      next_actions: [],
      exit_code: 0,
    };
    expect(() => validateHandoff(bad)).toThrow(/Invalid Handoff/);
  });

  test("rejects handoff with changes as string instead of array", () => {
    const bad = {
      status: "completed",
      summary: "changes must be an array.",
      changes: "plugins/arc-orchestrator/bin/arc-orchestrator",
      verification: [],
      risks: [],
      next_actions: [],
    };
    expect(() => validateHandoff(bad)).toThrow(/Invalid Handoff/);
  });
});
