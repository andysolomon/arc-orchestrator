import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const skillPath = "plugins/cursor-orchestrator/skills/direct-worker/SKILL.md";

function read(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

describe("Cursor direct worker skill", () => {
  test("ships a direct-worker escape hatch with four routes and a full delegation contract", () => {
    expect(existsSync(resolve(projectRoot, skillPath))).toBe(true);

    const skill = read(skillPath);

    expect(skill).toContain("name: direct-worker");
    expect(skill).toContain("--backend codex --mode analyze");
    expect(skill).toContain("--backend codex --mode review");
    expect(skill).toContain("--backend codex --mode implement");
    expect(skill).toContain("--backend composer --mode implement");
    expect(skill).toContain("outcome, scope, invariants, verification, prohibitions, and a safe label");
    expect(skill).toContain("never commit, push, merge, deploy, edit secrets, or touch unrelated files");
    expect(skill).toContain("Cursor did not return the required structured result");
    expect(skill).toContain("Inspect the worktree");
    expect(skill).toContain("Never silently accept unverified changes");
  });
});
