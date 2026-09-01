import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const workflowPath = ".github/workflows/release.yml";
const mergeGateWorkflowPath = ".github/workflows/merge.yml";

// arc-board's arc-story-queue root manifest declares these workspaces, and
// `bun install` inside packages/arc-contracts resolves the parent manifest,
// so the vendor sparse-checkout must materialize all of them (W-000104).
const REQUIRED_VENDOR_WORKSPACES = [
  "arc-story-queue/packages/arc-contracts",
  "arc-story-queue/mcp-server",
  "arc-story-queue/app",
];

function read(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

function sparseCheckoutPaths(workflow: string): string[] {
  const lines = workflow.split("\n");
  const keyLine = lines.findIndex((line) =>
    /^\s*sparse-checkout:\s*\|\s*$/.test(line),
  );
  if (keyLine === -1) return [];
  const keyIndent = lines[keyLine].search(/\S/);
  const paths: string[] = [];
  for (const line of lines.slice(keyLine + 1)) {
    if (line.trim() === "") continue;
    if (line.search(/\S/) <= keyIndent) break;
    paths.push(line.trim());
  }
  return paths;
}

describe("Release workflow", () => {
  test("release.yml exists and triggers on push to main", () => {
    expect(existsSync(resolve(projectRoot, workflowPath))).toBe(true);

    const workflow = read(workflowPath);
    expect(workflow).toMatch(/^\s*push:\s*$/m);
    expect(workflow).toMatch(/^\s*branches:\s*$/m);
    expect(workflow).toContain("- main");
  });

  test("grants write permissions for contents, issues, and pull requests", () => {
    const workflow = read(workflowPath);
    expect(workflow).toMatch(/contents:\s*write/);
    expect(workflow).toMatch(/issues:\s*write/);
    expect(workflow).toMatch(/pull-requests:\s*write/);
  });

  test("checks out full git history for semantic-release", () => {
    const workflow = read(workflowPath);
    expect(workflow).toMatch(/fetch-depth:\s*0/);
  });

  test("uses the release deploy key so the version push bypasses the ruleset (W-000036)", () => {
    const workflow = read(workflowPath);
    expect(workflow).toContain("ssh-key: ${{ secrets.RELEASE_DEPLOY_KEY }}");
    // The secrets context is unavailable in if: conditionals, so the guard
    // must flow through a job env flag.
    expect(workflow).toContain(
      "HAS_RELEASE_DEPLOY_KEY: ${{ secrets.RELEASE_DEPLOY_KEY != '' }}",
    );
    expect(workflow).toContain("if: ${{ env.HAS_RELEASE_DEPLOY_KEY == 'true' }}");
    // Fallback checkout keeps pre-deploy-key behavior when the secret is absent.
    expect(workflow).toContain("if: ${{ env.HAS_RELEASE_DEPLOY_KEY != 'true' }}");
    expect(workflow).not.toMatch(/if:\s*\$\{\{\s*secrets\./);
  });

  test("sparse-checkout materializes every required arc-story-queue workspace (W-000104)", () => {
    const releasePaths = sparseCheckoutPaths(read(workflowPath));
    const mergeGatePaths = sparseCheckoutPaths(read(mergeGateWorkflowPath));

    // The passing Merge Gate is the reference setup: Release must check out
    // at least the same vendor paths so `bun install` inside arc-contracts
    // finds every arc-story-queue workspace declared by its root manifest.
    expect(mergeGatePaths).toEqual(
      expect.arrayContaining(REQUIRED_VENDOR_WORKSPACES),
    );
    expect(releasePaths).toEqual(expect.arrayContaining(mergeGatePaths));
    expect(releasePaths).toEqual(
      expect.arrayContaining(REQUIRED_VENDOR_WORKSPACES),
    );
  });
});
