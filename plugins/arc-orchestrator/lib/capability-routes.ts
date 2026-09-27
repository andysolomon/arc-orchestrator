// Runtime shim over the shared routing-core capability routes. Route contracts
// are fixed; the public alias bindings are derived from the shipped policy's
// route bindings through the same function the control plane uses.

import {
  aliasBindingsFor,
  capabilityRoutesContractFor,
  resolvePublicAliasIn,
  type AliasBinding as SharedAliasBinding,
  type AliasKind,
  type CanonicalCapabilityRouteId,
  type CapabilityRouteContract,
} from "../../../packages/routing-core/src/capability-routes";
import { PUBLIC_ROUTE_MODEL_BINDINGS, type RouteId } from "./trace-schema";

export {
  CAPABILITY_ROUTES,
  CAPABILITY_ROUTES_SCHEMA_VERSION,
  CAPABILITY_ROUTES_SOURCE,
  capabilityRouteFor,
  type AliasKind,
  type CanonicalCapabilityRouteId,
  type CapabilityRouteContract,
  type OutputContractId,
} from "../../../packages/routing-core/src/capability-routes";

export type PublicAlias = RouteId | "opus-review";

export type AliasBinding = {
  alias: PublicAlias;
  kind: AliasKind;
  capabilityRoute: CanonicalCapabilityRouteId;
};

export const PUBLIC_ALIAS_BINDINGS: readonly AliasBinding[] = aliasBindingsFor(
  PUBLIC_ROUTE_MODEL_BINDINGS,
) as AliasBinding[];

export function resolvePublicAlias(
  alias: string | null | undefined,
): AliasBinding | undefined {
  return resolvePublicAliasIn(PUBLIC_ALIAS_BINDINGS, alias) as
    | AliasBinding
    | undefined;
}

export function capabilityRoutesContract(): {
  schema_version: number;
  source: string;
  capability_routes: CapabilityRouteContract[];
  aliases: SharedAliasBinding[];
} {
  return capabilityRoutesContractFor(PUBLIC_ALIAS_BINDINGS);
}
