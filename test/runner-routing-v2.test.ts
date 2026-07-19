import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { candidateStackForRoute } from "../plugins/fable-orchestrator/lib/model-registry";
import { routeCapabilities, routesContract } from "../plugins/fable-orchestrator/lib/routes";
import { resolvePublicAlias } from "../plugins/fable-orchestrator/lib/capability-routes";
import {
  resolveRoutingIntent,
  resolveRoutingPolicyMarker,
  RUNNER_ROUTING_V2_POLICY,
} from "../plugins/fable-orchestrator/lib/routing-intent";
import { parseArguments } from "../plugins/fable-orchestrator/lib/cli";
import { codexModelFor } from "../plugins/fable-orchestrator/lib/routes";
import {
  buildOpenCodeCommand,
  OPENCODE_READ_ONLY_AGENT,
  openCodePermissionEnv,
  openCodeReadOnlyConfigContent,
} from "../plugins/fable-orchestrator/lib/spawn-adapter";
import {
  classifyBackendOutage,
  collectOpenCodeErrors,
} from "../plugins/fable-orchestrator/lib/outage";
import { normalizeBackendOutage } from "../plugins/fable-orchestrator/lib/failure-classification";

const implement = (workloadClass: string) =>
  candidateStackForRoute(
    "implement.workspace-write.v1",
    null,
    workloadClass,
  )?.candidates;

const EXPLICIT_PINS: Array<[string, string, string]> = [
  ["codex-explore", "explore.read-only.v1", "gpt-5.6-luna"],
  ["codex-implement", "implement.workspace-write.v1", "gpt-5.5"],
  ["codex-check", "check.read-only.v1", "gpt-5.5"],
  ["opus-explore", "explore.read-only.v1", "opus-4.8"],
  ["opus-implement", "implement.workspace-write.v1", "opus-4.8"],
  ["opus-check", "check.read-only.v1", "opus-4.8"],
  ["composer-implement", "implement.workspace-write.v1", "composer-2.5"],
  ["composer-explore", "explore.read-only.v1", "composer-2.5"],
  ["composer-check", "check.read-only.v1", "composer-2.5"],
  ["grok-explore", "explore.read-only.v1", "grok-4.5"],
  ["grok-implement", "implement.workspace-write.v1", "grok-4.5"],
  ["grok-check", "check.read-only.v1", "grok-4.5"],
  ["kimi-explore", "explore.read-only.v1", "kimi-k3"],
  ["kimi-implement", "implement.workspace-write.v1", "kimi-k3"],
  ["kimi-check", "check.read-only.v1", "kimi-k3"],
  ["fable-explore", "explore.read-only.v1", "fable-5"],
  ["fable-implement", "implement.workspace-write.v1", "fable-5"],
  ["fable-check", "check.read-only.v1", "fable-5"],
  ["cursor-fable-explore", "explore.read-only.v1", "cursor-fable-high"],
  ["cursor-fable-implement", "implement.workspace-write.v1", "cursor-fable-high"],
  ["cursor-fable-check", "check.read-only.v1", "cursor-fable-high"],
  ["minimax-explore", "explore.read-only.v1", "minimax-m3"],
  ["minimax-implement", "implement.workspace-write.v1", "minimax-m3"],
  ["minimax-check", "check.read-only.v1", "minimax-m3"],
  ["terra-implement", "implement.workspace-write.v1", "gpt-5.6-terra"],
  ["sol-explore", "explore.read-only.v1", "gpt-5.6-sol"],
  ["sol-check", "check.read-only.v1", "gpt-5.6-sol"],
  ["sol-implement", "implement.workspace-write.v1", "gpt-5.6-sol"],
  ["opus-review", "taste-review.read-only.v1", "opus-4.8"],
];

