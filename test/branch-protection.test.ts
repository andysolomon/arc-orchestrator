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

  test("protection script contains required branch protection API fields", () => {
    const content = read(protectionScript);
    expect(content).toContain("Merge Gate");
    expect(content).toContain("enforce_admins=true");
    expect(content).toContain("required_status_checks[strict]=true");
    expect(content).toContain(
      "required_pull_request_reviews[required_approving_review_count]=1",
    );
    expect(content).toContain("gh repo view --json nameWithOwner");
    expect(content).toContain("branches/main/protection");
    expect(content).toContain("--dry-run");
  });

  test("configure-release-bypass-ruleset.sh exists and targets GitHub Actions bypass", () => {
    expect(existsSync(bypassScript)).toBe(true);
    const content = read(bypassScript);
    expect(content).toMatch(/^#!\/usr\/bin\/env bash/);
    expect(content).toContain("set -euo pipefail");
    expect(content).toContain("Release automation bypass");
    expect(content).toContain("github-actions");
    expect(content).toContain("actor_type");
    expect(content).toContain("Integration");
    expect(content).toContain("repos/${REPO}/rulesets");
    expect(content).toContain("--dry-run");
  });

  test("protection script dry-run prints JSON without calling PUT", () => {
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
    expect(stdout).toContain('"enforce_admins": true');
    expect(stdout).toContain('"strict": true');
    expect(stdout).toContain('"required_approving_review_count": 1');
  });
});

describe("branch protection documentation", () => {
  const docs = read(docsPath);

  test("docs/branch-protection.md exists", () => {
    expect(existsSync(docsPath)).toBe(true);
  });

  test("documents direct-push block, admin enforcement, Merge Gate, and release bypass", () => {
    expect(docs).toMatch(/direct push/i);
    expect(docs).toMatch(/enforce_admins|admins cannot bypass|Admins are not exempt/i);
    expect(docs).toContain("Merge Gate");
    expect(docs).toMatch(/release bypass|release automation bypass/i);
    expect(docs).toMatch(/GITHUB_TOKEN|PAT/);
    expect(docs).toContain("configure-main-branch-protection.sh");
    expect(docs).toContain("configure-release-bypass-ruleset.sh");
  });
});
