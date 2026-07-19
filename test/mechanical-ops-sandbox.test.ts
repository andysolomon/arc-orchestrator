import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolvePublicAlias } from "../plugins/arc-orchestrator/lib/capability-routes";
import { routeCapabilities } from "../plugins/arc-orchestrator/lib/routes";
import { renderMechanicalOpsPolicySection } from "../plugins/orchestrator-core/routing-policy";

const ROOT = resolve(import.meta.dir, "..");

describe("mechanical-ops removal", () => {
  test("rejects legacy mechanical aliases", () => {
    for (const alias of [
      "mechanical-post-comment",
      "mechanical-commit-push",
      "mechanical-merge",
    ]) {
      expect(resolvePublicAlias(alias)).toBeUndefined();
      expect(
        routeCapabilities({}).some((route) => route.id === alias),
      ).toBe(false);
    }
  });

  test("shipping policy asserts parent-direct authority and worker prohibition", () => {
    const section = renderMechanicalOpsPolicySection();
    expect(section).toContain("## Shipping authority");
    expect(section).toContain("no mechanical worker routes or aliases");
    expect(section).toContain("parent orchestrator performs the authorized");
    expect(section).toContain("Workers are prohibited");
  });

  test("deleted mechanical broker and agent files stay absent", () => {
    for (const relative of [
      "plugins/arc-orchestrator/lib/mechanical-ops-sandbox.ts",
      "plugins/arc-orchestrator/skills/mechanical-ops-runtime/SKILL.md",
      "plugins/arc-orchestrator/agents/mechanical-commit-push.md",
      "plugins/arc-orchestrator/agents/mechanical-merge.md",
      "plugins/arc-orchestrator/agents/mechanical-post-comment.md",
    ]) {
      expect(() => readFileSync(resolve(ROOT, relative), "utf8")).toThrow();
    }
  });
});
