import { describe, expect, test } from "bun:test";
import {
  codexModelFor,
  type EnvLike,
  grokModelFor,
  grokProfileFor,
  resolveProfile,
} from "../plugins/arc-orchestrator/lib/routes";
import { parseArguments } from "../plugins/arc-orchestrator/lib/cli";
import { executeRun } from "../plugins/arc-orchestrator/lib/engine";

const empty: EnvLike = {};

describe("engine/routes: worker-authored artifact profiles", () => {
  test.each(["composer", "claude", "minimax", "opencode", "kimi"] as const)(
    "resolves slugged analyze as write-capable for %s",
    (backend) => {
      const profile = resolveProfile(empty, backend, "analyze", null, null, "runner-slug", "plan");
      expect(profile.sandbox).toBe("workspace-write");
      expect(profile.instruction.match(/docs\/runner-slug\/plan\.md/g)).toHaveLength(1);
      expect(profile.instruction).not.toContain("Do not modify files");
    },
  );

  test("retains the slug across fallback and emits capability before outage classification", async () => {
    const calls: Array<{ backend: string; taskSlug?: string | null; prompt: string }> = [];
    const stderr: string[] = [];
    const result = await executeRun({
      backend: "codex",
      mode: "analyze",
      phase: "plan",
      task: "bounded task",
      taskSlug: "runner-slug",
      cwd: process.cwd(),
      label: null,
      taskClass: null,
      routeRationale: null,
      budget: { maxTokens: null, maxDurationMs: null },
      effort: null,
      fallback: "claude",
      backendExplicit: true,
      routingIntent: "backend-explicit",
    }, {
      env: {},
      emitStderr: (line) => stderr.push(line),
      invokeBackend: async (input) => {
        calls.push({ backend: input.backend, taskSlug: input.taskSlug, prompt: input.prompt });
        if (input.backend === "codex") {
          throw new Error("Codex invocation failed\nusage limit reached");
        }
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            is_error: false,
            result: JSON.stringify({ status: "completed", summary: "done", changes: [], verification: [], risks: [], next_actions: [] }),
          }),
        };
      },
    });
    expect(result.success).toBe(true);
    expect(calls.map(({ backend, taskSlug }) => ({ backend, taskSlug }))).toEqual([
      { backend: "codex", taskSlug: "runner-slug" },
      { backend: "claude", taskSlug: "runner-slug" },
    ]);
    expect(calls[1]?.prompt.match(/docs\/runner-slug\/plan\.md/g)).toHaveLength(1);
    const sentinel = stderr.findIndex((line) => line.includes("backend=codex containment=repo-root"));
    const unavailable = stderr.findIndex((line) => line.includes("codex unavailable (usage_limit)"));
    expect(sentinel).toBeGreaterThanOrEqual(0);
    expect(unavailable).toBeGreaterThan(sentinel);
  });
});

describe("engine/routes: grokModelFor env overrides", () => {
  test("uses ARC_ORCHESTRATOR_GROK_MODEL when set", () => {
    expect(grokModelFor({ ARC_ORCHESTRATOR_GROK_MODEL: "custom-grok" })).toBe(
      "custom-grok",
    );
  });

  test("rejects Grok fast variants and accepts the normal Grok profile", () => {
    expect(() =>
      grokModelFor({
        ARC_ORCHESTRATOR_GROK_MODEL: "cursor-grok-4.6-fast-high",
      }),
    ).toThrow(
      "ARC_ORCHESTRATOR_GROK_MODEL must not select a Grok fast variant",
    );
    expect(
      grokModelFor({
        ARC_ORCHESTRATOR_GROK_MODEL: "cursor-grok-4.7-high",
      }),
    ).toBe("cursor-grok-4.7-high");
  });

  test("blank or whitespace overrides fall back to cursor-grok-4.7-high", () => {
    expect(grokModelFor({ ARC_ORCHESTRATOR_GROK_MODEL: " \t " })).toBe(
      "cursor-grok-4.7-high",
    );
  });
});

describe("engine/routes: codexModelFor env overrides", () => {
  test("blank or whitespace overrides fall back to defaults", () => {
    expect(
      codexModelFor(
        { ARC_ORCHESTRATOR_IMPLEMENT_MODEL: " \t " },
        "implement",
        null,
      ),
    ).toBe("gpt-5.5");
  });
});

