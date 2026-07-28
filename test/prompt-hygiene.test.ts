import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { OrchestratorSurface } from "../plugins/orchestrator-core/prompt-factory";

const projectRoot = resolve(import.meta.dir, "..");

const SURFACES: OrchestratorSurface[] = ["claude", "cursor", "pi", "copilot"];

const RUNTIME_SKILL_PATHS = [
  "plugins/arc-orchestrator/skills/claude-runtime/SKILL.md",
  "plugins/arc-orchestrator/skills/codex-runtime/SKILL.md",
  "plugins/arc-orchestrator/skills/composer-runtime/SKILL.md",
  "plugins/arc-orchestrator/skills/grok-runtime/SKILL.md",
] as const;

function discoverClaudeAgentPaths(): string[] {
  const agentsDir = resolve(projectRoot, "plugins/arc-orchestrator/agents");
  return readdirSync(agentsDir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => `plugins/arc-orchestrator/agents/${name}`);
}

function buildSurfaceWorkerPromptPaths(): Record<OrchestratorSurface, string[]> {
  return {
    claude: [...discoverClaudeAgentPaths(), ...RUNTIME_SKILL_PATHS],
    cursor: [
      "plugins/cursor-orchestrator/skills/opus-review/SKILL.md",
      "plugins/cursor-orchestrator/commands/opus-review.md",
      "plugins/cursor-orchestrator/prompts/opus-review.md",
    ],
    pi: [],
    copilot: [],
  };
}

const SURFACE_WORKER_PROMPT_PATHS = buildSurfaceWorkerPromptPaths();

const FORBIDDEN_PATTERNS: RegExp[] = [
  /\bescalate\b/i,
  /state machine/i,
  /state-machine/i,
  /\bTaskState\b/,
  /\bTaskStateName\b/,
  /\bTerminalStateName\b/,
  /\bTaskEvent\b/,
  /\bTaskEffect\b/,
  /\bTaskTransition\b/,
  /\bTransitionRejection\b/,
  /\bTransitionExplanation\b/,
  /\bTaskStepInput\b/,
  /\bTaskPolicy\b/,
  /\bTaskBudgetPolicy\b/,
  /\bEscalationAuthorization\b/,
  /\bVerificationVerdict\b/,
  /\bVerificationEvidence\b/,
  /\bVerificationMode\b/,
  /fail-quality/,
  /fail-approach/,
  /fail-blocked/,
  /escalation_of/,
  /task-events\.jsonl/,
  /TASK_EVENTS_SCHEMA/,
  /TASK_MACHINE_SCHEMA/,
  /TASK_TRANSITION_TABLE/,
  /dispatch-selected/,
  /dispatch-completed/,
  /escalation-authorized/,
  /escalation-denied/,
  /transition table/i,
];

type Violation = { surface: OrchestratorSurface; path: string; match: string };

function read(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

function scanForForbiddenVocabulary(
  surface: OrchestratorSurface,
  relativePath: string,
  content: string,
): Violation[] {
  const violations: Violation[] = [];
  for (const pattern of FORBIDDEN_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      violations.push({
        surface,
        path: relativePath,
        match: match[0],
      });
    }
  }
  return violations;
}

describe("worker prompt hygiene (ADR 0011 §7)", () => {
  test("surface map covers claude, cursor, pi, and copilot worker prompts", () => {
    for (const surface of SURFACES) {
      expect(SURFACE_WORKER_PROMPT_PATHS[surface]).toBeDefined();
    }

    const claudeAgents = discoverClaudeAgentPaths();
    expect(claudeAgents.length).toBeGreaterThanOrEqual(8);
    expect(SURFACE_WORKER_PROMPT_PATHS.claude.length).toBe(
      claudeAgents.length + RUNTIME_SKILL_PATHS.length,
    );
    expect(SURFACE_WORKER_PROMPT_PATHS.pi).toHaveLength(0);
    expect(SURFACE_WORKER_PROMPT_PATHS.copilot).toHaveLength(0);

    for (const relativePath of SURFACE_WORKER_PROMPT_PATHS.cursor) {
      expect(existsSync(resolve(projectRoot, relativePath))).toBe(
        true,
        `missing cursor worker prompt: ${relativePath}`,
      );
    }
  });

  test("worker prompts contain no task-lifecycle state-machine vocabulary", () => {
    const violations: Violation[] = [];

    for (const surface of SURFACES) {
      const paths = SURFACE_WORKER_PROMPT_PATHS[surface];
      for (const relativePath of paths) {
        const absolutePath = resolve(projectRoot, relativePath);
        expect(existsSync(absolutePath)).toBe(
          true,
          `missing ${surface} worker prompt: ${relativePath}`,
        );
        const content = read(relativePath);
        violations.push(
          ...scanForForbiddenVocabulary(surface, relativePath, content),
        );
      }
    }

    if (violations.length > 0) {
      const detail = violations
        .map((v) => `${v.surface}: ${v.path} matched "${v.match}"`)
        .join("\n");
      expect(violations, detail).toEqual([]);
    }
  });
});
