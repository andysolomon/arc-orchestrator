// Parity: the shared routing-core package must reproduce the runtime's
// pre-migration routing facts byte-for-byte. The baseline fixtures were dumped
// from the runtime before any module moved (see test/fixtures/routing-core);
// a drift here is a production routing change and must be an explicit,
// tested migration, never a side effect of extraction.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CANDIDATE_STACKS,
  MODEL_REGISTRY,
  PUBLIC_ALIAS_CANDIDATE_STACKS,
  candidateStackForRoute,
} from "../../plugins/arc-orchestrator/lib/model-registry";
import { routesContract, WORKLOAD_CLASSES as RUNTIME_WORKLOAD_CLASSES } from "../../plugins/arc-orchestrator/lib/routes";
import {
  CAPABILITY_ROUTES,
  PUBLIC_ALIAS_BINDINGS,
} from "../../plugins/arc-orchestrator/lib/capability-routes";
import {
  floorForWorkloadClass,
  workloadClassFloorTable,
} from "../../plugins/arc-orchestrator/lib/capability-floor";
import { DEFAULT_CAPABILITY_SNAPSHOT } from "../../plugins/orchestrator-core/routing-policy";
import { resolveRoutingShadow } from "../../plugins/arc-orchestrator/lib/routing-shadow";
import { MODEL_POLICY, MODEL_POLICY_SOURCE } from "../../plugins/arc-orchestrator/lib/model-policy";
import {
  WORKLOAD_CLASSES,
  compileCandidateStacks,
  compilePublicAliasStacks,
  evaluateRouting,
  parsePolicyDocument,
  renderPolicyBlock,
  parsePolicyBlock,
  canonicalPolicyJson,
  validatePolicy,
  policyHasErrors,
  registryPolicyDivergences,
} from "../../packages/routing-core/src/index";
import { policyDigest } from "../../packages/routing-core/src/runtime";
import { parsePolicyDocument as parseWithSyncedMjs } from "../../scripts/model-policy.mjs";

const fixtures = resolve(import.meta.dir, "../fixtures/routing-core");
const readFixture = (name: string) => JSON.parse(readFileSync(resolve(fixtures, name), "utf8"));
const NOW_MS = Date.parse("2026-09-26T00:00:00Z");

