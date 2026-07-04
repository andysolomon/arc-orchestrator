import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildDelegationPrompt,
  recommendedPromptFiles,
} from "../plugins/orchestrator-core/prompt-factory";

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

describe("Orchestrator prompt factory", () => {
  test("ships a surface-aware repo prompt-generation skill", () => {
    const skill = read("plugins/fable-orchestrator/skills/prompt-factory/SKILL.md");
    const reference = read(
      "plugins/fable-orchestrator/skills/prompt-factory/references/prompt-types.md",
    );

    expect(skill).toContain("name: prompt-factory");
    expect(skill).toContain("docs/orchestrator/");
    expect(skill).toContain("selected surface");
    expect(skill).toContain("Use Pi or Copilot only when requested");
    expect(reference).toContain("plugin-surface-sync.md");
    expect(reference).toContain("Prompt Quality Checks");
    expect(reference).toContain("How does the user copy/paste it in the selected surface?");
  });

  test("central factory builds durable cross-surface prompts", () => {
    const prompt = buildDelegationPrompt({
      surface: "pi",
      route: "codex/review",
      outcome: "Review generated orchestrator prompt files.",
      scope: ["docs/orchestrator"],
      invariants: ["Do not make Fable the default parent for Pi."],
      verification: ["Run bun test."],
      label: "prompt-factory-review",
    });

    expect(prompt).toContain("Codex 5.5 is the default parent orchestrator");
    expect(prompt).toContain("Route: codex/review");
    expect(prompt).toContain("Do not commit, push, merge, deploy, or edit secrets.");

    const files = recommendedPromptFiles({
      hasDocs: true,
      hasPlugins: true,
      hasTests: true,
    }).map((item) => item.file);

    expect(files).toContain("docs/orchestrator/plugin-surface-sync.md");
    expect(files).toContain("docs/orchestrator/implementation.md");
    expect(files).toContain("docs/orchestrator/test-strategy.md");
  });

  test("includes generated docs/orchestrator prompt files", () => {
    const files = [
      "repo-scan.md",
      "file-focused-review.md",
      "plugin-surface-sync.md",
      "implementation.md",
      "test-strategy.md",
    ];

    for (const file of files) {
      const content = read(`docs/orchestrator/${file}`);
      expect(content).toContain("# ");
      expect(content).toContain("/fable-orchestrator:");
      expect(content).toContain("Label the run");
    }
  });
});

describe("Claude Code observability surface", () => {
  test("ships a TUI-friendly observability skill", () => {
    const skill = read("plugins/fable-orchestrator/skills/observability/SKILL.md");

    expect(skill).toContain("name: observability");
    expect(skill).toContain("fable-orchestrator observability --limit 10");
    expect(skill).toContain("Laminar export requires");
    expect(skill).toContain("does not trace every parent Fable/Claude Code message");
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
