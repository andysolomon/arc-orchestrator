import { describe, expect, test } from "bun:test";
import {
  evaluateCandidateEligibility,
  GPT_55_STABLE_ID,
  GPT_56_SOL_STABLE_ID,
  resolveCanonicalRoute,
  resolveDelegationRouting,
} from "../plugins/fable-orchestrator/lib/delegation-routing";
import { capabilityRouteFor } from "../plugins/fable-orchestrator/lib/capability-routes";

describe("delegation-routing: canonical route resolution", () => {
  test("resolves executable aliases and canonical capability routes", () => {
    expect(resolveCanonicalRoute("composer-implement")).toEqual({
      ok: true,
      canonicalRouteId: "implement.workspace-write.v1",
      requestedAlias: "composer-implement",
    });
    expect(resolveCanonicalRoute("implement.workspace-write.v1")).toEqual({
      ok: true,
      canonicalRouteId: "implement.workspace-write.v1",
      requestedAlias: null,
    });
    expect(resolveCanonicalRoute("bogus-alias")).toEqual({
      ok: false,
      reasons: ["malformed-route-path"],
    });
  });

  test("grok aliases select the grok composer candidate without codex stack fallback", () => {
    const explore = resolveDelegationRouting({
      requestedRoute: "grok-explore",
    });
    expect(explore.ok).toBe(true);
    if (!explore.ok) {
      return;
    }
    expect(explore.candidateStableId).toBe("grok-4.5");
    expect(explore.fixedContract).toMatchObject({
      mode: "analyze",
      sandbox: "read-only",
    });

    const check = resolveDelegationRouting({
      requestedRoute: "grok-check",
    });
    expect(check.ok).toBe(true);
    if (!check.ok) {
      return;
    }
    expect(check.candidateStableId).toBe("grok-4.5");
    expect(check.fixedContract).toMatchObject({
      mode: "review",
      sandbox: "read-only",
    });
  });

  test("legacy mechanical aliases are rejected", () => {
    for (const requestedRoute of [
      "mechanical-post-comment",
      "mechanical-commit-push",
      "mechanical-merge",
    ]) {
      expect(resolveCanonicalRoute(requestedRoute)).toEqual({
        ok: false,
        reasons: ["malformed-route-path"],
      });
      expect(resolveDelegationRouting({ requestedRoute }).ok).toBe(false);
    }
  });
});

