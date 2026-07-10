import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const setupSkillPath = "plugins/cursor-orchestrator/skills/setup/SKILL.md";
const observabilitySkillPath =
  "plugins/cursor-orchestrator/skills/observability/SKILL.md";
const cliPath = "plugins/fable-orchestrator/bin/fable-orchestrator";

const REAL_SUBCOMMANDS = [
  "run",
  "annotate",
  "runs",
  "report",
  "observability",
  "doctor",
] as const;

function read(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

function mentionedSubcommands(text: string): string[] {
  const matches = text.matchAll(/fable-orchestrator\s+([a-z][a-z-]*)/g);
  return [...matches].map((match) => match[1]);
}

describe("Cursor setup and observability skills", () => {
  test("ships a setup skill that verifies both backends and warns against sudo", () => {
    expect(existsSync(resolve(projectRoot, setupSkillPath))).toBe(true);

    const skill = read(setupSkillPath);

    expect(skill).toContain("name: setup");
    expect(skill).toContain("Codex");
    expect(skill).toContain("Cursor Agent");
    expect(skill).toContain("cursor-agent");
    expect(skill).toContain("sudo");
    expect(skill).toContain("fable-orchestrator doctor --json");
    expect(skill).toContain("codex login status");
    expect(skill).toContain("gpt-5.6-terra");
    expect(skill).toContain("gpt-5.6-luna");
    expect(skill).toContain("gpt-5.6-sol");
    expect(skill).toContain("FABLE_ORCHESTRATOR_COMPOSER_MODEL");
    expect(skill).toContain("taste-sensitive");
    expect(skill).toMatch(
      /\*\*Codex CLI\*\*:[\s\S]*?reports `gpt-5\.6-terra`, `gpt-5\.6-luna`, and `gpt-5\.6-sol` as available in the `codex\.models` block\./,
    );
    expect(skill).toMatch(
      /\*\*Cursor Agent\*\*[\s\S]*?reports only `composer-2\.5` in the `composer\.models` block\./,
    );
  });

  test("ships an observability skill with Laminar boundaries and Cursor chat limits", () => {
    expect(existsSync(resolve(projectRoot, observabilitySkillPath))).toBe(true);

    const skill = read(observabilitySkillPath);

    expect(skill).toContain("name: observability");
    expect(skill).toContain("Laminar");
    expect(skill).toContain("evaluations, not traces");
    expect(skill).toContain("does not trace every parent Cursor chat message");
    expect(skill).toContain("fable-orchestrator observability --limit 10");
    expect(skill).toContain("fable-orchestrator report --group-by model");
    expect(skill).toContain("fable-orchestrator runs --limit 20");
  });

  test("mentions only real fable-orchestrator CLI subcommands", () => {
    const setupSkill = read(setupSkillPath);
    const observabilitySkill = read(observabilitySkillPath);
    const cliSource = read(cliPath);

    for (const subcommand of REAL_SUBCOMMANDS) {
      expect(cliSource).toContain(`fable-orchestrator ${subcommand}`);
    }

    const mentioned = [
      ...mentionedSubcommands(setupSkill),
      ...mentionedSubcommands(observabilitySkill),
    ];

    expect(mentioned.length).toBeGreaterThan(0);
    for (const subcommand of mentioned) {
      expect(REAL_SUBCOMMANDS).toContain(subcommand);
    }
  });
});
