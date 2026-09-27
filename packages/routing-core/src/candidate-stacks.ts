// Candidate stacks are a *derived artifact* of the routing policy: every
// automatic stack is a policy chain with the shared emergency tail appended,
// and every public alias pins exactly one candidate. Both planes compile them
// through this module, so "what stack does this class mean" has one answer.

import type { CanonicalCapabilityRouteId } from "./capability-routes";
import {
  CAPABILITY_ROUTE_BY_SUFFIX,
  PUBLIC_ROUTE_SUFFIXES,
  TASTE_REVIEW_ALIAS,
} from "./capability-routes";
import {
  NO_EFFORT_RUNG,
  parseRungId,
  registryIndex,
  type ModelDefinition,
} from "./model-schema";
import type { RoutingPolicy, RungId } from "./policy-schema";
import type { Effort, TaskPhase, WorkerPhase } from "./vocabulary";

// One ordered position in a v4 candidate stack: `(stableId, effort)`. The same
// model may legitimately hold two rungs at different efforts. Effort `none`
// means the transport exposes no generic effort flag.
export type CandidateRung = { stableId: string; effort: Effort };
export type StackRung = CandidateRung;

export type CandidateStack = {
  route: CanonicalCapabilityRouteId;
  policyVersion: string;
  candidates: string[];
  phase?: TaskPhase;
  candidateEfforts?: Partial<Record<string, Effort>>;
  // Authoritative ordered traversal for runner-routing-v4. `candidates` and
  // `candidateEfforts` are stableId-keyed derived views kept for trace and
  // contract consumers; when `rungs` is present it owns order and efforts.
  rungs?: readonly CandidateRung[];
  automaticFallback: boolean;
  workloadClass?: string;
};

export type PublicAliasCandidateStack = CandidateStack & {
  publicAlias: string;
};

export type CompiledRoutingPolicy = {
  policyVersion: string;
  stacks: readonly CandidateStack[];
  aliasStacks: readonly PublicAliasCandidateStack[];
};

// The taste-review surface (`opus-review`) is the one stack not written in the
// policy document: it is a fixed contract pin, not an availability chain. It is
// declared once here so runtime and control plane agree on it.
export const TASTE_REVIEW_PIN = {
  alias: TASTE_REVIEW_ALIAS,
  route: "taste-review.read-only.v1",
  stableId: "opus-5.5",
} as const satisfies { alias: string; route: CanonicalCapabilityRouteId; stableId: string };

// Which capability route each worker phase chain executes on.
export const POLICY_PHASE_ROUTES: Readonly<
  Record<WorkerPhase, CanonicalCapabilityRouteId>
> = {
  explore: "explore.read-only.v1",
  research: "explore.read-only.v1",
  plan: "explore.read-only.v1",
  verify: "check.read-only.v1",
  deploy: "implement.workspace-write.v1",
};

/** Capability route for any phase, including implement and parent-local analyze. */
export function capabilityRouteForPhase(phase: TaskPhase): CanonicalCapabilityRouteId {
  if (phase === "implement") {
    return "implement.workspace-write.v1";
  }
  if (phase === "analyze") {
    return "explore.read-only.v1";
  }
  return POLICY_PHASE_ROUTES[phase];
}

export function stackRungs(stack: CandidateStack): CandidateRung[] {
  if (stack.rungs) {
    return [...stack.rungs];
  }
  return stack.candidates.map((stableId) => ({
    stableId,
    effort: stack.candidateEfforts?.[stableId] ?? NO_EFFORT_RUNG,
  }));
}

// Every automatic rung is authored as `<stableId>@<effort>` in the policy; a
// malformed rung is a policy bug and fails at compile time.
export function policyRung(rung: RungId): readonly [string, Effort] {
  const parsed = parseRungId(rung);
  if (!parsed) {
    throw new Error(`model policy rung "${rung}" is not <stableId>@<effort>`);
  }
  return [parsed.stableId, parsed.effort];
}

function rungList(
  specs: ReadonlyArray<readonly [string, Effort]>,
): StackRung[] {
  return specs.map(([stableId, effort]) => ({ stableId, effort }));
}

function v4Stack(input: {
  policyVersion: string;
  route: CanonicalCapabilityRouteId;
  phase?: TaskPhase;
  workloadClass?: string;
  rungs: ReadonlyArray<readonly [string, Effort]>;
  tail: ReadonlyArray<readonly [string, Effort]>;
}): CandidateStack {
  const rungs = rungList([...input.rungs, ...input.tail]);
  const candidates: string[] = [];
  const candidateEfforts: Partial<Record<string, Effort>> = {};
  for (const rung of rungs) {
    if (candidates.includes(rung.stableId)) {
      continue;
    }
    candidates.push(rung.stableId);
    if (rung.effort !== NO_EFFORT_RUNG) {
      candidateEfforts[rung.stableId] = rung.effort;
    }
  }
  return {
    route: input.route,
    policyVersion: input.policyVersion,
    ...(input.phase ? { phase: input.phase } : {}),
    ...(input.workloadClass ? { workloadClass: input.workloadClass } : {}),
    candidates,
    ...(Object.keys(candidateEfforts).length > 0 ? { candidateEfforts } : {}),
    rungs,
    automaticFallback: true,
  };
}

/**
 * Compile a policy into its automatic candidate stacks: the nine implement
 * workload stacks, the five worker phase stacks, and the pinned taste-review
 * stack, each automatic stack carrying the policy's emergency tail.
 */
