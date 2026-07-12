import { describe, expect, test } from "bun:test";
import { capabilityRouteFor } from "../plugins/fable-orchestrator/lib/capability-routes";
import type { RouteCapability } from "../plugins/fable-orchestrator/lib/routes";
import { resolveRoutingShadow } from "../plugins/fable-orchestrator/lib/routing-shadow";
import {
  defaultRouteCapabilities,
  gpt56WorkerRoutingBullets,
  renderRoutingPolicyMd,
  renderRolloutGatesSection,
  renderWorkloadMatrixGuidanceSection,
} from "../plugins/orchestrator-core/routing-policy";
import { renderCursorOrchestratorRule } from "../plugins/orchestrator-core/surface-templates";

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

describe("routing-policy: generated prose", () => {
  test("derives route defaults from capability data and shares Cursor rule bullets", () => {
    const changedCapabilities: RouteCapability[] = defaultRouteCapabilities().map(
      (route) => ({
        ...route,
        ...(route.id === "codex-explore"
          ? { model: "gpt-6.0-scout", sandbox: "workspace-write" as const }
          : {}),
        ...(route.id === "composer-implement"
          ? { model: "composer-3.0" }
          : {}),
        ...(route.id === "codex-implement"
          ? {
              model: "gpt-6.0-builder",
              sandbox: "read-only" as const,
              task_class_variants: route.task_class_variants?.map((variant) => ({
                ...variant,
                model: "gpt-6.0-polish",
              })),
            }
          : {}),
        ...(route.id === "codex-check"
          ? {
              model: "gpt-6.0-auditor",
              sandbox: "workspace-write" as const,
              task_class_variants: route.task_class_variants?.map((variant) => ({
                ...variant,
                model: "gpt-6.0-inspector",
              })),
            }
          : {}),
      }),
    );

    const policy = renderRoutingPolicyMd(changedCapabilities);
    expect(policy).toContain(
      "The route is workspace-write and defaults to `gpt-6.0-scout`.",
    );
    expect(policy).toContain("defaults to Composer 3.0.");
    expect(policy).toContain(
      "The route is read-only and defaults to `gpt-6.0-builder`; taste-sensitive task classes default to `gpt-6.0-polish`",
    );
    expect(policy).toContain(
      "The route is workspace-write and defaults to `gpt-6.0-auditor`; taste-sensitive task classes default to `gpt-6.0-inspector`",
    );

    const codexImplementSection = policy.slice(
      policy.indexOf("## Route to `codex-implement`"),
      policy.indexOf("## Route to `codex-check`"),
    );
    expect(codexImplementSection).toContain(
      "a rerun after Composer 3.0 misses the quality bar;",
    );
    expect(codexImplementSection).toContain(
      "work where GPT-6.0 Builder's steerability is more important than cost.",
    );
    expect(codexImplementSection).not.toContain("Composer 2.5");
    expect(codexImplementSection).not.toContain("GPT-5.6 Terra");

    const bullets = gpt56WorkerRoutingBullets(changedCapabilities);
    expect(bullets).toContain(
      "`gpt-6.0-scout`: Codex analyze default for high-volume, low-stakes exploration and evidence gathering.",
    );
    expect(bullets).toContain(
      "`gpt-6.0-builder`: Codex implement default for harder implementation, debugging, and escalation.",
    );
    expect(bullets).toContain(
      "`gpt-6.0-auditor`: Codex review default for routine checks.",
    );
    expect(bullets).toContain(
      "`gpt-6.0-polish`: Codex implement default for taste-sensitive task classes (`taste-sensitive`, `ui`, `copy`, `api-design`) unless the matching mode override is non-empty.",
    );
    expect(bullets).toContain(
      "`gpt-6.0-inspector`: Codex review default for taste-sensitive task classes (`taste-sensitive`, `ui`, `copy`, `api-design`) unless the matching mode override is non-empty.",
    );
    expect(bullets).toContain(
      "Composer 3.0 remains the default Cursor implementation worker; `FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-6.0-polish` is an explicit override escape hatch, not the default.",
    );

    const rule = renderCursorOrchestratorRule(changedCapabilities);
    expect(rule).toContain(bullets.map((bullet) => `- ${bullet}`).join("\n"));
    expect(rule).toContain(
      "Use Codex review for read-only correctness, regression, security, and acceptance-criteria checks; defaults to GPT-6.0 Auditor, or Inspector for taste-sensitive task classes.",
    );
    expect(rule).not.toContain("Composer 2.5");
    expect(rule).not.toContain("GPT-5.6 Luna");
    expect(rule).not.toContain("GPT-5.6 Terra");
    expect(rule).not.toContain("Sol for taste-sensitive task classes");

    const workloadGuidance = renderWorkloadMatrixGuidanceSection(
      changedCapabilities,
    );
    expect(workloadGuidance).toContain(
      "| `gpt-6.0-builder` | Codex | Default hard implementation:",
    );
    expect(workloadGuidance).toContain(
      "| `gpt-6.0-auditor` | Codex | Default read-only review:",
    );
    expect(workloadGuidance).toContain(
      "| `gpt-6.0-polish` | Codex | Taste-sensitive implementation",
    );
    expect(workloadGuidance).toContain(
      "| `gpt-6.0-inspector` | Codex | Taste-sensitive read-only review",
    );
    expect(workloadGuidance).not.toContain("gpt-5.6-terra");
    expect(workloadGuidance).not.toContain("gpt-5.6-sol");
  });
});

describe("routing-policy: rollout gates section", () => {
  test("includes capability-derived defaults without hard-coded duplicate bullets", () => {
    const section = renderRolloutGatesSection();
    expect(section).toContain("Staged routing rollout");
    expect(section).toContain("`gpt-5.6-luna`");
    expect(section).toContain("fixture-to-shadow");
    expect(section).toContain("humanApproved=true");
    expect(section).toContain("FABLE_ORCHESTRATOR_ROLLOUT_HUMAN_APPROVED=1");

    const policy = renderRoutingPolicyMd();
    expect(policy).toContain("## Staged routing rollout");
    expect(policy).toContain("FABLE_ORCHESTRATOR_ROLLOUT_STAGE");
  });
});
