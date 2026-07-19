import type { Backend, Mode, RouteId, TraceSandbox } from "./trace-schema";
import { minimaxModel } from "./minimax";
import { CANDIDATE_STACKS } from "./model-registry";
import { kimiModel } from "./kimi";
import {
  ECO_ROUTES,
  orchestratorIdentityContract,
  resolveOrchestratorIdentity,
  type OrchestratorIdentity,
} from "./orchestrator-identity";

// Environment is threaded in as a parameter instead of read from the global
// `process.env` so route resolution stays a pure function of its inputs and
// can be exercised directly in unit tests.
export type EnvLike = Record<string, string | undefined>;

export type Profile = {
  model: string;
  sandbox: TraceSandbox;
  instruction: string;
};

// runner-routing-v2 workload classes: finite policy keys used only by the
// automatic implementation candidate-stack selection. Separate from task_class,
// which stays free-form parent observability metadata and never selects a model.
export type WorkloadClass =
  | "default"
  | "light-work"
  | "medium-light-work"
  | "medium-work"
  | "medium-hard-work"
  | "hard-light-work"
  | "hard-work";

export const WORKLOAD_CLASSES: readonly WorkloadClass[] = [
  "default",
  "light-work",
  "medium-light-work",
  "medium-work",
  "medium-hard-work",
  "hard-light-work",
  "hard-work",
];

export function normalizeWorkloadClass(
  value: string | null | undefined,
): WorkloadClass | null {
  if (value == null || value.trim() === "") {
    return "default";
  }
  const normalized = value.trim().toLowerCase();
  return WORKLOAD_CLASSES.includes(normalized as WorkloadClass)
    ? (normalized as WorkloadClass)
    : null;
}

export type RouteCapability = {
  id: RouteId;
  backend: Backend;
  mode: Mode;
  model: string;
  sandbox: Profile["sandbox"];
  guidance: string;
  active?: boolean;
  eligible?: boolean;
};

export const ROUTES_SCHEMA_VERSION = 2;
export const ROUTES_SOURCE = "arc-orchestrator";

// Retained as free-form observability vocabulary only. task_class never selects
// a model; workload_class owns implementation stack selection.
export const TASTE_SENSITIVE_TASK_CLASSES = [
  "taste-sensitive",
  "ui",
  "copy",
  "api-design",
] as const;
export type TasteSensitiveTaskClass =
  (typeof TASTE_SENSITIVE_TASK_CLASSES)[number];
const TASTE_SENSITIVE_TASK_CLASS_SET = new Set<string>(
  TASTE_SENSITIVE_TASK_CLASSES,
);

// Observability vocabulary only — never selects a model.
export function isTasteSensitiveTaskClass(
  taskClass: string | null | undefined,
): boolean {
  if (!taskClass) {
    return false;
  }
  return TASTE_SENSITIVE_TASK_CLASS_SET.has(taskClass.trim().toLowerCase());
}

const CODEX_DEFAULT_MODELS: Record<Mode, string> = {
  analyze: "gpt-5.6-luna",
  implement: "gpt-5.5",
  review: "gpt-5.5",
};

export function grokModelFor(env: EnvLike): string {
  return env.ARC_ORCHESTRATOR_GROK_MODEL?.trim() || "grok-4.5";
}

export function isGrokRouteId(routeId: string | null | undefined): boolean {
  return routeId?.startsWith("grok-") ?? false;
}

export function grokProfileFor(env: EnvLike, mode: Mode): Profile {
  const base = profileFor(env, mode, null);
  return {
    model: grokModelFor(env),
    sandbox: mode === "implement" ? "workspace-write" : "read-only",
    instruction: base.instruction,
  };
}

