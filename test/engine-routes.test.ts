import { describe, expect, test } from "bun:test";
import {
  codexModelFor,
  type EnvLike,
  grokModelFor,
  grokProfileFor,
  isGrokRouteId,
  isTasteSensitiveTaskClass,
  profileFor,
  resolveProfile,
  ROUTES_SCHEMA_VERSION,
  ROUTES_SOURCE,
  routeCapabilities,
  routesContract,
  TASTE_SENSITIVE_TASK_CLASSES,
} from "../plugins/fable-orchestrator/lib/routes";
import { parseArguments } from "../plugins/fable-orchestrator/lib/cli";

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
        "Implement the bounded task directly. Do not expand scope, commit, push, or deploy. Run focused verification and report every changed file.",
    });
    expect(profileFor(empty, "review")).toEqual({
      model: "gpt-5.5",
      sandbox: "read-only",
      instruction:
        "Review only. Do not modify files. Prioritize concrete correctness, security, regression, and test risks with file-level evidence.",
    });
  });

  test("upgrades implement and review to Sol for taste-sensitive classes", () => {
    expect(profileFor(empty, "implement", "ui").model).toBe("gpt-5.6-sol");
    expect(profileFor(empty, "review", "api-design").model).toBe("gpt-5.6-sol");
    // Analyze never upgrades on taste class.
    expect(profileFor(empty, "analyze", "ui").model).toBe("gpt-5.6-luna");
  });
});

describe("engine/routes: grokModelFor env overrides", () => {
  test("defaults to grok-4.5 when unset", () => {
    expect(grokModelFor(empty)).toBe("grok-4.5");
  });

  test("uses FABLE_ORCHESTRATOR_GROK_MODEL when set", () => {
    expect(
      grokModelFor({ FABLE_ORCHESTRATOR_GROK_MODEL: "custom-grok" }),
    ).toBe("custom-grok");
  });

  test("blank or whitespace overrides fall back to grok-4.5", () => {
    expect(grokModelFor({ FABLE_ORCHESTRATOR_GROK_MODEL: " \t " })).toBe(
      "grok-4.5",
    );
  });
});

