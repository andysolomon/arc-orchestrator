// Phase-2 registry/selector shadow mode: resolve current vs proposed routing without
// changing execution. Observational only.

import {
  CAPABILITY_ROUTES_SCHEMA_VERSION,
  capabilityRouteFor,
  resolvePublicAlias,
  type CanonicalCapabilityRouteId,
  type OutputContractId,
} from "./capability-routes";
import {
  CANDIDATE_STACKS,
  MODEL_REGISTRY,
  MODEL_REGISTRY_SCHEMA_VERSION,
  type ModelMaturity,
  type ModelRegistryEntry,
} from "./model-registry";
import {
  type EnvLike,
  resolveProfile,
  routeCapabilities,
} from "./routes";
import type { Backend, Mode, TraceSandbox } from "./trace-schema";

export const ROUTING_SHADOW_SCHEMA_VERSION = 1;

export type OverrideRequest = {
  model: string;
  explicitParentAuthorization?: boolean;
};

export type RoutingShadowInput = {
  requestedAlias: string;
  env: EnvLike;
  taskClass?: string | null;
  override?: OverrideRequest;
};

export type FixedRouteContract = {
  mode: Mode;
  sandbox: TraceSandbox;
  outputContract: OutputContractId;
};

export type RoutingShadowVersions = {
  routingShadow: number;
  capabilityRoutes: number;
  modelRegistry: number;
  candidateStackPolicy: string;
};

export type CandidateEvaluation = {
  stableId: string;
  transportBackend: string | null;
  maturity: ModelMaturity;
  eligible: boolean;
  ineligibleReasons: string[];
};

export type OverrideOutcome =
  | { status: "not-requested" }
  | {
      status: "applied";
      model: string;
      stableId: string;
      explicitParentAuthorization?: boolean;
    }
  | {
      status: "rejected";
      model: string;
      reasons: string[];
    };

export type RoutingSelection = {
  backend: Backend;
  model: string;
};

export type RoutingShadowReport = {
  requestedAlias: string;
  canonicalRouteId: CanonicalCapabilityRouteId | null;
  fixedContract: FixedRouteContract | null;
  versions: RoutingShadowVersions;
  candidateEvaluations: CandidateEvaluation[];
  overrideOutcome: OverrideOutcome;
  currentSelection: (RoutingSelection & { role: "executing" }) | null;
  proposedSelection: RoutingSelection | null;
  proposedSelectionReason: string | null;
  comparison: { matches: boolean; explanation: string } | null;
  error?: string;
};

const RUNNABLE_MATURITIES = new Set<ModelMaturity>([
  "experimental",
  "available",
  "deprecated",
]);

const REGISTRY_BY_ID = new Map(
  MODEL_REGISTRY.map((entry) => [entry.stableId, entry]),
);