export function codexModelFor(
  env: EnvLike,
  mode: Mode,
  _taskClass: string | null | undefined = null,
): string {
  const override =
    mode === "analyze"
      ? env.ARC_ORCHESTRATOR_ANALYZE_MODEL?.trim()
      : mode === "implement"
        ? env.ARC_ORCHESTRATOR_IMPLEMENT_MODEL?.trim()
        : env.ARC_ORCHESTRATOR_REVIEW_MODEL?.trim();
  if (override) {
    return override;
  }
  return CODEX_DEFAULT_MODELS[mode];
}

export function kimiModelFor(env: EnvLike): string {
  // OpenCode transport for public kimi-* / --backend opencode. Do not read
  // ARC_ORCHESTRATOR_KIMI_MODEL — that env owns direct --backend kimi
  // (Anthropic-compatible kimi-k3[1m] via kimiModel()).
  return env.ARC_ORCHESTRATOR_OPENCODE_MODEL?.trim() || "moonshotai/kimi-k3";
}

export function profileFor(
  env: EnvLike,
  mode: Mode,
  taskClass: string | null | undefined = null,
): Profile {
  const profiles: Record<Mode, Profile> = {
    analyze: {
      model: codexModelFor(env, "analyze", taskClass),
      sandbox: "read-only",
      instruction:
        "Analyze only. Do not modify files. Inspect the repository directly and return concise evidence relevant to the task.",
    },
    implement: {
      model: codexModelFor(env, "implement", taskClass),
      sandbox: "workspace-write",
      instruction:
        "Implement the bounded task directly. Do not expand scope, commit, push, or deploy. Run focused verification and report every changed file.",
    },
    review: {
      model: codexModelFor(env, "review", taskClass),
      sandbox: "read-only",
      instruction:
        "Review only. Do not modify files. Prioritize concrete correctness, security, regression, and test risks with file-level evidence.",
    },
  };

  return profiles[mode];
}

// Explicit diagnostic/manual-recovery routes. Each executes exactly one target
// once; explicit routes never inherit the automatic workload/ADR fallback
// chains. Explicit alias models are fixed contract facts and ignore ambient
// ARC_ORCHESTRATOR_*_MODEL env; direct --backend dispatch still uses
// env-overridable backend defaults via resolveProfile without a route id.
const ROUTE_PROFILES: Record<RouteId, { backend: Backend; mode: Mode }> = {
  "composer-implement": { backend: "composer", mode: "implement" },
  "opus-explore": { backend: "claude", mode: "analyze" },
  "opus-implement": { backend: "claude", mode: "implement" },
  "opus-check": { backend: "claude", mode: "review" },
  "grok-explore": { backend: "composer", mode: "analyze" },
  "grok-implement": { backend: "composer", mode: "implement" },
  "grok-check": { backend: "composer", mode: "review" },
  "kimi-explore": { backend: "opencode", mode: "analyze" },
  "kimi-implement": { backend: "opencode", mode: "implement" },
  "kimi-check": { backend: "opencode", mode: "review" },
  "fable-explore": { backend: "claude", mode: "analyze" },
  "fable-implement": { backend: "claude", mode: "implement" },
  "fable-check": { backend: "claude", mode: "review" },
  "cursor-fable-explore": { backend: "composer", mode: "analyze" },
  "cursor-fable-implement": { backend: "composer", mode: "implement" },
  "cursor-fable-check": { backend: "composer", mode: "review" },
  "minimax-explore": { backend: "minimax", mode: "analyze" },
  "minimax-implement": { backend: "minimax", mode: "implement" },
  "minimax-check": { backend: "minimax", mode: "review" },
  "composer-explore": { backend: "composer", mode: "analyze" },
  "composer-check": { backend: "composer", mode: "review" },
};