describe("engine/routes: codexModelFor env overrides", () => {
  test("uses the per-mode override env var when set", () => {
    expect(
      codexModelFor(
        { FABLE_ORCHESTRATOR_ANALYZE_MODEL: "custom-analyze" },
        "analyze",
        null,
      ),
    ).toBe("custom-analyze");
    expect(
      codexModelFor(
        { FABLE_ORCHESTRATOR_IMPLEMENT_MODEL: "custom-implement" },
        "implement",
        null,
      ),
    ).toBe("custom-implement");
    expect(
      codexModelFor(
        { FABLE_ORCHESTRATOR_REVIEW_MODEL: "custom-review" },
        "review",
        null,
      ),
    ).toBe("custom-review");
  });

  test("override beats the taste-sensitive Sol default", () => {
    expect(
      codexModelFor(
        { FABLE_ORCHESTRATOR_IMPLEMENT_MODEL: "custom-implement" },
        "implement",
        "taste-sensitive",
      ),
    ).toBe("custom-implement");
  });

  test("blank or whitespace overrides fall back to defaults", () => {
    expect(
      codexModelFor(
        { FABLE_ORCHESTRATOR_IMPLEMENT_MODEL: " \t " },
        "implement",
        null,
      ),
    ).toBe("gpt-5.5");
  });

  test("reads only the passed env, never the global process.env", () => {
    const key = "FABLE_ORCHESTRATOR_IMPLEMENT_MODEL";
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

  test("grokProfileFor defaults model to grok-4.5", () => {
    expect(grokProfileFor(empty, "implement").model).toBe("grok-4.5");
  });

  test("resolveProfile honors grok route ids with mode-aware sandbox", () => {
    expect(resolveProfile(empty, "composer", "analyze", null, "grok-explore")).toEqual({
      model: "grok-4.5",
      sandbox: "read-only",
      instruction:
        "Analyze only. Do not modify files. Inspect the repository directly and return concise evidence relevant to the task.",
    });
    expect(resolveProfile(empty, "composer", "review", null, "grok-check")).toEqual({
      model: "grok-4.5",
      sandbox: "read-only",
      instruction:
        "Review only. Do not modify files. Prioritize concrete correctness, security, regression, and test risks with file-level evidence.",
    });
    expect(
      resolveProfile(empty, "composer", "implement", null, "grok-implement"),
    ).toEqual({
      model: "grok-4.5",
      sandbox: "workspace-write",
      instruction:
        "Implement the bounded task directly. Do not expand scope, commit, push, or deploy. Run focused verification and report every changed file.",
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
    const previous = process.env.FABLE_ORCHESTRATOR_GROK_MODEL;
    delete process.env.FABLE_ORCHESTRATOR_GROK_MODEL;
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
        model: "grok-4.5",
        sandbox: "read-only",
      });
    } finally {
      if (previous === undefined) {
        delete process.env.FABLE_ORCHESTRATOR_GROK_MODEL;
      } else {
        process.env.FABLE_ORCHESTRATOR_GROK_MODEL = previous;
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
        "Implement the bounded task directly. Do not expand scope, commit, push, or deploy. Run focused verification and report every changed file.",
    });
    expect(resolveProfile(empty, "claude", "review", null)).toEqual({
      model: "claude-opus-4-8",
      sandbox: "read-only",
      instruction:
        "Review only. Do not modify files. Prioritize concrete correctness, security, regression, and test risks with file-level evidence.",
    });
    expect(resolveProfile(empty, "codex", "implement", "ui")).toEqual({
      model: "gpt-5.6-sol",
      sandbox: "workspace-write",
      instruction:
        "Implement the bounded task directly. Do not expand scope, commit, push, or deploy. Run focused verification and report every changed file.",
    });
  });

  test("honors backend-specific model overrides and blank fallback semantics", () => {
    expect(
      resolveProfile(
        { FABLE_ORCHESTRATOR_COMPOSER_MODEL: "custom-composer" },
        "composer",
        "implement",
        "taste-sensitive",
      ).model,
    ).toBe("custom-composer");
    expect(
      resolveProfile(
        { FABLE_ORCHESTRATOR_CLAUDE_MODEL: "claude-sonnet-4-6" },
        "claude",
        "analyze",
        null,
      ).model,
    ).toBe("claude-sonnet-4-6");
    expect(
      resolveProfile(
        { FABLE_ORCHESTRATOR_CLAUDE_MODEL: " \t " },
        "claude",
        "analyze",
        null,
      ).model,
    ).toBe("claude-opus-4-8");
  });
});

describe("engine/routes: Composer orchestrator CLI selection", () => {
  test.each([
    ["analyze", "claude", "opus-explore", "claude-opus-4-8", "read-only"],
    ["implement", "composer", "composer-implement", "composer-2.5", "workspace-write"],
    ["review", "claude", "opus-check", "claude-opus-4-8", "read-only"],
  ] as const)(
    "CLI identity activates the fixed %s worker",
    (mode, backend, route, model, sandbox) => {
      const previousIdentity = process.env.FABLE_ORCHESTRATOR_ORCHESTRATOR;
      const previousClaude = process.env.FABLE_ORCHESTRATOR_CLAUDE_MODEL;
      const previousComposer = process.env.FABLE_ORCHESTRATOR_COMPOSER_MODEL;
      process.env.FABLE_ORCHESTRATOR_ORCHESTRATOR = "fable";
      process.env.FABLE_ORCHESTRATOR_CLAUDE_MODEL = "claude-sonnet-4-6";
      process.env.FABLE_ORCHESTRATOR_COMPOSER_MODEL = "gpt-5.6-sol";
      try {
        const parsed = parseArguments([
          "run",
          "--orchestrator",
          "composer",
          "--mode",
          mode,
          "--task",
          "bounded task",
        ]);
        expect(parsed).toMatchObject({
          orchestratorIdentity: "composer",
          backend,
          requestedAlias: route,
          profileOverride: { model, sandbox },
        });
      } finally {
        if (previousIdentity === undefined) {
          delete process.env.FABLE_ORCHESTRATOR_ORCHESTRATOR;
        } else {
          process.env.FABLE_ORCHESTRATOR_ORCHESTRATOR = previousIdentity;
        }
        if (previousClaude === undefined) {
          delete process.env.FABLE_ORCHESTRATOR_CLAUDE_MODEL;
        } else {
          process.env.FABLE_ORCHESTRATOR_CLAUDE_MODEL = previousClaude;
        }
        if (previousComposer === undefined) {
          delete process.env.FABLE_ORCHESTRATOR_COMPOSER_MODEL;
        } else {
          process.env.FABLE_ORCHESTRATOR_COMPOSER_MODEL = previousComposer;
        }
      }
    },
  );

  test("environment identity activates Composer mode when the CLI is absent", () => {
    const previous = process.env.FABLE_ORCHESTRATOR_ORCHESTRATOR;
    process.env.FABLE_ORCHESTRATOR_ORCHESTRATOR = "composer";
    try {
      expect(
        parseArguments([
          "run",
          "--mode",
          "review",
          "--task",
          "bounded task",
        ]),
      ).toMatchObject({
        orchestratorIdentity: "composer",
        backend: "claude",
        requestedAlias: "opus-check",
      });
    } finally {
      if (previous === undefined) {
        delete process.env.FABLE_ORCHESTRATOR_ORCHESTRATOR;
      } else {
        process.env.FABLE_ORCHESTRATOR_ORCHESTRATOR = previous;
      }
    }
  });
});

describe("engine/routes: routeCapabilities and routesContract", () => {
  test("reports gpt-5.5 as the codex implement and review default", () => {
    const routes = routeCapabilities(empty);
    expect(
      Object.fromEntries(
        routes
          .filter((route) => route.backend === "codex")
          .map((route) => [route.id, route.model]),
      ),
    ).toEqual({
      "codex-explore": "gpt-5.6-luna",
      "codex-implement": "gpt-5.5",
      "codex-check": "gpt-5.5",
    });
  });

  test("emits routes in order with taste variants only on codex routes", () => {
    const routes = routeCapabilities(empty);
    expect(routes.map((route) => route.id)).toEqual([
      "codex-explore",
      "composer-implement",
      "codex-implement",
      "codex-check",
      "opus-explore",
      "opus-implement",
      "opus-check",
      "grok-explore",
      "grok-implement",
      "grok-check",
      "mechanical-post-comment",
      "mechanical-commit-push",
      "mechanical-merge",
    ]);

    const variantIds = routes
      .filter((route) => route.task_class_variants)
      .map((route) => route.id);
    expect(variantIds).toEqual(["codex-implement", "codex-check"]);

    for (const route of routes) {
      if (route.task_class_variants) {
        expect(route.task_class_variants).toEqual(
          TASTE_SENSITIVE_TASK_CLASSES.map((task_class) => ({
            task_class,
            case_sensitive: false,
            trim_whitespace: true,
            model: "gpt-5.6-sol",
          })),
        );
      }
    }
  });

  test("reports grok-4.5 for grok routes and composer-2.5 for composer-implement", () => {
    const routes = routeCapabilities(empty);
    expect(
      Object.fromEntries(
        routes
          .filter((route) => route.id.startsWith("grok-"))
          .map((route) => [route.id, route.model]),
      ),
    ).toEqual({
      "grok-explore": "grok-4.5",
      "grok-implement": "grok-4.5",
      "grok-check": "grok-4.5",
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

  test("resolves route models through the same override precedence as execution", () => {
    const routes = routeCapabilities({
      FABLE_ORCHESTRATOR_ANALYZE_MODEL: "custom-analyze",
      FABLE_ORCHESTRATOR_IMPLEMENT_MODEL: "custom-implement",
      FABLE_ORCHESTRATOR_REVIEW_MODEL: "custom-review",
      FABLE_ORCHESTRATOR_COMPOSER_MODEL: "custom-composer",
      FABLE_ORCHESTRATOR_CLAUDE_MODEL: "custom-opus",
    });
    expect(
      Object.fromEntries(routes.map((route) => [route.id, route.model])),
    ).toEqual({
      "codex-explore": "custom-analyze",
      "composer-implement": "custom-composer",
      "codex-implement": "custom-implement",
      "codex-check": "custom-review",
      "opus-explore": "custom-opus",
      "opus-implement": "custom-opus",
      "opus-check": "custom-opus",
      "grok-explore": "grok-4.5",
      "grok-implement": "grok-4.5",
      "grok-check": "grok-4.5",
      "mechanical-post-comment": "composer-2.5",
      "mechanical-commit-push": "composer-2.5",
      "mechanical-merge": "composer-2.5",
    });
    const codexImplement = routes.find(
      (route) => route.id === "codex-implement",
    );
    expect(
      codexImplement?.task_class_variants?.map((variant) => variant.model),
    ).toEqual(["custom-implement", "custom-implement", "custom-implement", "custom-implement"]);
  });

  test("mechanical routes are fixed to Composer 2.5 and set operation task classes", () => {
    const routes = routeCapabilities({
      FABLE_ORCHESTRATOR_COMPOSER_MODEL: "hostile-composer",
      FABLE_ORCHESTRATOR_IMPLEMENT_MODEL: "hostile-codex",
    });
    expect(
      routes
        .filter((route) => route.id.startsWith("mechanical-"))
        .map(({ id, backend, mode, model, sandbox }) => ({
          id,
          backend,
          mode,
          model,
          sandbox,
        })),
    ).toEqual([
      {
        id: "mechanical-post-comment",
        backend: "composer",
        mode: "implement",
        model: "composer-2.5",
        sandbox: "workspace-write",
      },
      {
        id: "mechanical-commit-push",
        backend: "composer",
        mode: "implement",
        model: "composer-2.5",
        sandbox: "workspace-write",
      },
      {
        id: "mechanical-merge",
        backend: "composer",
        mode: "implement",
        model: "composer-2.5",
        sandbox: "workspace-write",
      },
    ]);

    const parsed = parseArguments([
      "run",
      "--orchestrator",
      "composer",
      "--route",
      "mechanical-post-comment",
      "--task",
      "post the approved review comment",
      "--cwd",
      process.cwd(),
    ]);
    expect(parsed).toMatchObject({
      orchestratorIdentity: "composer",
      backend: "composer",
      mode: "implement",
      requestedAlias: "mechanical-post-comment",
      taskClass: "post-github-comment",
      profileOverride: { model: "composer-2.5", sandbox: "workspace-write" },
    });
  });

  test("routesContract wraps the routes in the versioned envelope", () => {
    const contract = routesContract(empty);
    expect(Object.keys(contract)).toEqual([
      "schema_version",
      "source",
      "orchestrator_identity",
      "orchestrator_identity_support",
      "composer_orchestrator_mode",
      "routes",
    ]);
    expect(contract.schema_version).toBe(ROUTES_SCHEMA_VERSION);
    expect(contract.source).toBe(ROUTES_SOURCE);
    expect(contract.orchestrator_identity).toBeNull();
    expect(contract.composer_orchestrator_mode).toEqual({
      active: false,
      policy: null,
      stack: null,
      worker_stack: [],
      effective_routes: [],
    });
    expect(contract.orchestrator_identity_support).toEqual({
      "claude-code": {
        fable: true,
        sol: false,
        composer: false,
        opus: true,
        "cursor-fable-high": false,
      },
      codex: {
        fable: false,
        sol: true,
        composer: false,
        opus: false,
        "cursor-fable-high": false,
      },
      cursor: {
        fable: false,
        sol: false,
        composer: true,
        opus: false,
        "cursor-fable-high": true,
      },
    });
    expect(contract.routes).toEqual(routeCapabilities(empty));
    expect(
      routesContract({ FABLE_ORCHESTRATOR_ORCHESTRATOR: "fable" })
        .orchestrator_identity,
    ).toBe("fable");
    expect(
      routesContract({ FABLE_ORCHESTRATOR_ORCHESTRATOR: "composer" })
        .composer_orchestrator_mode,
    ).toEqual({
      active: true,
      policy: "composer-economy/v1",
      stack: "(O) Composer -> opus-explore -> composer-implement -> opus-check",
      worker_stack: ["opus-explore", "composer-implement", "opus-check"],
      effective_routes: [
        {
          mode: "analyze",
          route: "opus-explore",
          backend: "claude",
          stable_id: "opus-4.8",
          model: "claude-opus-4-8",
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
          stable_id: "opus-4.8",
          model: "claude-opus-4-8",
          sandbox: "read-only",
        },
      ],
    });
  });

  test("Composer contract fixes active economy routes and marks generic routes ineligible under hostile overrides", () => {
    const contract = routesContract(
      {
        FABLE_ORCHESTRATOR_CLAUDE_MODEL: "hostile-claude-model",
        FABLE_ORCHESTRATOR_COMPOSER_MODEL: "hostile-composer-model",
      },
      "composer",
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
    ).toEqual([
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
        model: "claude-opus-4-8",
        sandbox: "read-only",
        eligible: true,
      },
      {
        id: "opus-check",
        backend: "claude",
        mode: "review",
        model: "claude-opus-4-8",
        sandbox: "read-only",
        eligible: true,
      },
    ]);
    expect(
      contract.routes
        .filter((route) => !route.active)
        .every((route) => route.eligible === false),
    ).toBe(true);
    expect(
      active.map((route) => route.guidance),
    ).toEqual([
      "Fixed economy worker for Composer orchestrator implement; no automatic fallback.",
      "Fixed economy worker for Composer orchestrator analyze; no automatic fallback.",
      "Fixed economy worker for Composer orchestrator review; no automatic fallback.",
    ]);
    const serialized = JSON.stringify(contract);
    expect(serialized).not.toContain("Use when Codex is unavailable");
    expect(serialized).not.toContain("Use when Opus is unavailable");
    expect(serialized).not.toContain("explicitly chooses Grok");
    expect(routeCapabilities({ FABLE_ORCHESTRATOR_CLAUDE_MODEL: "override" }))
      .not.toHaveProperty("0.active");
  });
});
