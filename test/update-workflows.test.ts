import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");

function read(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

describe("Root README update workflows", () => {
  const readme = read("README.md");

  test("documents Claude Code plugin update and verification", () => {
    expect(readme).toContain("Updating Each Surface");
    expect(readme).toContain("Claude Code");
    expect(readme).toMatch(/plugin marketplace update fable-orchestrator/i);
    expect(readme).toMatch(/plugin update fable-orchestrator@fable-orchestrator/i);
    expect(readme).toContain("/reload-plugins");
    expect(readme).toMatch(/claude plugin list/i);
    expect(readme).toMatch(/verify/i);
  });

  test("documents Cursor update path with pull and reload", () => {
    expect(readme).toContain("Cursor");
    expect(readme).toMatch(/git pull/i);
    expect(readme).toMatch(/Developer: Reload Window/i);
    expect(readme).toContain("plugins/cursor-orchestrator/README.md");
  });

  test("documents Pi symlink-based update mechanics", () => {
    expect(readme).toContain("Pi");
    expect(readme).toMatch(/symlink/i);
    expect(readme).toContain("pi install ./plugins/pi-orchestrator -l");
    expect(readme).toMatch(/git pull/i);
  });

  test("documents Copilot re-copy update mechanics", () => {
    expect(readme).toContain("Copilot");
    expect(readme).toMatch(/re-copy/i);
    expect(readme).toContain("plugins/copilot-orchestrator/copilot-instructions.md");
    expect(readme).toContain(".github/copilot-instructions.md");
  });
});
