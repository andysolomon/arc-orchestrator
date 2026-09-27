// `evaluateRouting`: the one function both planes call to answer "what would
// ARC do, and why". It composes the exact runtime pieces — compiled candidate
// stacks, the capability floor, `deriveLeadPolicy`, `buildAvailabilityView`,
// and `select()` — over a policy, a registry, a snapshot, and a context. The
// runtime's routing-shadow path runs the same pieces; a parity test in the
// runtime holds the two decisions equal for every automatic stack.
//
// Two layers are reported, and they are deliberately not merged:
//   * `traversal` predicts the *executing* runner-routing-v4 behavior: the
//     authored stack walked in order, skipping non-runnable entries and
//     backends observed unavailable. This is what dispatches today.
//   * `selection` is the capability-rung `select()` decision (ADR 0010), which
//     runs observationally in shadow and is a routing proxy, not the executor.

import {
  buildAvailabilityView,
  type AvailabilityView,
  type BackendObservation,
} from "./availability";
import { budgetStateFor, type BudgetState } from "./budget";
import {
  aliasBindingsFor,
  capabilityRouteFor,
  resolvePublicAliasIn,
  type CanonicalCapabilityRouteId,
  type CapabilityRouteContract,
} from "./capability-routes";
import {
  candidateStackForRouteIn,
  capabilityRouteForPhase,
  compileRoutingPolicy,
  stackRungs,
  tailStartIndex,
  type CandidateStack,
  type CompiledRoutingPolicy,
} from "./candidate-stacks";
import {
  capabilityFloorDisagreement,
  resolveCapabilityFloor,
  resolveCapabilityFloorForStack,
  type ResolvedCapabilityFloor,
} from "./capability-floor";
import {
  emptyCapabilitySnapshot,
  snapshotIndex,
  type CapabilityAxis,
  type CapabilitySnapshot,
} from "./capability-snapshot";
import {
  findModel,
  hasRunnableIdentityFields,
  hasVerifiedEvidence,
  registryIndex,
  rungId,
  type ModelDefinition,
  type RungId,
} from "./model-schema";
import type { RoutingPolicy } from "./policy-schema";
import type { RoutingContext } from "./routing-context";
import {
  SELECTION_POLICY_VERSION,
  bandForSnapshotEntry,
  deriveLeadPolicy,
  select,
  type SelectionDecision,
} from "./selection";
import { selectionTraceFrom } from "./selection-trace";
import type { RoutingTraceV2Selection, WorkloadProfileRecord } from "./trace-schema";
import {
  RUNNABLE_MATURITIES,
  type Backend,
  type Effort,
  type WorkloadClass,
} from "./vocabulary";
import {
  hasSufficientEvidence,
  profileWorkload,
  type WorkloadProfile,
} from "./workload-profile";

export const ROUTING_EVALUATION_VERSION = "routing-evaluation/v1" as const;

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

export type TraversalStatus =
  | "selected"
  | "runnable"
  | "unavailable"
  | "not-runnable"
  | "ineligible"
  | "quota-exhausted"
  | "unknown-model";

export type TraversalStep = {
  index: number;
  rungId: RungId;
  stableId: string;
  effort: Effort;
  backend: Backend | null;
  displayName: string;
  inTail: boolean;
  status: TraversalStatus;
  reasons: string[];
  band: number | null;
  estimatedUsd: number | null;
};

export type PredictedTraversal = {
  policyVersion: string;
  automaticFallback: boolean;
  steps: TraversalStep[];
  selectedIndex: number | null;
  selected: TraversalStep | null;
  // Number of runnable rungs skipped because their backend was observed unavailable.
  availabilitySkips: number;
  exhausted: boolean;
};

export type RoutingEvaluationError = {
  code:
    | "parent-local-phase"
    | "workload-class-required"
    | "insufficient-evidence"
    | "unknown-alias"
    | "alias-route-mismatch"
    | "no-candidate-stack"
    | "override-unknown-model";
  message: string;
};

export type RoutingEvaluation = {
  version: typeof ROUTING_EVALUATION_VERSION;
  policyLabel: string;
  phase: RoutingContext["phase"];
  route: (CapabilityRouteContract & { axis: CapabilityAxis }) | null;
  workloadClass: WorkloadClass | null;
  workloadClassSource: "explicit" | "profiled" | "none";
  workloadProfile: WorkloadProfile | null;
  workloadProfileRecord: WorkloadProfileRecord | null;
  classDisagreement: { explicit: WorkloadClass; profiled: WorkloadClass } | null;
  stack: CandidateStack | null;
  tailStartIndex: number;
  traversal: PredictedTraversal | null;
  floor: ResolvedCapabilityFloor | null;
  floorDisagreement: { explicit: number; derived: number } | null;
  availability: AvailabilityView;
  budget: BudgetState;
  selection: SelectionDecision | null;
  selectionTrace: RoutingTraceV2Selection | null;
  error: RoutingEvaluationError | null;
};

