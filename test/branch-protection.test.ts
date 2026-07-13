import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");

const protectionScript = resolve(
  projectRoot,
  "scripts/configure-main-branch-protection.sh",
);
const supersededBypassScript = resolve(
  projectRoot,
  "scripts/configure-release-bypass-ruleset.sh",
);
const docsPath = resolve(projectRoot, "docs/branch-protection.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("branch protection script", () => {
  test("configure-main-branch-protection.sh exists and is executable bash", () => {
    expect(existsSync(protectionScript)).toBe(true);
    const content = read(protectionScript);
    expect(content).toMatch(/^#!\/usr\/bin\/env bash/);
    expect(content).toContain("set -euo pipefail");
  });

  test("configures a ruleset, not classic branch protection (W-000036)", () => {
    // Classic protection blocks every actor including GITHUB_TOKEN; only a
    // ruleset supports bypass actors, so protection and bypass must live in
    // the same ruleset payload for the release bot to push version commits.
    const content = read(protectionScript);
    expect(content).toContain("repos/${REPO}/rulesets");
    expect(content).toContain("bypass_actors");
    expect(content).toContain("Integration");
    expect(content).toContain("github-actions");
    expect(content).not.toMatch(/branches\/main\/protection"\s*\\\s*-X PUT/);
  });

  test("ruleset payload gates humans behind PRs and Merge Gate", () => {
    const content = read(protectionScript);
    expect(content).toContain("Merge Gate");
    expect(content).toContain('type: "pull_request"');
    expect(content).toContain("required_approving_review_count: 0");
    expect(content).toContain('type: "required_status_checks"');
    expect(content).toContain("strict_required_status_checks_policy: true");
    expect(content).toContain('type: "non_fast_forward"');
    expect(content).toContain('type: "deletion"');
    expect(content).toContain("gh repo view --json nameWithOwner");
    expect(content).toContain("--dry-run");
  });

  test("removes classic protection after the ruleset is active", () => {
    const content = read(protectionScript);
    expect(content).toContain('branches/main/protection');
    expect(content).toContain("-X DELETE");
  });

  test("superseded configure-release-bypass-ruleset.sh is gone", () => {
    // Its bypass actor is folded into the main ruleset; standalone it could
    // never unblock classic protection and re-running it would mislead.
    expect(existsSync(supersededBypassScript)).toBe(false);
  });

  test("protection script dry-run prints ruleset JSON without calling the API", () => {
    const result = Bun.spawnSync(["bash", protectionScript, "--dry-run"], {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PATH: process.env.PATH },
    });

    const stdout = result.stdout.toString();
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain("Dry run");
    expect(stdout).toContain("Merge Gate");
    expect(stdout).toContain('"enforcement": "active"');
    expect(stdout).toContain('"strict_required_status_checks_policy": true');
    expect(stdout).toContain('"required_approving_review_count": 0');
    expect(stdout).toContain('"bypass_mode": "always"');
    expect(stdout).toContain('"actor_type": "DeployKey"');
    expect(stdout).toContain('"actor_type": "Integration"');
    expect(stdout).toContain("remove classic branch protection");
  });

  test("falls back to a deploy-key-only bypass on user-owned repos (W-000036)", () => {
    // The rulesets API rejects the GitHub Actions app as a bypass actor on
    // user-owned repos; the release push then relies on the DeployKey bypass
    // via the RELEASE_DEPLOY_KEY checkout in release.yml.
    const content = read(protectionScript);
    expect(content).toContain("must be part of the ruleset source");
    expect(content).toContain("deploy-key-only");
    expect(content).toContain('"actor_type": "DeployKey"');
    expect(content).toContain("RELEASE_DEPLOY_KEY");
  });
});

describe("branch protection documentation", () => {
  const docs = read(docsPath);

  test("docs/branch-protection.md exists", () => {
    expect(existsSync(docsPath)).toBe(true);
  });

  test("documents ruleset model, direct-push block, Merge Gate, and release bypass", () => {
    expect(docs).toMatch(/direct push/i);
    expect(docs).toMatch(/ruleset/i);
    expect(docs).toContain("Merge Gate");
    expect(docs).toMatch(/bypass/i);
    expect(docs).toMatch(/GITHUB_TOKEN|PAT/);
    expect(docs).toContain("configure-main-branch-protection.sh");
    expect(docs).not.toContain("configure-release-bypass-ruleset.sh");
  });

  test("documents the release deploy key bypass and one-time setup", () => {
    expect(docs).toContain("RELEASE_DEPLOY_KEY");
    expect(docs).toContain("DeployKey");
    expect(docs).toMatch(/deploy-key add.*--allow-write|--allow-write.*deploy-key add/s);
    expect(docs).toContain("gh secret set RELEASE_DEPLOY_KEY");
  });
});
