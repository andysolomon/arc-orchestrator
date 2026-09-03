import { describe, expect, test } from "bun:test";
import {
  codexModelFor,
  type EnvLike,
  grokModelFor,
  grokProfileFor,
  isGrokRouteId,
  isTasteSensitiveTaskClass,
  profileFor,
  workerArtifactCapability,
  resolveProfile,
  ROUTES_SCHEMA_VERSION,
  ROUTES_SOURCE,
  routeCapabilities,
  routesContract,
  TASTE_SENSITIVE_TASK_CLASSES,
} from "../plugins/arc-orchestrator/lib/routes";
import {
  PUBLIC_ROUTE_MODEL_BINDINGS,
  PUBLIC_ROUTE_SUFFIXES,
} from "../plugins/arc-orchestrator/lib/trace-schema";
import { parseArguments } from "../plugins/arc-orchestrator/lib/cli";
import { executeRun } from "../plugins/arc-orchestrator/lib/engine";

const empty: EnvLike = {};

describe("engine/routes: profileFor", () => {
  test("resolves default model, sandbox, and instruction per mode", () => {
    expect(profileFor(empty, "analyze")).toEqual({
      model: "gpt-5.6-luna",
      sandbox: "read-only",
      instruction:
        "Analyze only. Do not modify files. Inspect the repository directly and return concise evidence relevant to the task.",
    });
    expect(profileFor(empty, "implement")).toEqual({
      model: "gpt-5.5",
      sandbox: "workspace-write",
      instruction:
        "Implement the bounded task directly. Do not expand scope, commit, or push. Deployment is forbidden unless the selected phase is deploy and the CLI has validated explicit human authorization. Run focused verification and report every changed file.",
    });
    expect(profileFor(empty, "review")).toEqual({
      model: "gpt-5.5",
      sandbox: "read-only",
      instruction:
        "Review only. Do not modify files. Prioritize concrete correctness, security, regression, and test risks with file-level evidence.",
    });
  });

  test("does not upgrade implement or review on task_class", () => {
    expect(profileFor(empty, "implement", "ui").model).toBe("gpt-5.5");
    expect(profileFor(empty, "review", "api-design").model).toBe("gpt-5.5");
    expect(profileFor(empty, "analyze", "ui").model).toBe("gpt-5.6-luna");
  });
});

describe("engine/routes: worker-authored artifact profiles", () => {
  test.each(["codex", "composer", "claude", "minimax", "opencode", "kimi"] as const)(
    "resolves slugged analyze as write-capable for %s",
    (backend) => {
      const profile = resolveProfile(empty, backend, "analyze", null, null, "runner-slug", "plan");
      expect(profile.sandbox).toBe("workspace-write");
      expect(profile.instruction.match(/docs\/runner-slug\/plan\.md/g)).toHaveLength(1);
      expect(profile.instruction).not.toContain("Do not modify files");
    },
  );

  test("reports configured containment strength without a verification claim", () => {
    expect(workerArtifactCapability("claude", "analyze", "runner-slug", "plan")?.containment).toBe("path-scoped-configured");
    expect(workerArtifactCapability("codex", "analyze", "runner-slug", "plan")?.containment).toBe("repo-root");
    expect(workerArtifactCapability("composer", "analyze", "runner-slug", "plan")?.containment).toBe("prompt-only");
    expect(workerArtifactCapability("claude", "review", "runner-slug", "verify")).toBeNull();
  });

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
  test("defaults to cursor-grok-4.6-high when unset", () => {
    expect(grokModelFor(empty)).toBe("cursor-grok-4.6-high");
  });

  test("uses ARC_ORCHESTRATOR_GROK_MODEL when set", () => {
    expect(grokModelFor({ ARC_ORCHESTRATOR_GROK_MODEL: "custom-grok" })).toBe(
      "custom-grok",
    );
  });

  test("blank or whitespace overrides fall back to cursor-grok-4.6-high", () => {
    expect(grokModelFor({ ARC_ORCHESTRATOR_GROK_MODEL: " \t " })).toBe(
      "cursor-grok-4.6-high",
    );
  });
});

