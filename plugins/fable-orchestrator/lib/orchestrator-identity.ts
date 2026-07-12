export const ORCHESTRATOR_IDENTITIES = [
  "fable",
  "sol",
  "composer",
  "opus",
  "cursor-fable-high",
] as const;

export type OrchestratorIdentity = (typeof ORCHESTRATOR_IDENTITIES)[number];

export type OrchestratorHarness = "claude-code" | "codex" | "cursor";

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
} {
  return {
    orchestrator_identity: active,
    orchestrator_identity_support: ORCHESTRATOR_IDENTITY_SUPPORT,
  };
}
