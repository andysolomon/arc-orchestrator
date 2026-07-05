import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const pluginRoot = resolve(projectRoot, "plugins/cursor-orchestrator");

function read(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

describe("Cursor plugin packaging", () => {
  test("manifest is valid JSON with required fields and semver version", () => {
    const manifest = JSON.parse(read("plugins/cursor-orchestrator/.cursor-plugin/plugin.json"));

    expect(manifest.name).toBe("cursor-orchestrator");
    expect(typeof manifest.description).toBe("string");
    expect(manifest.description.length).toBeGreaterThan(0);
    expect(typeof manifest.version).toBe("string");
    expect(manifest.version.length).toBeGreaterThan(0);
    expect(manifest.version).toMatch(SEMVER_PATTERN);
    expect(manifest.author).toBeDefined();
    expect(typeof manifest.author.name).toBe("string");
    expect(manifest.author.name.length).toBeGreaterThan(0);
  });

  test("ships conventional component directories", () => {
    expect(existsSync(resolve(pluginRoot, "rules/orchestrator.mdc"))).toBe(true);
    expect(existsSync(resolve(pluginRoot, "skills/orchestrate/SKILL.md"))).toBe(true);
    expect(existsSync(resolve(pluginRoot, "commands/orchestrate.md"))).toBe(true);
    expect(existsSync(resolve(pluginRoot, "commands/opus-review.md"))).toBe(true);
    expect(existsSync(resolve(pluginRoot, "prompts/orchestrate.md"))).toBe(true);
    expect(existsSync(resolve(pluginRoot, ".cursor-plugin/plugin.json"))).toBe(true);
  });

  test("slash commands carry frontmatter metadata", () => {
    for (const file of ["commands/orchestrate.md", "commands/opus-review.md"]) {
      const content = read(`plugins/cursor-orchestrator/${file}`);
      expect(content.startsWith("---\n")).toBe(true);
      expect(content).toContain("name: ");
      expect(content).toContain("description: ");
    }
  });

  test("README documents local loading and distribution path", () => {
    const readme = read("plugins/cursor-orchestrator/README.md");

    expect(readme).toContain("real Cursor plugin package");
    expect(readme).toContain("~/.cursor/plugins");
    expect(readme).toMatch(/Distribution/i);
    expect(readme).toMatch(/marketplace/i);
  });
});
