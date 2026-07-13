// Phase-5 delegation routing: resolve capability routes and stack candidates for
// parent-scheduled depth-two dispatch. Library-only; does not activate execution.

import {
  CAPABILITY_ROUTES,
  capabilityRouteFor,
  resolvePublicAlias,
  type CanonicalCapabilityRouteId,
  type OutputContractId,
} from "./capability-routes";
import {
  MODEL_REGISTRY,
  candidateStackForRoute,
  type ModelMaturity,
  type ModelRegistryEntry,
} from "./model-registry";
import { RETRYABLE_FAILURE_CLASSES } from "./failure-classification";
import type { Mode, TraceSandbox } from "./trace-schema";

export const DELEGATION_ROUTING_SCHEMA_VERSION = 1;
export const MAX_PREFERRED_CANDIDATE_STABLE_IDS = 5;

export const GPT_55_STABLE_ID = "gpt-5.5";
export const GPT_56_SOL_STABLE_ID = "gpt-5.6-sol";

export type FixedRouteContract = {
  mode: Mode;
  sandbox: TraceSandbox;
  outputContract: OutputContractId;
};

export type DelegationRoutingInput = {
  requestedRoute: string;
  preferredCandidateStableIds?: readonly string[];
  failureTrigger?: string | null;
  exhaustedCandidateStableId?: string | null;
  explicitParentAuthorization?: boolean;
  toughTask?: boolean;
};

export type DelegationRoutingSuccess = {
  ok: true;
  canonicalRouteId: CanonicalCapabilityRouteId;
  requestedAlias: string | null;
  fixedContract: FixedRouteContract;
  candidateStableId: string;
  selectionReason: string;
  rateLimitFallback: boolean;
  explicitParentAuthorizationApplied: boolean;
};

export type DelegationRoutingFailure = {
  ok: false;
  reasons: string[];
};

export type DelegationRoutingResult =
  | DelegationRoutingSuccess
  | DelegationRoutingFailure;

const RUNNABLE_MATURITIES = new Set<ModelMaturity>([
  "experimental",
  "available",
  "deprecated",
]);

const RETRYABLE_TRIGGER_SET = new Set<string>(RETRYABLE_FAILURE_CLASSES);

const REGISTRY_BY_ID = new Map(
  MODEL_REGISTRY.map((entry) => [entry.stableId, entry]),
);

const CANONICAL_ROUTE_IDS = new Set(
  CAPABILITY_ROUTES.map((route) => route.id),
);

function normalizeRouteInput(route: string): string {
  return route.trim().toLowerCase();
}

function normalizeFailureTrigger(
  trigger: string | null | undefined,
): string | null {
  if (trigger == null) {
    return null;
  }
  const normalized = trigger.trim().toLowerCase().replace(/-/g, "_");
  return normalized === "" ? null : normalized;
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
  if (
    entry.transportBackend == null ||
    entry.transportBackend === "claude-code-parent"
  ) {
    return false;
  }
  const runnerKey = `${entry.transportBackend}:${contract.mode}`;
  return entry.runnerSupport.includes(runnerKey);
}

export function evaluateCandidateEligibility(
  stableId: string,
  routeId: CanonicalCapabilityRouteId,
  contract: FixedRouteContract,
): { eligible: boolean; reasons: string[] } {
  const entry = REGISTRY_BY_ID.get(stableId);
  const reasons: string[] = [];

  if (!entry) {
    return { eligible: false, reasons: ["unknown-registry-entry"] };
  }

  if (entry.maturity === "planned" || entry.maturity === "disabled") {
    reasons.push("not-runnable-maturity");
  } else if (!RUNNABLE_MATURITIES.has(entry.maturity)) {
    reasons.push("not-runnable-maturity");
  }

  if (!entry.routeEligibility.includes(routeId)) {
    reasons.push("missing-route-eligibility");
  }

  if (entry.roleRestriction === "parent-only") {
    reasons.push("parent-only-role-restriction");
  }

  if (!hasVerifiedEvidence(entry) || !hasRunnableIdentityFields(entry)) {
    reasons.push("missing-evidence");
  }

  if (!satisfiesRouteContract(entry, routeId, contract)) {
    reasons.push("contract-incompatible");
  }

  return { eligible: reasons.length === 0, reasons };
}

export function resolveCanonicalRoute(
  requestedRoute: string,
):
  | {
      ok: true;
      canonicalRouteId: CanonicalCapabilityRouteId;
      requestedAlias: string | null;
    }
  | { ok: false; reasons: string[] } {
  const normalized = normalizeRouteInput(requestedRoute);
  if (normalized === "") {
    return { ok: false, reasons: ["malformed-route-path"] };
  }

  if (CANONICAL_ROUTE_IDS.has(normalized as CanonicalCapabilityRouteId)) {
    return {
      ok: true,
      canonicalRouteId: normalized as CanonicalCapabilityRouteId,
      requestedAlias: null,
    };
  }

  const binding = resolvePublicAlias(normalized);
  if (!binding) {
    return { ok: false, reasons: ["malformed-route-path"] };
  }

  return {
    ok: true,
    canonicalRouteId: binding.capabilityRoute,
    requestedAlias: binding.alias,
  };
}

