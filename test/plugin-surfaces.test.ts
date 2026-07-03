import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");

function read(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

function expectNoFableDefault(text: string): void {
  const normalized = text.toLowerCase();
  expect(normalized).not.toContain("use fable as the default");
  expect(normalized).not.toContain("fable is the default parent");
  expect(normalized).not.toContain("fable is the default orchestrator");
}

describe("Pi orchestrator package", () => {
  test("declares a Pi package with skills and prompts", () => {
    const manifest = JSON.parse(read("plugins/pi-orchestrator/package.json"));

    expect(manifest.name).toBe("arc-orchestrator-pi");
    expect(manifest.keywords).toContain("pi-package");
    expect(manifest.pi.skills).toContain("./skills");
    expect(manifest.pi.prompts).toContain("./prompts");
  });

  test("ships a Codex-first skill and prompt", () => {
    const skill = read("plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md");
    const prompt = read("plugins/pi-orchestrator/prompts/orchestrate.md");

    expect(skill).toContain("name: arc-orchestrator");
    expect(skill).toContain("Codex 5.5");
    expect(skill).toContain("Fable is not required");
    expect(skill).toContain("--backend codex");
    expect(skill).toContain("--mode implement");
    expect(prompt).toContain("Codex 5.5 as the default parent orchestrator");
    expectNoFableDefault(skill);
    expectNoFableDefault(prompt);
  });
});

describe("Copilot orchestrator package", () => {
  test("ships instructions and prompt files", () => {
    expect(
      existsSync(resolve(projectRoot, "plugins/copilot-orchestrator/copilot-instructions.md")),
    ).toBe(true);
    expect(
      existsSync(resolve(projectRoot, "plugins/copilot-orchestrator/prompts/orchestrate.prompt.md")),
    ).toBe(true);
    expect(
      existsSync(resolve(projectRoot, "plugins/copilot-orchestrator/prompts/review.prompt.md")),
    ).toBe(true);
  });

  test("uses Codex 5.5 rather than Fable as the default orchestrator", () => {
    const files = [
      "plugins/copilot-orchestrator/copilot-instructions.md",
      "plugins/copilot-orchestrator/prompts/orchestrate.prompt.md",
      "plugins/copilot-orchestrator/prompts/review.prompt.md",
    ];

    for (const file of files) {
      const content = read(file);
      expect(content).toContain("Codex 5.5");
      expectNoFableDefault(content);
    }
  });
});
