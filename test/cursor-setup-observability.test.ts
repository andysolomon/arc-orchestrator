import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const setupSkillPath = "plugins/cursor-orchestrator/skills/setup/SKILL.md";
const observabilitySkillPath =
  "plugins/cursor-orchestrator/skills/observability/SKILL.md";
const cliPath = "plugins/arc-orchestrator/bin/arc-orchestrator";

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
  // Same-line only: avoid matching `LMNR_PROJECT_NAME=arc-orchestrator\nexport ...`.
  const matches = text.matchAll(/arc-orchestrator[ \t]+([a-z][a-z-]*)/g);
  return [...matches].map((match) => match[1]);
}

describe("Cursor setup and observability skills", () => {
  test("mentions only real arc-orchestrator CLI subcommands", () => {
    const setupSkill = read(setupSkillPath);
    const observabilitySkill = read(observabilitySkillPath);
    const cliSource = read(cliPath);

    for (const subcommand of REAL_SUBCOMMANDS) {
      expect(cliSource).toContain(`arc-orchestrator ${subcommand}`);
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