describe("engine/routes: codexModelFor env overrides", () => {
  test("uses the per-mode override env var when set", () => {
    expect(
      codexModelFor(
        { ARC_ORCHESTRATOR_ANALYZE_MODEL: "custom-analyze" },
        "analyze",
        null,
      ),
    ).toBe("custom-analyze");
    expect(
      codexModelFor(
        { ARC_ORCHESTRATOR_IMPLEMENT_MODEL: "custom-implement" },
        "implement",
        null,
      ),
    ).toBe("custom-implement");
    expect(
      codexModelFor(
        { ARC_ORCHESTRATOR_REVIEW_MODEL: "custom-review" },
        "review",
        null,
      ),
    ).toBe("custom-review");
  });

  test("override beats the default even when task_class is set", () => {
    expect(
      codexModelFor(
        { ARC_ORCHESTRATOR_IMPLEMENT_MODEL: "custom-implement" },
        "implement",
        "taste-sensitive",
      ),
    ).toBe("custom-implement");
    expect(codexModelFor(empty, "implement", "taste-sensitive")).toBe(
      "gpt-5.5",
    );
  });

  test("blank or whitespace overrides fall back to defaults", () => {
    expect(
      codexModelFor(
        { ARC_ORCHESTRATOR_IMPLEMENT_MODEL: " \t " },
        "implement",
        null,
      ),
    ).toBe("gpt-5.5");
  });

  test("reads only the passed env, never the global process.env", () => {
    const key = "ARC_ORCHESTRATOR_IMPLEMENT_MODEL";
    const previous = process.env[key];
    process.env[key] = "leaked-global";
    try {
      expect(codexModelFor(empty, "implement", null)).toBe("gpt-5.5");
    } finally {
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  });
});

describe("engine/routes: isTasteSensitiveTaskClass", () => {
  test("matches the known classes case-insensitively and trimmed", () => {
    for (const taskClass of TASTE_SENSITIVE_TASK_CLASSES) {
      expect(isTasteSensitiveTaskClass(taskClass)).toBe(true);
      expect(isTasteSensitiveTaskClass(`  ${taskClass.toUpperCase()} `)).toBe(
        true,
      );
    }
  });

  test("rejects unknown, empty, and nullish classes", () => {
    expect(isTasteSensitiveTaskClass("migration")).toBe(false);
    expect(isTasteSensitiveTaskClass("")).toBe(false);
    expect(isTasteSensitiveTaskClass(null)).toBe(false);
    expect(isTasteSensitiveTaskClass(undefined)).toBe(false);
  });
});

describe("engine/routes: grokProfileFor and resolveProfile grok routes", () => {
  test("grokProfileFor uses read-only sandbox for analyze and review", () => {
    expect(grokProfileFor(empty, "analyze").sandbox).toBe("read-only");
    expect(grokProfileFor(empty, "review").sandbox).toBe("read-only");
    expect(grokProfileFor(empty, "implement").sandbox).toBe("workspace-write");
  });

  test("grokProfileFor defaults model to cursor-grok-4.6-high", () => {
    expect(grokProfileFor(empty, "implement").model).toBe("cursor-grok-4.6-high");
  });

  test("resolveProfile honors grok route ids with mode-aware sandbox", () => {
    expect(
      resolveProfile(empty, "composer", "analyze", null, "grok-explore"),
    ).toEqual({
      model: "cursor-grok-4.6-high",
      sandbox: "read-only",
      instruction:
        "Analyze only. Do not modify files. Inspect the repository directly and return concise evidence relevant to the task.",
    });
    expect(
      resolveProfile(empty, "composer", "review", null, "grok-check"),
    ).toEqual({
      model: "cursor-grok-4.6-high",
      sandbox: "read-only",
      instruction:
        "Review only. Do not modify files. Prioritize concrete correctness, security, regression, and test risks with file-level evidence.",
    });
    expect(
      resolveProfile(empty, "composer", "implement", null, "grok-implement"),
    ).toEqual({
      model: "cursor-grok-4.6-high",
      sandbox: "workspace-write",
      instruction:
        "Implement the bounded task directly. Do not expand scope, commit, or push. Deployment is forbidden unless the selected phase is deploy and the CLI has validated explicit human authorization. Run focused verification and report every changed file.",
    });
  });

  test("composer backend without grok route id stays implement-only workspace-write", () => {
    expect(resolveProfile(empty, "composer", "analyze", null).sandbox).toBe(
      "workspace-write",
    );
  });

  test("isGrokRouteId identifies grok public aliases", () => {
    expect(isGrokRouteId("grok-explore")).toBe(true);
    expect(isGrokRouteId("composer-implement")).toBe(false);
  });

  test("CLI route parsing permits composer analyze through the grok read-only route", () => {
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
        model: "cursor-grok-4.6-high",
        sandbox: "read-only",
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
  test("returns model, sandbox, and instruction for each backend", () => {
    expect(resolveProfile(empty, "composer", "implement", "ui")).toEqual({
      model: "composer-2.5",
      sandbox: "workspace-write",
      instruction:
        "Implement the bounded task directly. Do not expand scope, commit, or push. Deployment is forbidden unless the selected phase is deploy and the CLI has validated explicit human authorization. Run focused verification and report every changed file.",
    });
    expect(resolveProfile(empty, "claude", "review", null)).toEqual({
      model: "claude-opus-5",
      sandbox: "read-only",
      instruction:
        "Review only. Do not modify files. Prioritize concrete correctness, security, regression, and test risks with file-level evidence.",
    });
    expect(resolveProfile(empty, "codex", "implement", "ui")).toEqual({
      model: "gpt-5.5",
      sandbox: "workspace-write",
      instruction:
        "Implement the bounded task directly. Do not expand scope, commit, or push. Deployment is forbidden unless the selected phase is deploy and the CLI has validated explicit human authorization. Run focused verification and report every changed file.",
    });
  });

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
    ).toBe("claude-opus-5");
  });
});

