import { pinnedModelForAlias } from "./model-registry";
import type { PublicAlias } from "./capability-routes";
import type { Backend, TraceSandbox } from "./trace-schema";

export const ORCHESTRATOR_IDENTITIES = [
  "fable",
  "sol",
  "eco",
  "opus",
  "cursor-fable-high",
] as const;

export type OrchestratorIdentity = (typeof ORCHESTRATOR_IDENTITIES)[number];

export type OrchestratorHarness = "claude-code" | "codex" | "cursor";

export const ECO_POLICY = "eco/v1" as const;

export const ECO_STACK =
  "(O) Eco -> opus-explore [| grok-explore] -> composer-implement -> opus-check [| grok-check]" as const;

export const ECO_WORKER_STACK = [
  "opus-explore",
  "composer-implement",
  "opus-check",
] as const;

export const ECO_BACKUP_WORKER_STACK = [
  "grok-explore",
  "grok-check",
] as const;

// Eco declares only policy: which alias runs each mode, on which backend, at
// which sandbox. The model a route runs is NOT restated here — it is derived
// from the model registry through the alias, so eco cannot drift away from the
// rest of the runner. Before this was derived, `arc-orchestrator run
// --orchestrator eco` kept dispatching Opus 4.8 after every other opus-* path
// had moved to Opus 5, because the pin lived in two files and only one moved.
type EcoRoutePolicy = {
  route: PublicAlias;
  backend: Backend;
  sandbox: TraceSandbox;
};

function withPinnedModel<T extends EcoRoutePolicy>(policy: T) {
  const { stableId, providerModelId } = pinnedModelForAlias(policy.route);
  return { ...policy, stableId, model: providerModelId };
}

const ECO_ROUTE_POLICY = {
  analyze: {
    route: "opus-explore",
    backend: "claude",
    sandbox: "read-only",
  },
  implement: {
    route: "composer-implement",
    backend: "composer",
    sandbox: "workspace-write",
  },
  review: {
    route: "opus-check",
    backend: "claude",
    sandbox: "read-only",
  },
} as const satisfies Record<string, EcoRoutePolicy>;

/** Availability-only backups for analyze/review economy workers (Cursor Grok 4.6 High). */
const ECO_BACKUP_ROUTE_POLICY = {
  analyze: {
    route: "grok-explore",
    backend: "composer",
    sandbox: "read-only",
  },
  review: {
    route: "grok-check",
    backend: "composer",
    sandbox: "read-only",
  },
} as const satisfies Record<string, EcoRoutePolicy>;

export const ECO_ROUTES = {
  analyze: withPinnedModel(ECO_ROUTE_POLICY.analyze),
  implement: withPinnedModel(ECO_ROUTE_POLICY.implement),
  review: withPinnedModel(ECO_ROUTE_POLICY.review),
};

export const ECO_BACKUP_ROUTES = {
  analyze: withPinnedModel(ECO_BACKUP_ROUTE_POLICY.analyze),
  review: withPinnedModel(ECO_BACKUP_ROUTE_POLICY.review),
};

type EcoRoute = (typeof ECO_ROUTES)[keyof typeof ECO_ROUTES];
type EcoBackupRoute =
  (typeof ECO_BACKUP_ROUTES)[keyof typeof ECO_BACKUP_ROUTES];

export function ecoBackupFor(
  mode: keyof typeof ECO_ROUTES,
): EcoBackupRoute | null {
  if (mode === "analyze" || mode === "review") {
    return ECO_BACKUP_ROUTES[mode];
  }
  return null;
}

export function ecoModeContract(active: boolean): {
  active: boolean;
  policy: typeof ECO_POLICY | null;
  stack: typeof ECO_STACK | null;
  worker_stack: typeof ECO_WORKER_STACK | readonly [];
  backup_worker_stack: typeof ECO_BACKUP_WORKER_STACK | readonly [];
  effective_routes: ReadonlyArray<{
    mode: keyof typeof ECO_ROUTES;
    route: EcoRoute["route"];
    backend: EcoRoute["backend"];
    stable_id: EcoRoute["stableId"];
    model: EcoRoute["model"];
    sandbox: EcoRoute["sandbox"];
  }>;
  backup_routes: ReadonlyArray<{
    mode: keyof typeof ECO_BACKUP_ROUTES;
    route: EcoBackupRoute["route"];
    backend: EcoBackupRoute["backend"];
    stable_id: EcoBackupRoute["stableId"];
    model: EcoBackupRoute["model"];
    sandbox: EcoBackupRoute["sandbox"];
  }>;
} {
  const effectiveRoutes = (
    Object.entries(ECO_ROUTES) as Array<[keyof typeof ECO_ROUTES, EcoRoute]>
  ).map(([mode, route]) => ({
    mode,
    route: route.route,
    backend: route.backend,
    stable_id: route.stableId,
    model: route.model,
    sandbox: route.sandbox,
  }));
  const backupRoutes = (
    Object.entries(ECO_BACKUP_ROUTES) as Array<
      [keyof typeof ECO_BACKUP_ROUTES, EcoBackupRoute]
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
        policy: ECO_POLICY,
        stack: ECO_STACK,
        worker_stack: ECO_WORKER_STACK,
        backup_worker_stack: ECO_BACKUP_WORKER_STACK,
        effective_routes: effectiveRoutes,
        backup_routes: backupRoutes,
      }
    : {
        active: false,
        policy: null,
        stack: null,
        worker_stack: [],
        backup_worker_stack: [],
        effective_routes: [],
        backup_routes: [],
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
};

export const ORCHESTRATOR_IDENTITY_ENV =
  "ARC_ORCHESTRATOR_ORCHESTRATOR" as const;

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
  eco_orchestrator_mode: ReturnType<typeof ecoModeContract>;
} {
  return {
    orchestrator_identity: active,
    orchestrator_identity_support: ORCHESTRATOR_IDENTITY_SUPPORT,
    eco_orchestrator_mode: ecoModeContract(active === "eco"),
  };
}