describe("engine/routes: grokProfileFor and resolveProfile grok routes", () => {
  test("grokProfileFor takes the sandbox from the resolved mode profile", () => {
    expect(grokProfileFor(empty, "analyze").sandbox).toBe("workspace-write");
    expect(grokProfileFor(empty, "review").sandbox).toBe("read-only");
    expect(grokProfileFor(empty, "implement").sandbox).toBe("workspace-write");
  });

  test("CLI route parsing permits workspace-write composer analyze through the grok route", () => {
    const previous = process.env.ARC_ORCHESTRATOR_GROK_MODEL;
    delete process.env.ARC_ORCHESTRATOR_GROK_MODEL;
    try {
      const parsed = parseArguments([
        "run",
        "--route",
        "grok-explore",
        "--task",
        "inspect the repo",
        "--cwd",
        process.cwd(),
      ]);

      expect(parsed.backend).toBe("composer");
      expect(parsed.mode).toBe("analyze");
      expect(parsed.requestedAlias).toBe("grok-explore");
      expect(parsed.profileOverride).toMatchObject({
        model: "cursor-grok-4.7-high",
        sandbox: "workspace-write",
      });
    } finally {
      if (previous === undefined) {
        delete process.env.ARC_ORCHESTRATOR_GROK_MODEL;
      } else {
        process.env.ARC_ORCHESTRATOR_GROK_MODEL = previous;
      }
    }
  });
});

describe("engine/routes: resolveProfile", () => {
  test("honors backend-specific model overrides and blank fallback semantics", () => {
    expect(
      resolveProfile(
        { ARC_ORCHESTRATOR_COMPOSER_MODEL: "custom-composer" },
        "composer",
        "implement",
        "taste-sensitive",
      ).model,
    ).toBe("custom-composer");
    expect(
      resolveProfile(
        { ARC_ORCHESTRATOR_CLAUDE_MODEL: "claude-sonnet-4-6" },
        "claude",
        "analyze",
        null,
      ).model,
    ).toBe("claude-sonnet-4-6");
    expect(
      resolveProfile(
        { ARC_ORCHESTRATOR_CLAUDE_MODEL: " \t " },
        "claude",
        "analyze",
        null,
      ).model,
    ).toBe("claude-opus-5-5");
  });
});

describe("engine/routes: Composer orchestrator CLI selection", () => {
  test("environment identity activates eco mode when the CLI is absent", () => {
    const previous = process.env.ARC_ORCHESTRATOR_ORCHESTRATOR;
    process.env.ARC_ORCHESTRATOR_ORCHESTRATOR = "eco";
    try {
      expect(
        parseArguments(["run", "--mode", "review", "--task", "bounded task"]),
      ).toMatchObject({
        orchestratorIdentity: "eco",
        backend: "claude",
        requestedAlias: "opus-check",
      });
    } finally {
      if (previous === undefined) {
        delete process.env.ARC_ORCHESTRATOR_ORCHESTRATOR;
      } else {
        process.env.ARC_ORCHESTRATOR_ORCHESTRATOR = previous;
      }
    }
  });
});

// The 2026-09-11 posture, asserted directly rather than inferred from the
// surrounding cases: review is read-only on every transport, and composer
// analyze is admitted as a workspace-write dispatch.
describe("engine/routes: analyze/review sandbox posture", () => {
  test("review resolves read-only on claude, composer, codex, and opencode", () => {
    expect(resolveProfile(empty, "claude", "review", null).sandbox).toBe(
      "read-only",
    );
    expect(resolveProfile(empty, "codex", "review", null).sandbox).toBe(
      "read-only",
    );
    expect(resolveProfile(empty, "opencode", "review", null).sandbox).toBe(
      "read-only",
    );
    // Composer has no read-only headless mode of its own, so a composer review
    // only exists through a route whose contract is read-only.
    expect(
      resolveProfile(empty, "composer", "review", null, "grok-check").sandbox,
    ).toBe("read-only");
    expect(
      resolveProfile(empty, "composer", "review", null, "cursor-auto-check")
        .sandbox,
    ).toBe("read-only");
  });

  // The CLI guard that rejects a non-read-only composer review calls
  // `process.exit`, so its fail-closed behavior is asserted as a subprocess in
  // test/orchestrator.test.ts. Here we assert the other half: composer analyze
  // is admitted and resolves workspace-write.
  test("composer analyze is admitted as a workspace-write dispatch", () => {
    const parsed = parseArguments([
      "run",
      "--backend",
      "composer",
      "--mode",
      "analyze",
      "--task",
      "inspect the repo",
      "--cwd",
      process.cwd(),
    ]);
    expect(parsed).toMatchObject({ backend: "composer", mode: "analyze" });
    expect(resolveProfile(empty, "composer", "analyze", null).sandbox).toBe(
      "workspace-write",
    );
  });
});
