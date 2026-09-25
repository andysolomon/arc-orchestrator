import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");

const protectionScript = resolve(
  projectRoot,
  "scripts/configure-main-branch-protection.sh",
);

describe("branch protection script", () => {
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
});
