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

  test("mechanical aliases select only fixed composer-2.5 candidates", () => {
    for (const [requestedRoute, canonicalRouteId] of [
      ["mechanical-post-comment", "mechanical-post-comment.workspace-write.v1"],
      ["mechanical-commit-push", "mechanical-commit-push.workspace-write.v1"],
      ["mechanical-merge", "mechanical-merge.workspace-write.v1"],
    ] as const) {
      const result = resolveDelegationRouting({ requestedRoute });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result).toMatchObject({
        canonicalRouteId,
        requestedAlias: requestedRoute,
        candidateStableId: "composer-2.5",
        rateLimitFallback: false,
        fixedContract: {
          mode: "implement",
          sandbox: "workspace-write",
          outputContract: "mechanical-operation-result.v1",
        },
      });
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
      requestedRoute: "codex-check",
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
      requestedRoute: "composer-implement",
      failureTrigger: "rate_limit",
      exhaustedCandidateStableId: "composer-2.5",
      toughTask: true,
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) {
      return;
    }
    expect(rejected.reasons).toContain("explicit-parent-authorization-required");

    const authorized = resolveDelegationRouting({
      requestedRoute: "composer-implement",
      failureTrigger: "rate_limit",
      exhaustedCandidateStableId: "composer-2.5",
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

  test("gpt-5.6-sol worker choice requires explicit parent authorization", () => {
    const rejected = resolveDelegationRouting({
      requestedRoute: "codex-implement",
      preferredCandidateStableIds: [GPT_56_SOL_STABLE_ID],
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) {
      return;
    }
    expect(rejected.reasons).toContain("explicit-parent-authorization-required");

    const authorized = resolveDelegationRouting({
      requestedRoute: "codex-implement",
      preferredCandidateStableIds: [GPT_56_SOL_STABLE_ID],
      explicitParentAuthorization: true,
    });
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) {
      return;
    }
    expect(authorized.candidateStableId).toBe(GPT_56_SOL_STABLE_ID);
  });
});

describe("delegation-routing: rate-limit alternate provider", () => {
  test("allows parent-validated alternate provider from the same stack on rate_limit", () => {
    const result = resolveDelegationRouting({
      requestedRoute: "composer-implement",
      failureTrigger: "rate_limit",
      exhaustedCandidateStableId: "composer-2.5",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rateLimitFallback).toBe(true);
    expect(result.candidateStableId).toBe(GPT_55_STABLE_ID);
    expect(result.selectionReason).toBe("rate-limit-stack-fallback");
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
  test("rejects parent-only and contract-ineligible candidates", () => {
    const contract = capabilityRouteFor("check.read-only.v1");
    const parentOnly = evaluateCandidateEligibility(
      "fable-5",
      "check.read-only.v1",
      {
        mode: contract.mode,
        sandbox: contract.sandbox,
        outputContract: contract.outputContract,
      },
    );
    expect(parentOnly.eligible).toBe(false);
    expect(parentOnly.reasons).toContain("parent-only-role-restriction");

    const ineligiblePreferred = resolveDelegationRouting({
      requestedRoute: "codex-check",
      preferredCandidateStableIds: ["gpt-5.6-luna"],
    });
    expect(ineligiblePreferred.ok).toBe(false);
    if (ineligiblePreferred.ok) {
      return;
    }
    expect(ineligiblePreferred.reasons).toEqual(
      expect.arrayContaining(["missing-route-eligibility", "contract-incompatible"]),
    );
  });

  test("rejects malformed preferred candidate paths", () => {
    const result = resolveDelegationRouting({
      requestedRoute: "codex-check",
      preferredCandidateStableIds: ["not-a-registry-id"],
    });
    expect(result).toEqual({
      ok: false,
      reasons: ["malformed-preferred-candidate"],
    });
  });
});