function boundedPreferredCandidates(
  preferred: readonly string[] | undefined,
): string[] | { ok: false; reasons: string[] } {
  if (preferred == null) {
    return [];
  }
  if (preferred.length > MAX_PREFERRED_CANDIDATE_STABLE_IDS) {
    return { ok: false, reasons: ["preferred-candidates-overflow"] };
  }
  const normalized: string[] = [];
  for (const candidate of preferred) {
    const stableId = candidate.trim().toLowerCase();
    if (stableId === "" || !REGISTRY_BY_ID.has(stableId)) {
      return { ok: false, reasons: ["malformed-preferred-candidate"] };
    }
    if (!normalized.includes(stableId)) {
      normalized.push(stableId);
    }
  }
  return normalized;
}

function requiresToughTaskAuthorization(
  stableId: string,
  toughTask: boolean,
): boolean {
  return stableId === GPT_55_STABLE_ID && toughTask;
}

function requiresSolAuthorization(stableId: string): boolean {
  return stableId === GPT_56_SOL_STABLE_ID;
}

function authorizationFailure(
  stableId: string,
  toughTask: boolean,
  explicitParentAuthorization: boolean,
): string | null {
  if (
    requiresSolAuthorization(stableId) &&
    explicitParentAuthorization !== true
  ) {
    return "explicit-parent-authorization-required";
  }
  if (
    requiresToughTaskAuthorization(stableId, toughTask) &&
    explicitParentAuthorization !== true
  ) {
    return "explicit-parent-authorization-required";
  }
  return null;
}

function firstEligibleFromPreferences(
  routeId: CanonicalCapabilityRouteId,
  contract: FixedRouteContract,
  stackCandidates: readonly string[],
  preferred: readonly string[],
): { stableId: string; reason: string } | null {
  for (const preferredId of preferred) {
    const evaluation = evaluateCandidateEligibility(
      preferredId,
      routeId,
      contract,
    );
    if (evaluation.eligible) {
      return { stableId: preferredId, reason: "preferred-eligible-candidate" };
    }
  }

  for (const stableId of stackCandidates) {
    const evaluation = evaluateCandidateEligibility(
      stableId,
      routeId,
      contract,
    );
    if (evaluation.eligible) {
      return { stableId, reason: "first-eligible-stack-candidate" };
    }
  }

  return null;
}

function rateLimitSuccessor(
  routeId: CanonicalCapabilityRouteId,
  contract: FixedRouteContract,
  stackCandidates: readonly string[],
  exhaustedCandidateStableId: string,
): { stableId: string; reason: string } | null {
  const exhausted = exhaustedCandidateStableId.trim().toLowerCase();
  const startIndex = stackCandidates.indexOf(exhausted);
  if (startIndex < 0) {
    return null;
  }

  for (let index = startIndex + 1; index < stackCandidates.length; index += 1) {
    const stableId = stackCandidates[index]!;
    const evaluation = evaluateCandidateEligibility(
      stableId,
      routeId,
      contract,
    );
    if (evaluation.eligible) {
      return {
        stableId,
        reason: "rate-limit-stack-fallback",
      };
    }
  }

  return null;
}

function isProviderSwitch(
  firstStackEligible: string | null,
  selected: string,
): boolean {
  if (firstStackEligible == null) {
    return false;
  }
  if (firstStackEligible === selected) {
    return false;
  }
  const firstEntry = REGISTRY_BY_ID.get(firstStackEligible);
  const selectedEntry = REGISTRY_BY_ID.get(selected);
  if (!firstEntry?.transportBackend || !selectedEntry?.transportBackend) {
    return firstStackEligible !== selected;
  }
  return firstEntry.transportBackend !== selectedEntry.transportBackend;
}

