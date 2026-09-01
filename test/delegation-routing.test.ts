import { describe, expect, test } from "bun:test";
import {
  evaluateCandidateEligibility,
  GPT_55_STABLE_ID,
  GPT_56_SOL_STABLE_ID,
  resolveCanonicalRoute,
  resolveDelegationRouting,
} from "../plugins/arc-orchestrator/lib/delegation-routing";
import { capabilityRouteFor } from "../plugins/arc-orchestrator/lib/capability-routes";

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
    expect(explore.candidateStableId).toBe("cursor-grok-4.6-high");
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
    expect(check.candidateStableId).toBe("cursor-grok-4.6-high");
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
    expect(rejected.reasons).toContain(
      "explicit-parent-authorization-required",
    );

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
    // hard-medium leads with gpt-5.6-sol on the same codex transport, so
    // preferring gpt-5.5 is not a provider switch and needs no authorization.
    const result = resolveDelegationRouting({
      requestedRoute: "implement.workspace-write.v1",
      workloadClass: "hard-medium",
      preferredCandidateStableIds: [GPT_55_STABLE_ID],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.candidateStableId).toBe(GPT_55_STABLE_ID);
    expect(result.explicitParentAuthorizationApplied).toBe(false);
  });

  test("preferring gpt-5.5 on a Flash-led easy stack is a provider switch without a rate limit", () => {
    // Since the 2026-08-31 OpenCode Go expansion, easy-medium leads with
    // opencode-go-glm-5.3-flash on the opencode transport, so a codex
    // preference is an unauthorized provider switch until a rate limit or
    // explicit parent authorization allows it.
    const result = resolveDelegationRouting({
      requestedRoute: "implement.workspace-write.v1",
      workloadClass: "easy-medium",
      preferredCandidateStableIds: [GPT_55_STABLE_ID],
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reasons).toEqual([
      "provider-switch-not-authorized-without-rate-limit",
    ]);
  });

  test("gpt-5.6-sol worker choice does not require explicit parent authorization", () => {
    const result = resolveDelegationRouting({
      requestedRoute: "implement.workspace-write.v1",
      workloadClass: "hard-medium",
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
      workloadClass: "easy-medium",
      failureTrigger: "rate_limit",
      exhaustedCandidateStableId: "gpt-5.5",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rateLimitFallback).toBe(true);
    expect(result.candidateStableId).toBe("cursor-grok-4.6-high");
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
  test("accepts fable-5.1 on ADR routes and rejects removed candidate identities", () => {
    const contract = capabilityRouteFor("check.read-only.v1");
    const fable = evaluateCandidateEligibility(
      "fable-5.1",
      "check.read-only.v1",
      {
        mode: contract.mode,
        sandbox: contract.sandbox,
        outputContract: contract.outputContract,
      },
    );
    expect(fable.eligible).toBe(true);
    expect(fable.reasons).toEqual([]);

    expect(
      resolveDelegationRouting({
        requestedRoute: "check.read-only.v1",
        preferredCandidateStableIds: ["fable-5"],
      }),
    ).toEqual({
      ok: false,
      reasons: [
        "not-runnable-maturity",
        "missing-route-eligibility",
        "contract-incompatible",
      ],
    });

    for (const removed of [
      "gpt-5.6-terra",
      "grok-4.5",
      "cursor-grok-4.5-high",
    ]) {
      expect(
        resolveDelegationRouting({
          requestedRoute: "check.read-only.v1",
          preferredCandidateStableIds: [removed],
        }),
      ).toEqual({ ok: false, reasons: ["malformed-preferred-candidate"] });
    }
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