// Explicit alias models are pinned contract facts. Ambient model env never
// rewrites these; only direct --backend resolution (no route id) honors env.
// Removed codex-/sol-/terra-* public aliases: Codex is reachable only via the
// automatic ADR fallback chain (or direct --backend without --route).
const FIXED_ROUTE_MODELS: Partial<Record<RouteId, string>> = {
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
  "fable-explore": "claude-fable-5",
  "fable-implement": "claude-fable-5",
  "fable-check": "claude-fable-5",
  "cursor-fable-explore": "claude-fable-5-thinking-high",
  "cursor-fable-implement": "claude-fable-5-thinking-high",
  "cursor-fable-check": "claude-fable-5-thinking-high",
};

export function routeProfileFor(
  routeId: RouteId,
): { backend: Backend; mode: Mode } | undefined {
  return ROUTE_PROFILES[routeId];
}

function backendDefaultModel(
  env: EnvLike,
  backend: Backend,
  mode: Mode,
  taskClass: string | null | undefined,
): string {
  if (backend === "composer") {
    return env.ARC_ORCHESTRATOR_COMPOSER_MODEL?.trim() || "composer-2.5";
  }
  if (backend === "claude") {
    return env.ARC_ORCHESTRATOR_CLAUDE_MODEL?.trim() || "claude-opus-4-8";
  }
  if (backend === "minimax") {
    return minimaxModel(env);
  }
  if (backend === "opencode") {
    return kimiModelFor(env);
  }
  if (backend === "kimi") {
    return kimiModel(env);
  }
  return codexModelFor(env, mode, taskClass);
}

export function resolveProfile(
  env: EnvLike,
  backend: Backend,
  mode: Mode,
  taskClass: string | null | undefined,
  routeId?: RouteId | null,
): Profile {
  const route = routeId ? ROUTE_PROFILES[routeId] : undefined;
  if (route) {
    const base = profileFor(env, route.mode, taskClass);
    return {
      model:
        FIXED_ROUTE_MODELS[routeId as RouteId] ??
        backendDefaultModel(env, route.backend, route.mode, taskClass),
      sandbox: route.mode === "implement" ? "workspace-write" : "read-only",
      instruction: base.instruction,
    };
  }

  if (backend === "composer") {
    return {
      model: env.ARC_ORCHESTRATOR_COMPOSER_MODEL?.trim() || "composer-2.5",
      sandbox: "workspace-write",
      instruction: profileFor(env, mode, taskClass).instruction,
    };
  }

  if (backend === "claude") {
    const profile = profileFor(env, mode, taskClass);
    return {
      ...profile,
      model: env.ARC_ORCHESTRATOR_CLAUDE_MODEL?.trim() || "claude-opus-4-8",
    };
  }

  if (backend === "minimax") {
    const profile = profileFor(env, mode, taskClass);
    return {
      ...profile,
      model: minimaxModel(env),
    };
  }

  if (backend === "opencode") {
    // OpenCode Kimi enforces the mode-specific permission boundary: analyze and
    // review are read-only, implement is workspace-write.
    const profile = profileFor(env, mode, taskClass);
    return {
      ...profile,
      model: kimiModelFor(env),
    };
  }

  if (backend === "kimi") {
    const profile = profileFor(env, mode, taskClass);
    return {
      ...profile,
      model: kimiModel(env),
    };
  }

  return profileFor(env, mode, taskClass);
}

