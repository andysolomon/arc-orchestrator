import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FEATURE_MATRIX,
  PARENT_MODEL_DEFAULTS,
} from "../plugins/orchestrator-core/feature-matrix";
import type { OrchestratorSurface } from "../plugins/orchestrator-core/prompt-factory";
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

function expectFableDefault(text: string): void {
  const normalized = text.toLowerCase();
  const hasDefaultParent =
    normalized.includes("default/recommended parent orchestrator") ||
    normalized.includes("default parent orchestrator") ||
    normalized.includes("use fable as the default parent orchestrator");
  expect(hasDefaultParent).toBe(true);
}

const COMPOSER_ECONOMY_CONTRACT_ASSERTIONS = [
  "--orchestrator composer",
  "(O) Composer -> opus-explore -> composer-implement -> opus-check",
  "True Composer-parent orchestration requires Cursor",
];

describe("feature parity matrix", () => {
  test("required artifacts exist on every surface", () => {
    for (const feature of FEATURE_MATRIX) {
      for (const [surface, status] of Object.entries(feature.surfaces) as [
        OrchestratorSurface,
        (typeof feature.surfaces)[OrchestratorSurface],
      ][]) {
        if (status.kind !== "required") {
          continue;
        }

        const artifactPaths = [
          status.path,
          ...(status.additionalPaths ?? []),
        ];
        for (const relativePath of artifactPaths) {
          const artifactPath = resolve(projectRoot, relativePath);
          expect(existsSync(artifactPath)).toBe(
            true,
            `missing ${surface} artifact for feature "${feature.id}" (${feature.name}): ${relativePath}`,
          );
        }
      }
    }
  });

  test("intentional differences document a non-empty rationale", () => {
    for (const feature of FEATURE_MATRIX) {
      for (const [surface, status] of Object.entries(feature.surfaces) as [
        OrchestratorSurface,
        (typeof feature.surfaces)[OrchestratorSurface],
      ][]) {
        if (status.kind !== "intentional-difference") {
          continue;
        }

        expect(status.rationale.trim().length).toBeGreaterThan(
          0,
          `empty rationale for intentional difference on ${surface} feature "${feature.id}"`,
        );
      }
    }
  });

  test("required feature assertions are present in their artifacts", () => {
    for (const feature of FEATURE_MATRIX) {
      for (const [surface, status] of Object.entries(feature.surfaces) as [
        OrchestratorSurface,
        (typeof feature.surfaces)[OrchestratorSurface],
      ][]) {
        if (status.kind !== "required" || !status.assertions) {
          continue;
        }

        const content = read(status.path);
        for (const assertion of status.assertions) {
          expect(content).toContain(
            assertion,
            `missing assertion for ${surface} feature "${feature.id}" in ${status.path}: ${assertion}`,
          );
        }
      }
    }
  });

  test("Composer orchestrator mode is referenced on every parent surface", () => {
    const feature = FEATURE_MATRIX.find(
      (entry) => entry.id === "composer-orchestrator-mode",
    );

    expect(feature?.surfaces.claude).toMatchObject({
      kind: "required",
      path: "plugins/fable-orchestrator/skills/orchestrate-composer/SKILL.md",
    });
    expect(feature?.surfaces.cursor).toMatchObject({
      kind: "required",
      path: "plugins/cursor-orchestrator/skills/orchestrate/SKILL.md",
    });
    expect(feature?.surfaces.pi).toMatchObject({
      kind: "required",
      path: "plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md",
    });
    expect(feature?.surfaces.copilot).toMatchObject({
      kind: "required",
      path: "plugins/copilot-orchestrator/copilot-instructions.md",
    });

    const surfacePaths = {
      claude: "plugins/fable-orchestrator/skills/orchestrate-composer/SKILL.md",
      cursor: "plugins/cursor-orchestrator/skills/orchestrate/SKILL.md",
      pi: "plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md",
      copilot: "plugins/copilot-orchestrator/copilot-instructions.md",
    } as const;
    for (const [surface, path] of Object.entries(surfacePaths)) {
      const content = read(path);
      expect(content.toLowerCase()).toContain("composer orchestrator");
      for (const assertion of COMPOSER_ECONOMY_CONTRACT_ASSERTIONS) {
        expect(content).toContain(assertion, `missing Composer economy guidance on ${surface}`);
      }
    }

    const matrix = read("docs/orchestrator/feature-parity-matrix.md");
    expect(matrix).toContain("Composer orchestrator mode");
    expect(matrix).toContain("Claude, Cursor, Pi, and Copilot all document the same explicit activation contract");
    for (const assertion of COMPOSER_ECONOMY_CONTRACT_ASSERTIONS) {
      expect(matrix).toContain(assertion);
    }
    const readme = read("README.md");
    expect(readme).toContain("Claude Code can use `/fable-orchestrator:orchestrate-composer`");
    expect(readme).toContain("Cursor can use `/orchestrate-composer`");
    expect(readme).toContain("Pi and Copilot can select the same runner identity");
    for (const assertion of COMPOSER_ECONOMY_CONTRACT_ASSERTIONS) {
      expect(readme).toContain(assertion);
    }
    expect(matrix).toContain("required: `plugins/fable-orchestrator/skills/orchestrate-composer/SKILL.md`");
    expect(matrix).toContain("required: `plugins/cursor-orchestrator/skills/orchestrate/SKILL.md`");
    expect(matrix).toContain("required: `plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md`");
    expect(matrix).toContain("required: `plugins/copilot-orchestrator/copilot-instructions.md`");
  });

  test("matrix covers every Mechanical ops task class on every parent surface", () => {
    const surfacePolicyPaths = {
      claude:
        "plugins/fable-orchestrator/skills/orchestrate/references/routing-policy.md",
      cursor: "plugins/cursor-orchestrator/skills/orchestrate/SKILL.md",
      pi: "plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md",
      copilot: "plugins/copilot-orchestrator/copilot-instructions.md",
    } as const;
    const semanticAssertions = [
      "`open-pr`",
      "`post-github-comment`",
      "`commit-push`",
      "`merge`",
      "four named mechanical-ops routes are active",
      "non-writing Composer 2.5 operation-plan proposal",
      "runner-side canonical argv validation",
      "shell-free execution of trusted `git` or `gh` binaries",
      "Composer 2.5 is the only proposal model for all four task classes",
      "no automatic fallback or model override",
      "must delegate every corresponding operation to its named mechanical-ops route",
      "Parents must never directly run",
      "only bounded exception",
      "Deployment remains prohibited for every route",
    ];

    for (const taskClass of [
      "open-pr",
      "post-github-comment",
      "commit-push",
      "merge",
    ]) {
      const feature = FEATURE_MATRIX.find(
        (entry) => entry.id === `mechanical-ops-${taskClass}`,
      );
      expect(feature?.name).toBe(`Mechanical ops: ${taskClass}`);
      for (const surface of ["claude", "cursor", "pi", "copilot"] as const) {
        expect(feature?.surfaces[surface]).toEqual({
          kind: "required",
          path: surfacePolicyPaths[surface],
          assertions: expect.any(Array),
        });
      }
    }

    for (const [surface, path] of Object.entries(surfacePolicyPaths)) {
      const policy = read(path);
      for (const assertion of semanticAssertions) {
        expect(policy).toContain(
          assertion,
          `missing Mechanical ops policy on ${surface} surface (${path}): ${assertion}`,
        );
      }
    }
  });

  test("Fable-first surfaces state Fable as the default parent", () => {
    for (const policy of PARENT_MODEL_DEFAULTS) {
      if (policy.defaultParent !== "fable") {
        continue;
      }

      for (const path of policy.assertionPaths) {
        const content = read(path);
        expectFableDefault(content);
      }
    }
  });

  test("Codex 5.6 Terra-first surfaces do not make Fable the default parent", () => {
    for (const policy of PARENT_MODEL_DEFAULTS) {
      if (policy.defaultParent !== "codex-5.6-terra") {
        continue;
      }

      for (const path of policy.assertionPaths) {
        const content = read(path);
        expect(content.toLowerCase()).toContain("codex 5.6 terra");
        expectNoFableDefault(content);
      }
    }
  });

  test("Codex 5.6 Sol-first surfaces do not make Fable the default parent", () => {
    for (const policy of PARENT_MODEL_DEFAULTS) {
      if (policy.defaultParent !== "codex-5.6-sol") {
        continue;
      }

      for (const path of policy.assertionPaths) {
        const content = read(path);
        expect(content.toLowerCase()).toContain("codex 5.6 sol");
        expectNoFableDefault(content);
      }
    }
  });

  test("Cursor documents parent fallback chain when Fable is unavailable", () => {
    const cursorPolicy = PARENT_MODEL_DEFAULTS.find(
      (entry) => entry.surface === "cursor",
    );

    expect(cursorPolicy?.defaultParent).toBe("fable");
    expect(cursorPolicy?.fallbackParents).toEqual([
      "codex-5.6-sol",
      "cursor-fable-high",
    ]);

    for (const path of cursorPolicy?.assertionPaths ?? []) {
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

    const readme = read("README.md");
    expect(readme).toContain("CC-Fable → Codex 5.6 Sol → Cursor-Fable-High");
    expect(readme).toContain("Run every parent tier at high reasoning effort");
    expect(readme).toContain("Copilot intentionally remains Codex 5.6 Terra-first");
  });

  test("parent model defaults cover all four surfaces", () => {
    const surfaces = new Set(PARENT_MODEL_DEFAULTS.map((entry) => entry.surface));
    expect(surfaces).toEqual(new Set(["claude", "cursor", "pi", "copilot"]));
  });

  test("generated policy surfaces match checked-in files", () => {
    expect(() => assertSurfacesFresh(projectRoot)).not.toThrow();
  });

  test("Cursor guidance distinguishes bounded Sol work from open-ended Opus critique", () => {
    for (const path of [
      "plugins/cursor-orchestrator/README.md",
      "plugins/cursor-orchestrator/commands/orchestrate.md",
      "plugins/cursor-orchestrator/commands/opus-review.md",
      "plugins/cursor-orchestrator/prompts/orchestrate.md",
      "plugins/cursor-orchestrator/prompts/opus-review.md",
      "plugins/cursor-orchestrator/rules/orchestrator.mdc",
      "plugins/cursor-orchestrator/skills/orchestrate/SKILL.md",
      "plugins/cursor-orchestrator/skills/opus-review/SKILL.md",
      "docs/orchestrator/cursor/file-focused-review.md",
      "docs/orchestrator/cursor/model-selection.md",
      "docs/orchestrator/cursor/opus-review.md",
      "docs/orchestrator/cursor/orchestrate.md",
    ]) {
      const content = read(path).toLowerCase();
      expect(content).toContain(
        "bounded taste-sensitive codex implementation/review against explicit criteria",
      );
      expect(content).toContain(
        "open-ended high-taste critique or design direction before criteria are fixed",
      );
    }
  });
});