export function compileCandidateStacks(policy: RoutingPolicy): CandidateStack[] {
  const tail = policy.emergencyTail.map(policyRung);
  const workloadClasses = Object.keys(
    policy.workloadChains,
  ) as (keyof RoutingPolicy["workloadChains"])[];
  const phases = Object.keys(
    policy.phaseChains,
  ) as (keyof RoutingPolicy["phaseChains"])[];
  return [
    ...workloadClasses.map((workloadClass) =>
      v4Stack({
        policyVersion: policy.label,
        route: "implement.workspace-write.v1",
        phase: "implement",
        workloadClass,
        rungs: policy.workloadChains[workloadClass].map(policyRung),
        tail,
      }),
    ),
    ...phases.map((phase) =>
      v4Stack({
        policyVersion: policy.label,
        route: POLICY_PHASE_ROUTES[phase],
        phase,
        rungs: policy.phaseChains[phase].map(policyRung),
        tail,
      }),
    ),
    {
      route: TASTE_REVIEW_PIN.route,
      policyVersion: policy.label,
      candidates: [TASTE_REVIEW_PIN.stableId],
      automaticFallback: false,
    },
  ];
}

/**
 * Compile the single-candidate explicit alias stacks. An explicit route
 * executes its target once and never inherits the automatic chains. The
 * registry supplies each model's fixed effort where the policy names none.
 */
export function compilePublicAliasStacks(
  policy: RoutingPolicy,
  registry: readonly ModelDefinition[],
): PublicAliasCandidateStack[] {
  const byId = registryIndex(registry);
  const specs: Array<[string, CanonicalCapabilityRouteId, string, Effort | undefined]> = [
    ...policy.routeBindings.flatMap((binding) =>
      PUBLIC_ROUTE_SUFFIXES.map(
        (suffix) =>
          [
            `${binding.base}-${suffix}`,
            CAPABILITY_ROUTE_BY_SUFFIX[suffix],
            binding.stableId,
            "defaultEffort" in binding ? binding.defaultEffort : undefined,
          ] as [string, CanonicalCapabilityRouteId, string, Effort | undefined],
      ),
    ),
    [TASTE_REVIEW_PIN.alias, TASTE_REVIEW_PIN.route, TASTE_REVIEW_PIN.stableId, undefined],
  ];
  return specs.map(([publicAlias, route, candidate, aliasEffort]) => {
    const effort =
      aliasEffort ?? byId.get(candidate)?.fixedEffort ?? NO_EFFORT_RUNG;
    return {
      publicAlias,
      route,
      policyVersion: policy.label,
      candidates: [candidate],
      ...(effort === NO_EFFORT_RUNG
        ? {}
        : { candidateEfforts: { [candidate]: effort } }),
      rungs: [{ stableId: candidate, effort }],
      automaticFallback: false,
    };
  });
}

export function compileRoutingPolicy(
  policy: RoutingPolicy,
  registry: readonly ModelDefinition[],
): CompiledRoutingPolicy {
  return {
    policyVersion: policy.label,
    stacks: compileCandidateStacks(policy),
    aliasStacks: compilePublicAliasStacks(policy, registry),
  };
}

export function candidateStackForRouteIn(
  compiled: Pick<CompiledRoutingPolicy, "stacks" | "aliasStacks">,
  route: CanonicalCapabilityRouteId,
  requestedAlias: string | null | undefined,
  workloadClass?: string | null,
  phase?: TaskPhase | null,
): CandidateStack | null {
  const normalizedAlias = requestedAlias?.trim().toLowerCase();
  // Explicit routes pin one candidate. Automatic policy passes null/undefined
  // so the workload/phase stacks are selected instead.
  const aliasStack = normalizedAlias
    ? compiled.aliasStacks.find(
        (stack) =>
          stack.publicAlias === normalizedAlias && stack.route === route,
      )
    : undefined;
  if (aliasStack) {
    return aliasStack;
  }
  // v4 has no default implement class: automatic implement selection without a
  // canonical workload class resolves to no stack and the caller fails closed.
  const workload = workloadClass?.trim().toLowerCase() || null;
  const resolvedPhase =
    phase ??
    (route === "check.read-only.v1"
      ? "verify"
      : route === "implement.workspace-write.v1"
        ? "implement"
        : "explore");
  return (
    compiled.stacks.find(
      (stack) =>
        stack.route === route &&
        (stack.phase === resolvedPhase || stack.phase == null) &&
        (resolvedPhase !== "implement" || stack.workloadClass === workload),
    ) ?? null
  );
}

/**
 * Resolve the single model an explicit public alias pins, straight from the
 * registry. The registry is the one place a stable id is bound to a provider
 * model id.
 */
export function pinnedModelForAliasIn(
  aliasStacks: readonly PublicAliasCandidateStack[],
  registry: readonly ModelDefinition[],
  alias: string,
): { stableId: string; providerModelId: string } {
  const stack = aliasStacks.find((candidate) => candidate.publicAlias === alias);
  if (!stack) {
    throw new Error(`No pinned candidate stack for public alias: ${alias}`);
  }
  const [stableId] = stack.candidates;
  const entry = registry.find((model) => model.stableId === stableId);
  if (!entry) {
    throw new Error(`Public alias ${alias} pins unknown model: ${stableId}`);
  }
  if (!entry.providerModelId) {
    throw new Error(
      `Public alias ${alias} pins ${stableId}, which has no providerModelId`,
    );
  }
  return { stableId: stableId!, providerModelId: entry.providerModelId };
}

/** Index of the first tail rung inside a compiled automatic stack, or -1 for pinned stacks. */
export function tailStartIndex(stack: CandidateStack, policy: RoutingPolicy): number {
  if (!stack.automaticFallback) {
    return -1;
  }
  return Math.max(0, stackRungs(stack).length - policy.emergencyTail.length);
}
