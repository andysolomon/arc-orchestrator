import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildDelegationPrompt,
  recommendedPromptFiles,
} from "../plugins/orchestrator-core/prompt-factory";
import { GENERATED_SURFACE_PATHS } from "../plugins/orchestrator-core/generate-surfaces";
import { assertSurfacesFresh } from "../plugins/orchestrator-core/surface-staleness";

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

describe("Cursor orchestrator plugin", () => {
  test("ships the three-tier Cursor parent policy across manifest, rules, skills, and prompts", () => {
    const manifest = JSON.parse(read("plugins/cursor-orchestrator/.cursor-plugin/plugin.json"));
    const readme = read("plugins/cursor-orchestrator/README.md");
    const rules = read("plugins/cursor-orchestrator/rules/orchestrator.mdc");
    const skill = read("plugins/cursor-orchestrator/skills/orchestrate/SKILL.md");
    const composerSkill = read(
      "plugins/fable-orchestrator/skills/orchestrate-composer/SKILL.md",
    );
    const composerCommand = read(
      "plugins/cursor-orchestrator/commands/orchestrate-composer.md",
    );
    const opusSkill = read("plugins/cursor-orchestrator/skills/opus-review/SKILL.md");
    const prompt = read("plugins/cursor-orchestrator/prompts/orchestrate.md");
    const opusPrompt = read("plugins/cursor-orchestrator/prompts/opus-review.md");

    expect(manifest.name).toBe("cursor-orchestrator");
    expect(readme).toContain("real Cursor plugin package");
    expect(rules).toContain("alwaysApply: true");
    expect(rules).toContain("use CC-Fable as the default parent orchestrator");
    expect(rules).toContain("Cursor Composer 2.5");
    expect(rules).toContain("Opus 4.8 review");
    expect(skill).toContain("name: orchestrate");
    expect(skill).toContain("Use CC-Fable as the default parent orchestrator");
    expect(skill).toContain("## Composer Orchestrator Mode");
    expect(skill).toContain(
      "Cursor carries this required policy because `(O) Composer` is Cursor-native",
    );
    expect(skill).toContain(
      "(O) Composer -> opus-explore -> composer-implement -> opus-check",
    );
    expect(skill).toContain(
      "explicitly exclude Fable, Codex 5.6 Sol, and default Codex workers",
    );
    expect(skill).toContain("remain on the economy stack unless a worker fails");
    expect(skill).toContain("No silent upgrade");
    expect(skill).toContain(
      "explicit parent decision before leaving the economy stack",
    );
    expect(skill).toContain("/orchestrate-composer <task>");
    expect(skill).toContain("The normal `/orchestrate <task>` command remains Fable-first");
    for (const surface of [composerSkill, composerCommand]) {
      expect(surface).toContain("FABLE_ORCHESTRATOR_ORCHESTRATOR=composer");
      expect(surface).toContain("--orchestrator composer");
      expect(surface).toContain("opus-explore");
      expect(surface).toContain("composer-implement");
      expect(surface).toContain("opus-check");
      expect(surface).toContain("Never silently upgrade");
    }
    expect(composerSkill).toContain("name: orchestrate-composer");
    expect(composerCommand).toContain("name: orchestrate-composer");
    expect(composerCommand).toContain("does not change that command's Fable-first default");
    expect(opusSkill).toContain("name: opus-review");
    expect(opusSkill).toContain("Use Opus 4.8");
    expect(prompt).toContain("Use the active parent tier to orchestrate");
    expect(prompt).toContain("FABLE_ORCHESTRATOR_COMPOSER_MODEL");
    expect(opusPrompt).toContain("Opus 4.8 as a read-only review worker");
  });
});

