import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

// These obsolete identities must reject rather than silently redirect to a
// current model. Stable `sol-*` is intentionally live again under v4.
const REMOVED_ALIAS_PATTERN = /(?<![\w-])(?:codex|terra|cursor-fable|gpt-5\.6-sol|gpt-5\.6-luna|opus-5|grok-4\.[56]|cursor-grok-4\.[56]-high)-(?:explore|implement|check)(?![\w-])/g;

// Dated records describe what was true when written; they are not live guidance
// and must not be rewritten to match current routing.
const HISTORICAL_RECORDS = new Set([
  "IMPLEMENTATION_PLAN.md",
  "docs/orchestrator/model-tier-routing-plan.md",
]);

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "test",
  "docs/orchestrator/decisions",
]);

// Dot-directories are tooling and vendored third-party checkouts (`.git`,
// `.vendor`) whose prose this repo does not own. CI materializes `.vendor`
// even though a local clone usually has not.
function isSkipped(entry: string, relativePath: string): boolean {
  return (
    entry.startsWith(".") ||
    SKIPPED_DIRECTORIES.has(entry) ||
    SKIPPED_DIRECTORIES.has(relativePath)
  );
}

function guidanceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry);
    const relativePath = relative(ROOT, absolute);
    if (isSkipped(entry, relativePath)) {
      continue;
    }
    if (statSync(absolute).isDirectory()) {
      guidanceFiles(absolute, found);
      continue;
    }
    if (entry.endsWith(".md") && !HISTORICAL_RECORDS.has(relativePath)) {
      found.push(relativePath);
    }
  }
  return found;
}

describe("removed route aliases", () => {
  it("are absent from every live guidance surface", () => {
    const offenders: string[] = [];
    for (const relativePath of guidanceFiles(ROOT)) {
      const content = readFileSync(join(ROOT, relativePath), "utf8");
      for (const match of content.matchAll(REMOVED_ALIAS_PATTERN)) {
        offenders.push(`${relativePath}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
