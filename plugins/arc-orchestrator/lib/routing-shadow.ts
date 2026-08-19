// Phase-2 registry/selector shadow mode: resolve current vs proposed routing without
// changing execution. Observational only.
//
// Phase 13.10 adds an optional capability-rung shadow pass: when the projected
// selection stage is exactly `shadow` and a capability snapshot is explicitly
// supplied, `select()` runs beside the authored candidate stack. Authored stacks
// remain the sole executing path; the derived decision feeds a reviewable
// disagreement corpus and never rewrites backend inputs.

import {
  buildAvailabilityView,
  type BackendObservation,
} from "./availability-view";
import {
  listAvailabilityObservations,
} from "./availability-observations";
import {
  capabilityFloorDisagreement,
  resolveCapabilityFloor,
} from "./capability-floor";
import {
  CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
  type CapabilityAxis,
  type CapabilitySnapshot,
} from "./capability-snapshot";
import {
  deriveLeadPolicy,
  select,
  SELECTION_POLICY_VERSION,
  type SelectionDecision,
} from "./capability-selection";
import {
  CAPABILITY_ROUTES,
  CAPABILITY_ROUTES_SCHEMA_VERSION,
  capabilityRouteFor,
  resolvePublicAlias,
  type CanonicalCapabilityRouteId,
  type OutputContractId,
} from "./capability-routes";
import {
  createRootBudgetLedger,
  type RootBudgetLedger,
} from "./delegation-budget";
import {
  MODEL_REGISTRY,
  MODEL_REGISTRY_SCHEMA_VERSION,
  PREFERRED_MODEL_ENV,
  candidateStackForRoute,
  preferAutomaticAnalyzeCandidate,
  type ModelMaturity,
  type ModelRegistryEntry,
} from "./model-registry";
import { resolveSelectionStage } from "./rollout-gates";
import {
  type EnvLike,
  resolveProfile,
  routeCapabilities,
} from "./routes";
import {
  authoredStackView,
  buildSelectionShadowCorpusRecord,
  type SelectionShadowCorpusRecord,
  type StackComparison,
} from "./selection-shadow-corpus";
import { selectionTraceFrom } from "./selection-trace";
import type {
  Backend,
  Mode,
  TaskPhase,
  RoutingTraceV2Selection,
  TraceSandbox,
} from "./trace-schema";

export const ROUTING_SHADOW_SCHEMA_VERSION = 1;

/** Explicit empty snapshot for configured rollback / delete-the-snapshot. */
export function emptyCapabilitySnapshotForShadow(): CapabilitySnapshot {
  return {
    schemaVersion: CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
    snapshotVersion: "2026-07-26+empty",
    bandWidth: 0.25,
    rungs: [],
  };
}

export function axisForCapabilityRoute(
  routeId: CanonicalCapabilityRouteId,
): CapabilityAxis {
  switch (routeId) {
    case "taste-review.read-only.v1":
      return "taste";
    case "explore.read-only.v1":
    case "check.read-only.v1":
      return "swe";
    case "implement.workspace-write.v1":
      return "agentic-edit";
  }
}

export type OverrideRequest = {
  model: string;
  explicitParentAuthorization?: boolean;
};

export type RoutingShadowInput = {
  requestedAlias: string;
  env: EnvLike;
  taskClass?: string | null;
  workloadClass?: string | null;
  phase?: TaskPhase | null;
  // When false, request the canonical route via alias but select the automatic
  // ADR stack instead of the single-candidate explicit pin.
  pinAlias?: boolean;
  override?: OverrideRequest;
  // Phase 13.10: explicit snapshot configuration. `undefined` means the caller
  // did not configure a snapshot — select() does not run and absence is not
  // treated as measured evidence. `null` means configured empty (rollback).
  capabilitySnapshot?: CapabilitySnapshot | null;
  // Injected clock for select(); defaults only when capability shadow runs.
  nowMs?: number;
  // Optional ledger; when omitted a fresh root ledger is created for shadow.
  ledger?: RootBudgetLedger;
  // Optional observations; when omitted the process-local producer buffer is used.
  availabilityObservations?: readonly BackendObservation[];
  taskIdentity?: string | null;
};

export type CapabilityShadowSkipReason =
  | "stage-not-shadow"
  | "snapshot-absent"
  | "no-authored-stack"
  | "select-error";

