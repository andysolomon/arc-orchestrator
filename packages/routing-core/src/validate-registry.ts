// Registry validation: shipped-data invariants (duplicate ids, ambiguous
// aliases, route/contract/sandbox claims, stack membership, evidence gates,
// the GLM provider boundary) and registry <-> policy parity. Pure functions
// over the arrays passed in; the runtime shim binds them to the shipped data.

import {
  CAPABILITY_ROUTES,
  type CanonicalCapabilityRouteId,
} from "./capability-routes";
import type { CandidateStack } from "./candidate-stacks";
import { rungId } from "./model-schema";
import {
  BACKEND_SUPPORTED_EFFORTS,
  NO_EFFORT_RUNG,
  hasRunnableIdentityFields,
  hasVerifiedEvidence,
  supportedEffortsFor,
  type ModelDefinition,
} from "./model-schema";
import type { RoutingPolicy } from "./policy-schema";
import { EFFORT_LEVELS, RUNNABLE_MATURITIES, type Effort } from "./vocabulary";

export const MODEL_REGISTRY_ERROR = {
  DUPLICATE_STABLE_ID: "model-registry: duplicate stableId",
  AMBIGUOUS_ALIAS: "model-registry: ambiguous alias",
  UNKNOWN_ROUTE_VERSION: "model-registry: unknown route version",
  UNKNOWN_OUTPUT_CONTRACT: "model-registry: unknown output-contract version",
  UNSUPPORTED_SANDBOX_CLAIM: "model-registry: unsupported sandbox claim",
  UNKNOWN_SANDBOX_VALUE: "model-registry: unknown sandbox value",
  FALLBACK_CYCLE: "model-registry: fallback cycle",
  STACK_CANDIDATE_NOT_ELIGIBLE:
    "model-registry: stack candidate not route-eligible",
  ROLE_RESTRICTED_AUTOMATIC_FALLBACK:
    "model-registry: role-restricted candidate in automatic-fallback stack",
  RUNNABLE_MISSING_EVIDENCE: "model-registry: runnable entry missing evidence",
  PLANNED_ROUTE_ELIGIBLE:
    "model-registry: planned or disabled entry is route-eligible",
  PARENT_ONLY_ROUTE_ELIGIBLE:
    "model-registry: parent-only entry has route eligibility",
  GLM_PROVIDER_BOUNDARY:
    "model-registry: glm provider boundary violated",
  UNKNOWN_EFFORT_LEVEL: "model-registry: unknown effort level",
  DUPLICATE_EFFORT_LEVEL: "model-registry: duplicate effort level",
  EFFORT_UNSUPPORTED_BY_BACKEND:
    "model-registry: effort override exceeds backend adapter support",
  DUPLICATE_RUNG: "model-registry: duplicate rung in stack",
} as const;

const KNOWN_ROUTE_IDS = new Set(CAPABILITY_ROUTES.map((route) => route.id));

const KNOWN_OUTPUT_CONTRACTS = new Set(
  CAPABILITY_ROUTES.map((route) => route.outputContract),
);

const ROUTE_BY_ID = Object.fromEntries(
  CAPABILITY_ROUTES.map((route) => [route.id, route]),
) as Record<CanonicalCapabilityRouteId, (typeof CAPABILITY_ROUTES)[number]>;

const KNOWN_SANDBOXES: ReadonlySet<string> = new Set([
  "read-only",
  "workspace-write",
]);

export const OPENCODE_GO_SERVING_PROVIDER = "OpenCode Go";

const APPROVED_GLM_PROVIDER_MODEL_ID_PATTERN = /^opencode-go\/glm-[\w.-]+$/;

function labelMatchesGlm(value: string): boolean {
  return /glm/i.test(value);
}

// Identity detection must not depend on cooperative labelling. An entry that
// keeps a non-GLM family, stable id, display name, and alias set still reaches
// GLM weights whenever its provider model id names a GLM model, so the
// provider id is part of the identity surface and triggers the same boundary.
export function isGlmIdentity(entry: ModelDefinition): boolean {
  if (entry.family === "glm") {
    return true;
  }
  return [
    entry.stableId,
    entry.displayName,
    entry.providerModelId ?? "",
    ...entry.aliases,
  ].some(labelMatchesGlm);
}

function isPreservedNonRoutableGlm(entry: ModelDefinition): boolean {
  return (
    isGlmIdentity(entry) &&
    (entry.maturity === "planned" || entry.maturity === "disabled") &&
    entry.routeEligibility.length === 0
  );
}