// This is the public capability contract for external planners. Keep route
// selection facts here, but resolve models and sandboxes through the same
// functions used by execution so the exported defaults cannot drift.
export function routeCapabilities(env: EnvLike): RouteCapability[] {
  const route = (id: RouteId, guidance: string): RouteCapability => {
    const definition = ROUTE_PROFILES[id];
    const profile = resolveProfile(
      env,
      definition.backend,
      definition.mode,
      null,
      id,
    );
    return {
      id,
      backend: definition.backend,
      mode: definition.mode,
      model: profile.model,
      sandbox: profile.sandbox,
      guidance,
    };
  };

  const diagnostic = (id: RouteId): RouteCapability =>
    route(
      id,
      `Explicit ${ROUTE_PROFILES[id].mode} diagnostic/manual-recovery route; executes exactly one pinned model and does not inherit the automatic workload/ADR fallback chain.`,
    );

  return [
    route(
      "composer-implement",
      "Explicit implement diagnostic/manual-recovery route pinned to Composer 2.5 (or the composer model override).",
    ),
    route(
      "opus-explore",
      "Explicit explore diagnostic/manual-recovery route pinned to Opus 4.8 (or the Claude model override).",
    ),
    route(
      "opus-implement",
      "Explicit implement diagnostic/manual-recovery route pinned to Opus 4.8 (or the Claude model override).",
    ),
    route(
      "opus-check",
      "Explicit check diagnostic/manual-recovery route pinned to Opus 4.8 (or the Claude model override).",
    ),
    route(
      "grok-explore",
      "Explicit explore diagnostic/manual-recovery route pinned to Grok 4.5.",
    ),
    route(
      "grok-implement",
      "Explicit implement diagnostic/manual-recovery route pinned to Grok 4.5.",
    ),
    route(
      "grok-check",
      "Explicit check diagnostic/manual-recovery route pinned to Grok 4.5.",
    ),
    diagnostic("kimi-explore"),
    diagnostic("kimi-implement"),
    diagnostic("kimi-check"),
    diagnostic("fable-explore"),
    diagnostic("fable-implement"),
    diagnostic("fable-check"),
    diagnostic("cursor-fable-explore"),
    diagnostic("cursor-fable-implement"),
    diagnostic("cursor-fable-check"),
    diagnostic("minimax-explore"),
    diagnostic("minimax-implement"),
    diagnostic("minimax-check"),
    diagnostic("composer-explore"),
    diagnostic("composer-check"),
  ];
}

// The full, versioned routes contract emitted by `routes --json`. Building it
// here keeps the envelope shape and the route facts resolved through the same
// code path that execution uses.
export function routesContract(
  env: EnvLike,
  orchestratorIdentity?: OrchestratorIdentity | null,
) {
  const activeIdentity =
    orchestratorIdentity === undefined
      ? resolveOrchestratorIdentity(undefined, env)
      : orchestratorIdentity;
  const routes = routeCapabilities(env);
  const observableRoutes =
    activeIdentity === "eco"
      ? routes.map((route) => {
          const economyRoute = ECO_ROUTES[route.mode];
          const active = route.id === economyRoute.route;
          return {
            ...route,
            ...(active
              ? {
                  backend: economyRoute.backend,
                  model: economyRoute.model,
                  sandbox: economyRoute.sandbox,
                }
              : {}),
            active,
            eligible: active,
            guidance: active
              ? route.mode === "implement"
                ? `Fixed economy worker for Eco orchestrator ${route.mode}; no automatic backup.`
                : `Fixed economy worker for Eco orchestrator ${route.mode}; availability backup is grok-${route.mode === "analyze" ? "explore" : "check"}.`
              : "Inactive and ineligible in eco mode.",
          };
        })
      : routes;
  return {
    schema_version: ROUTES_SCHEMA_VERSION,
    source: ROUTES_SOURCE,
    ...orchestratorIdentityContract(activeIdentity),
    workload_classes: WORKLOAD_CLASSES,
    routing_policy: {
      label: "runner-routing-v2",
      fallback: "availability-only",
      // Optional fail-closed CLI marker for clients such as ARC Pi. Exact value
      // is accepted only for automatic no-backend/no-route delegation; other
      // values and incompatible intents are rejected. Omitting the flag is fine.
      cli_marker: {
        option: "--routing-policy",
        value: "runner-routing-v2",
        optional: true,
        intents: ["automatic"],
      },
      candidate_stacks: CANDIDATE_STACKS.map((stack) => ({
        route: stack.route,
        workload_class: stack.workloadClass ?? null,
        candidates: stack.candidates,
        automatic_fallback: stack.automaticFallback,
      })),
    },
    routes: observableRoutes,
  };
}
