import { describe, expect, test } from "bun:test";
import {
  CAPABILITY_ROUTES,
  CAPABILITY_ROUTES_SCHEMA_VERSION,
  CAPABILITY_ROUTES_SOURCE,
  capabilityRouteFor,
  capabilityRoutesContract,
  PUBLIC_ALIAS_BINDINGS,
  resolvePublicAlias,
  type CanonicalCapabilityRouteId,
} from "../plugins/arc-orchestrator/lib/capability-routes";
import { routeCapabilities } from "../plugins/arc-orchestrator/lib/routes";

const empty = {};

describe("capability-routes: resolvePublicAlias", () => {
  test("resolves all public aliases to expected canonical routes", () => {
    const expected: Array<{
      alias: string;
      route: CanonicalCapabilityRouteId;
      kind: "executable-route" | "public-surface";
    }> = [
      {
        alias: "opus-explore",
        route: "explore.read-only.v1",
        kind: "executable-route",
      },
      {
        alias: "grok-explore",
        route: "explore.read-only.v1",
        kind: "executable-route",
      },
      {
        alias: "composer-implement",
        route: "implement.workspace-write.v1",
        kind: "executable-route",
      },
      {
        alias: "opus-implement",
        route: "implement.workspace-write.v1",
        kind: "executable-route",
      },
      {
        alias: "grok-implement",
        route: "implement.workspace-write.v1",
        kind: "executable-route",
      },
      {
        alias: "opus-check",
        route: "check.read-only.v1",
        kind: "executable-route",
      },
      {
        alias: "grok-check",
        route: "check.read-only.v1",
        kind: "executable-route",
      },
      {
        alias: "opus-review",
        route: "taste-review.read-only.v1",
        kind: "public-surface",
      },
    ];

    for (const { alias, route, kind } of expected) {
      const binding = resolvePublicAlias(alias);
      expect(binding).toBeDefined();
      expect(binding?.alias).toBe(alias);
      expect(binding?.capabilityRoute).toBe(route);
      expect(binding?.kind).toBe(kind);
    }
    for (const alias of ["mechanical-post-comment", "mechanical-commit-push", "mechanical-merge"]) {
      expect(resolvePublicAlias(alias)).toBeUndefined();
    }
  });

  test("trims and lowercases before matching", () => {
    const binding = resolvePublicAlias("  OPUS-EXPLORE ");
    expect(binding?.alias).toBe("opus-explore");
    expect(binding?.capabilityRoute).toBe("explore.read-only.v1");
  });

  test("returns undefined for unknown, empty, null, and undefined inputs", () => {
    expect(resolvePublicAlias("glm-explore")).toBeUndefined();
    expect(resolvePublicAlias("")).toBeUndefined();
    expect(resolvePublicAlias("   ")).toBeUndefined();
    expect(resolvePublicAlias(null)).toBeUndefined();
    expect(resolvePublicAlias(undefined)).toBeUndefined();
  });
});

describe("capability-routes: canonical routes", () => {
  test("defines canonical routes with v1 ids fixing mode, sandbox, and output contract", () => {
    expect(CAPABILITY_ROUTES).toHaveLength(4);

    for (const route of CAPABILITY_ROUTES) {
      expect(route.id.endsWith(".v1")).toBe(true);
      expect(route.outputContract.endsWith(".v1")).toBe(true);
    }

    expect(capabilityRouteFor("explore.read-only.v1")).toEqual({
      id: "explore.read-only.v1",
      mode: "analyze",
      sandbox: "read-only",
      outputContract: "exploration-result.v1",
    });
    expect(capabilityRouteFor("implement.workspace-write.v1")).toEqual({
      id: "implement.workspace-write.v1",
      mode: "implement",
      sandbox: "workspace-write",
      outputContract: "implementation-result.v1",
    });
    expect(capabilityRouteFor("check.read-only.v1")).toEqual({
      id: "check.read-only.v1",
      mode: "review",
      sandbox: "read-only",
      outputContract: "correctness-review-result.v1",
    });
    expect(capabilityRouteFor("taste-review.read-only.v1")).toEqual({
      id: "taste-review.read-only.v1",
      mode: "review",
      sandbox: "read-only",
      outputContract: "taste-review-result.v1",
    });
  });
});

describe("capability-routes: executable-route alias alignment with routeCapabilities", () => {
  test("executable-route aliases match routeCapabilities ids exactly", () => {
    const routes = routeCapabilities(empty);
    const routeIds = routes.map((route) => route.id);

    const executableAliases = PUBLIC_ALIAS_BINDINGS.filter(
      (binding) => binding.kind === "executable-route",
    ).map((binding) => binding.alias);

    expect(executableAliases).toHaveLength(21);
    expect(new Set(executableAliases)).toEqual(new Set(routeIds));
  });

  test("routeCapabilities includes intentional backend/mode duplicates for diagnostic aliases", () => {
    const routes = routeCapabilities(empty);
    const pairs = routes.map((route) => `${route.backend}:${route.mode}`);
    const duplicatePairs = pairs.filter(
      (pair, index) => pairs.indexOf(pair) !== index,
    );
    expect(duplicatePairs.length).toBeGreaterThan(0);
    expect(new Set(duplicatePairs).has("composer:implement")).toBe(true);
  });

  test("opus-review is public-surface, maps to taste-review, and is not an executable route", () => {
    const routes = routeCapabilities(empty);
    const routeIds = routes.map((route) => route.id);

    const binding = resolvePublicAlias("opus-review");
    expect(binding?.kind).toBe("public-surface");
    expect(binding?.capabilityRoute).toBe("taste-review.read-only.v1");
    expect(routeIds).not.toContain("opus-review");
  });

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

describe("capability-routes: capabilityRoutesContract", () => {
  test("emits the versioned envelope with canonical routes and aliases", () => {
    const contract = capabilityRoutesContract();

    expect(Object.keys(contract)).toEqual([
      "schema_version",
      "source",
      "capability_routes",
      "aliases",
    ]);
    expect(contract.schema_version).toBe(CAPABILITY_ROUTES_SCHEMA_VERSION);
    expect(contract.source).toBe(CAPABILITY_ROUTES_SOURCE);
    expect(contract.capability_routes).toEqual([...CAPABILITY_ROUTES]);
    expect(contract.aliases).toEqual([...PUBLIC_ALIAS_BINDINGS]);
    expect(contract.capability_routes).toHaveLength(4);
    expect(contract.aliases).toHaveLength(22);
  });
});
