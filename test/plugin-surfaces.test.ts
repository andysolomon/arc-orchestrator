import { describe, expect, test } from "bun:test";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { assertSurfacesFresh } from "../plugins/orchestrator-core/surface-staleness";

const projectRoot = resolve(import.meta.dir, "..");

function read(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

describe("Pi orchestrator package", () => {
  test("loads the canonical generated prompt and injects the task via $ARGUMENTS", () => {
    const prompt = read("plugins/pi-orchestrator/prompts/orchestrate.md");
    const promptPath = resolve(projectRoot, "plugins/pi-orchestrator/prompts/orchestrate.md");

    expect(lstatSync(promptPath).isSymbolicLink()).toBe(true);
    expect(realpathSync(promptPath)).toBe(
      resolve(projectRoot, "plugins/orchestrator-core/prompts/pi-orchestrate.md"),
    );

    expect(prompt).toContain("$ARGUMENTS");
  });
});

describe("generated surface staleness", () => {
  test("checked-in policy surfaces match generator output", () => {
    expect(() => assertSurfacesFresh(projectRoot)).not.toThrow();
  });
});
