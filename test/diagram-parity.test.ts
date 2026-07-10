import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FEATURE_MATRIX,
  PARENT_MODEL_DEFAULTS,
} from "../plugins/orchestrator-core/feature-matrix";
import type { OrchestratorSurface } from "../plugins/orchestrator-core/prompt-factory";

const projectRoot = resolve(import.meta.dir, "..");
const HARNESS_MAP_PATH = "docs/diagrams/harness-overview.mermaid.md";

// Visual simplifications in the diagrams are allowed; this test binds only the
// harness list and parent-default tokens via the parity-anchor table.

function read(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

function parityAnchorRowPattern(
  surface: OrchestratorSurface,
  defaultParent: string,
  fallbackParent?: string,
): RegExp {
  const fallback = fallbackParent
    ? `[\\s\\S]*?\`?${escapeRegex(fallbackParent)}\`?`
    : `[\\s\\S]*?(?:—|-)`;
  return new RegExp(
    `\\|\\s*\`${escapeRegex(surface)}\`\\s*\\|\\s*\`${escapeRegex(defaultParent)}\`\\s*\\|${fallback}\\s*\\|`,
    "i",
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("harness overview diagram parity", () => {
  test("harness overview map exists", () => {
    expect(existsSync(resolve(projectRoot, HARNESS_MAP_PATH))).toBe(true);
  });

  test("parity-anchor table matches PARENT_MODEL_DEFAULTS", () => {
    const map = read(HARNESS_MAP_PATH);

    for (const policy of PARENT_MODEL_DEFAULTS) {
      const pattern = parityAnchorRowPattern(
        policy.surface,
        policy.defaultParent,
        policy.fallbackParent,
      );
      expect(map).toMatch(
        pattern,
        `missing or mismatched parity-anchor row for surface "${policy.surface}"`,
      );
    }
  });

  test("every FEATURE_MATRIX surface appears in the map", () => {
    const map = read(HARNESS_MAP_PATH);
    const surfaces = new Set<OrchestratorSurface>();

    for (const feature of FEATURE_MATRIX) {
      for (const surface of Object.keys(feature.surfaces) as OrchestratorSurface[]) {
        surfaces.add(surface);
      }
    }

    for (const surface of surfaces) {
      expect(map).toContain(
        surface,
        `harness overview map missing surface key "${surface}" from FEATURE_MATRIX`,
      );
    }
  });

  test("docs/diagrams/README.md links to the harness overview map", () => {
    const readme = read("docs/diagrams/README.md");
    expect(readme).toContain("harness-overview.mermaid.md");
  });

  test("docs/architecture.md references the harness overview map first", () => {
    const architecture = read("docs/architecture.md");
    const visualRefIndex = architecture.indexOf("Visual references:");
    expect(visualRefIndex).toBeGreaterThanOrEqual(0);

    const afterVisualRefs = architecture.slice(visualRefIndex);
    const harnessLinkIndex = afterVisualRefs.indexOf("harness-overview.mermaid.md");
    const excalidrawLinkIndex = afterVisualRefs.indexOf("diagrams/README.md");
    const mermaidLinkIndex = afterVisualRefs.indexOf("diagrams/mermaid.md");

    expect(harnessLinkIndex).toBeGreaterThanOrEqual(0);
    expect(excalidrawLinkIndex).toBeGreaterThanOrEqual(0);
    expect(mermaidLinkIndex).toBeGreaterThanOrEqual(0);
    expect(harnessLinkIndex).toBeLessThan(excalidrawLinkIndex);
    expect(harnessLinkIndex).toBeLessThan(mermaidLinkIndex);
  });
});