describe("parent orchestrator reasoning effort policy", () => {
  test("requires high reasoning for CC-Fable, Codex-Sol, and Cursor-Fable parents", () => {
    const claudePolicy = read("CLAUDE.md");
    const fableSkill = read("plugins/fable-orchestrator/skills/orchestrate/SKILL.md");
    const routingPolicy = read("plugins/fable-orchestrator/skills/orchestrate/references/routing-policy.md");
    const piSkill = read("plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md");
    const cursorFallbackSurfaces = [
      "plugins/cursor-orchestrator/skills/orchestrate/SKILL.md",
      "plugins/cursor-orchestrator/rules/orchestrator.mdc",
      "plugins/cursor-orchestrator/prompts/orchestrate.md",
      "plugins/cursor-orchestrator/commands/orchestrate.md",
      "plugins/cursor-orchestrator/README.md",
      "plugins/cursor-orchestrator/skills/prompt-factory/SKILL.md",
      "docs/orchestrator/feature-parity-matrix.md",
    ];
    const generatedCursorDocs = GENERATED_SURFACE_PATHS.filter((path) =>
      path.startsWith("docs/orchestrator/cursor/"),
    );

    expect(claudePolicy).toContain("Run the CC-Fable parent as Fable 5 at high reasoning effort (`high`)");
    expect(claudePolicy).toContain("must never be applied to the CC-Fable parent");
    expect(fableSkill).toContain("The CC-Fable parent must be Fable 5 at high reasoning effort (`high`)");
    expect(fableSkill).toContain("do not use low or unspecified/default effort for the parent session");
    expect(routingPolicy).toContain("Run the Codex-Sol parent fallback at high reasoning effort");
    expect(routingPolicy).toContain("`--effort high`");

    expect(piSkill).toContain("run that Codex-Sol parent session at high reasoning effort");
    expect(piSkill).toContain("Start Pi with `--effort high`");

    for (const path of cursorFallbackSurfaces) {
      const content = read(path);
      const chainStart = content.indexOf("CC-Fable");
      const codexFallback = content.indexOf("Codex 5.6 Sol", chainStart);
      const cursorFallback = content.indexOf("Cursor-Fable-High", codexFallback);

      expect(chainStart).toBeGreaterThanOrEqual(0);
      expect(codexFallback).toBeGreaterThan(chainStart);
      expect(cursorFallback).toBeGreaterThan(codexFallback);
      expect(content).toContain("Run every parent in this availability chain at high reasoning effort");
      expect(content).toContain("`--effort high`");
      expect(content.toLowerCase()).not.toContain("terra parent fallback");
    }

    expect(generatedCursorDocs.length).toBeGreaterThan(0);
    for (const path of generatedCursorDocs) {
      const content = read(path);
      const chain = "CC-Fable → Codex 5.6 Sol → Cursor-Fable-High";
      const chainStart = content.indexOf(chain);

      expect(chainStart).toBeGreaterThanOrEqual(0);
      expect(content).toContain(
        "Run every parent in this availability chain at high reasoning effort",
      );
      expect(content).toContain("`--effort high`");
      expect(content).toContain(
        "never use low or unspecified/default reasoning for a parent",
      );
      expect(content).not.toMatch(
        /Terra.{0,80}(?:parent|fallback)|(?:parent|fallback).{0,80}Terra/i,
      );
    }
  });
});

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
    const canonicalPrompt = read("plugins/orchestrator-core/prompts/pi-orchestrate.md");
    const promptPath = resolve(projectRoot, "plugins/pi-orchestrator/prompts/orchestrate.md");

    expect(lstatSync(promptPath).isSymbolicLink()).toBe(true);
    expect(realpathSync(promptPath)).toBe(
      resolve(projectRoot, "plugins/orchestrator-core/prompts/pi-orchestrate.md"),
    );
    expect(prompt).toBe(canonicalPrompt);

    expect(skill).toContain("name: arc-orchestrator");
    expect(skill).toContain("Codex 5.6 Sol");
    expect(skill).toContain("Fable is not required");
    expect(skill).toContain("--backend codex");
    expect(skill).toContain("--mode implement");
    expect(prompt).toContain("Codex 5.6 Sol as the default parent orchestrator");
    expect(prompt).toContain('argument-hint: "<task>"');
    expect(prompt).toContain("$ARGUMENTS");
    expect(prompt).not.toContain("{{task}}");
    expect(skill).toContain("gpt-5.5");
    expect(skill).toContain("gpt-5.6-luna");
    expect(skill).toContain("gpt-5.6-sol");
    expect(skill).toContain("Explicit model overrides always win.");
    expect(prompt).toContain("FABLE_ORCHESTRATOR_COMPOSER_MODEL");
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

    expect(prompt).toContain("Codex 5.6 Sol is the default parent orchestrator");
    expect(prompt).toContain("Route: codex/review");
    expect(prompt).toContain("Do not commit, push, merge, deploy, or edit secrets.");

    const files = recommendedPromptFiles({
      hasDocs: true,
      hasPlugins: true,
      hasTests: true,
    }).map((item) => item.file);

    expect(files).toContain("docs/orchestrator/plugin-surface-sync.md");
    expect(files).toContain("docs/orchestrator/implementation.md");
    expect(files).toContain("docs/orchestrator/model-selection.md");
    expect(files).toContain("docs/orchestrator/direct-worker.md");
    expect(files).toContain("docs/orchestrator/opus-review.md");
    expect(files).toContain("docs/orchestrator/test-strategy.md");
  });

  test("includes generated docs/orchestrator slash command files", () => {
    const files = [
      "repo-scan.md",
      "file-focused-review.md",
      "plugin-surface-sync.md",
      "implementation.md",
      "test-strategy.md",
      "model-selection.md",
      "direct-worker.md",
      "opus-review.md",
    ];

    for (const file of files) {
      const content = read(`docs/orchestrator/${file}`);
      expect(content).toContain("# ");
      expect(content).toContain("/fable-orchestrator:");
      expect(content).toContain("Label the run");
    }
  });
});