export type CapabilityShadowReport = {
  ran: boolean;
  skipReason: CapabilityShadowSkipReason | null;
  decision: SelectionDecision | null;
  // Clipped per-dispatch shape; always executed:false under shadow.
  selectionTrace: RoutingTraceV2Selection | null;
  comparison: StackComparison | null;
  // Full unclipped corpus record when select() ran.
  corpus: SelectionShadowCorpusRecord | null;
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
  // Phase 13.10 observational capability-rung shadow. Absent when the Phase-2
  // report short-circuits before route resolution; otherwise always present so
  // readers can tell "did not run" from "predates the writer".
  capabilityShadow?: CapabilityShadowReport;
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
  if (
    entry.transportBackend == null ||
    entry.transportBackend === "claude-code-parent"
  ) {
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
  _override: OverrideRequest,
): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];

  if (!entry) {
    return { ok: false, reasons: ["unknown-model"] };
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
    (route) =>
      route.backend === backend &&
      route.mode === mode &&
      !route.id.startsWith("grok-"),
  );
  return match?.id ?? null;
}

export function canonicalRouteIdFromAlias(
  requestedAlias: string,
): CanonicalCapabilityRouteId | null {
  const normalized = requestedAlias.trim().toLowerCase();
  const binding = resolvePublicAlias(normalized);
  if (binding) {
    return binding.capabilityRoute;
  }
  const route = CAPABILITY_ROUTES.find((route) => route.id === normalized);
  return route?.id ?? null;
}

function skippedCapabilityShadow(
  skipReason: CapabilityShadowSkipReason,
): CapabilityShadowReport {
  return {
    ran: false,
    skipReason,
    decision: null,
    selectionTrace: null,
    comparison: null,
    corpus: null,
  };
}

function runCapabilitySelectionShadow(input: {
  env: EnvLike;
  routeId: CanonicalCapabilityRouteId;
  workloadClass: string | null | undefined;
  phase: TaskPhase | null | undefined;
  pinAlias: boolean;
  bindingAlias: string | null;
  capabilitySnapshot: CapabilitySnapshot | null | undefined;
  nowMs: number | undefined;
  ledger: RootBudgetLedger | undefined;
  availabilityObservations: readonly BackendObservation[] | undefined;
  taskIdentity: string | null | undefined;
  override: OverrideRequest | undefined;
}): CapabilityShadowReport {
  const stage = resolveSelectionStage(input.env);
  if (stage !== "shadow") {
    return skippedCapabilityShadow("stage-not-shadow");
  }
  if (input.capabilitySnapshot === undefined) {
    return skippedCapabilityShadow("snapshot-absent");
  }

  const snapshot =
    input.capabilitySnapshot ?? emptyCapabilitySnapshotForShadow();
  const authoredStack = candidateStackForRoute(
    input.routeId,
    input.pinAlias ? input.bindingAlias : null,
    input.workloadClass,
  );
  const stack =
    authoredStack &&
    !input.pinAlias &&
    (input.phase == null || input.phase === "analyze")
      ? preferAutomaticAnalyzeCandidate(
          authoredStack,
          input.env[PREFERRED_MODEL_ENV],
        )
      : authoredStack;
  if (!stack) {
    return skippedCapabilityShadow("no-authored-stack");
  }

  try {
    const axis = axisForCapabilityRoute(input.routeId);
    const nowMs = input.nowMs ?? 0;
    const floor = resolveCapabilityFloor({
      workloadClass: input.workloadClass ?? "default",
      inputs: {
        capabilityRoute: input.routeId,
        axis,
        snapshot,
        registry: MODEL_REGISTRY,
      },
    });
    const leadPolicy = deriveLeadPolicy(stack, MODEL_REGISTRY);
    const observations =
      input.availabilityObservations ?? listAvailabilityObservations();
    const availability = buildAvailabilityView({
      backends: observations,
      nowMs,
    });
    const ledger =
      input.ledger ??
      createRootBudgetLedger("routing-shadow", {
        clock: () => {
          throw new Error("capability shadow must not read a clock");
        },
        createdAtMs: nowMs,
      });

    let override: { stableId: string; effort: null } | null = null;
    if (input.override?.model) {
      const entry = lookupRegistryEntry(input.override.model);
      if (entry) {
        override = { stableId: entry.stableId, effort: null };
      }
    }

    const decision = select({
      request: {
        capabilityRoute: input.routeId,
        axis,
        capabilityFloor: floor.capabilityFloor,
        minimumFloor: floor.minimumFloor,
        bandCeiling: floor.bandCeiling,
        override,
        taskIdentity: input.taskIdentity ?? "routing-shadow",
        depth: 0,
        leadPolicy,
      },
      registry: MODEL_REGISTRY,
      snapshot,
      ledger,
      availability,
      policyVersion: SELECTION_POLICY_VERSION,
      nowMs,
    });

    const authored = authoredStackView({
      candidates: stack.candidates,
      leadBackend: leadPolicy.incumbentLeadBackend,
      policyVersion: stack.policyVersion,
    });
    const corpus = buildSelectionShadowCorpusRecord({
      taskIdentity: input.taskIdentity ?? null,
      capabilityRoute: input.routeId,
      axis,
      decision,
      authored,
      floorDisagreement: capabilityFloorDisagreement(floor),
    });

    return {
      ran: true,
      skipReason: null,
      decision,
      selectionTrace: selectionTraceFrom(decision, { executed: false }),
      comparison: corpus.comparison,
      corpus,
    };
  } catch {
    return skippedCapabilityShadow("select-error");
  }
}