const REGISTRY_BY_LABEL = new Map<string, ModelRegistryEntry>();
for (const entry of MODEL_REGISTRY) {
  for (const label of [entry.stableId, entry.displayName, ...entry.aliases]) {
    const normalized = label.trim().toLowerCase();
    if (normalized !== "") {
      REGISTRY_BY_LABEL.set(normalized, entry);
    }
  }
  if (entry.providerModelId) {
    REGISTRY_BY_LABEL.set(entry.providerModelId.trim().toLowerCase(), entry);
  }
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

function hasVerifiedEvidence(entry: ModelRegistryEntry): boolean {
  if (entry.evidence == null) {
    return false;
  }
  const keys = [
    "providerAccountAvailability",
    "adapter",
    "route",
    "sandbox",
    "output",
    "cancellation",
    "errorNormalization",
  ] as const;
  return keys.every((key) => entry.evidence?.[key].verified);
}

function hasRunnableIdentityFields(entry: ModelRegistryEntry): boolean {
  return (
    entry.providerModelId != null &&
    entry.adapterId != null &&
    entry.adapterVersion != null &&
    entry.authAccountScope != null
  );
}

function satisfiesRouteContract(
  entry: ModelRegistryEntry,
  routeId: CanonicalCapabilityRouteId,
  contract: FixedRouteContract,
): boolean {
  if (!entry.routeEligibility.includes(routeId)) {
    return false;
  }
  if (!entry.sandboxPermissionSupport.includes(contract.sandbox)) {
    return false;
  }
  if (!entry.outputContracts.includes(contract.outputContract)) {
    return false;
  }
  if (entry.transportBackend == null || entry.transportBackend === "claude-code-parent") {
    return false;
  }
  const runnerKey = `${entry.transportBackend}:${contract.mode}`;
  return entry.runnerSupport.includes(runnerKey);
}

function selectionModelForEntry(entry: ModelRegistryEntry): string {
  return entry.providerModelId ?? entry.stableId;
}

function backendForAlias(
  alias: string,
  env: EnvLike,
): { backend: Backend; mode: Mode } | null {
  const executable = routeCapabilities(env).find((route) => route.id === alias);
  if (executable) {
    return { backend: executable.backend, mode: executable.mode };
  }

  const binding = resolvePublicAlias(alias);
  if (binding?.alias === "opus-review") {
    return { backend: "claude", mode: "review" };
  }

  return null;
}

function lookupRegistryEntry(model: string): ModelRegistryEntry | undefined {
  return REGISTRY_BY_LABEL.get(normalizeLabel(model));
}

function evaluateCandidateForStack(
  entry: ModelRegistryEntry,
  routeId: CanonicalCapabilityRouteId,
  contract: FixedRouteContract,
): CandidateEvaluation {
  const ineligibleReasons: string[] = [];

  if (entry.maturity === "planned" || entry.maturity === "disabled") {
    ineligibleReasons.push("not-runnable-maturity");
  } else if (!RUNNABLE_MATURITIES.has(entry.maturity)) {
    ineligibleReasons.push("not-runnable-maturity");
  }

  if (!entry.routeEligibility.includes(routeId)) {
    ineligibleReasons.push("missing-route-eligibility");
  }

  if (entry.roleRestriction === "parent-only") {
    ineligibleReasons.push("parent-only-role-restriction");
  }

  if (entry.roleRestriction === "explicit-parent-authorization") {
    ineligibleReasons.push("explicit-parent-authorization-required");
  }

  if (!hasVerifiedEvidence(entry) || !hasRunnableIdentityFields(entry)) {
    ineligibleReasons.push("missing-evidence");
  }

  if (!satisfiesRouteContract(entry, routeId, contract)) {
    ineligibleReasons.push("contract-incompatible");
  }

  return {
    stableId: entry.stableId,
    transportBackend: entry.transportBackend,
    maturity: entry.maturity,
    eligible: ineligibleReasons.length === 0,
    ineligibleReasons,
  };
}

function validateOverride(
  entry: ModelRegistryEntry | undefined,
  routeId: CanonicalCapabilityRouteId,
  contract: FixedRouteContract,
  override: OverrideRequest,
): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];

  if (!entry) {
    return { ok: false, reasons: ["unknown-model"] };
  }

  if (entry.roleRestriction === "parent-only") {
    reasons.push("parent-only-role-restriction");
  }

  if (entry.roleRestriction === "explicit-parent-authorization") {
    if (override.explicitParentAuthorization !== true) {
      reasons.push("explicit-parent-authorization-required");
    }
  }

  if (!entry.routeEligibility.includes(routeId)) {
    reasons.push("missing-route-eligibility");
  }

  if (!satisfiesRouteContract(entry, routeId, contract)) {
    reasons.push("contract-incompatible");
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }

  return { ok: true };
}

function selectionForEntry(entry: ModelRegistryEntry): RoutingSelection | null {
  if (
    entry.transportBackend == null ||
    entry.transportBackend === "claude-code-parent"
  ) {
    return null;
  }
  return {
    backend: entry.transportBackend,
    model: selectionModelForEntry(entry),
  };
}

function buildVersions(candidateStackPolicy: string): RoutingShadowVersions {
  return {
    routingShadow: ROUTING_SHADOW_SCHEMA_VERSION,
    capabilityRoutes: CAPABILITY_ROUTES_SCHEMA_VERSION,
    modelRegistry: MODEL_REGISTRY_SCHEMA_VERSION,
    candidateStackPolicy,
  };
}

function emptyReport(
  requestedAlias: string,
  error: string,
  candidateStackPolicy = "candidate-stacks/v1",
): RoutingShadowReport {
  return {
    requestedAlias,
    canonicalRouteId: null,
    fixedContract: null,
    versions: buildVersions(candidateStackPolicy),
    candidateEvaluations: [],
    overrideOutcome: { status: "not-requested" },
    currentSelection: null,
    proposedSelection: null,
    proposedSelectionReason: null,
    comparison: null,
    error,
  };
}

export function executableAliasForBackendMode(
  backend: Backend,
  mode: Mode,
): string | null {
  const match = routeCapabilities({}).find(
    (route) => route.backend === backend && route.mode === mode,
  );
  return match?.id ?? null;
}

