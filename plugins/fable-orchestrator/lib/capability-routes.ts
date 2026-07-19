// Phase-1 canonical capability contract from docs/orchestrator/model-tier-routing-plan.md.
// This module defines typed routes and alias bindings only; nothing here activates selection changes.

import type { Mode, RouteId, TraceSandbox } from "./trace-schema";

export const CAPABILITY_ROUTES_SCHEMA_VERSION = 1;
export const CAPABILITY_ROUTES_SOURCE = "fable-orchestrator";

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

export const CAPABILITY_ROUTES: readonly CapabilityRouteContract[] = [
  {
    id: "explore.read-only.v1",
    mode: "analyze",
    sandbox: "read-only",
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

export type PublicAlias = RouteId | "opus-review";
export type AliasKind = "executable-route" | "public-surface";

export type AliasBinding = {
  alias: PublicAlias;
  kind: AliasKind;
  capabilityRoute: CanonicalCapabilityRouteId;
};

export const PUBLIC_ALIAS_BINDINGS: readonly AliasBinding[] = [
  {
    alias: "codex-explore",
    kind: "executable-route",
    capabilityRoute: "explore.read-only.v1",
  },
  {
    alias: "opus-explore",
    kind: "executable-route",
    capabilityRoute: "explore.read-only.v1",
  },
  {
    alias: "grok-explore",
    kind: "executable-route",
    capabilityRoute: "explore.read-only.v1",
  },
  {
    alias: "composer-implement",
    kind: "executable-route",
    capabilityRoute: "implement.workspace-write.v1",
  },
  {
    alias: "codex-implement",
    kind: "executable-route",
    capabilityRoute: "implement.workspace-write.v1",
  },
  {
    alias: "opus-implement",
    kind: "executable-route",
    capabilityRoute: "implement.workspace-write.v1",
  },
  {
    alias: "grok-implement",
    kind: "executable-route",
    capabilityRoute: "implement.workspace-write.v1",
  },
  {
    alias: "codex-check",
    kind: "executable-route",
    capabilityRoute: "check.read-only.v1",
  },
  {
    alias: "opus-check",
    kind: "executable-route",
    capabilityRoute: "check.read-only.v1",
  },
  {
    alias: "grok-check",
    kind: "executable-route",
    capabilityRoute: "check.read-only.v1",
  },
  {
    alias: "opus-review",
    kind: "public-surface",
    capabilityRoute: "taste-review.read-only.v1",
  },
  ...([
    ["fable-explore", "explore.read-only.v1"],
    ["kimi-explore", "explore.read-only.v1"],
    ["cursor-fable-explore", "explore.read-only.v1"],
    ["minimax-explore", "explore.read-only.v1"],
    ["composer-explore", "explore.read-only.v1"],
    ["fable-implement", "implement.workspace-write.v1"],
    ["kimi-implement", "implement.workspace-write.v1"],
    ["cursor-fable-implement", "implement.workspace-write.v1"],
    ["minimax-implement", "implement.workspace-write.v1"],
    ["terra-implement", "implement.workspace-write.v1"],
    ["sol-explore", "explore.read-only.v1"],
    ["sol-check", "check.read-only.v1"],
    ["sol-implement", "implement.workspace-write.v1"],
    ["kimi-check", "check.read-only.v1"],
    ["fable-check", "check.read-only.v1"],
    ["cursor-fable-check", "check.read-only.v1"],
    ["minimax-check", "check.read-only.v1"],
    ["composer-check", "check.read-only.v1"],
  ] as const).map(([alias, capabilityRoute]) => ({
    alias,
    kind: "executable-route" as const,
    capabilityRoute,
  })),
];

export function capabilityRouteFor(
  id: CanonicalCapabilityRouteId,
): CapabilityRouteContract {
  const route = CAPABILITY_ROUTES.find((entry) => entry.id === id);
  if (!route) {
    throw new Error(`Unknown capability route: ${id}`);
  }
  return route;
}

export function resolvePublicAlias(
  alias: string | null | undefined,
): AliasBinding | undefined {
  if (alias == null) {
    return undefined;
  }
  const normalized = alias.trim().toLowerCase();
  if (normalized === "") {
    return undefined;
  }
  return PUBLIC_ALIAS_BINDINGS.find((binding) => binding.alias === normalized);
}

export function capabilityRoutesContract(): {
  schema_version: number;
  source: string;
  capability_routes: CapabilityRouteContract[];
  aliases: AliasBinding[];
} {
  return {
    schema_version: CAPABILITY_ROUTES_SCHEMA_VERSION,
    source: CAPABILITY_ROUTES_SOURCE,
    capability_routes: [...CAPABILITY_ROUTES],
    aliases: [...PUBLIC_ALIAS_BINDINGS],
  };
}