describe("engine/routes: Composer orchestrator CLI selection", () => {
  test.each([
    ["analyze", "claude", "opus-explore", "claude-opus-5", "read-only"],
    [
      "implement",
      "composer",
      "composer-implement",
      "composer-2.5",
      "workspace-write",
    ],
    ["review", "claude", "opus-check", "claude-opus-5", "read-only"],
  ] as const)(
    "CLI identity activates the fixed %s worker",
    (mode, backend, route, model, sandbox) => {
      const previousIdentity = process.env.ARC_ORCHESTRATOR_ORCHESTRATOR;
      const previousClaude = process.env.ARC_ORCHESTRATOR_CLAUDE_MODEL;
      const previousComposer = process.env.ARC_ORCHESTRATOR_COMPOSER_MODEL;
      process.env.ARC_ORCHESTRATOR_ORCHESTRATOR = "fable";
      process.env.ARC_ORCHESTRATOR_CLAUDE_MODEL = "claude-sonnet-4-6";
      process.env.ARC_ORCHESTRATOR_COMPOSER_MODEL = "gpt-5.6-sol";
      try {
        const parsed = parseArguments([
          "run",
          "--orchestrator",
          "eco",
          "--mode",
          mode,
          "--task",
          "bounded task",
        ]);
        expect(parsed).toMatchObject({
          orchestratorIdentity: "eco",
          backend,
          requestedAlias: route,
          profileOverride: { model, sandbox },
        });
      } finally {
        if (previousIdentity === undefined) {
          delete process.env.ARC_ORCHESTRATOR_ORCHESTRATOR;
        } else {
          process.env.ARC_ORCHESTRATOR_ORCHESTRATOR = previousIdentity;
        }
        if (previousClaude === undefined) {
          delete process.env.ARC_ORCHESTRATOR_CLAUDE_MODEL;
        } else {
          process.env.ARC_ORCHESTRATOR_CLAUDE_MODEL = previousClaude;
        }
        if (previousComposer === undefined) {
          delete process.env.ARC_ORCHESTRATOR_COMPOSER_MODEL;
        } else {
          process.env.ARC_ORCHESTRATOR_COMPOSER_MODEL = previousComposer;
        }
      }
    },
  );

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

describe("engine/routes: routeCapabilities and routesContract", () => {
  test("advertises stable and versioned Codex aliases with fixed current models", () => {
    const routes = routeCapabilities(empty);
    expect(
      Object.fromEntries(
        routes
          .filter((route) => route.backend === "codex")
          .map((route) => [route.id, route.model]),
      ),
    ).toEqual({
      "sol-explore": "gpt-5.6-sol",
      "sol-implement": "gpt-5.6-sol",
      "sol-check": "gpt-5.6-sol",
      "gpt-5.6-sol-explore": "gpt-5.6-sol",
      "gpt-5.6-sol-implement": "gpt-5.6-sol",
      "gpt-5.6-sol-check": "gpt-5.6-sol",
      "luna-explore": "gpt-5.6-luna",
      "luna-implement": "gpt-5.6-luna",
      "luna-check": "gpt-5.6-luna",
      "gpt-5.6-luna-explore": "gpt-5.6-luna",
      "gpt-5.6-luna-implement": "gpt-5.6-luna",
      "gpt-5.6-luna-check": "gpt-5.6-luna",
      "gpt-5.5-explore": "gpt-5.5",
      "gpt-5.5-implement": "gpt-5.5",
      "gpt-5.5-check": "gpt-5.5",
    });
  });

  test("emits routes in order with taste variants only on codex routes", () => {
    const routes = routeCapabilities(empty);
    expect(routes.map((route) => route.id)).toEqual(
      PUBLIC_ROUTE_MODEL_BINDINGS.flatMap(({ base }) =>
        PUBLIC_ROUTE_SUFFIXES.map((suffix) => `${base}-${suffix}`),
      ),
    );

    expect(routes.every((route) => !("task_class_variants" in route))).toBe(
      true,
    );
  });

  test("reports cursor-grok-4.6-high for grok routes and composer-2.5 for composer-implement", () => {
    const routes = routeCapabilities(empty);
    expect(
      Object.fromEntries(
        routes
          .filter((route) => route.id.startsWith("grok-"))
          .map((route) => [route.id, route.model]),
      ),
    ).toEqual({
      "grok-explore": "cursor-grok-4.6-high",
      "grok-implement": "cursor-grok-4.6-high",
      "grok-check": "cursor-grok-4.6-high",
      "grok-4.6-explore": "cursor-grok-4.6-high",
      "grok-4.6-implement": "cursor-grok-4.6-high",
      "grok-4.6-check": "cursor-grok-4.6-high",
    });
    expect(routes.find((route) => route.id === "grok-explore")?.sandbox).toBe(
      "read-only",
    );
    expect(routes.find((route) => route.id === "grok-check")?.sandbox).toBe(
      "read-only",
    );
    expect(routes.find((route) => route.id === "grok-implement")?.sandbox).toBe(
      "workspace-write",
    );
  });

  test("stable and versioned Kimi aliases use Cursor Kimi on Composer", () => {
    const routes = routeCapabilities(empty);
    for (const base of ["kimi", "kimi-k3"]) {
      for (const suffix of PUBLIC_ROUTE_SUFFIXES) {
        const route = routes.find((candidate) => candidate.id === `${base}-${suffix}`);
        expect(route).toMatchObject({
          backend: "composer",
          model: "kimi-k3",
          mode:
            suffix === "explore"
              ? "analyze"
              : suffix === "implement"
                ? "implement"
                : "review",
        });
      }
    }
    // The only OpenCode routes are the provider-qualified OpenCode Go bases;
    // no kimi-* alias ever resolves to the opencode transport.
    const openCodeRoutes = routes.filter((route) => route.backend === "opencode");
    expect(openCodeRoutes.length).toBe(11 * PUBLIC_ROUTE_SUFFIXES.length);
    for (const route of openCodeRoutes) {
      expect(route.model.startsWith("opencode-go/")).toBe(true);
      // kimi-* / kimi-k3-* stay on Composer; only go-kimi-k3-* and
      // kimi-k2.7-code-* are OpenCode Go bases.
      expect(/^kimi(?:-k3)?-(?:explore|implement|check)$/.test(route.id)).toBe(
        false,
      );
    }
    expect(routes.find((route) => route.id === "go-kimi-k3-check")).toMatchObject({
      backend: "opencode",
      model: "opencode-go/kimi-k3",
      mode: "review",
      sandbox: "read-only",
    });
    expect(routes.find((route) => route.id === "glm-5.3-flash-implement")).toMatchObject({
      backend: "opencode",
      model: "opencode-go/glm-5.3-flash",
      mode: "implement",
      sandbox: "workspace-write",
    });
  });

  test("explicit route aliases ignore ambient model env overrides", () => {
    const routes = routeCapabilities({
      ARC_ORCHESTRATOR_ANALYZE_MODEL: "custom-analyze",
      ARC_ORCHESTRATOR_IMPLEMENT_MODEL: "custom-implement",
      ARC_ORCHESTRATOR_REVIEW_MODEL: "custom-review",
      ARC_ORCHESTRATOR_COMPOSER_MODEL: "custom-composer",
      ARC_ORCHESTRATOR_CLAUDE_MODEL: "custom-opus",
    });
    expect(
      Object.fromEntries(
        routes
          .filter((route) =>
            [
              "composer-implement",
              "opus-explore",
              "opus-implement",
              "opus-check",
              "composer-explore",
              "composer-check",
              "grok-explore",
              "grok-implement",
              "grok-check",
            ].includes(route.id),
          )
          .map((route) => [route.id, route.model]),
      ),
    ).toEqual({
      "composer-implement": "composer-2.5",
      "opus-explore": "claude-opus-5",
      "opus-implement": "claude-opus-5",
      "opus-check": "claude-opus-5",
      "composer-explore": "composer-2.5",
      "composer-check": "composer-2.5",
      "grok-explore": "cursor-grok-4.6-high",
      "grok-implement": "cursor-grok-4.6-high",
      "grok-check": "cursor-grok-4.6-high",
    });
    // Direct --backend (no route id) still honors ambient env.
    expect(
      resolveProfile(
      { ARC_ORCHESTRATOR_IMPLEMENT_MODEL: "custom-implement" },
      "codex",
      "implement",
      null,
      ).model,
    ).toBe("custom-implement");
    expect(
      resolveProfile(
      { ARC_ORCHESTRATOR_COMPOSER_MODEL: "custom-composer" },
      "composer",
      "implement",
      null,
      ).model,
    ).toBe("custom-composer");
    expect(
      resolveProfile(
      { ARC_ORCHESTRATOR_CLAUDE_MODEL: "custom-opus" },
      "claude",
      "review",
      null,
      ).model,
    ).toBe("custom-opus");
    expect(routes.some((route) => route.id.startsWith("mechanical-"))).toBe(
      false,
    );
    expect(
      routes.find((route) => route.id === "codex-implement"),
    ).not.toHaveProperty("task_class_variants");
  });

  test("mechanical aliases are absent from route capabilities", () => {
    const routes = routeCapabilities({});
    expect(routes.some((route) => route.id.startsWith("mechanical-"))).toBe(
      false,
    );
    for (const alias of [
      "mechanical-post-comment",
      "mechanical-commit-push",
      "mechanical-merge",
    ]) {
      expect(routes.find((route) => route.id === alias)).toBeUndefined();
    }
  });

  test("routesContract wraps the routes in the versioned envelope", () => {
    const contract = routesContract(empty);
    expect(Object.keys(contract)).toEqual([
      "schema_version",
      "source",
      "orchestrator_identity",
      "orchestrator_identity_support",
      "eco_orchestrator_mode",
      "phases",
      "phase_modes",
      "workload_classes",
      "arc_delegate_workload_classes",
      "routing_policy",
      "routes",
    ]);
    expect(contract.schema_version).toBe(ROUTES_SCHEMA_VERSION);
    expect(contract.source).toBe(ROUTES_SOURCE);
    expect(contract.orchestrator_identity).toBeNull();
    expect(contract.eco_orchestrator_mode).toEqual({
      active: false,
      policy: null,
      stack: null,
      worker_stack: [],
      backup_worker_stack: [],
      effective_routes: [],
      backup_routes: [],
    });
    expect(contract.orchestrator_identity_support).toEqual({
      "claude-code": {
        fable: true,
        sol: false,
        eco: false,
        opus: true,
        "cursor-fable-high": false,
      },
      codex: {
        fable: false,
        sol: true,
        eco: false,
        opus: false,
        "cursor-fable-high": false,
      },
      cursor: {
        fable: false,
        sol: false,
        eco: true,
        opus: false,
        "cursor-fable-high": true,
      },
    });
    expect(contract.routes).toEqual(routeCapabilities(empty));
    expect(
      routesContract({ ARC_ORCHESTRATOR_ORCHESTRATOR: "fable" })
        .orchestrator_identity,
    ).toBe("fable");
    expect(
      routesContract({ ARC_ORCHESTRATOR_ORCHESTRATOR: "eco" })
        .eco_orchestrator_mode,
    ).toEqual({
      active: true,
      policy: "eco/v1",
      stack:
        "(O) Eco -> opus-explore [| grok-explore] -> composer-implement -> opus-check [| grok-check]",
      worker_stack: ["opus-explore", "composer-implement", "opus-check"],
      backup_worker_stack: ["grok-explore", "grok-check"],
      effective_routes: [
        {
          mode: "analyze",
          route: "opus-explore",
          backend: "claude",
          stable_id: "opus-5",
          model: "claude-opus-5",
          sandbox: "read-only",
        },
        {
          mode: "implement",
          route: "composer-implement",
          backend: "composer",
          stable_id: "composer-2.5",
          model: "composer-2.5",
          sandbox: "workspace-write",
        },
        {
          mode: "review",
          route: "opus-check",
          backend: "claude",
          stable_id: "opus-5",
          model: "claude-opus-5",
          sandbox: "read-only",
        },
      ],
      backup_routes: [
        {
          mode: "analyze",
          route: "grok-explore",
          backend: "composer",
          stable_id: "cursor-grok-4.6-high",
          model: "cursor-grok-4.6-high",
          sandbox: "read-only",
        },
        {
          mode: "review",
          route: "grok-check",
          backend: "composer",
          stable_id: "cursor-grok-4.6-high",
          model: "cursor-grok-4.6-high",
          sandbox: "read-only",
        },
      ],
    });
  });

  test("Eco contract fixes active economy routes and marks generic routes ineligible under hostile overrides", () => {
    const contract = routesContract(
      {
        ARC_ORCHESTRATOR_CLAUDE_MODEL: "hostile-claude-model",
        ARC_ORCHESTRATOR_COMPOSER_MODEL: "hostile-composer-model",
      },
      "eco",
    );
    const active = contract.routes.filter((route) => route.active);
    expect(
      active.map(({ id, backend, mode, model, sandbox, eligible }) => ({
        id,
        backend,
        mode,
        model,
        sandbox,
        eligible,
      })),
    ).toEqual(expect.arrayContaining([
      {
        id: "composer-implement",
        backend: "composer",
        mode: "implement",
        model: "composer-2.5",
        sandbox: "workspace-write",
        eligible: true,
      },
      {
        id: "opus-explore",
        backend: "claude",
        mode: "analyze",
        model: "claude-opus-5",
        sandbox: "read-only",
        eligible: true,
      },
      {
        id: "opus-check",
        backend: "claude",
        mode: "review",
        model: "claude-opus-5",
        sandbox: "read-only",
        eligible: true,
      },
    ]));
    expect(
      contract.routes
        .filter((route) => !route.active)
        .every((route) => route.eligible === false),
    ).toBe(true);
    expect(active.map((route) => route.guidance)).toEqual(expect.arrayContaining([
      "Fixed economy worker for Eco orchestrator implement; no automatic backup.",
      "Fixed economy worker for Eco orchestrator analyze; availability backup is grok-explore.",
      "Fixed economy worker for Eco orchestrator review; availability backup is grok-check.",
    ]));
    const serialized = JSON.stringify(contract);
    expect(serialized).not.toContain("Use when Codex is unavailable");
    expect(serialized).not.toContain("Use when Opus is unavailable");
    expect(serialized).not.toContain("explicitly chooses Grok");
    expect(
      routeCapabilities({ ARC_ORCHESTRATOR_CLAUDE_MODEL: "override" }),
    ).not.toHaveProperty("0.active");
  });
});
