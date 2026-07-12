import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildDelegationPrompt } from "../plugins/orchestrator-core/prompt-factory";

const projectRoot = resolve(import.meta.dir, "..");

function read(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

const SHARED_INPUT = {
  route: "codex/review" as const,
  outcome: "Review generated orchestrator prompt files.",
  scope: ["docs/orchestrator"],
  invariants: ["Do not change unrelated plugin surfaces."],
  verification: ["Run bun test."],
  label: "prompt-factory-parity",
};

const STRUCTURE_SECTIONS = [
  "## Outcome",
  "## Scope",
  "## Invariants",
  "## Verification",
  "## Prohibitions",
  "## Safe Label",
];

const DEFAULT_PROHIBITION =
  "Do not commit, push, merge, deploy, or edit secrets.";

describe("Cursor prompt-factory parity", () => {
  test("ships a Cursor prompt-factory skill aligned with docs/orchestrator", () => {
    const skillPath = "plugins/cursor-orchestrator/skills/prompt-factory/SKILL.md";
    expect(existsSync(resolve(projectRoot, skillPath))).toBe(true);

    const skill = read(skillPath);
    expect(skill).toContain("name: prompt-factory");
    expect(skill).toContain("docs/orchestrator/");
    expect(skill).toContain("Default to the Cursor surface");
    expect(skill).toContain("plugins/orchestrator-core/prompt-factory.ts");
    expect(skill).toContain("CC-Fable → Codex 5.6 Sol → Cursor-Fable-High");
    expect(skill).toContain("Require every Cursor parent tier to use high reasoning");
  });

  test("buildDelegationPrompt cursor surface emits the ordered high-reasoning parent chain", () => {
    const prompt = buildDelegationPrompt({
      surface: "cursor",
      ...SHARED_INPUT,
    });

    const chainStart = prompt.indexOf("CC-Fable");
    const codexTier = prompt.indexOf("Codex 5.6 Sol", chainStart);
    const cursorTier = prompt.indexOf("Cursor-Fable-High", codexTier);

    expect(chainStart).toBeGreaterThanOrEqual(0);
    expect(codexTier).toBeGreaterThan(chainStart);
    expect(cursorTier).toBeGreaterThan(codexTier);
    expect(prompt).toContain("Run every parent tier at high reasoning effort");
    expect(prompt).toContain("`--effort high`");
    expect(prompt).toContain("active parent chat");
    expect(prompt).not.toContain("Claude Code Fable orchestrator plugin");
    expect(prompt).not.toContain("Codex 5.6 Terra is the default parent orchestrator");
  });

  test("generated Cursor orchestration prompt preserves the ordered high-reasoning parent chain", () => {
    const prompt = read("plugins/cursor-orchestrator/prompts/orchestrate.md");
    const chainStart = prompt.indexOf("CC-Fable");
    const codexFallback = prompt.indexOf("Codex 5.6 Sol", chainStart);
    const cursorFallback = prompt.indexOf("Cursor-Fable-High", codexFallback);

    expect(chainStart).toBeGreaterThanOrEqual(0);
    expect(codexFallback).toBeGreaterThan(chainStart);
    expect(cursorFallback).toBeGreaterThan(codexFallback);
    expect(prompt).toContain("Run every parent in this availability chain at high reasoning effort");
    expect(prompt).toContain("`--effort high`");
    expect(prompt.toLowerCase()).not.toContain("terra parent fallback");
  });

  test("cross-surface prompts share structure, prohibitions, and surface-specific intros", () => {
    const surfaces = ["claude", "cursor", "pi", "copilot"] as const;
    const prompts = Object.fromEntries(
      surfaces.map((surface) => [
        surface,
        buildDelegationPrompt({ surface, ...SHARED_INPUT }),
      ]),
    ) as Record<(typeof surfaces)[number], string>;

    for (const surface of surfaces) {
      const prompt = prompts[surface];
      for (const section of STRUCTURE_SECTIONS) {
        expect(prompt).toContain(section);
      }
      expect(prompt).toContain(SHARED_INPUT.outcome);
      expect(prompt).toContain(`- ${SHARED_INPUT.scope[0]}`);
      expect(prompt).toContain(`- ${SHARED_INPUT.invariants[0]}`);
      expect(prompt).toContain(`- ${SHARED_INPUT.verification[0]}`);
      expect(prompt).toContain(DEFAULT_PROHIBITION);
      expect(prompt).toContain(`Route: ${SHARED_INPUT.route}`);
      expect(prompt).toContain(`# Orchestrator Prompt: ${SHARED_INPUT.label}`);
    }

    expect(prompts.claude).toContain("Claude Code Fable orchestrator plugin");
    expect(prompts.claude).not.toContain("Codex 5.6 Terra is the default parent orchestrator");

    expect(prompts.cursor).toContain("CC-Fable → Codex 5.6 Sol → Cursor-Fable-High");
    expect(prompts.cursor).not.toContain("Claude Code");
    expect(prompts.cursor).not.toContain("Codex 5.6 Terra is the default parent orchestrator");

    expect(prompts.pi).toContain("Codex 5.6 Sol is the default parent orchestrator");
    expect(prompts.pi).not.toContain("Claude Code Fable orchestrator plugin");

    expect(prompts.copilot).toContain("Codex 5.6 Terra is the default parent orchestrator");
    expect(prompts.copilot).not.toContain("Claude Code Fable orchestrator plugin");
  });
});
