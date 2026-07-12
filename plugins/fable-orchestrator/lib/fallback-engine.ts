// Phase-3 bounded one-pass fallback state machine from docs/orchestrator/model-tier-routing-plan.md.
// Availability recovery only, never quality escalation; not wired into execution (staged control below).

import type { CanonicalCapabilityRouteId, OutputContractId } from "./capability-routes";
import {
  type FailureDisposition,
  isRetryableDisposition,
} from "./failure-classification";
import type {
  CandidateStack,
  ModelMaturity,
  ModelRegistryEntry,
} from "./model-registry";
import type { EnvLike } from "./routes";
import type { Mode, TraceSandbox } from "./trace-schema";

export const FALLBACK_ENGINE_SCHEMA_VERSION = 1;

export type FallbackEngineStage = "off" | "shadow";

export function fallbackEngineStage(env: EnvLike): FallbackEngineStage {
  return env.FABLE_ORCHESTRATOR_FALLBACK_ENGINE === "shadow" ? "shadow" : "off";
}

export type FixedFallbackContract = {
  mode: Mode;
  sandbox: TraceSandbox;
  outputContract: OutputContractId;
};

export type AttemptOutcome =
  | { status: "success" }
  | { status: "failure"; disposition: FailureDisposition };

export type AttemptFn = (
  candidate: { stableId: string; entry: ModelRegistryEntry },
  attemptIndex: number,
) => AttemptOutcome | Promise<AttemptOutcome>;

export type BoundaryCrossing = {
  crossedProvider: boolean;
  crossedBackend: boolean;
  crossedPriceBand: boolean;
};

export type TraversalStep =
  | {
      action: "skipped-non-runnable";
      candidateIndex: number;
      stableId: string;
      classification: "not_runnable";
      detail: string;
    }
  | {
      action: "terminated-incompatible";
      candidateIndex: number;
      stableId: string;
      disposition: FailureDisposition;
      detail: string;
    }
  | {
      action: "attempted";
      candidateIndex: number;
      attemptIndex: number;
      stableId: string;
      outcome: "success" | "failure";
      disposition: FailureDisposition | null;
      boundary: BoundaryCrossing | null;
    };

export type TraversalResult = {
  schemaVersion: 1;
  route: CanonicalCapabilityRouteId;
  status: "selected" | "terminal" | "stack-exhausted" | "budget-exhausted";
  selected: {
    stableId: string;
    transportBackend: string | null;
    model: string;
  } | null;
  terminalDisposition: FailureDisposition | null;
  steps: TraversalStep[];
  attemptCount: number;
};

const SANDBOX_STRICTNESS: Record<TraceSandbox, number> = {
  "read-only": 2,
  "workspace-write": 1,
};

function isSandboxCompatible(
  contractSandbox: TraceSandbox,
  support: readonly TraceSandbox[],
): boolean {
  const requiredStrictness = SANDBOX_STRICTNESS[contractSandbox];
  return support.some((sandbox) => SANDBOX_STRICTNESS[sandbox] >= requiredStrictness);
}

function boundaryCrossing(
  previous: ModelRegistryEntry,
  current: ModelRegistryEntry,
): BoundaryCrossing {
  return {
    crossedProvider: previous.servingProvider !== current.servingProvider,
    crossedBackend: previous.transportBackend !== current.transportBackend,
    crossedPriceBand: previous.priceBand !== current.priceBand,
  };
}

function skipDetailForMaturity(maturity: ModelMaturity): string {
  return `${maturity} maturity`;
}

function selectedModelFor(entry: ModelRegistryEntry): string {
  return entry.providerModelId ?? entry.stableId;
}

