import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const workflowPath = ".github/workflows/release.yml";

function read(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
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
});
