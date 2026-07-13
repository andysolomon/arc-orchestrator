import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  GENERATED_SURFACE_PATHS,
  generateAllSurfaces,
} from "./generate-surfaces";

export function regenerateToTemp(rootDir: string): string {
  const tempDir = mkdtempSync(join(tmpdir(), "orchestrator-surfaces-"));
  generateAllSurfaces(rootDir, { outputRoot: tempDir });
  return tempDir;
}

export function compareGeneratedSurfaces(
  rootDir: string,
  tempDir: string,
): { mismatches: string[] } {
  const mismatches: string[] = [];

  for (const relativePath of GENERATED_SURFACE_PATHS) {
    const expectedPath = join(rootDir, relativePath);
    const generatedPath = join(tempDir, relativePath);

    let expected: string;
    let generated: string;

    try {
      expected = readFileSync(expectedPath, "utf8");
    } catch {
      mismatches.push(`${relativePath}: missing checked-in file`);
      continue;
    }

    try {
      generated = readFileSync(generatedPath, "utf8");
    } catch {
      mismatches.push(`${relativePath}: missing generated file`);
      continue;
    }

    if (expected !== generated) {
      mismatches.push(`${relativePath}: content differs from generator output`);
    }
  }

  return { mismatches };
}

export function assertSurfacesFresh(rootDir: string): void {
  const resolvedRoot = resolve(rootDir);
  const tempDir = regenerateToTemp(resolvedRoot);
  const { mismatches } = compareGeneratedSurfaces(resolvedRoot, tempDir);

  if (mismatches.length > 0) {
    throw new Error(
      `Generated surfaces are stale. Run: pnpm exec bun plugins/orchestrator-core/generate-surfaces.ts\n${mismatches.join("\n")}`,
    );
  }
}