export function resolveRoutingShadow(
  input: RoutingShadowInput,
): RoutingShadowReport {
  try {
    const requestedAlias = input.requestedAlias.trim().toLowerCase();
    const binding = resolvePublicAlias(requestedAlias);
    if (!binding) {
      return emptyReport(requestedAlias, "unknown-alias");
    }

    const routeId = binding.capabilityRoute;
    const routeContract = capabilityRouteFor(routeId);
    const fixedContract: FixedRouteContract = {
      mode: routeContract.mode,
      sandbox: routeContract.sandbox,
      outputContract: routeContract.outputContract,
    };

    const stack =
      CANDIDATE_STACKS.find((candidate) => candidate.route === routeId) ?? null;
    const candidateStackPolicy =
      stack?.policyVersion ?? "candidate-stacks/v1";

    const routeBackend = backendForAlias(binding.alias, input.env);
    const currentSelection =
      routeBackend == null
        ? null
        : {
            backend: routeBackend.backend,
            model: resolveProfile(
              input.env,
              routeBackend.backend,
              routeBackend.mode,
              input.taskClass ?? null,
            ).model,
            role: "executing" as const,
          };

    const candidateEvaluations: CandidateEvaluation[] = [];
    if (stack) {
      for (const stableId of stack.candidates) {
        const entry = REGISTRY_BY_ID.get(stableId);
        if (!entry) {
          candidateEvaluations.push({
            stableId,
            transportBackend: null,
            maturity: "disabled",
            eligible: false,
            ineligibleReasons: ["unknown-registry-entry"],
          });
          continue;
        }
        candidateEvaluations.push(
          evaluateCandidateForStack(entry, routeId, fixedContract),
        );
      }
    }

    let overrideOutcome: OverrideOutcome = { status: "not-requested" };
    let proposedSelection: RoutingSelection | null = null;
    let proposedSelectionReason: string | null = null;

    if (input.override?.model) {
      const overrideEntry = lookupRegistryEntry(input.override.model);
      const validation = validateOverride(
        overrideEntry,
        routeId,
        fixedContract,
        input.override,
      );
      if (validation.ok && overrideEntry) {
        overrideOutcome = {
          status: "applied",
          model: selectionModelForEntry(overrideEntry),
          stableId: overrideEntry.stableId,
          ...(overrideEntry.roleRestriction === "explicit-parent-authorization"
            ? {
                explicitParentAuthorization:
                  input.override.explicitParentAuthorization === true,
              }
            : {}),
        };
        proposedSelection = selectionForEntry(overrideEntry);
        proposedSelectionReason = "explicit-override-applied";
      } else {
        overrideOutcome = {
          status: "rejected",
          model: input.override.model,
          reasons: validation.ok ? ["unknown-model"] : validation.reasons,
        };
      }
    }

    if (overrideOutcome.status === "rejected") {
      // A requested-but-invalid override fails the proposed dispatch visibly;
      // substituting a stack candidate would hide the failure and record
      // misleading migration evidence.
      proposedSelectionReason = "override-rejected";
    } else if (overrideOutcome.status !== "applied") {
      const firstEligible = candidateEvaluations.find(
        (evaluation) => evaluation.eligible,
      );
      if (firstEligible) {
        const entry = REGISTRY_BY_ID.get(firstEligible.stableId);
        proposedSelection = entry ? selectionForEntry(entry) : null;
        proposedSelectionReason = "first-eligible-stack-candidate";
      } else if (stack && stack.candidates.length > 0) {
        proposedSelectionReason = "no-eligible-stack-candidate";
      } else {
        proposedSelectionReason = "no-candidate-stack";
      }
    }

    let comparison: RoutingShadowReport["comparison"] = null;
    if (currentSelection && proposedSelection) {
      const matches =
        currentSelection.backend === proposedSelection.backend &&
        currentSelection.model === proposedSelection.model;
      comparison = {
        matches,
        explanation: matches
          ? "current and proposed backend/model agree"
          : `current executes ${currentSelection.backend}/${currentSelection.model}; proposed selects ${proposedSelection.backend}/${proposedSelection.model}`,
      };
    } else if (currentSelection && !proposedSelection) {
      comparison = {
        matches: false,
        explanation: `current executes ${currentSelection.backend}/${currentSelection.model}; proposed selection is null (${proposedSelectionReason ?? "unknown"})`,
      };
    }

    return {
      requestedAlias: binding.alias,
      canonicalRouteId: routeId,
      fixedContract,
      versions: buildVersions(candidateStackPolicy),
      candidateEvaluations,
      overrideOutcome,
      currentSelection,
      proposedSelection,
      proposedSelectionReason,
      comparison,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emptyReport(
      input.requestedAlias,
      `routing-shadow-internal-error: ${message}`,
    );
  }
}