export type RoutingEvaluationInputs = {
  policy: RoutingPolicy;
  registry: readonly ModelDefinition[];
  // `null` is the explicit "no snapshot" rollback state; `select()` then ranks
  // nothing and every derived floor is 0.
  snapshot: CapabilitySnapshot | null;
  context: RoutingContext;
  // Reuse compiled stacks across many evaluations (replay).
  compiled?: CompiledRoutingPolicy;
};

const compiledCache = new WeakMap<RoutingPolicy, CompiledRoutingPolicy>();

export function compiledFor(
  policy: RoutingPolicy,
  registry: readonly ModelDefinition[],
): CompiledRoutingPolicy {
  const cached = compiledCache.get(policy);
  if (cached) {
    return cached;
  }
  const compiled = compileRoutingPolicy(policy, registry);
  compiledCache.set(policy, compiled);
  return compiled;
}

function workloadProfileRecordFor(
  profile: WorkloadProfile,
  routed: WorkloadClass | null,
  source: WorkloadProfileRecord["class_source"],
  disagreement: WorkloadProfileRecord["disagreement"],
): WorkloadProfileRecord {
  return {
    contract: "workload-profile/v1",
    difficulty: profile.difficulty,
    volume: profile.volume,
    workload_class: profile.workloadClass,
    reasons: profile.reasons,
    routed_class: routed,
    class_source: source,
    disagreement,
    evidence_coverage: (Object.entries(profile.coverage) as Array<[string, boolean]>)
      .filter(([, seen]) => seen)
      .map(([section]) => section),
  };
}

/**
 * Resolve the workload class from an explicit class and/or evidence. Explicit
 * wins; the profile is still computed and reported so disagreement is visible.
 */
export function resolveWorkloadClass(context: RoutingContext): {
  workloadClass: WorkloadClass | null;
  source: RoutingEvaluation["workloadClassSource"];
  profile: WorkloadProfile | null;
  record: WorkloadProfileRecord | null;
  disagreement: RoutingEvaluation["classDisagreement"];
  insufficientEvidence: boolean;
} {
  const explicit = context.workloadClass ?? null;
  const profile = context.evidence ? profileWorkload(context.evidence) : null;
  const sufficient = context.evidence ? hasSufficientEvidence(context.evidence) : false;
  if (explicit) {
    const disagreement =
      profile && sufficient && profile.workloadClass !== explicit
        ? { explicit, profiled: profile.workloadClass }
        : null;
    return {
      workloadClass: explicit,
      source: "explicit",
      profile,
      record: profile ? workloadProfileRecordFor(profile, explicit, "explicit", disagreement) : null,
      disagreement,
      insufficientEvidence: false,
    };
  }
  if (profile && sufficient) {
    const routed = context.phase === "implement" ? profile.workloadClass : null;
    return {
      workloadClass: routed,
      source: routed ? "profiled" : "none",
      profile,
      record: workloadProfileRecordFor(profile, routed, routed ? "profiled" : "none", null),
      disagreement: null,
      insufficientEvidence: false,
    };
  }
  return {
    workloadClass: null,
    source: "none",
    profile,
    record: profile ? workloadProfileRecordFor(profile, null, "none", null) : null,
    disagreement: null,
    insufficientEvidence: profile != null && !sufficient,
  };
}

function eligibilityReasons(
  entry: ModelDefinition,
  route: CapabilityRouteContract,
): string[] {
  const reasons: string[] = [];
  if (!RUNNABLE_MATURITIES.has(entry.maturity)) {
    reasons.push(`not runnable: ${entry.maturity} maturity`);
  }
  if (!entry.routeEligibility.includes(route.id)) {
    reasons.push(`not eligible for ${route.id}`);
  }
  if (!entry.sandboxPermissionSupport.includes(route.sandbox)) {
    reasons.push(`sandbox ${route.sandbox} unsupported`);
  }
  if (!entry.outputContracts.includes(route.outputContract)) {
    reasons.push(`output contract ${route.outputContract} unsupported`);
  }
  if (!hasVerifiedEvidence(entry) || !hasRunnableIdentityFields(entry)) {
    reasons.push("missing runnable evidence");
  }
  if (entry.transportBackend == null || entry.transportBackend === "claude-code-parent") {
    reasons.push("no dispatchable transport");
  }
  return reasons;
}

