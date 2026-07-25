import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { PUBLIC_ALIAS_BINDINGS } from "../plugins/arc-orchestrator/lib/capability-routes";

const ROOT = resolve(import.meta.dir, "..");

// `codex-*`, `sol-*`, and `terra-*` were removed as public aliases so an
// explicit `--route` cannot bypass the automatic ADR fallback chain. Guidance
// that still names them sends the parent model to a route the runner rejects at
// dispatch — the exact drift that shipped to arc-pi and had to be reverted
// downstream. Codex is reached through `--backend codex --mode <mode>` or the
// automatic `workload_class` stacks instead.
const REMOVED_ALIAS_PATTERN = /(?<![\w-])(?:sol|codex|terra)-(?:explore|implement|check)(?![\w-])/g;

// Dated records describe what was true when written; they are not live guidance
// and must not be rewritten to match current routing.
const HISTORICAL_RECORDS = new Set([
  "IMPLEMENTATION_PLAN.md",
  "docs/orchestrator/model-tier-routing-plan.md",
]);

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "test",
  "docs/orchestrator/decisions",
]);

function guidanceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry);
    const relativePath = relative(ROOT, absolute);
    if (SKIPPED_DIRECTORIES.has(entry) || SKIPPED_DIRECTORIES.has(relativePath)) {
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

  it("are absent from the public alias bindings the runner will dispatch", () => {
    const aliases = PUBLIC_ALIAS_BINDINGS.map((binding) => binding.alias);
    for (const removed of [
      "sol-explore",
      "sol-implement",
      "sol-check",
      "codex-explore",
      "codex-implement",
      "codex-check",
      "terra-implement",
    ]) {
      expect(aliases).not.toContain(removed);
    }
  });
});