export function resolveRoutingShadow(
  input: RoutingShadowInput,
): RoutingShadowReport {
  try {
    const requestedAlias = input.requestedAlias.trim().toLowerCase();
    const routeId = canonicalRouteIdFromAlias(requestedAlias);
    if (!routeId) {
      return emptyReport(requestedAlias, "unknown-alias");
    }

    const binding = resolvePublicAlias(requestedAlias);
    const routeContract = capabilityRouteFor(routeId);
    const fixedContract: FixedRouteContract = {
      mode: routeContract.mode,
      sandbox: routeContract.sandbox,
      outputContract: routeContract.outputContract,
    };

    const authoredStack = candidateStackForRoute(
      routeId,
      input.pinAlias === false ? null : binding?.alias,
      input.workloadClass,
      input.phase,
    );
    const stack =
      authoredStack && input.pinAlias === false
        ? preferAutomaticAnalyzeCandidate(
            authoredStack,
            input.env[PREFERRED_MODEL_ENV],
          )
        : authoredStack;
    const candidateStackPolicy = stack?.policyVersion ?? "candidate-stacks/v1";

    const routeBackend = binding
      ? backendForAlias(binding.alias, input.env)
      : null;
    // pinAlias (explicit --route): currentSelection mirrors the pinned stack
    // candidate and ignores ambient model env. pinAlias=false keeps the env
    // profile so shadow can compare automatic/direct backend defaults against
    // the ADR stack proposal.
    let currentSelection: RoutingShadowReport["currentSelection"] = null;
    if (input.pinAlias !== false && stack && stack.candidates.length > 0) {
      const pinnedEntry = REGISTRY_BY_ID.get(stack.candidates[0]!);
      const pinned = pinnedEntry ? selectionForEntry(pinnedEntry) : null;
      if (pinned) {
        currentSelection = { ...pinned, role: "executing" };
      }
    } else if (routeBackend != null) {
      // Automatic shadow: compare ambient/direct backend defaults (no route pin)
      // against the ADR stack proposal.
      currentSelection = {
        backend: routeBackend.backend,
        model: resolveProfile(
          input.env,
          routeBackend.backend,
          routeBackend.mode,
          input.taskClass ?? null,
        ).model,
        role: "executing",
      };
    }

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
          ...(input.override.explicitParentAuthorization === true
            ? { explicitParentAuthorization: true }
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

    const capabilityShadow = runCapabilitySelectionShadow({
      env: input.env,
      routeId,
      workloadClass: input.workloadClass,
      phase: input.phase,
      pinAlias: input.pinAlias !== false,
      bindingAlias: binding?.alias ?? null,
      capabilitySnapshot: input.capabilitySnapshot,
      nowMs: input.nowMs,
      ledger: input.ledger,
      availabilityObservations: input.availabilityObservations,
      taskIdentity: input.taskIdentity,
      override: input.override,
    });

    return {
      requestedAlias: binding?.alias ?? requestedAlias,
      canonicalRouteId: routeId,
      fixedContract,
      versions: buildVersions(candidateStackPolicy),
      candidateEvaluations,
      overrideOutcome,
      currentSelection,
      proposedSelection,
      proposedSelectionReason,
      comparison,
      capabilityShadow,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emptyReport(
      input.requestedAlias,
      `routing-shadow-internal-error: ${message}`,
    );
  }
}