export function resolveDelegationRouting(
  input: DelegationRoutingInput,
): DelegationRoutingResult {
  const routeResolution = resolveCanonicalRoute(input.requestedRoute);
  if (!routeResolution.ok) {
    return routeResolution;
  }

  const routeContract = capabilityRouteFor(routeResolution.canonicalRouteId);
  const fixedContract: FixedRouteContract = {
    mode: routeContract.mode,
    sandbox: routeContract.sandbox,
    outputContract: routeContract.outputContract,
  };

  const stack = candidateStackForRoute(
    routeResolution.canonicalRouteId,
    routeResolution.requestedAlias,
  );
  if (!stack || stack.candidates.length === 0) {
    return { ok: false, reasons: ["no-candidate-stack"] };
  }

  const preferredResult = boundedPreferredCandidates(
    input.preferredCandidateStableIds,
  );
  if (!Array.isArray(preferredResult)) {
    return preferredResult;
  }

  const failureTrigger = normalizeFailureTrigger(input.failureTrigger);
  const rateLimitRequested = failureTrigger === "rate_limit";
  const toughTask = input.toughTask === true;

  if (failureTrigger != null && !RETRYABLE_TRIGGER_SET.has(failureTrigger)) {
    return { ok: false, reasons: ["malformed-failure-trigger"] };
  }

  let selection: { stableId: string; reason: string } | null = null;
  let rateLimitFallback = false;

  if (rateLimitRequested) {
    const exhausted = input.exhaustedCandidateStableId?.trim().toLowerCase();
    if (!exhausted) {
      return { ok: false, reasons: ["rate-limit-missing-exhausted-candidate"] };
    }
    selection = rateLimitSuccessor(
      routeResolution.canonicalRouteId,
      fixedContract,
      stack.candidates,
      exhausted,
    );
    if (!selection) {
      return { ok: false, reasons: ["no-rate-limit-fallback-candidate"] };
    }
    rateLimitFallback = true;
  } else {
    if (preferredResult.length > 0) {
      const firstStack = firstEligibleFromPreferences(
        routeResolution.canonicalRouteId,
        fixedContract,
        stack.candidates,
        [],
      );
      const preferredSelection = firstEligibleFromPreferences(
        routeResolution.canonicalRouteId,
        fixedContract,
        stack.candidates,
        preferredResult,
      );
      if (!preferredSelection) {
        return { ok: false, reasons: ["no-eligible-preferred-candidate"] };
      }

      if (
        failureTrigger != null &&
        failureTrigger !== "rate_limit" &&
        isProviderSwitch(firstStack?.stableId ?? null, preferredSelection.stableId)
      ) {
        return {
          ok: false,
          reasons: ["provider-switch-not-authorized-without-rate-limit"],
        };
      }

      const preferredAuthFailure = authorizationFailure(
        preferredSelection.stableId,
        toughTask,
        input.explicitParentAuthorization === true,
      );
      if (preferredAuthFailure) {
        return { ok: false, reasons: [preferredAuthFailure] };
      }

      const allowsAuthorizedProviderSwitch =
        input.explicitParentAuthorization === true &&
        preferredResult.some(
          (stableId) =>
            stableId === preferredSelection.stableId &&
            (stableId === GPT_55_STABLE_ID ||
              stableId === GPT_56_SOL_STABLE_ID),
        );
      if (
        isProviderSwitch(firstStack?.stableId ?? null, preferredSelection.stableId) &&
        !allowsAuthorizedProviderSwitch
      ) {
        return {
          ok: false,
          reasons: ["provider-switch-not-authorized-without-rate-limit"],
        };
      }
      selection = preferredSelection;
    } else {
      selection = firstEligibleFromPreferences(
        routeResolution.canonicalRouteId,
        fixedContract,
        stack.candidates,
        [],
      );
      if (!selection) {
        return { ok: false, reasons: ["no-eligible-stack-candidate"] };
      }
    }
  }

  const visibleIneligible = preferredResult
    .map((stableId) =>
      evaluateCandidateEligibility(
        stableId,
        routeResolution.canonicalRouteId,
        fixedContract,
      ),
    )
    .find((evaluation) => !evaluation.eligible);
  if (
    visibleIneligible &&
    preferredResult.includes(selection.stableId) === false &&
    !rateLimitFallback
  ) {
    return { ok: false, reasons: visibleIneligible.reasons };
  }

  const selectedEvaluation = evaluateCandidateEligibility(
    selection.stableId,
    routeResolution.canonicalRouteId,
    fixedContract,
  );
  if (!selectedEvaluation.eligible) {
    return { ok: false, reasons: selectedEvaluation.reasons };
  }

  const authFailure = authorizationFailure(
    selection.stableId,
    toughTask,
    input.explicitParentAuthorization === true,
  );
  if (authFailure) {
    return { ok: false, reasons: [authFailure] };
  }

  return {
    ok: true,
    canonicalRouteId: routeResolution.canonicalRouteId,
    requestedAlias: routeResolution.requestedAlias,
    fixedContract,
    candidateStableId: selection.stableId,
    selectionReason: selection.reason,
    rateLimitFallback,
    explicitParentAuthorizationApplied:
      requiresSolAuthorization(selection.stableId) ||
      requiresToughTaskAuthorization(selection.stableId, toughTask),
  };
}
