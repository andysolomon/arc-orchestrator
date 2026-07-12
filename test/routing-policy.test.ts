import { describe, expect, test } from "bun:test";
import { capabilityRouteFor } from "../plugins/fable-orchestrator/lib/capability-routes";
import { resolveRoutingShadow } from "../plugins/fable-orchestrator/lib/routing-shadow";

const empty = {};

describe("routing-policy: override precedence", () => {
  test("authorized valid override bypasses stack ordering", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "composer-implement",
      env: empty,
      override: { model: "gpt-5.5" },
    });

    expect(report.overrideOutcome).toMatchObject({
      status: "applied",
      stableId: "gpt-5.5",
    });
    expect(report.proposedSelection).toEqual({
      backend: "codex",
      model: "gpt-5.5",
    });
    expect(report.candidateEvaluations[0]?.stableId).toBe("composer-2.5");
    expect(report.proposedSelectionReason).toBe("explicit-override-applied");
  });

  test("override to a model lacking route eligibility is rejected with visible reasons", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "composer-implement",
      env: empty,
      override: { model: "gpt-5.6-luna" },
    });

    expect(report.overrideOutcome).toEqual({
      status: "rejected",
      model: "gpt-5.6-luna",
      reasons: ["missing-route-eligibility", "contract-incompatible"],
    });
    expect(report.proposedSelection).toBeNull();
    expect(report.proposedSelectionReason).toBe("override-rejected");
    expect(report.comparison?.matches).toBe(false);
    expect(report.comparison?.explanation).toContain("override-rejected");
  });

  test("override to fable-5 is always rejected", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "codex-check",
      env: empty,
      override: { model: "fable-5" },
    });

    expect(report.overrideOutcome).toMatchObject({
      status: "rejected",
      model: "fable-5",
      reasons: expect.arrayContaining(["parent-only-role-restriction"]),
    });
  });

  test("override to gpt-5.6-sol without explicitParentAuthorization is rejected", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "codex-implement",
      env: empty,
      override: { model: "gpt-5.6-sol" },
    });

    expect(report.overrideOutcome).toEqual({
      status: "rejected",
      model: "gpt-5.6-sol",
      reasons: ["explicit-parent-authorization-required"],
    });
    expect(report.proposedSelection).toBeNull();
    expect(report.proposedSelectionReason).toBe("override-rejected");
  });

  test("override to gpt-5.6-sol with explicitParentAuthorization is applied and recorded", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "codex-implement",
      env: empty,
      override: {
        model: "gpt-5.6-sol",
        explicitParentAuthorization: true,
      },
    });

    expect(report.overrideOutcome).toEqual({
      status: "applied",
      model: "gpt-5.6-sol",
      stableId: "gpt-5.6-sol",
      explicitParentAuthorization: true,
    });
    expect(report.proposedSelection).toEqual({
      backend: "codex",
      model: "gpt-5.6-sol",
    });
  });
});

describe("routing-policy: fixed route contract immutability", () => {
  test("override cannot change fixed route contract fields in the report", () => {
    const baseline = resolveRoutingShadow({
      requestedAlias: "composer-implement",
      env: empty,
    });
    const overridden = resolveRoutingShadow({
      requestedAlias: "composer-implement",
      env: empty,
      override: { model: "gpt-5.5" },
    });

    const expected = capabilityRouteFor("implement.workspace-write.v1");
    expect(baseline.fixedContract).toEqual({
      mode: expected.mode,
      sandbox: expected.sandbox,
      outputContract: expected.outputContract,
    });
    expect(overridden.fixedContract).toEqual(baseline.fixedContract);
    expect(overridden.canonicalRouteId).toBe("implement.workspace-write.v1");
  });
});