/** Walk the authored stack the way the availability-only fallback engine would. */
export function predictTraversal(input: {
  stack: CandidateStack;
  policy: RoutingPolicy;
  registry: readonly ModelDefinition[];
  route: CapabilityRouteContract;
  axis: CapabilityAxis;
  snapshot: CapabilitySnapshot | null;
  availability: AvailabilityView;
}): PredictedTraversal {
  const byId = registryIndex(input.registry);
  const rungIndex = snapshotIndex(input.snapshot);
  const tailAt = tailStartIndex(input.stack, input.policy);
  const steps: TraversalStep[] = [];
  let selectedIndex: number | null = null;
  let availabilitySkips = 0;
  const rungs = stackRungs(input.stack);
  rungs.forEach((rung, index) => {
    const id = rungId(rung.stableId, rung.effort);
    const entry = byId.get(rung.stableId);
    const snapshotEntry = rungIndex.get(id) ?? null;
    const band = input.snapshot ? bandForSnapshotEntry(snapshotEntry, input.axis, input.snapshot.bandWidth) : null;
    const estimatedUsd = snapshotEntry?.costPrior?.usdPerTask ?? null;
    const base: Omit<TraversalStep, "status" | "reasons"> = {
      index,
      rungId: id,
      stableId: rung.stableId,
      effort: rung.effort,
      backend: entry && entry.transportBackend !== "claude-code-parent" ? entry.transportBackend : null,
      displayName: entry?.displayName ?? rung.stableId,
      inTail: tailAt >= 0 && index >= tailAt,
      band,
      estimatedUsd,
    };
    if (!entry) {
      steps.push({ ...base, status: "unknown-model", reasons: ["not in the model registry"] });
      return;
    }
    if (!RUNNABLE_MATURITIES.has(entry.maturity)) {
      steps.push({ ...base, status: "not-runnable", reasons: [`${entry.maturity} maturity`] });
      return;
    }
    const ineligible = eligibilityReasons(entry, input.route);
    if (ineligible.length > 0) {
      steps.push({ ...base, status: "ineligible", reasons: ineligible });
      return;
    }
    const backend = base.backend!;
    const health = input.availability.backends[backend];
    if (health?.state === "unavailable") {
      availabilitySkips += 1;
      steps.push({ ...base, status: "unavailable", reasons: [`${backend} observed ${health.classification ?? "unavailable"}`] });
      return;
    }
    const pool = snapshotEntry?.quotaPool ?? null;
    if (pool && input.availability.quotaPools[pool]?.remainingFraction === 0) {
      steps.push({ ...base, status: "quota-exhausted", reasons: [`quota pool ${pool} observed exhausted`] });
      return;
    }
    if (selectedIndex === null) {
      selectedIndex = index;
      steps.push({ ...base, status: "selected", reasons: [health?.state === "degraded" ? `${backend} observed degraded; still attempted` : "first runnable rung in stack order"] });
      return;
    }
    steps.push({ ...base, status: "runnable", reasons: ["reached only if every earlier rung fails on availability"] });
  });
  return {
    policyVersion: input.stack.policyVersion,
    automaticFallback: input.stack.automaticFallback,
    steps,
    selectedIndex,
    selected: selectedIndex === null ? null : steps[selectedIndex]!,
    availabilitySkips,
    exhausted: selectedIndex === null,
  };
}

