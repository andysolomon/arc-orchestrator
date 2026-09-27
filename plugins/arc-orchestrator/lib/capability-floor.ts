// Runtime shim over the shared routing-core capability floor (ADR 0010 phase
// 13.8). The shared functions take the registry and compiled stacks they
// resolve through; here both default to the shipped registry and the stacks
// compiled from the shipped policy, so existing callers are unchanged.

import {
  derivedEffortFloorForStableId as derivedEffortFloorForStableIdWith,
  floorForWorkloadClass as floorForWorkloadClassWith,
  resolveCapabilityFloor as resolveCapabilityFloorWith,
  workloadClassFloorTable as workloadClassFloorTableWith,
  type CapabilityFloorInputs as SharedCapabilityFloorInputs,
  type DerivedCapabilityFloor,
  type DerivedEffortFloor,
  type ExplicitCapabilityFloor,
  type ResolvedCapabilityFloor,
} from "../../../packages/routing-core/src/capability-floor";
import type { CapabilitySnapshot } from "../../../packages/routing-core/src/capability-snapshot";
import type { WorkloadClass } from "../../../packages/routing-core/src/vocabulary";
import {
  COMPILED_ROUTING_POLICY,
  MODEL_REGISTRY,
  type ModelRegistryEntry,
} from "./model-registry";

export {
  CAPABILITY_FLOOR_POLICY_VERSION,
  capabilityFloorDisagreement,
  type CapabilityFloorSource,
  type DerivedCapabilityFloor,
  type DerivedEffortFloor,
  type ExplicitCapabilityFloor,
  type ResolvedCapabilityFloor,
} from "../../../packages/routing-core/src/capability-floor";

export type CapabilityFloorInputs = Omit<
  SharedCapabilityFloorInputs,
  "registry" | "stacks"
> & {
  registry?: readonly ModelRegistryEntry[];
  stacks?: SharedCapabilityFloorInputs["stacks"];
};

function withDefaults(
  inputs: CapabilityFloorInputs,
): SharedCapabilityFloorInputs {
  return {
    ...inputs,
    registry: inputs.registry ?? MODEL_REGISTRY,
    stacks: inputs.stacks ?? COMPILED_ROUTING_POLICY,
  };
}

export function derivedEffortFloorForStableId(
  stableId: string,
  snapshot: CapabilitySnapshot | null,
  registry: readonly ModelRegistryEntry[] = MODEL_REGISTRY,
): DerivedEffortFloor | null {
  return derivedEffortFloorForStableIdWith(stableId, snapshot, registry);
}

export function floorForWorkloadClass(
  workloadClass: string | null | undefined,
  inputs: CapabilityFloorInputs,
): DerivedCapabilityFloor {
  return floorForWorkloadClassWith(workloadClass, withDefaults(inputs));
}

export function resolveCapabilityFloor(input: {
  explicit?: ExplicitCapabilityFloor | null;
  workloadClass: string | null | undefined;
  inputs: CapabilityFloorInputs;
}): ResolvedCapabilityFloor {
  return resolveCapabilityFloorWith({
    ...input,
    inputs: withDefaults(input.inputs),
  });
}

export function workloadClassFloorTable(
  inputs: CapabilityFloorInputs,
  classes?: readonly WorkloadClass[],
): DerivedCapabilityFloor[] {
  return workloadClassFloorTableWith(withDefaults(inputs), classes);
}
