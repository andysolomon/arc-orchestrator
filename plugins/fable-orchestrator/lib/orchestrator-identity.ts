export const ORCHESTRATOR_IDENTITIES = [
  "fable",
  "sol",
  "composer",
  "opus",
  "cursor-fable-high",
] as const;

export type OrchestratorIdentity = (typeof ORCHESTRATOR_IDENTITIES)[number];

export type OrchestratorHarness = "claude-code" | "codex" | "cursor";

export const COMPOSER_ECONOMY_POLICY = "composer-economy/v1" as const;
export const COMPOSER_ECONOMY_STACK =
  "(O) Composer -> opus-explore -> composer-implement -> opus-check" as const;
export const COMPOSER_ECONOMY_WORKER_STACK = [
  "opus-explore",
  "composer-implement",
  "opus-check",
] as const;

export const COMPOSER_ECONOMY_ROUTES = {
  analyze: {
    route: "opus-explore",
    backend: "claude",
    stableId: "opus-4.8",
    model: "claude-opus-4-8",
    sandbox: "read-only",
  },
  implement: {
    route: "composer-implement",
    backend: "composer",
    stableId: "composer-2.5",
    model: "composer-2.5",
    sandbox: "workspace-write",
  },
  review: {
    route: "opus-check",
    backend: "claude",
    stableId: "opus-4.8",
    model: "claude-opus-4-8",
    sandbox: "read-only",
  },
} as const;

type ComposerEconomyRoute =
  (typeof COMPOSER_ECONOMY_ROUTES)[keyof typeof COMPOSER_ECONOMY_ROUTES];

export function composerEconomyModeContract(active: boolean): {
  active: boolean;
  policy: typeof COMPOSER_ECONOMY_POLICY | null;
  stack: typeof COMPOSER_ECONOMY_STACK | null;
  worker_stack: typeof COMPOSER_ECONOMY_WORKER_STACK | readonly [];
  effective_routes: ReadonlyArray<{
    mode: keyof typeof COMPOSER_ECONOMY_ROUTES;
    route: ComposerEconomyRoute["route"];
    backend: ComposerEconomyRoute["backend"];
    stable_id: ComposerEconomyRoute["stableId"];
    model: ComposerEconomyRoute["model"];
    sandbox: ComposerEconomyRoute["sandbox"];
  }>;
} {
  const effectiveRoutes = (
    Object.entries(COMPOSER_ECONOMY_ROUTES) as Array<
      [keyof typeof COMPOSER_ECONOMY_ROUTES, ComposerEconomyRoute]
    >
  ).map(([mode, route]) => ({
    mode,
    route: route.route,
    backend: route.backend,
    stable_id: route.stableId,
    model: route.model,
    sandbox: route.sandbox,
  }));
  return active
    ? {
        active: true,
        policy: COMPOSER_ECONOMY_POLICY,
        stack: COMPOSER_ECONOMY_STACK,
        worker_stack: COMPOSER_ECONOMY_WORKER_STACK,
        effective_routes: effectiveRoutes,
      }
    : {
        active: false,
        policy: null,
        stack: null,
        worker_stack: [],
        effective_routes: [],
      };
}

// This describes where each parent identity can actually run. It is deliberately
// separate from worker backends: a parent may dispatch any eligible worker route.
export const ORCHESTRATOR_IDENTITY_SUPPORT: Record<
  OrchestratorHarness,
  Record<OrchestratorIdentity, boolean>
> = {
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
};

export const ORCHESTRATOR_IDENTITY_ENV =
  "FABLE_ORCHESTRATOR_ORCHESTRATOR" as const;

export function allowedOrchestratorIdentities(): string {
  return ORCHESTRATOR_IDENTITIES.join(", ");
}

export function resolveOrchestratorIdentity(
  cliValue: string | undefined,
  env: Record<string, string | undefined>,
): OrchestratorIdentity | null {
  const source =
    cliValue !== undefined ? "--orchestrator" : ORCHESTRATOR_IDENTITY_ENV;
  const raw = cliValue !== undefined ? cliValue : env[ORCHESTRATOR_IDENTITY_ENV];
  const normalized = raw?.trim();
  if (!normalized) {
    return null;
  }
  if (!ORCHESTRATOR_IDENTITIES.includes(normalized as OrchestratorIdentity)) {
    throw new Error(
      `${source} must be one of: ${allowedOrchestratorIdentities()}`,
    );
  }
  return normalized as OrchestratorIdentity;
}

export function orchestratorIdentityContract(
  active: OrchestratorIdentity | null,
): {
  orchestrator_identity: OrchestratorIdentity | null;
  orchestrator_identity_support: typeof ORCHESTRATOR_IDENTITY_SUPPORT;
  composer_orchestrator_mode: ReturnType<typeof composerEconomyModeContract>;
} {
  return {
    orchestrator_identity: active,
    orchestrator_identity_support: ORCHESTRATOR_IDENTITY_SUPPORT,
    composer_orchestrator_mode: composerEconomyModeContract(active === "composer"),
  };
}