describe("routing-core parity with the pre-migration runtime", () => {
  test("compiled candidate stacks equal the baseline stacks", () => {
    const baseline = readFixture("candidate-stacks.baseline.json");
    expect(JSON.parse(JSON.stringify(CANDIDATE_STACKS))).toEqual(baseline.stacks);
    expect(JSON.parse(JSON.stringify(PUBLIC_ALIAS_CANDIDATE_STACKS))).toEqual(baseline.aliasStacks);
    // And the shared compiler reproduces them from the policy alone.
    expect(JSON.parse(JSON.stringify(compileCandidateStacks(MODEL_POLICY)))).toEqual(baseline.stacks);
    expect(JSON.parse(JSON.stringify(compilePublicAliasStacks(MODEL_POLICY, MODEL_REGISTRY)))).toEqual(baseline.aliasStacks);
  });

  test("the routes --json contract is unchanged", () => {
    expect(JSON.parse(JSON.stringify(routesContract({})))).toEqual(readFixture("routes-contract.baseline.json"));
  });

  test("capability routes and public alias bindings are unchanged", () => {
    const baseline = readFixture("alias-bindings.baseline.json");
    expect(JSON.parse(JSON.stringify(CAPABILITY_ROUTES))).toEqual(baseline.routes);
    expect(JSON.parse(JSON.stringify(PUBLIC_ALIAS_BINDINGS))).toEqual(baseline.aliases);
  });

  test("derived capability floors are unchanged", () => {
    const baseline = readFixture("capability-floors.baseline.json");
    const floors = {
      implement: workloadClassFloorTable({ capabilityRoute: "implement.workspace-write.v1", axis: "agentic-edit", snapshot: DEFAULT_CAPABILITY_SNAPSHOT }),
      explore: floorForWorkloadClass(null, { capabilityRoute: "explore.read-only.v1", axis: "swe", snapshot: DEFAULT_CAPABILITY_SNAPSHOT }),
      check: floorForWorkloadClass(null, { capabilityRoute: "check.read-only.v1", axis: "swe", snapshot: DEFAULT_CAPABILITY_SNAPSHOT }),
    };
    expect(JSON.parse(JSON.stringify(floors))).toEqual(baseline);
  });

  test("shadow select() decisions are unchanged, and evaluateRouting reproduces them", () => {
    const baseline = readFixture("shadow-decisions.baseline.json");
    const shadowEnv = { ARC_ORCHESTRATOR_ROUTE_SELECTION: "shadow" };
    for (const stack of CANDIDATE_STACKS) {
      if (!stack.automaticFallback) continue;
      const key = `${stack.route}/${stack.phase ?? "-"}/${stack.workloadClass ?? "-"}`;
      const alias = stack.route === "implement.workspace-write.v1" ? "composer-implement" : stack.route === "check.read-only.v1" ? "composer-check" : "composer-explore";
      const report = resolveRoutingShadow({ requestedAlias: alias, env: shadowEnv, workloadClass: stack.workloadClass ?? null, phase: stack.phase ?? null, pinAlias: false, capabilitySnapshot: DEFAULT_CAPABILITY_SNAPSHOT, nowMs: NOW_MS, availabilityObservations: [], taskIdentity: "baseline" });
      const expected = baseline[key];
      const evaluation = evaluateRouting({
        policy: MODEL_POLICY,
        registry: MODEL_REGISTRY,
        snapshot: DEFAULT_CAPABILITY_SNAPSHOT,
        context: { phase: stack.phase!, workloadClass: stack.workloadClass as never, nowMs: NOW_MS, taskIdentity: "baseline" },
      });
      expect(evaluation.error).toBeNull();
      expect(evaluation.stack).toEqual(candidateStackForRoute(stack.route, null, stack.workloadClass ?? null, stack.phase ?? null));
      if (expected.skipped) {
        // The runtime shadow resolves the stack without a phase, so the deploy
        // stack (implement route, no class) was and still is skipped there. The
        // control plane can evaluate it because it carries the phase.
        expect(report.capabilityShadow?.decision ?? null).toBeNull();
        expect(report.capabilityShadow?.skipReason).toBe(expected.skipped);
        expect(evaluation.selection?.outcome).toBe("selected");
        continue;
      }
      const runtimeDecision = JSON.parse(JSON.stringify(report.capabilityShadow?.decision));
      expect(runtimeDecision, key).toEqual(expected);
      // The control plane's engine, same inputs, same decision.
      expect(JSON.parse(JSON.stringify(evaluation.selection)), key).toEqual(expected);
    }
  });

  test("the runtime's policy-derived workload classes equal the canonical vocabulary", () => {
    expect([...RUNTIME_WORKLOAD_CLASSES]).toEqual([...WORKLOAD_CLASSES]);
  });

  test("the TypeScript parser agrees with the synchronized .mjs parser and the shipped copy", () => {
    const markdown = readFileSync(resolve(import.meta.dir, "../../docs/arc-model-policy.md"), "utf8");
    const parsed = parsePolicyDocument(markdown);
    expect(parsed).toEqual(parseWithSyncedMjs(markdown));
    expect(parsed).toEqual(JSON.parse(JSON.stringify(MODEL_POLICY)));
    expect(policyDigest(parsed)).toBe(MODEL_POLICY_SOURCE.digest);
  });

  test("rendering a policy round-trips through the parser to an equal object", () => {
    const rendered = renderPolicyBlock(MODEL_POLICY);
    const reparsed = parsePolicyBlock(rendered);
    expect(canonicalPolicyJson(reparsed)).toBe(canonicalPolicyJson(JSON.parse(JSON.stringify(MODEL_POLICY))));
  });

  test("the shipped policy validates against the shipped registry with no errors", () => {
    const issues = validatePolicy(MODEL_POLICY, { registry: MODEL_REGISTRY });
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(policyHasErrors(issues)).toBe(false);
    expect(registryPolicyDivergences(MODEL_REGISTRY, MODEL_POLICY, CANDIDATE_STACKS)).toEqual([]);
  });

  test("the registry stable ids are unchanged", () => {
    expect(MODEL_REGISTRY.map((entry) => entry.stableId)).toEqual(readFixture("registry-stable-ids.baseline.json"));
  });
});
