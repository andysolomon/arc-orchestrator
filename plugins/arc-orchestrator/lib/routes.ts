import {
  TASK_PHASES,
  PUBLIC_ROUTE_MODEL_BINDINGS,
  PUBLIC_ROUTE_SUFFIXES,
  type Backend,
  type Mode,
  type PublicRouteSuffix,
  type RouteId,
  type TaskPhase,
  type TraceSandbox,
} from "./trace-schema";
import { minimaxModel } from "./minimax";
import { MODEL_POLICY, MODEL_POLICY_SOURCE } from "./model-policy";
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

export type ArtifactContainmentStrength =
  | "path-scoped-configured"
  | "repo-root"
  | "prompt-only";

export type WorkerArtifactCapability = {
  artifactDirectory: string;
  artifactTarget: string;
  containment: ArtifactContainmentStrength;
};

export function workerArtifactCapability(
  backend: Backend,
  mode: Mode,
  taskSlug: string | null | undefined,
  phase: TaskPhase | undefined,
): WorkerArtifactCapability | null {
  if (mode !== "analyze" || !taskSlug) {
    return null;
  }
  const artifactDirectory = `docs/${taskSlug}/`;
  return {
    artifactDirectory,
    artifactTarget: `${artifactDirectory}${phase ?? "analyze"}.md`,
    containment:
      backend === "claude" ||
      backend === "minimax" ||
      backend === "kimi" ||
      backend === "opencode"
        ? "path-scoped-configured"
        : backend === "codex"
          ? "repo-root"
          : "prompt-only",
  };
}

export function applyWorkerArtifactProfile(
  profile: Profile,
  backend: Backend,
  mode: Mode,
  taskSlug: string | null | undefined,
  phase: TaskPhase | undefined,
): Profile {
  const capability = workerArtifactCapability(backend, mode, taskSlug, phase);
  if (!capability) {
    return profile;
  }
  return {
    ...profile,
    sandbox: "workspace-write",
    instruction: `Analyze the repository and write only the worker-authored artifact at ${capability.artifactTarget}. Do not modify any other file. Return concise evidence and include the artifact in changes.`,
  };
}

// runner-routing-v4 canonical workload classes: finite two-axis policy keys
// (difficulty: hard/medium/easy, volume: heavy/medium/light) used only by the
// automatic implementation candidate-stack selection. Separate from task_class,
// which stays free-form parent observability metadata and never selects a
// model. Legacy v2/v3 class names (default, light-work, hard-hard, easy-easy,
// ...) are rejected, never silently mapped.
export type WorkloadClass =
  | "hard-heavy"
  | "hard-medium"
  | "hard-light"
  | "medium-heavy"
  | "medium-medium"
  | "medium-light"
  | "easy-heavy"
  | "easy-medium"
  | "easy-light";

export const WORKLOAD_CLASSES: readonly WorkloadClass[] = Object.keys(
  MODEL_POLICY.workloadChains,
) as WorkloadClass[];

// Policy label and fallback semantics come from the generated policy copy.
export const ROUTING_POLICY_LABEL: "runner-routing-v4" = MODEL_POLICY.label;
export const ROUTING_POLICY_FALLBACK: "availability-only" =
  MODEL_POLICY.fallback;
export const PARENT_LOCAL_PHASES: readonly TaskPhase[] =
  MODEL_POLICY.parentLocalPhases;

// v4 has one canonical vocabulary; this export remains for consumers that read
// the ARC Delegate list separately from the base list.
export const ARC_DELEGATE_WORKLOAD_CLASSES: readonly WorkloadClass[] =
  WORKLOAD_CLASSES;

const ALL_WORKLOAD_CLASSES = WORKLOAD_CLASSES;

export const PHASE_MODE: Readonly<Record<TaskPhase, Mode>> = {
  explore: "analyze",
  analyze: "analyze",
  research: "analyze",
  plan: "analyze",
  implement: "implement",
  verify: "review",
  deploy: "implement",
};

