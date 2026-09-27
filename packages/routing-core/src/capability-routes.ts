// Canonical capability routes and public alias bindings. Route contracts are
// fixed facts; alias bindings are derived from a policy's `routeBindings`, so
// the runtime and the control plane compute them from the same input.

import type { RouteBinding } from "./policy-schema";
import type { Mode, TraceSandbox } from "./vocabulary";

export const CAPABILITY_ROUTES_SCHEMA_VERSION = 1;
export const CAPABILITY_ROUTES_SOURCE = "arc-orchestrator";

export type CanonicalCapabilityRouteId =
  | "explore.read-only.v1"
  | "implement.workspace-write.v1"
  | "check.read-only.v1"
  | "taste-review.read-only.v1";

export type OutputContractId =
  | "exploration-result.v1"
  | "implementation-result.v1"
  | "correctness-review-result.v1"
  | "taste-review-result.v1";

export type CapabilityRouteContract = {
  id: CanonicalCapabilityRouteId;
  mode: Mode;
  sandbox: TraceSandbox;
  outputContract: OutputContractId;
};

// Route ids are stable contract identifiers and keep their historical
// `.read-only.v1` spelling even where the posture has moved on: `sandbox` below
// is the route's permission maximum, not a promise implied by the id. Since the
// 2026-09-11 policy, global analyze execution is workspace-write-capable, while
// every review route stays read-only.
export const CAPABILITY_ROUTES: readonly CapabilityRouteContract[] = [
  {
    id: "explore.read-only.v1",
    mode: "analyze",
    sandbox: "workspace-write",
    outputContract: "exploration-result.v1",
  },
  {
    id: "implement.workspace-write.v1",
    mode: "implement",
    sandbox: "workspace-write",
    outputContract: "implementation-result.v1",
  },
  {
    id: "check.read-only.v1",
    mode: "review",
    sandbox: "read-only",
    outputContract: "correctness-review-result.v1",
  },
  {
    id: "taste-review.read-only.v1",
    mode: "review",
    sandbox: "read-only",
    outputContract: "taste-review-result.v1",
  },
];

export const CANONICAL_ROUTE_IDS: ReadonlySet<string> = new Set(
  CAPABILITY_ROUTES.map((route) => route.id),
);

export function isCanonicalCapabilityRouteId(
  value: unknown,
): value is CanonicalCapabilityRouteId {
  return typeof value === "string" && CANONICAL_ROUTE_IDS.has(value);
}

export const PUBLIC_ROUTE_SUFFIXES = ["explore", "implement", "check"] as const;
export type PublicRouteSuffix = (typeof PUBLIC_ROUTE_SUFFIXES)[number];

export const CAPABILITY_ROUTE_BY_SUFFIX = {
  explore: "explore.read-only.v1",
  implement: "implement.workspace-write.v1",
  check: "check.read-only.v1",
} as const satisfies Record<PublicRouteSuffix, CanonicalCapabilityRouteId>;

export const ROUTE_MODE_BY_SUFFIX = {
  explore: "analyze",
  implement: "implement",
  check: "review",
} as const satisfies Record<PublicRouteSuffix, Mode>;

/** The one taste-review surface; it pins a single model and never inherits fallback. */
export const TASTE_REVIEW_ALIAS = "opus-review" as const;

export type PublicAliasFor<Base extends string = string> =
  | `${Base}-${PublicRouteSuffix}`
  | typeof TASTE_REVIEW_ALIAS;
export type AliasKind = "executable-route" | "public-surface";

export type AliasBinding = {
  alias: string;
  kind: AliasKind;
  capabilityRoute: CanonicalCapabilityRouteId;
};

export function capabilityRouteFor(
  id: CanonicalCapabilityRouteId,
): CapabilityRouteContract {
  const route = CAPABILITY_ROUTES.find((entry) => entry.id === id);
  if (!route) {
    throw new Error(`Unknown capability route: ${id}`);
  }
  return route;
}

/** Every public alias a set of policy bindings exposes, in contract order. */
export function aliasBindingsFor(
  bindings: readonly RouteBinding[],
): AliasBinding[] {
  return [
    ...bindings.flatMap(({ base }) =>
      PUBLIC_ROUTE_SUFFIXES.map((suffix) => ({
        alias: `${base}-${suffix}`,
        kind: "executable-route" as const,
        capabilityRoute: CAPABILITY_ROUTE_BY_SUFFIX[suffix],
      })),
    ),
    {
      alias: TASTE_REVIEW_ALIAS,
      kind: "public-surface" as const,
      capabilityRoute: "taste-review.read-only.v1",
    },
  ];
}

export function resolvePublicAliasIn(
  aliasBindings: readonly AliasBinding[],
  alias: string | null | undefined,
): AliasBinding | undefined {
  if (alias == null) {
    return undefined;
  }
  const normalized = alias.trim().toLowerCase();
  if (normalized === "") {
    return undefined;
  }
  return aliasBindings.find((binding) => binding.alias === normalized);
}

/** Resolve a public alias or a canonical route id to its capability route. */
export function canonicalRouteIdFor(
  aliasBindings: readonly AliasBinding[],
  requested: string,
): CanonicalCapabilityRouteId | null {
  const normalized = requested.trim().toLowerCase();
  const binding = resolvePublicAliasIn(aliasBindings, normalized);
  if (binding) {
    return binding.capabilityRoute;
  }
  return isCanonicalCapabilityRouteId(normalized) ? normalized : null;
}

export function capabilityRoutesContractFor(aliasBindings: readonly AliasBinding[]): {
  schema_version: number;
  source: string;
  capability_routes: CapabilityRouteContract[];
  aliases: AliasBinding[];
} {
  return {
    schema_version: CAPABILITY_ROUTES_SCHEMA_VERSION,
    source: CAPABILITY_ROUTES_SOURCE,
    capability_routes: [...CAPABILITY_ROUTES],
    aliases: [...aliasBindings],
  };
}