describe("runner-routing-v2", () => {
  test("advertises all executable policy workers and workload classes", () => {
    const contract = routesContract({});
    expect(contract.workload_classes).toEqual([
      "default", "light-work", "medium-light-work", "medium-work",
      "medium-hard-work", "hard-light-work", "hard-work",
    ]);
    expect(routeCapabilities({}).find((route) => route.id === "kimi-implement"))
      .toMatchObject({ backend: "opencode", model: "moonshotai/kimi-k3" });
    expect(routeCapabilities({}).find((route) => route.id === "composer-check"))
      .toMatchObject({ backend: "composer", sandbox: "read-only" });
    expect(
      routeCapabilities({}).every((route) => !("task_class_variants" in route)),
    ).toBe(true);
  });

  test("uses exact implementation stacks and no default/light fallback", () => {
    expect(implement("default")).toEqual(["composer-2.5"]);
    expect(implement("light-work")).toEqual(["grok-4.5"]);
    expect(implement("medium-light-work")).toEqual([
      "opus-4.8", "gpt-5.5", "kimi-k3", "grok-4.5", "minimax-m3", "composer-2.5",
    ]);
    expect(implement("medium-work")).toEqual([
      "gpt-5.5", "opus-4.8", "kimi-k3", "grok-4.5", "minimax-m3", "composer-2.5",
    ]);
    expect(implement("medium-hard-work")).toEqual([
      "gpt-5.6-terra", "fable-5", "cursor-fable-high", "kimi-k3", "minimax-m3", "composer-2.5",
    ]);
    expect(implement("hard-light-work")).toEqual([
      "gpt-5.6-sol", "fable-5", "cursor-fable-high", "kimi-k3", "minimax-m3", "composer-2.5",
    ]);
    expect(implement("hard-work")).toEqual([
      "fable-5", "gpt-5.6-sol", "cursor-fable-high", "kimi-k3", "minimax-m3", "composer-2.5",
    ]);
  });

  test("uses the same availability-only read-only chain for analyze and review", () => {
    const expected = [
      "fable-5", "gpt-5.6-sol", "kimi-k3", "cursor-fable-high",
      "grok-4.5", "minimax-m3", "composer-2.5",
    ];
    expect(candidateStackForRoute("explore.read-only.v1", null)?.candidates)
      .toEqual(expected);
    expect(candidateStackForRoute("check.read-only.v1", null)?.candidates)
      .toEqual(expected);
    expect(candidateStackForRoute("explore.read-only.v1", "fable-explore")?.candidates)
      .toEqual(["fable-5"]);
    expect(candidateStackForRoute("check.read-only.v1", "fable-check")?.candidates)
      .toEqual(["fable-5"]);
  });

  test("resolves the four routing intents", () => {
    expect(resolveRoutingIntent({ backendExplicit: false })).toBe("automatic");
    expect(
      resolveRoutingIntent({ requestedAlias: "codex-implement" }),
    ).toBe("explicit");
    expect(resolveRoutingIntent({ backendExplicit: true })).toBe("direct");
    expect(resolveRoutingIntent({ workerModel: "gpt-5.5" })).toBe("direct");
    expect(
      resolveRoutingIntent({ orchestratorIdentity: "composer" }),
    ).toBe("economy");
  });

  test("accepts the exact runner-routing-v2 marker on automatic workloads", () => {
    for (const mode of ["analyze", "review", "implement"] as const) {
      const parsed = parseArguments([
        "run",
        "--mode",
        mode,
        "--task",
        "bounded automatic task",
        "--routing-policy",
        RUNNER_ROUTING_V2_POLICY,
        "--cwd",
        process.cwd(),
      ]);
      expect(parsed).toMatchObject({
        routingIntent: "automatic",
        routingPolicy: RUNNER_ROUTING_V2_POLICY,
        backendExplicit: false,
        requestedAlias: null,
      });
    }
    expect(
      resolveRoutingPolicyMarker({
        routingPolicy: RUNNER_ROUTING_V2_POLICY,
        routingIntent: "automatic",
      }),
    ).toEqual({ ok: true, marker: RUNNER_ROUTING_V2_POLICY });
  });

  test("keeps automatic delegation optional without the marker", () => {
    const parsed = parseArguments([
      "run",
      "--mode",
      "implement",
      "--task",
      "bounded automatic task",
      "--cwd",
      process.cwd(),
    ]);
    expect(parsed.routingIntent).toBe("automatic");
    expect(parsed.routingPolicy).toBeNull();
    expect(
      resolveRoutingPolicyMarker({
        routingPolicy: null,
        routingIntent: "automatic",
      }),
    ).toEqual({ ok: true, marker: null });
  });

  test("rejects a wrong routing-policy marker", () => {
    expect(
      resolveRoutingPolicyMarker({
        routingPolicy: "candidate-stacks/v1",
        routingIntent: "automatic",
      }),
    ).toEqual({
      ok: false,
      error: "--routing-policy must be runner-routing-v2",
    });
  });

  test("rejects the marker with explicit backend, route, or economy", () => {
    for (const routingIntent of ["explicit", "direct", "economy"] as const) {
      const result = resolveRoutingPolicyMarker({
        routingPolicy: RUNNER_ROUTING_V2_POLICY,
        routingIntent,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("only valid for automatic delegation");
      }
    }

    const runner = new URL(
      "../plugins/fable-orchestrator/bin/fable-orchestrator",
      import.meta.url,
    ).pathname;
    const cases: string[][] = [
      ["--routing-policy", "candidate-stacks/v1", "--mode", "analyze", "--task", "x"],
      [
        "--routing-policy",
        RUNNER_ROUTING_V2_POLICY,
        "--backend",
        "codex",
        "--mode",
        "analyze",
        "--task",
        "x",
      ],
      [
        "--routing-policy",
        RUNNER_ROUTING_V2_POLICY,
        "--route",
        "codex-explore",
        "--task",
        "x",
      ],
      [
        "--routing-policy",
        RUNNER_ROUTING_V2_POLICY,
        "--orchestrator",
        "composer",
        "--mode",
        "implement",
        "--task",
        "x",
      ],
    ];
    for (const args of cases) {
      const result = Bun.spawnSync([runner, "run", ...args, "--cwd", process.cwd()], {
        stdout: "pipe",
        stderr: "pipe",
        env: process.env,
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("--routing-policy");
    }
  });

  test("marker does not change automatic stack policy behavior", () => {
    const withMarker = resolveRoutingIntent({ backendExplicit: false });
    const withoutMarker = resolveRoutingIntent({ backendExplicit: false });
    expect(withMarker).toBe("automatic");
    expect(withoutMarker).toBe("automatic");
    expect(implement("medium-work")).toEqual([
      "gpt-5.5", "opus-4.8", "kimi-k3", "grok-4.5", "minimax-m3", "composer-2.5",
    ]);
    expect(routesContract({}).routing_policy).toMatchObject({
      label: RUNNER_ROUTING_V2_POLICY,
      fallback: "availability-only",
      cli_marker: {
        option: "--routing-policy",
        value: RUNNER_ROUTING_V2_POLICY,
        optional: true,
        intents: ["automatic"],
      },
    });
  });

  test("pins every explicit route alias to exactly one model", () => {
    for (const [alias, route, candidate] of EXPLICIT_PINS) {
      expect(candidateStackForRoute(route as never, alias)?.candidates).toEqual([
        candidate,
      ]);
      expect(candidateStackForRoute(route as never, alias)?.automaticFallback)
        .toBe(false);
    }
  });

  test("pinned routeCapabilities models ignore hostile ambient model env", () => {
    const hostile = {
      FABLE_ORCHESTRATOR_ANALYZE_MODEL: "hostile-analyze",
      FABLE_ORCHESTRATOR_IMPLEMENT_MODEL: "hostile-implement",
      FABLE_ORCHESTRATOR_REVIEW_MODEL: "hostile-review",
      FABLE_ORCHESTRATOR_CLAUDE_MODEL: "hostile-claude",
      FABLE_ORCHESTRATOR_COMPOSER_MODEL: "hostile-composer",
      FABLE_ORCHESTRATOR_GROK_MODEL: "hostile-grok",
      FABLE_ORCHESTRATOR_KIMI_MODEL: "hostile-kimi",
      FABLE_ORCHESTRATOR_OPENCODE_MODEL: "hostile-opencode",
      FABLE_ORCHESTRATOR_MINIMAX_MODEL: "hostile-minimax",
    };
    const pinned: Record<string, string> = {
      "codex-explore": "gpt-5.6-luna",
      "codex-implement": "gpt-5.5",
      "codex-check": "gpt-5.5",
      "opus-explore": "claude-opus-4-8",
      "opus-implement": "claude-opus-4-8",
      "opus-check": "claude-opus-4-8",
      "composer-implement": "composer-2.5",
      "composer-explore": "composer-2.5",
      "composer-check": "composer-2.5",
      "grok-explore": "grok-4.5",
      "grok-implement": "grok-4.5",
      "grok-check": "grok-4.5",
      "kimi-explore": "moonshotai/kimi-k3",
      "kimi-implement": "moonshotai/kimi-k3",
      "kimi-check": "moonshotai/kimi-k3",
      "minimax-explore": "MiniMax-M3",
      "minimax-implement": "MiniMax-M3",
      "minimax-check": "MiniMax-M3",
      "sol-explore": "gpt-5.6-sol",
      "sol-check": "gpt-5.6-sol",
      "sol-implement": "gpt-5.6-sol",
      "terra-implement": "gpt-5.6-terra",
      "fable-explore": "claude-fable-5",
      "fable-implement": "claude-fable-5",
      "fable-check": "claude-fable-5",
      "cursor-fable-explore": "claude-fable-5-thinking-high",
      "cursor-fable-implement": "claude-fable-5-thinking-high",
      "cursor-fable-check": "claude-fable-5-thinking-high",
    };
    const routes = routeCapabilities(hostile);
    for (const [id, model] of Object.entries(pinned)) {
      expect(routes.find((route) => route.id === id)?.model).toBe(model);
    }
  });

  test("pins sol-explore and sol-check as single-candidate Sol diagnostics", () => {
    expect(resolvePublicAlias("sol-explore")).toMatchObject({
      alias: "sol-explore",
      kind: "executable-route",
      capabilityRoute: "explore.read-only.v1",
    });
    expect(resolvePublicAlias("sol-check")).toMatchObject({
      alias: "sol-check",
      kind: "executable-route",
      capabilityRoute: "check.read-only.v1",
    });
    expect(routeCapabilities({}).find((route) => route.id === "sol-explore"))
      .toMatchObject({
        backend: "codex",
        mode: "analyze",
        model: "gpt-5.6-sol",
        sandbox: "read-only",
      });
    expect(routeCapabilities({}).find((route) => route.id === "sol-check"))
      .toMatchObject({
        backend: "codex",
        mode: "review",
        model: "gpt-5.6-sol",
        sandbox: "read-only",
      });
    expect(routesContract({}).routes.map((route) => route.id)).toEqual(
      expect.arrayContaining(["sol-explore", "sol-check", "sol-implement"]),
    );
  });

  test("automatic stacks ignore an inferred backend alias", () => {
    expect(
      candidateStackForRoute("implement.workspace-write.v1", null, "medium-work")
        ?.candidates,
    ).toEqual([
      "gpt-5.5", "opus-4.8", "kimi-k3", "grok-4.5", "minimax-m3", "composer-2.5",
    ]);
    expect(
      candidateStackForRoute(
        "implement.workspace-write.v1",
        "composer-implement",
        "medium-work",
      )?.candidates,
    ).toEqual(["composer-2.5"]);
  });

  test("task_class does not select Sol on direct Codex defaults", () => {
    expect(codexModelFor({}, "implement", "taste-sensitive")).toBe("gpt-5.5");
    expect(codexModelFor({}, "review", "ui")).toBe("gpt-5.5");
    expect(codexModelFor({}, "implement", "api-design")).toBe("gpt-5.5");
    expect(codexModelFor({}, "analyze", "taste-sensitive")).toBe("gpt-5.6-luna");
  });

  test("OpenCode analyze/review uses controlled agent config", () => {
    for (const mode of ["analyze", "review"] as const) {
      const command = buildOpenCodeCommand({
        opencodeBinary: "opencode",
        profile: { model: "moonshotai/kimi-k3" },
        prompt: "Read-only task",
        mode,
      });
      expect(command).toEqual([
        "opencode",
        "--pure",
        "run",
        "--agent",
        OPENCODE_READ_ONLY_AGENT,
        "--format",
        "json",
        "--model",
        "moonshotai/kimi-k3",
        "Read-only task",
      ]);
      const env = openCodePermissionEnv(mode, {});
      expect(env.OPENCODE_CONFIG_CONTENT).toBe(openCodeReadOnlyConfigContent());
      expect(JSON.parse(env.OPENCODE_PERMISSION!)).toMatchObject({
        edit: "deny",
        write: "deny",
        bash: "deny",
        task: "deny",
        webfetch: "deny",
        websearch: "deny",
      });
    }
    const implementCommand = buildOpenCodeCommand({
      opencodeBinary: "opencode",
      profile: { model: "moonshotai/kimi-k3" },
      prompt: "Implement",
      mode: "implement",
    });
    expect(implementCommand).not.toContain("--agent");
    expect(implementCommand).toContain("--pure");
  });

  test("OpenCode JSONL errors classify as availability for automatic continuation", () => {
    const stream = [
      JSON.stringify({ type: "error", message: "authentication failed" }),
      JSON.stringify({ type: "error", message: "model unavailable: moonshotai/kimi-k3" }),
    ].join("\n");
    expect(collectOpenCodeErrors(stream)).toEqual([
      "authentication failed",
      "model unavailable: moonshotai/kimi-k3",
    ]);
    expect(classifyBackendOutage(["authentication failed"])).toBe("auth");
    expect(classifyBackendOutage(["model unavailable: moonshotai/kimi-k3"])).toBe(
      "model_unavailable",
    );
    expect(
      normalizeBackendOutage("auth", { demonstratedTransient: true }).kind,
    ).toBe("retryable");
    expect(normalizeBackendOutage("model_unavailable").kind).toBe("retryable");
    expect(normalizeBackendOutage("usage_limit").kind).toBe("retryable");
    expect(normalizeBackendOutage("missing_binary").kind).toBe("retryable");
    // Direct semantics: auth without demonstratedTransient stays terminal.
    expect(normalizeBackendOutage("auth").kind).toBe("terminal");
  });

  test("does not retain mechanical aliases", () => {
    expect(resolvePublicAlias("mechanical-post-comment")).toBeUndefined();
    expect(resolvePublicAlias("mechanical-commit-push")).toBeUndefined();
    expect(resolvePublicAlias("mechanical-merge")).toBeUndefined();
  });

  test("active policy docs do not claim Fable/Sol are never automatic workers", () => {
    const policy = readFileSync(
      new URL(
        "../plugins/fable-orchestrator/skills/orchestrate/references/routing-policy.md",
        import.meta.url,
      ),
      "utf8",
    );
    expect(policy).not.toContain("Fable stays parent-only");
    expect(policy).not.toContain("never a worker candidate");
    expect(policy).not.toMatch(/Sol requires explicit parent authorization and is never an automatic fallback/);
    expect(policy).toContain("ordinary ADR 0004 workers");
  });
});
