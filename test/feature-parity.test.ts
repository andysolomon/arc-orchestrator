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
      const content = read(path).toLowerCase();
      expect(content).toContain("codex 5.6 sol");
      expect(content).toContain("cursor-fable-high");
      expect(content).toContain("fallback");
      expect(content).toContain("fable is unavailable");
    }
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