export async function runFallbackTraversal(
  input: {
    route: CanonicalCapabilityRouteId;
    contract: FixedFallbackContract;
    stack: CandidateStack;
    registry: readonly ModelRegistryEntry[];
    maxAttempts?: number;
  },
  attempt: AttemptFn,
): Promise<TraversalResult> {
  const registryById = new Map(input.registry.map((entry) => [entry.stableId, entry]));
  const steps: TraversalStep[] = [];
  let attemptCount = 0;
  let attemptIndex = 0;
  let lastAttemptedEntry: ModelRegistryEntry | null = null;
  let lastRetryableDisposition: FailureDisposition | null = null;

  // A stack with a repeated stableId is not a validated stack: traversing it
  // could attempt the same candidate twice. Terminate visibly before any attempt.
  const seenStableIds = new Set<string>();
  for (let candidateIndex = 0; candidateIndex < input.stack.candidates.length; candidateIndex++) {
    const stableId = input.stack.candidates[candidateIndex];
    if (seenStableIds.has(stableId)) {
      const detail = `duplicate candidate in stack: ${stableId}`;
      const disposition: FailureDisposition = {
        kind: "terminal",
        classification: "invalid_configuration",
        detail,
      };
      steps.push({
        action: "terminated-incompatible",
        candidateIndex,
        stableId,
        disposition,
        detail,
      });
      return {
        schemaVersion: 1,
        route: input.route,
        status: "terminal",
        selected: null,
        terminalDisposition: disposition,
        steps,
        attemptCount,
      };
    }
    seenStableIds.add(stableId);
  }

  for (let candidateIndex = 0; candidateIndex < input.stack.candidates.length; candidateIndex++) {
    const stableId = input.stack.candidates[candidateIndex];
    const entry = registryById.get(stableId);

    if (!entry) {
      const disposition: FailureDisposition = {
        kind: "terminal",
        classification: "invalid_configuration",
        detail: `unknown candidate: ${stableId}`,
      };
      const detail = disposition.detail ?? "unknown candidate";
      steps.push({
        action: "terminated-incompatible",
        candidateIndex,
        stableId,
        disposition,
        detail,
      });
      return {
        schemaVersion: 1,
        route: input.route,
        status: "terminal",
        selected: null,
        terminalDisposition: disposition,
        steps,
        attemptCount,
      };
    }

    if (entry.maturity === "planned" || entry.maturity === "disabled") {
      steps.push({
        action: "skipped-non-runnable",
        candidateIndex,
        stableId,
        classification: "not_runnable",
        detail: skipDetailForMaturity(entry.maturity),
      });
      continue;
    }

    if (!isSandboxCompatible(input.contract.sandbox, entry.sandboxPermissionSupport)) {
      const detail = `sandbox incompatible: contract requires ${input.contract.sandbox}, support is ${entry.sandboxPermissionSupport.join(", ")}`;
      const disposition: FailureDisposition = {
        kind: "terminal",
        classification: "sandbox_incompatible",
        detail,
      };
      steps.push({
        action: "terminated-incompatible",
        candidateIndex,
        stableId,
        disposition,
        detail,
      });
      return {
        schemaVersion: 1,
        route: input.route,
        status: "terminal",
        selected: null,
        terminalDisposition: disposition,
        steps,
        attemptCount,
      };
    }

    if (!entry.outputContracts.includes(input.contract.outputContract)) {
      const detail = `output contract mismatch: required ${input.contract.outputContract}`;
      const disposition: FailureDisposition = {
        kind: "terminal",
        classification: "invalid_configuration",
        detail,
      };
      steps.push({
        action: "terminated-incompatible",
        candidateIndex,
        stableId,
        disposition,
        detail,
      });
      return {
        schemaVersion: 1,
        route: input.route,
        status: "terminal",
        selected: null,
        terminalDisposition: disposition,
        steps,
        attemptCount,
      };
    }

    if (input.maxAttempts !== undefined && attemptCount >= input.maxAttempts) {
      return {
        schemaVersion: 1,
        route: input.route,
        status: "budget-exhausted",
        selected: null,
        terminalDisposition: null,
        steps,
        attemptCount,
      };
    }

    const outcome = await attempt({ stableId, entry }, attemptIndex);
    const boundary =
      lastAttemptedEntry == null ? null : boundaryCrossing(lastAttemptedEntry, entry);

    if (outcome.status === "success") {
      steps.push({
        action: "attempted",
        candidateIndex,
        attemptIndex,
        stableId,
        outcome: "success",
        disposition: null,
        boundary,
      });
      attemptCount++;
      attemptIndex++;
      return {
        schemaVersion: 1,
        route: input.route,
        status: "selected",
        selected: {
          stableId,
          transportBackend: entry.transportBackend,
          model: selectedModelFor(entry),
        },
        terminalDisposition: null,
        steps,
        attemptCount,
      };
    }

    steps.push({
      action: "attempted",
      candidateIndex,
      attemptIndex,
      stableId,
      outcome: "failure",
      disposition: outcome.disposition,
      boundary,
    });
    attemptCount++;
    attemptIndex++;
    lastAttemptedEntry = entry;

    if (isRetryableDisposition(outcome.disposition)) {
      lastRetryableDisposition = outcome.disposition;
      continue;
    }

    return {
      schemaVersion: 1,
      route: input.route,
      status: "terminal",
      selected: null,
      terminalDisposition: outcome.disposition,
      steps,
      attemptCount,
    };
  }

  return {
    schemaVersion: 1,
    route: input.route,
    status: "stack-exhausted",
    selected: null,
    terminalDisposition: lastRetryableDisposition,
    steps,
    attemptCount,
  };
}
