import { describe, expect, test } from "bun:test";
import { buildComposerCommand } from "../plugins/fable-orchestrator/lib/spawn-adapter";

describe("spawn-adapter: buildComposerCommand", () => {
  test("uses --force for implement mode", () => {
    const command = buildComposerCommand({
      cursorBinary: "cursor-agent",
      profile: { model: "composer-2.5" },
      mode: "implement",
      cwd: "/tmp/workspace",
      prompt: "Implement the task",
    });

    expect(command).toEqual([
      "cursor-agent",
      "--print",
      "--output-format",
      "json",
      "--model",
      "composer-2.5",
      "--workspace",
      "/tmp/workspace",
      "--force",
      "Implement the task",
    ]);
  });

  test("uses plan mode for analyze and review read-only enforcement", () => {
    for (const mode of ["analyze", "review"] as const) {
      const command = buildComposerCommand({
        cursorBinary: "cursor-agent",
        profile: { model: "grok-4.5" },
        mode,
        cwd: "/tmp/workspace",
        prompt: "Read-only task",
      });

      expect(command).toContain("--mode");
      expect(command).toContain("plan");
      expect(command).not.toContain("--force");
      expect(command).toContain("grok-4.5");
    }
  });
});