describe("delegation-routing: parent authorization gates", () => {
  test("preferred tough gpt-5.5 requires explicit parent authorization", () => {
    const rejected = resolveDelegationRouting({
      requestedRoute: "composer-implement",
      preferredCandidateStableIds: [GPT_55_STABLE_ID],
      toughTask: true,
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) {
      return;
    }
    expect(rejected.reasons).toContain("explicit-parent-authorization-required");

    const authorized = resolveDelegationRouting({
      requestedRoute: "composer-implement",
      preferredCandidateStableIds: [GPT_55_STABLE_ID],
      toughTask: true,
      explicitParentAuthorization: true,
    });
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) {
      return;
    }
    expect(authorized.candidateStableId).toBe(GPT_55_STABLE_ID);
    expect(authorized.explicitParentAuthorizationApplied).toBe(true);
  });

  test("non-tough preferred gpt-5.5 does not require explicit parent authorization", () => {
    const result = resolveDelegationRouting({
      requestedRoute: "implement.workspace-write.v1",
      workloadClass: "medium-work",
      preferredCandidateStableIds: [GPT_55_STABLE_ID],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.candidateStableId).toBe(GPT_55_STABLE_ID);
    expect(result.explicitParentAuthorizationApplied).toBe(false);
  });

  test("rate-limit tough gpt-5.5 successor requires explicit parent authorization", () => {
    const rejected = resolveDelegationRouting({
      requestedRoute: "implement.workspace-write.v1",
      workloadClass: "medium-light-work",
      failureTrigger: "rate_limit",
      exhaustedCandidateStableId: "opus-4.8",
      toughTask: true,
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) {
      return;
    }
    expect(rejected.reasons).toContain("explicit-parent-authorization-required");

    const authorized = resolveDelegationRouting({
      requestedRoute: "implement.workspace-write.v1",
      workloadClass: "medium-light-work",
      failureTrigger: "rate_limit",
      exhaustedCandidateStableId: "opus-4.8",
      toughTask: true,
      explicitParentAuthorization: true,
    });
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) {
      return;
    }
    expect(authorized.candidateStableId).toBe(GPT_55_STABLE_ID);
    expect(authorized.rateLimitFallback).toBe(true);
    expect(authorized.explicitParentAuthorizationApplied).toBe(true);
  });

  test("gpt-5.6-sol worker choice does not require explicit parent authorization", () => {
    const result = resolveDelegationRouting({
      requestedRoute: "implement.workspace-write.v1",
      workloadClass: "hard-light-work",
      preferredCandidateStableIds: [GPT_56_SOL_STABLE_ID],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.candidateStableId).toBe(GPT_56_SOL_STABLE_ID);
    expect(result.explicitParentAuthorizationApplied).toBe(false);
  });
});

describe("delegation-routing: rate-limit alternate provider", () => {
  test("allows parent-validated alternate provider from the same stack on rate_limit", () => {
    const result = resolveDelegationRouting({
      requestedRoute: "implement.workspace-write.v1",
      workloadClass: "medium-work",
      failureTrigger: "rate_limit",
      exhaustedCandidateStableId: "gpt-5.5",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rateLimitFallback).toBe(true);
    expect(result.candidateStableId).toBe("opus-4.8");
    expect(result.selectionReason).toBe("rate-limit-stack-fallback");
  });

  test("default implement workload has no rate-limit successor after composer-2.5", () => {
    const result = resolveDelegationRouting({
      requestedRoute: "composer-implement",
      failureTrigger: "rate_limit",
      exhaustedCandidateStableId: "composer-2.5",
    });
    expect(result).toEqual({
      ok: false,
      reasons: ["no-rate-limit-fallback-candidate"],
    });
  });

  test("non-rate-limit recommendations cannot authorize provider switching", () => {
    const result = resolveDelegationRouting({
      requestedRoute: "composer-implement",
      preferredCandidateStableIds: [GPT_55_STABLE_ID],
      failureTrigger: "timeout",
    });
    expect(result).toEqual({
      ok: false,
      reasons: ["provider-switch-not-authorized-without-rate-limit"],
    });
  });
});

describe("delegation-routing: ineligible candidates fail visibly", () => {
  test("accepts fable-5 on ADR routes and rejects contract-ineligible candidates", () => {
    const contract = capabilityRouteFor("check.read-only.v1");
    const fable = evaluateCandidateEligibility(
      "fable-5",
      "check.read-only.v1",
      {
        mode: contract.mode,
        sandbox: contract.sandbox,
        outputContract: contract.outputContract,
      },
    );
    expect(fable.eligible).toBe(true);
    expect(fable.reasons).toEqual([]);

    const ineligiblePreferred = resolveDelegationRouting({
      requestedRoute: "check.read-only.v1",
      preferredCandidateStableIds: ["gpt-5.6-luna"],
    });
    expect(ineligiblePreferred.ok).toBe(false);
    if (ineligiblePreferred.ok) {
      return;
    }
    expect(ineligiblePreferred.reasons.length).toBeGreaterThan(0);
    expect(ineligiblePreferred.reasons).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /missing-route-eligibility|contract-incompatible|not-in-candidate-stack/,
        ),
      ]),
    );
  });

  test("rejects malformed preferred candidate paths", () => {
    const result = resolveDelegationRouting({
      requestedRoute: "check.read-only.v1",
      preferredCandidateStableIds: ["not-a-registry-id"],
    });
    expect(result).toEqual({
      ok: false,
      reasons: ["malformed-preferred-candidate"],
    });
  });
});
