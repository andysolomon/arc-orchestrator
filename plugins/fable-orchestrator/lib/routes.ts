import type { Backend, Mode, RouteId, TraceSandbox } from "./trace-schema";

// Environment is threaded in as a parameter instead of read from the global
// `process.env` so route resolution stays a pure function of its inputs and
// can be exercised directly in unit tests.
export type EnvLike = Record<string, string | undefined>;

export type Profile = {
  model: string;
  sandbox: TraceSandbox;
  instruction: string;
};

export type RouteCapability = {
  id: RouteId;
  backend: Backend;
  mode: Mode;
  model: string;
  sandbox: Profile["sandbox"];
  guidance: string;
  task_class_variants?: Array<{
    task_class: TasteSensitiveTaskClass;
    case_sensitive: false;
    trim_whitespace: true;
    model: string;
  }>;
};

export const ROUTES_SCHEMA_VERSION = 1;
export const ROUTES_SOURCE = "fable-orchestrator";

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

export function codexModelFor(
  env: EnvLike,
  mode: Mode,
  taskClass: string | null | undefined,
): string {
  const override =
    mode === "analyze"
      ? env.FABLE_ORCHESTRATOR_ANALYZE_MODEL?.trim()
      : mode === "implement"
        ? env.FABLE_ORCHESTRATOR_IMPLEMENT_MODEL?.trim()
        : env.FABLE_ORCHESTRATOR_REVIEW_MODEL?.trim();
  if (override) {
    return override;
  }
  if (mode !== "analyze" && isTasteSensitiveTaskClass(taskClass)) {
    return "gpt-5.6-sol";
  }
  return CODEX_DEFAULT_MODELS[mode];
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

export function resolveProfile(
  env: EnvLike,
  backend: Backend,
  mode: Mode,
  taskClass: string | null | undefined,
): Profile {
  if (backend === "composer") {
    return {
      model: env.FABLE_ORCHESTRATOR_COMPOSER_MODEL?.trim() || "composer-2.5",
      sandbox: "workspace-write",
      instruction: profileFor(env, mode, taskClass).instruction,
    };
  }

  if (backend === "claude") {
    const profile = profileFor(env, mode, taskClass);
    return {
      ...profile,
      model:
        env.FABLE_ORCHESTRATOR_CLAUDE_MODEL?.trim() || "claude-opus-4-8",
    };
  }

  return profileFor(env, mode, taskClass);
}

// This is the public capability contract for external planners. Keep route
// selection facts here, but resolve models and sandboxes through the same
// functions used by execution so the exported defaults cannot drift.
export function routeCapabilities(env: EnvLike): RouteCapability[] {
  const route = (
    id: RouteId,
    backend: Backend,
    mode: Mode,
    guidance: string,
    tasteSensitive = false,
  ): RouteCapability => ({
    id,
    backend,
    mode,
    model: resolveProfile(env, backend, mode, null).model,
    sandbox: resolveProfile(env, backend, mode, null).sandbox,
    guidance,
    ...(tasteSensitive
      ? {
          task_class_variants: TASTE_SENSITIVE_TASK_CLASSES.map(
            (taskClass) => ({
              task_class: taskClass,
              case_sensitive: false as const,
              trim_whitespace: true as const,
              model: resolveProfile(env, backend, mode, taskClass).model,
            }),
          ),
        }
      : {}),
  });

  return [
    route(
      "codex-explore",
      "codex",
      "analyze",
      "Use for bounded repository investigation and evidence gathering.",
    ),
    route(
      "composer-implement",
      "composer",
      "implement",
      "Use for clear, routine, or high-volume implementation work.",
    ),
    route(
      "codex-implement",
      "codex",
      "implement",
      "Use for difficult implementation, debugging, or escalation.",
      true,
    ),
    route(
      "codex-check",
      "codex",
      "review",
      "Use for an independent correctness, security, or regression check.",
      true,
    ),
    route(
      "opus-explore",
      "claude",
      "analyze",
      "Use when Codex is unavailable or the parent explicitly chooses Opus exploration.",
    ),
    route(
      "opus-implement",
      "claude",
      "implement",
      "Use when Codex is unavailable or the parent explicitly chooses Opus implementation.",
    ),
    route(
      "opus-check",
      "claude",
      "review",
      "Use when Codex is unavailable or the parent explicitly chooses an Opus check.",
    ),
  ];
}

// The full, versioned routes contract emitted by `routes --json`. Building it
// here keeps the envelope shape and the route facts resolved through the same
// code path that execution uses.
export function routesContract(env: EnvLike): {
  schema_version: number;
  source: string;
  routes: RouteCapability[];
} {
  return {
    schema_version: ROUTES_SCHEMA_VERSION,
    source: ROUTES_SOURCE,
    routes: routeCapabilities(env),
  };
}