export function requiresGlmProviderBoundary(entry: ModelDefinition): boolean {
  if (!isGlmIdentity(entry) || isPreservedNonRoutableGlm(entry)) {
    return false;
  }
  return (
    entry.routeEligibility.length > 0 || RUNNABLE_MATURITIES.has(entry.maturity)
  );
}

export function glmProviderBoundaryViolations(
  entry: ModelDefinition,
): string[] {
  if (!requiresGlmProviderBoundary(entry)) {
    return [];
  }
  const violations: string[] = [];
  const prefix = `${MODEL_REGISTRY_ERROR.GLM_PROVIDER_BOUNDARY}: ${entry.stableId}`;
  const providerModelId = entry.providerModelId;
  if (
    providerModelId == null ||
    !APPROVED_GLM_PROVIDER_MODEL_ID_PATTERN.test(providerModelId)
  ) {
    violations.push(
      `${prefix} -> providerModelId must be opencode-go/glm-* (got ${String(providerModelId)})`,
    );
  } else {
    // The stable id mirrors the provider id so the OpenCode Go identity a
    // route pins cannot drift from the model the adapter actually dispatches.
    const expectedStableId = providerModelId.replace("/", "-");
    if (entry.stableId !== expectedStableId) {
      violations.push(
        `${prefix} -> stableId must be ${expectedStableId} for providerModelId ${providerModelId}`,
      );
    }
  }
  if (entry.transportBackend !== "opencode") {
    violations.push(
      `${prefix} -> transportBackend must be opencode (got ${String(entry.transportBackend)})`,
    );
  }
  if (entry.adapterId !== "opencode") {
    violations.push(
      `${prefix} -> adapterId must be opencode (got ${String(entry.adapterId)})`,
    );
  }
  if (entry.servingProvider !== OPENCODE_GO_SERVING_PROVIDER) {
    violations.push(
      `${prefix} -> servingProvider must be ${OPENCODE_GO_SERVING_PROVIDER} (got ${String(entry.servingProvider)})`,
    );
  }
  return violations;
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

export function validateModelRegistry(
  entries: readonly ModelDefinition[],
  stacks: readonly CandidateStack[],
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  const stableIds = new Map<string, number>();
  for (const entry of entries) {
    stableIds.set(entry.stableId, (stableIds.get(entry.stableId) ?? 0) + 1);
  }
  for (const [stableId, count] of stableIds) {
    if (count > 1) {
      errors.push(`${MODEL_REGISTRY_ERROR.DUPLICATE_STABLE_ID}: ${stableId}`);
    }
  }

  const labelOwners = new Map<string, string>();
  for (const entry of entries) {
    const labels = [entry.stableId, entry.displayName, ...entry.aliases];
    for (const label of labels) {
      const normalized = normalizeLabel(label);
      if (normalized === "") {
        continue;
      }
      const owner = labelOwners.get(normalized);
      if (owner != null && owner !== entry.stableId) {
        errors.push(`${MODEL_REGISTRY_ERROR.AMBIGUOUS_ALIAS}: ${label}`);
      } else {
        labelOwners.set(normalized, entry.stableId);
      }
    }
  }

  for (const entry of entries) {
    const declared = entry.supportedEfforts;
    if (declared) {
      const seen = new Set<Effort>();
      for (const effort of declared) {
        if (!EFFORT_LEVELS.includes(effort)) {
          errors.push(
            `${MODEL_REGISTRY_ERROR.UNKNOWN_EFFORT_LEVEL}: ${entry.stableId} -> ${effort}`,
          );
          continue;
        }
        if (seen.has(effort)) {
          errors.push(
            `${MODEL_REGISTRY_ERROR.DUPLICATE_EFFORT_LEVEL}: ${entry.stableId} -> ${effort}`,
          );
        }
        seen.add(effort);
      }
      // An override may narrow what the adapter can do, never widen it: the
      // runner cannot forward a level its transport has no flag for.
      const backend = entry.transportBackend;
      const adapterSupport =
        backend == null || backend === "claude-code-parent"
          ? []
          : (BACKEND_SUPPORTED_EFFORTS[backend] ?? []);
      for (const effort of declared) {
        if (
          EFFORT_LEVELS.includes(effort) &&
          !adapterSupport.includes(effort)
        ) {
          errors.push(
            `${MODEL_REGISTRY_ERROR.EFFORT_UNSUPPORTED_BY_BACKEND}: ${entry.stableId} -> ${effort}`,
          );
        }
      }
    }

    for (const routeId of entry.routeEligibility) {
      if (!KNOWN_ROUTE_IDS.has(routeId)) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.UNKNOWN_ROUTE_VERSION}: ${entry.stableId} -> ${routeId}`,
        );
      }
    }
    for (const contractId of entry.outputContracts) {
      if (!KNOWN_OUTPUT_CONTRACTS.has(contractId)) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.UNKNOWN_OUTPUT_CONTRACT}: ${entry.stableId} -> ${contractId}`,
        );
      }
    }
  }

  for (const stack of stacks) {
    if (!KNOWN_ROUTE_IDS.has(stack.route)) {
      errors.push(
        `${MODEL_REGISTRY_ERROR.UNKNOWN_ROUTE_VERSION}: stack -> ${stack.route}`,
      );
    }
  }

  for (const entry of entries) {
    for (const sandbox of entry.sandboxPermissionSupport) {
      if (!KNOWN_SANDBOXES.has(sandbox)) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.UNKNOWN_SANDBOX_VALUE}: ${entry.stableId} -> ${sandbox}`,
        );
      }
    }
    for (const routeId of entry.routeEligibility) {
      const route = ROUTE_BY_ID[routeId];
      if (!route) {
        continue;
      }
      if (!entry.sandboxPermissionSupport.includes(route.sandbox)) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.UNSUPPORTED_SANDBOX_CLAIM}: ${entry.stableId} missing sandbox ${route.sandbox} for ${routeId}`,
        );
      }
      if (!entry.outputContracts.includes(route.outputContract)) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.UNSUPPORTED_SANDBOX_CLAIM}: ${entry.stableId} missing output contract ${route.outputContract} for ${routeId}`,
        );
      }
    }
  }

  const entryById = new Map(entries.map((entry) => [entry.stableId, entry]));
  for (const stack of stacks) {
    if (stack.rungs) {
      const seenRungs = new Set<string>();
      const candidateSet = new Set(stack.candidates);
      for (const rung of stack.rungs) {
        const key = rungId(rung.stableId, rung.effort);
        if (seenRungs.has(key)) {
          errors.push(
            `${MODEL_REGISTRY_ERROR.DUPLICATE_RUNG}: ${key} in ${stack.route}/${stack.phase ?? "unphased"}`,
          );
        }
        seenRungs.add(key);
        if (!candidateSet.has(rung.stableId)) {
          errors.push(
            `${MODEL_REGISTRY_ERROR.FALLBACK_CYCLE}: rung ${key} names a model missing from candidates in ${stack.route}`,
          );
        }
        if (!EFFORT_LEVELS.includes(rung.effort)) {
          errors.push(
            `${MODEL_REGISTRY_ERROR.UNKNOWN_EFFORT_LEVEL}: ${key} in ${stack.route}`,
          );
          continue;
        }
        const rungEntry = entryById.get(rung.stableId);
        if (
          rungEntry &&
          rung.effort !== NO_EFFORT_RUNG &&
          rungEntry.fixedEffort !== rung.effort &&
          !supportedEffortsFor(rungEntry).includes(rung.effort)
        ) {
          errors.push(
            `${MODEL_REGISTRY_ERROR.EFFORT_UNSUPPORTED_BY_BACKEND}: ${key}`,
          );
        }
      }
    }
    const seen = new Set<string>();
    for (const [candidate, effort] of Object.entries(
      stack.candidateEfforts ?? {},
    ) as Array<[string, Effort]>) {
      if (!stack.candidates.includes(candidate)) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.UNKNOWN_EFFORT_LEVEL}: ${candidate} is not in ${stack.route}/${stack.phase ?? "unphased"}`,
        );
        continue;
      }
      const candidateEntry = entryById.get(candidate);
      if (
        candidateEntry &&
        candidateEntry.fixedEffort !== effort &&
        !supportedEffortsFor(candidateEntry).includes(effort)
      ) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.EFFORT_UNSUPPORTED_BY_BACKEND}: ${candidate} -> ${effort}`,
        );
      }
    }
    for (const candidate of stack.candidates) {
      const candidateEntry = entryById.get(candidate);
      if (!candidateEntry) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.FALLBACK_CYCLE}: unknown candidate ${candidate} in ${stack.route}`,
        );
      } else {
        // Eligibility is a registry claim, distinct from runnability:
        // conditional (not-yet-evidenced) candidates may hold stack positions,
        // but never a model that is not eligible for the route at all. Any
        // remaining role-restricted model is banned from automatic-fallback
        // stacks (Fable/Sol are ordinary workers under ADR 0004).
        if (!candidateEntry.routeEligibility.includes(stack.route)) {
          errors.push(
            `${MODEL_REGISTRY_ERROR.STACK_CANDIDATE_NOT_ELIGIBLE}: ${candidate} in ${stack.route}`,
          );
        }
        if (stack.automaticFallback && candidateEntry.roleRestriction != null) {
          errors.push(
            `${MODEL_REGISTRY_ERROR.ROLE_RESTRICTED_AUTOMATIC_FALLBACK}: ${candidate} in ${stack.route}`,
          );
        }
      }
      if (seen.has(candidate)) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.FALLBACK_CYCLE}: duplicate candidate ${candidate} in ${stack.route}`,
        );
      }
      seen.add(candidate);
    }
  }

  for (const entry of entries) {
    if (
      RUNNABLE_MATURITIES.has(entry.maturity) &&
      entry.routeEligibility.length > 0 &&
      (!hasVerifiedEvidence(entry) || !hasRunnableIdentityFields(entry))
    ) {
      errors.push(
        `${MODEL_REGISTRY_ERROR.RUNNABLE_MISSING_EVIDENCE}: ${entry.stableId}`,
      );
    }
  }

  for (const entry of entries) {
    if (
      (entry.maturity === "planned" || entry.maturity === "disabled") &&
      entry.routeEligibility.length > 0
    ) {
      errors.push(
        `${MODEL_REGISTRY_ERROR.PLANNED_ROUTE_ELIGIBLE}: ${entry.stableId}`,
      );
    }
  }

  for (const entry of entries) {
    // Parent-only models are never workers: any route eligibility is rejected.
    if (
      entry.roleRestriction === "parent-only" &&
      entry.routeEligibility.length > 0
    ) {
      errors.push(
        `${MODEL_REGISTRY_ERROR.PARENT_ONLY_ROUTE_ELIGIBLE}: ${entry.stableId}`,
      );
    }
  }

  for (const entry of entries) {
    errors.push(...glmProviderBoundaryViolations(entry));
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Shipped registry ↔ policy parity. Every public binding in the generated
 * policy copy must resolve to a registry entry with the same provider model
 * id and transport backend, the policy's fixed-effort surface metadata must
 * equal the entry's fixedEffort, an alias default effort must be selectable
 * on that entry, and excluded models must never carry an automatic rung.
 * Returns the divergences; an empty list means the registry matches.
 */
export function registryPolicyDivergences(
  entries: readonly ModelDefinition[],
  policy: RoutingPolicy,
  stacks: readonly CandidateStack[],
): string[] {
  const errors: string[] = [];
  const byStableId = new Map(entries.map((entry) => [entry.stableId, entry]));
  for (const binding of policy.routeBindings) {
    const entry = byStableId.get(binding.stableId);
    if (!entry) {
      errors.push(
        `policy binding ${binding.base} pins ${binding.stableId}, which is not in the registry`,
      );
      continue;
    }
    if (entry.providerModelId !== binding.providerModelId) {
      errors.push(
        `policy binding ${binding.base}: registry providerModelId ${String(entry.providerModelId)} != policy ${binding.providerModelId}`,
      );
    }
    if (entry.transportBackend !== binding.backend) {
      errors.push(
        `policy binding ${binding.base}: registry backend ${String(entry.transportBackend)} != policy ${binding.backend}`,
      );
    }
    if (entry.maturity !== "available") {
      errors.push(
        `policy binding ${binding.base}: ${binding.stableId} is ${entry.maturity}, not available`,
      );
    }
    const surface = policy.surfaces[binding.stableId];
    if (!surface) {
      errors.push(`policy binding ${binding.base}: no surface for ${binding.stableId}`);
    } else if ((entry.fixedEffort ?? null) !== surface.fixedEffort) {
      errors.push(
        `policy surface ${binding.stableId}: registry fixedEffort ${String(entry.fixedEffort ?? null)} != policy ${String(surface.fixedEffort)}`,
      );
    }
    if ("defaultEffort" in binding) {
      const selectable = entry.fixedEffort
        ? [entry.fixedEffort]
        : supportedEffortsFor(entry);
      if (!selectable.includes(binding.defaultEffort as Effort)) {
        errors.push(
          `policy binding ${binding.base}: default effort ${binding.defaultEffort} is not selectable on ${binding.stableId}`,
        );
      }
    }
  }
  for (const stableId of Object.keys(policy.surfaces)) {
    if (!policy.routeBindings.some((binding) => binding.stableId === stableId)) {
      errors.push(`policy surface ${stableId} has no binding`);
    }
  }
  for (const stableId of policy.excludedModels) {
    for (const stack of stacks) {
      if (stack.automaticFallback && stack.candidates.includes(stableId)) {
        errors.push(
          `excluded model ${stableId} appears in automatic stack ${stack.route}/${stack.phase ?? "-"}/${stack.workloadClass ?? "-"}`,
        );
      }
    }
  }
  return errors;
}