export function evaluateRouting(inputs: RoutingEvaluationInputs): RoutingEvaluation {
  const { policy, registry, snapshot, context } = inputs;
  const compiled = inputs.compiled ?? compiledFor(policy, registry);
  const nowMs = context.nowMs;
  const availability = buildAvailabilityView({
    backends: context.availability?.backends ?? [],
    quotaPools: context.availability?.quotaPools ?? [],
    nowMs,
    ...(context.availability?.windowMs != null ? { windowMs: context.availability.windowMs } : {}),
  });
  const budget = context.budget ?? budgetStateFor();
  const classResolution = resolveWorkloadClass(context);

  const base: RoutingEvaluation = {
    version: ROUTING_EVALUATION_VERSION,
    policyLabel: policy.label,
    phase: context.phase,
    route: null,
    workloadClass: classResolution.workloadClass,
    workloadClassSource: classResolution.source,
    workloadProfile: classResolution.profile,
    workloadProfileRecord: classResolution.record,
    classDisagreement: classResolution.disagreement,
    stack: null,
    tailStartIndex: -1,
    traversal: null,
    floor: null,
    floorDisagreement: null,
    availability,
    budget,
    selection: null,
    selectionTrace: null,
    error: null,
  };

  const fail = (code: RoutingEvaluationError["code"], message: string): RoutingEvaluation => ({
    ...base,
    error: { code, message },
  });

  // Route resolution: an explicit alias pins its route; otherwise the phase decides.
  let routeId: CanonicalCapabilityRouteId;
  let pinnedAlias: string | null = null;
  if (context.requestedAlias) {
    const bindings = aliasBindingsFor(policy.routeBindings);
    const binding = resolvePublicAliasIn(bindings, context.requestedAlias);
    if (!binding) {
      return fail("unknown-alias", `"${context.requestedAlias}" is not a public route of ${policy.label}`);
    }
    routeId = binding.capabilityRoute;
    pinnedAlias = binding.alias;
    if (capabilityRouteForPhase(context.phase) !== routeId && context.phase !== "analyze") {
      return fail("alias-route-mismatch", `${binding.alias} executes ${routeId}, which does not serve phase ${context.phase}`);
    }
  } else {
    if (policy.parentLocalPhases.includes(context.phase)) {
      return fail("parent-local-phase", `${context.phase} is parent-local under ${policy.label}: the parent runs it and never delegates`);
    }
    routeId = capabilityRouteForPhase(context.phase);
  }
  const routeContract = capabilityRouteFor(routeId);
  const axis = axisForCapabilityRoute(routeId);
  const route = { ...routeContract, axis };

  if (!pinnedAlias && context.phase === "implement" && !classResolution.workloadClass) {
    if (classResolution.insufficientEvidence) {
      return { ...fail("insufficient-evidence", "workload evidence must include scope or change evidence to derive a workload class"), route };
    }
    return { ...fail("workload-class-required", "automatic implement requires one of the nine canonical workload classes (or structured workload evidence)"), route };
  }

  const stack = candidateStackForRouteIn(
    compiled,
    routeId,
    pinnedAlias,
    context.phase === "implement" ? classResolution.workloadClass : null,
    context.phase,
  );
  if (!stack) {
    return { ...fail("no-candidate-stack", `no candidate stack for ${routeId} / ${context.phase} / ${classResolution.workloadClass ?? "-"}`), route };
  }
  const tailAt = tailStartIndex(stack, policy);

  const traversal = predictTraversal({ stack, policy, registry, route: routeContract, axis, snapshot, availability });

  // Capability-rung selection (ADR 0010), exactly as routing-shadow runs it.
  const effectiveSnapshot = snapshot ?? emptyCapabilitySnapshot();
  // The runtime derives the floor through the workload class (and, off the
  // implement route, through the route's default stack). A stack no class
  // names — an explicit pin, or the deploy phase — has no class to resolve, so
  // its floor is read off the stack itself; the runtime shadow skips those.
  const floorInputs = { capabilityRoute: routeId, axis, snapshot, registry, stacks: compiled };
  const floor =
    routeId === "implement.workspace-write.v1" && (pinnedAlias != null || classResolution.workloadClass == null)
      ? resolveCapabilityFloorForStack(stack, floorInputs)
      : resolveCapabilityFloor({
          workloadClass: context.phase === "implement" ? classResolution.workloadClass : null,
          inputs: floorInputs,
        });
  const leadPolicy = deriveLeadPolicy(stack, registry);
  let override: { stableId: string; effort: Effort | null } | null = null;
  if (context.override?.model) {
    const entry = findModel(registry, context.override.model);
    if (!entry) {
      return { ...fail("override-unknown-model", `override model "${context.override.model}" is not in the registry`), route, stack, tailStartIndex: tailAt, traversal, floor };
    }
    override = { stableId: entry.stableId, effort: context.override.effort ?? null };
  }
  const selection = select({
    request: {
      capabilityRoute: routeId,
      axis,
      capabilityFloor: floor.capabilityFloor,
      minimumFloor: floor.minimumFloor,
      bandCeiling: floor.bandCeiling,
      override,
      taskIdentity: context.taskIdentity ?? "routing-evaluation",
      depth: 0,
      leadPolicy,
      ...(context.excludedRung != null ? { excludedRung: context.excludedRung } : {}),
      ...(context.excludedStableId != null ? { excludedStableId: context.excludedStableId } : {}),
    },
    registry,
    snapshot: effectiveSnapshot,
    ledger: budget,
    availability,
    policyVersion: SELECTION_POLICY_VERSION,
    nowMs,
  });

  return {
    ...base,
    route,
    stack,
    tailStartIndex: tailAt,
    traversal,
    floor,
    floorDisagreement: capabilityFloorDisagreement(floor),
    selection,
    selectionTrace: selectionTraceFrom(selection, { executed: false }),
  };
}

/** Convenience: observations marking backends unavailable at `nowMs`. */
export function unavailable(backends: readonly Backend[], nowMs: number): BackendObservation[] {
  return backends.map((backend) => ({ backend, classification: "provider_outage", observedAtMs: nowMs }));
}
