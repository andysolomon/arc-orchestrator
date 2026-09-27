// The authoritative representation of a runner-routing policy. This is the
// object the arc-pi `arc-model-policy` block parses to, the object the runtime
// compiles candidate stacks from, and the object the control plane edits.
// There is exactly one shape; both planes consume it.

import type { Backend, Effort, TaskPhase, WorkerPhase, WorkloadClass } from "./vocabulary";

export const ROUTING_POLICY_CONTRACT = "arc-routing-policy/v1" as const;
export const ROUTING_POLICY_SCHEMA_VERSION = 1;

import type { RungId } from "./model-schema";
export type { RungId };

export type ParentDefault = {
  provider: string;
  model: string;
  effort: Effort;
};

export type RouteBinding = {
  base: string;
  displayName: string;
  stableId: string;
  providerModelId: string;
  backend: Backend;
  defaultEffort?: Effort;
};

export type PolicySurface = {
  name: string;
  fixedEffort: Effort | null;
};

export type RoutingPolicy = {
  label: string;
  updated: string;
  supersedes: string | null;
  fallback: "availability-only";
  parentLocalPhases: readonly TaskPhase[];
  parentDefaults: Readonly<Record<string, ParentDefault>>;
  routeBindings: readonly RouteBinding[];
  surfaces: Readonly<Record<string, PolicySurface>>;
  emergencyTail: readonly RungId[];
  phaseChains: Readonly<Record<WorkerPhase, readonly RungId[]>>;
  workloadChains: Readonly<Record<WorkloadClass, readonly RungId[]>>;
  excludedModels: readonly string[];
  excludedEfforts: readonly Effort[];
};

/** Provenance of a policy copy: which document, when, and the SHA-256 of its canonical JSON. */
export type RoutingPolicySource = {
  document: string;
  updated: string;
  digest: string;
};

export type RoutingPolicyDocument = {
  contract: typeof ROUTING_POLICY_CONTRACT;
  schemaVersion: typeof ROUTING_POLICY_SCHEMA_VERSION;
  source: RoutingPolicySource;
  policy: RoutingPolicy;
};

export type RungRef = { stableId: string; effort: Effort };

export function formatRung(stableId: string, effort: Effort): RungId {
  return `${stableId}@${effort}`;
}

/** Canonical, whitespace-free serialization used for digests on both planes. */
export function canonicalPolicyJson(policy: RoutingPolicy): string {
  return JSON.stringify(policy);
}

/** Deep, structural clone that drops readonly-ness for editing. */
export function clonePolicy(policy: RoutingPolicy): RoutingPolicy {
  return JSON.parse(JSON.stringify(policy)) as RoutingPolicy;
}

export function policiesEqual(a: RoutingPolicy, b: RoutingPolicy): boolean {
  return canonicalPolicyJson(a) === canonicalPolicyJson(b);
}
