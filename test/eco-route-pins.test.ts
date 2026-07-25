import { describe, expect, it } from "bun:test";
import {
  ECO_BACKUP_ROUTES,
  ECO_ROUTES,
} from "../plugins/arc-orchestrator/lib/orchestrator-identity";
import {
  PUBLIC_ALIAS_CANDIDATE_STACKS,
  pinnedModelForAlias,
} from "../plugins/arc-orchestrator/lib/model-registry";
import {
  routeCapabilities,
  routeProfileFor,
} from "../plugins/arc-orchestrator/lib/routes";
import type { RouteId } from "../plugins/arc-orchestrator/lib/trace-schema";

const ECO_ROUTE_ENTRIES = [
  ...Object.entries(ECO_ROUTES),
  ...Object.entries(ECO_BACKUP_ROUTES),
];

describe("eco worker pins", () => {
  it("resolve their model from the registry, not a second hardcoded copy", () => {
    for (const [mode, route] of ECO_ROUTE_ENTRIES) {
      const pinned = pinnedModelForAlias(route.route);
      expect({ mode, ...pinned }).toEqual({
        mode,
        stableId: route.stableId,
        providerModelId: route.model,
      });
    }
  });

  // backend and sandbox stay declared because deriving them would make
  // orchestrator-identity import routes.ts, which already imports it back.
  // Pin the equivalence instead so the declaration cannot drift.
  it("declare the same backend and sandbox the route definitions use", () => {
    for (const [mode, route] of ECO_ROUTE_ENTRIES) {
      const profile = routeProfileFor(route.route as RouteId);
      expect(profile).toBeDefined();
      expect({ mode, backend: route.backend as string }).toEqual({
        mode,
        backend: profile!.backend as string,
      });
      expect({ mode, sandbox: route.sandbox }).toEqual({
        mode,
        sandbox:
          profile!.mode === "implement" ? "workspace-write" : "read-only",
      });
    }
  });
});

describe("explicit alias pins", () => {
  it("agree between the model registry and the route resolver", () => {
    const capabilities = routeCapabilities({});
    for (const stack of PUBLIC_ALIAS_CANDIDATE_STACKS) {
      const capability = capabilities.find(
        (route) => route.id === stack.publicAlias,
      );
      // `opus-review` is a public-surface alias with no executable route.
      if (!capability) {
        continue;
      }
      const { providerModelId } = pinnedModelForAlias(stack.publicAlias);
      expect({ alias: stack.publicAlias, model: capability.model }).toEqual({
        alias: stack.publicAlias,
        model: providerModelId,
      });
    }
  });
});