export function normalizeTaskPhase(
  value: string | null | undefined,
  mode: Mode,
): TaskPhase | null {
  if (value == null || value.trim() === "") {
    return mode === "review" ? "verify" : mode;
  }
  const normalized = value.trim().toLowerCase();
  if (!TASK_PHASES.includes(normalized as TaskPhase)) {
    return null;
  }
  const phase = normalized as TaskPhase;
  return PHASE_MODE[phase] === mode ? phase : null;
}

// Missing/empty means "no class stated" and returns null, the same as an
// invalid class: v4 has no default implement class, so callers that need one
// must fail closed rather than inventing it.
export function normalizeWorkloadClass(
  value: string | null | undefined,
): WorkloadClass | null {
  if (value == null || value.trim() === "") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return ALL_WORKLOAD_CLASSES.includes(normalized as WorkloadClass)
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

export const ROUTES_SCHEMA_VERSION = 4;
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
  return env.ARC_ORCHESTRATOR_GROK_MODEL?.trim() || "cursor-grok-4.6-high";
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

export const OPENCODE_DEFAULT_MODEL = "moonshotai/kimi-k3";

export function openCodeModelFor(env: EnvLike): string {
  // Default model for direct --backend opencode (no route). The OpenCode
  // transport also serves the provider-qualified `opencode-go/*` identities,
  // but those are reached only through their explicit public aliases
  // (glm-5.3-*, deepseek-v4-pro-*, go-kimi-k3-*, ...) or automatic v4 rungs,
  // never through this env default. Public kimi-* aliases are pinned to
  // Cursor Kimi K3 on the Composer transport. Do not read
  // ARC_ORCHESTRATOR_KIMI_MODEL — that env owns direct --backend kimi
  // (Anthropic-compatible kimi-k3[1m] via kimiModel()).
  return env.ARC_ORCHESTRATOR_OPENCODE_MODEL?.trim() || OPENCODE_DEFAULT_MODEL;
}

/** @deprecated Use openCodeModelFor; kept for older internal call sites. */
export const kimiModelFor = openCodeModelFor;

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
        "Implement the bounded task directly. Do not expand scope, commit, or push. Deployment is forbidden unless the selected phase is deploy and the CLI has validated explicit human authorization. Run focused verification and report every changed file.",
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
const ROUTE_MODE_BY_SUFFIX = {
  explore: "analyze",
  implement: "implement",
  check: "review",
} as const satisfies Record<PublicRouteSuffix, Mode>;

const ROUTE_PROFILES = Object.fromEntries(
  PUBLIC_ROUTE_MODEL_BINDINGS.flatMap(({ base, backend }) =>
    PUBLIC_ROUTE_SUFFIXES.map((suffix) => [
      `${base}-${suffix}` as RouteId,
      { backend, mode: ROUTE_MODE_BY_SUFFIX[suffix] },
    ]),
  ),
) as Record<RouteId, { backend: Backend; mode: Mode }>;

// Explicit alias models are pinned contract facts. Ambient model env never
// rewrites these; only direct --backend resolution (no route id) honors env.
const FIXED_ROUTE_MODELS = Object.fromEntries(
  PUBLIC_ROUTE_MODEL_BINDINGS.flatMap(({ base, providerModelId }) =>
    PUBLIC_ROUTE_SUFFIXES.map((suffix) => [
      `${base}-${suffix}` as RouteId,
      providerModelId,
    ]),
  ),
) as Record<RouteId, string>;

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
    return env.ARC_ORCHESTRATOR_CLAUDE_MODEL?.trim() || "claude-opus-5";
  }
  if (backend === "minimax") {
    return minimaxModel(env);
  }
  if (backend === "opencode") {
    return openCodeModelFor(env);
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
  taskSlug?: string | null,
  phase?: TaskPhase,
): Profile {
  const route = routeId ? ROUTE_PROFILES[routeId] : undefined;
  if (route) {
    const base = profileFor(env, route.mode, taskClass);
    return applyWorkerArtifactProfile(
      {
        model:
          FIXED_ROUTE_MODELS[routeId] ??
          backendDefaultModel(env, route.backend, route.mode, taskClass),
        sandbox: route.mode === "implement" ? "workspace-write" : "read-only",
        instruction: base.instruction,
      },
      backend,
      mode,
      taskSlug,
      phase,
    );
  }

  if (backend === "composer") {
    return applyWorkerArtifactProfile(
      {
        model: env.ARC_ORCHESTRATOR_COMPOSER_MODEL?.trim() || "composer-2.5",
        sandbox: "workspace-write",
        instruction: profileFor(env, mode, taskClass).instruction,
      },
      backend,
      mode,
      taskSlug,
      phase,
    );
  }

  if (backend === "claude") {
    const profile = profileFor(env, mode, taskClass);
    return applyWorkerArtifactProfile(
      {
        ...profile,
        model: env.ARC_ORCHESTRATOR_CLAUDE_MODEL?.trim() || "claude-opus-5",
      },
      backend,
      mode,
      taskSlug,
      phase,
    );
  }

  if (backend === "minimax") {
    const profile = profileFor(env, mode, taskClass);
    return applyWorkerArtifactProfile(
      { ...profile, model: minimaxModel(env) },
      backend,
      mode,
      taskSlug,
      phase,
    );
  }

  if (backend === "opencode") {
    // Direct OpenCode dispatch enforces the mode-specific permission boundary
    // for every OpenCode identity: analyze and review are read-only, implement
    // is workspace-write. Explicit opencode-go/* aliases resolve above through
    // FIXED_ROUTE_MODELS; this branch only serves the env default.
    const profile = profileFor(env, mode, taskClass);
    return applyWorkerArtifactProfile(
      { ...profile, model: openCodeModelFor(env) },
      backend,
      mode,
      taskSlug,
      phase,
    );
  }

  if (backend === "kimi") {
    const profile = profileFor(env, mode, taskClass);
    return applyWorkerArtifactProfile(
      { ...profile, model: kimiModel(env) },
      backend,
      mode,
      taskSlug,
      phase,
    );
  }

  return applyWorkerArtifactProfile(
    profileFor(env, mode, taskClass),
    backend,
    mode,
    taskSlug,
    phase,
  );
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

  return PUBLIC_ROUTE_MODEL_BINDINGS.flatMap(({ base }) =>
    PUBLIC_ROUTE_SUFFIXES.map((suffix) => {
      const id = `${base}-${suffix}` as RouteId;
      return route(
        id,
        `Explicit ${suffix} diagnostic/manual-recovery route; executes exactly one pinned model and does not inherit the automatic workload/ADR fallback chain.`,
      );
    }),
  );
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
    phases: TASK_PHASES,
    phase_modes: PHASE_MODE,
    workload_classes: WORKLOAD_CLASSES,
    arc_delegate_workload_classes: ARC_DELEGATE_WORKLOAD_CLASSES,
    routing_policy: {
      label: ROUTING_POLICY_LABEL,
      fallback: ROUTING_POLICY_FALLBACK,
      source: {
        document: MODEL_POLICY_SOURCE.document,
        updated: MODEL_POLICY_SOURCE.updated,
        digest: MODEL_POLICY_SOURCE.digest,
      },
      // Optional fail-closed CLI marker for clients such as ARC Pi. Exact value
      // is accepted only for automatic no-backend/no-route delegation; the
      // superseded v2/v3 markers and incompatible intents are rejected.
      // Omitting the flag is fine.
      cli_marker: {
        option: "--routing-policy",
        value: ROUTING_POLICY_LABEL,
        optional: true,
        intents: ["automatic"],
      },
      // Parent Analyze is local under v4: no analyze-phase worker stack exists.
      parent_local_phases: PARENT_LOCAL_PHASES,
      candidate_stacks: CANDIDATE_STACKS.map((stack) => ({
        route: stack.route,
        phase: stack.phase ?? null,
        workload_class: stack.workloadClass ?? null,
        candidates: stack.candidates,
        candidate_efforts: stack.candidateEfforts ?? {},
        rungs: (stack.rungs ?? []).map((rung) => ({
          stable_id: rung.stableId,
          effort: rung.effort,
        })),
        automatic_fallback: stack.automaticFallback,
      })),
    },
    routes: observableRoutes,
  };
}
