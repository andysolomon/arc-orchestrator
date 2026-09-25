import { describe, expect, test } from "bun:test";
import {
  capabilityRouteFor,
  PUBLIC_ALIAS_BINDINGS,
} from "../plugins/arc-orchestrator/lib/capability-routes";
import { routeCapabilities } from "../plugins/arc-orchestrator/lib/routes";

const empty = {};

describe("capability-routes: executable-route alias alignment with routeCapabilities", () => {
  test("each executable-route alias agrees on mode and sandbox with routeCapabilities", () => {
    const routes = routeCapabilities(empty);
    const routesById = Object.fromEntries(
      routes.map((route) => [route.id, route]),
    );

    for (const binding of PUBLIC_ALIAS_BINDINGS) {
      if (binding.kind !== "executable-route") {
        continue;
      }

      const route = routesById[binding.alias];
      expect(route).toBeDefined();

      const capabilityRoute = capabilityRouteFor(binding.capabilityRoute);
      expect(capabilityRoute.mode).toBe(route.mode);
      expect(capabilityRoute.sandbox).toBe(route.sandbox);
    }
  });
});