describe("Claude Code Opus review worker", () => {
  test("ships a high-taste read-only Opus review agent", () => {
    const agent = read("plugins/fable-orchestrator/agents/opus-review.md");
    const skill = read("plugins/fable-orchestrator/skills/orchestrate/SKILL.md");
    const routing = read("plugins/fable-orchestrator/skills/orchestrate/references/routing-policy.md");

    expect(agent).toContain("name: opus-review");
    expect(agent).toContain("model: opus");
    expect(agent).toContain("Opus 4.8 review worker");
    expect(agent).toContain("Do not edit files");
    expect(skill).toContain("fable-orchestrator:opus-review");
    expect(routing).toContain("Route to `opus-review`");
    expect(routing).toContain("UI/UX");
    expect(routing).toContain("API ergonomics");
  });
});

describe("Claude Code direct worker surface", () => {
  test("ships a direct worker skill for auto-mode wrapper blocks", () => {
    const skill = read("plugins/fable-orchestrator/skills/direct-worker/SKILL.md");

    expect(skill).toContain("name: direct-worker");
    expect(skill).toContain("auto-mode classification");
    expect(skill).toContain("Bash(fable-orchestrator run *)");
    expect(skill).toContain("Cursor did not return the required structured result");
  });
});

describe("Claude Code model-aware orchestration surface", () => {
  test("ships an explicit non-Fable parent orchestrator skill", () => {
    const skill = read("plugins/fable-orchestrator/skills/orchestrate-with-model/SKILL.md");
    const defaultSkill = read("plugins/fable-orchestrator/skills/orchestrate/SKILL.md");

    expect(skill).toContain("name: orchestrate-with-model");
    expect(skill).toContain("Fable 5 remains the default recommendation");
    expect(skill).toContain("Opus can also act as the parent orchestrator");
    expect(skill).toContain("without Fable");
    expect(defaultSkill).toContain("default/recommended parent orchestrator");
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

  test("uses Codex 5.6 Terra rather than Fable as the default orchestrator", () => {
    const files = [
      "plugins/copilot-orchestrator/copilot-instructions.md",
      "plugins/copilot-orchestrator/prompts/orchestrate.prompt.md",
      "plugins/copilot-orchestrator/prompts/review.prompt.md",
    ];

    for (const file of files) {
      const content = read(file);
      expect(content).toContain("Codex 5.6 Terra");
      expectNoFableDefault(content);
    }
  });
});

describe("policy surfaces: two-tier availability fallback", () => {
  test("README, CLAUDE.md, and orchestrate skill document grok-* workers", () => {
    for (const path of [
      "README.md",
      "CLAUDE.md",
      "plugins/fable-orchestrator/skills/orchestrate/SKILL.md",
    ]) {
      const content = read(path);
      expect(content).toContain("grok-explore");
      expect(content).toContain("grok-check");
      expect(content).toContain("grok-implement");
      expect(content.toLowerCase()).toContain("availability");
      expect(content.toLowerCase()).toContain("not taste escalation");
    }
  });
});

describe("generated surface staleness", () => {
  test("checked-in policy surfaces match generator output", () => {
    expect(() => assertSurfacesFresh(projectRoot)).not.toThrow();
  });
});
