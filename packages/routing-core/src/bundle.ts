// The routing bundle: every canonical artifact the control plane needs, in one
// validated shape. The runtime exports it (`arc-orchestrator routing export`);
// arc-router loads the generated JSON and re-validates it here.

import { CAPABILITY_ROUTES, type CapabilityRouteContract } from "./capability-routes";
import type { CapabilitySnapshot } from "./capability-snapshot";
import { MODEL_REGISTRY_SCHEMA_VERSION, type ModelDefinition } from "./model-schema";
import type { RoutingPolicyDocument } from "./policy-schema";
import { ROUTING_CORE_VERSION } from "./vocabulary";

export const ROUTING_BUNDLE_CONTRACT = "arc-routing-bundle/v1" as const;

export type RoutingBundle = {
  contract: typeof ROUTING_BUNDLE_CONTRACT;
  routingCore: typeof ROUTING_CORE_VERSION;
  policy: RoutingPolicyDocument;
  registry: { schemaVersion: number; entries: ModelDefinition[] };
  snapshot: CapabilitySnapshot | null;
  capabilityRoutes: CapabilityRouteContract[];
  generated: { at: string | null; sourceCommit: string | null };
};

export function buildRoutingBundle(input: {
  policy: RoutingPolicyDocument;
  registry: readonly ModelDefinition[];
  snapshot: CapabilitySnapshot | null;
  generatedAt?: string | null;
  sourceCommit?: string | null;
}): RoutingBundle {
  return {
    contract: ROUTING_BUNDLE_CONTRACT,
    routingCore: ROUTING_CORE_VERSION,
    policy: input.policy,
    registry: { schemaVersion: MODEL_REGISTRY_SCHEMA_VERSION, entries: [...input.registry] },
    snapshot: input.snapshot,
    capabilityRoutes: [...CAPABILITY_ROUTES],
    generated: { at: input.generatedAt ?? null, sourceCommit: input.sourceCommit ?? null },
  };
}

export type ModelRegistryDocument = {
  contract: "arc-model-registry/v1";
  schemaVersion: number;
  routingCore: string;
  entries: ModelDefinition[];
};

export function modelRegistryDocumentFor(registry: readonly ModelDefinition[]): ModelRegistryDocument {
  return {
    contract: "arc-model-registry/v1",
    schemaVersion: MODEL_REGISTRY_SCHEMA_VERSION,
    routingCore: ROUTING_CORE_VERSION,
    entries: [...registry],
  };
}
