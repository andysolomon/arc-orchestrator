import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");

const protectionScript = resolve(
  projectRoot,
  "scripts/configure-main-branch-protection.sh",
);
const bypassScript = resolve(
  projectRoot,
  "scripts/configure-release-bypass-ruleset.sh",
);
const docsPath = resolve(projectRoot, "docs/branch-protection.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("branch protection scripts", () => {
  test("configure-main-branch-protection.sh exists and is executable bash", () => {
    expect(existsSync(protectionScript)).toBe(true);
    const content = read(protectionScript);
    expect(content).toMatch(/^#!\/usr\/bin\/env bash/);
    expect(content).toContain("set -euo pipefail");
  });

  test("protection script configures a ruleset with PR, status checks, and GitHub Actions bypass", () => {
    const content = read(protectionScript);
    expect(content).toContain("Main branch protection");
    expect(content).toContain("pull_request");
    expect(content).toContain("required_status_checks");
    expect(content).toContain("Merge Gate");
    expect(content).toContain("strict_required_status_checks_policy");
    expect(content).toContain("bypass_actors");
    expect(content).toContain("Integration");
    expect(content).toContain("always");
    expect(content).toContain("non_fast_forward");
    expect(content).toContain("deletion");
    expect(content).toContain("gh repo view --json nameWithOwner");
    expect(content).toContain("repos/${REPO}/rulesets");
    expect(content).toContain("branches/main/protection");
    expect(content).toContain("-X DELETE");
    expect(content).toContain("--dry-run");
    expect(content).toContain("GITHUB_ACTIONS_APP_SLUG");
    expect(content).toContain("/apps/${GITHUB_ACTIONS_APP_SLUG}");
  });

  test("configure-release-bypass-ruleset.sh no longer exists (superseded by main ruleset)", () => {
    expect(existsSync(bypassScript)).toBe(false);
  });

  test("protection script dry-run prints JSON without mutating API calls", () => {
    const result = Bun.spawnSync(["bash", protectionScript, "--dry-run"], {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PATH: process.env.PATH },
    });

    const stdout = result.stdout.toString();
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain("Dry run");
    expect(stdout).toContain("Main branch protection");
    expect(stdout).toContain("Merge Gate");
    expect(stdout).toContain("pull_request");
    expect(stdout).toContain("required_status_checks");
    expect(stdout).toContain("strict_required_status_checks_policy");
    expect(stdout).toContain("bypass_actors");
    expect(stdout).toContain("Integration");
    expect(stdout).toContain("non_fast_forward");
    expect(stdout).toContain("deletion");
    expect(stdout).not.toContain("enforce_admins");

    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    expect(jsonMatch).not.toBeNull();
    const payload = JSON.parse(jsonMatch![0]);
    expect(payload.name).toBe("Main branch protection");
    expect(payload.bypass_actors[0].actor_type).toBe("Integration");
    expect(payload.bypass_actors[0].bypass_mode).toBe("always");
  });
});

describe("branch protection documentation", () => {
  const docs = read(docsPath);

  test("docs/branch-protection.md exists", () => {
    expect(existsSync(docsPath)).toBe(true);
  });

  test("documents ruleset model, direct-push block, Merge Gate, and GitHub Actions bypass", () => {
    expect(docs).toMatch(/direct push/i);
    expect(docs).toMatch(/ruleset/i);
    expect(docs).toMatch(/classic branch protection|classic protection/i);
    expect(docs).toMatch(/GH006|semantic-release/i);
    expect(docs).toContain("Merge Gate");
    expect(docs).toMatch(/GitHub Actions|github-actions/i);
    expect(docs).toMatch(/bypass/i);
    expect(docs).toMatch(/GITHUB_TOKEN|PAT/);
    expect(docs).toContain("configure-main-branch-protection.sh");
    expect(docs).not.toContain("configure-release-bypass-ruleset.sh");
  });
});
