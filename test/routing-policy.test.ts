import { describe, expect, test } from "bun:test";
import { capabilityRouteFor } from "../plugins/fable-orchestrator/lib/capability-routes";
import type { RouteCapability } from "../plugins/fable-orchestrator/lib/routes";
import { resolveRoutingShadow } from "../plugins/fable-orchestrator/lib/routing-shadow";
import {
  defaultRouteCapabilities,
  COMPOSER_ORCHESTRATOR_MODE_STACK,
  MECHANICAL_OPS_PRIMARY_MODEL,
  MECHANICAL_OPS_TASK_CLASSES,
  gpt56WorkerRoutingBullets,
  renderComposerOrchestratorModeSection,
  renderMechanicalOpsPolicySection,
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
      "The route is read-only and defaults to `gpt-6.0-builder` at high reasoning effort unless `--effort` overrides; taste-sensitive task classes default to `gpt-6.0-polish`",
    );
    expect(policy).toContain(
      "The route is workspace-write and defaults to `gpt-6.0-auditor` at high reasoning effort unless `--effort` overrides; taste-sensitive task classes default to `gpt-6.0-inspector`",
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
      "`gpt-6.0-builder`: Codex implement default for harder implementation, debugging, and escalation at high reasoning effort unless `--effort` overrides.",
    );
    expect(bullets).toContain(
      "`gpt-6.0-auditor`: Codex review default for routine checks at high reasoning effort unless `--effort` overrides.",
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
    const ruleRouteSelectionSection = rule.slice(
      rule.indexOf("## Route Selection"),
      rule.indexOf("## GPT-5.6 Worker Models"),
    );
    expect(ruleRouteSelectionSection).toContain(
      "Use Cursor Composer 3.0 for clear, mechanical, high-volume implementation after the approach is approved.",
    );
    expect(ruleRouteSelectionSection).toContain(
      "after Composer 3.0 misses the bar",
    );
    expect(ruleRouteSelectionSection).not.toContain("Composer 2.5");

    const ruleWorkerModelsSection = rule.slice(
      rule.indexOf("## GPT-5.6 Worker Models"),
      rule.indexOf("## Mechanical ops (dumb models)"),
    );
    expect(ruleWorkerModelsSection).toContain(
      "Composer 3.0 remains the default Cursor implementation worker;",
    );
    expect(ruleWorkerModelsSection).not.toContain("Composer 2.5");
    expect(rule).toContain(
      "Use Codex review for read-only correctness, regression, security, and acceptance-criteria checks; defaults to GPT-6.0 Auditor at high reasoning effort unless `--effort` overrides, or Inspector for taste-sensitive task classes.",
    );
    expect(rule).not.toContain("GPT-5.6 Luna");
    expect(rule).not.toContain("GPT-5.6 Terra");
    expect(rule).not.toContain("Sol for taste-sensitive task classes");

    const workloadGuidance = renderWorkloadMatrixGuidanceSection(
      changedCapabilities,
    );
    expect(workloadGuidance).toContain(
      "| `gpt-6.0-builder` | Codex | Default hard implementation at high reasoning effort unless `--effort` overrides:",
    );
    expect(workloadGuidance).toContain(
      "| `gpt-6.0-auditor` | Codex | Default read-only review at high reasoning effort unless `--effort` overrides:",
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

describe("routing-policy: parent orchestrator availability", () => {
  test("defines identity as an explicit contract distinct from chat parents and workers", () => {
    const policy = renderRoutingPolicyMd();
    expect(policy).toContain("--orchestrator <identity>");
    expect(policy).toContain("FABLE_ORCHESTRATOR_ORCHESTRATOR=<identity>");
    expect(policy).toContain("incidental chat parent/model");
    expect(policy).toContain("bounded workers");
    expect(policy).toContain("never infers orchestrator identity from a chat UI model");
    expect(policy).toContain("CLI selection takes precedence");
    expect(policy).toContain("`null` / not selected");
    expect(policy).toContain(
      "exactly `fable`, `sol`, `composer`, `opus`, and `cursor-fable-high`",
    );
    expect(policy).toContain(
      "`composer` identity activates the fixed Composer economy policy",
    );
    expect(policy).toContain(
      "All other identities, and a null/unset identity, retain the existing routing",
    );
  });

  test("documents Cursor CC-Fable to Codex-Sol to Cursor-Fable-High chain", () => {
    const policy = renderRoutingPolicyMd();
    expect(policy).toContain("## Parent orchestrator availability");
    expect(policy).toContain("CC-Fable");
    expect(policy).toContain("Codex-Sol");
    expect(policy).toContain("Cursor-Fable-High");
    expect(policy).toContain("usage limit");
    expect(policy).toContain("authentication failure");
    expect(policy).toContain("**active** parent session");
    expect(policy).toContain("worker Sol authorization");
    expect(policy).toContain("never an automatic *worker* fallback");
    expect(policy).toContain("Run the Codex-Sol parent fallback at high reasoning effort");
    expect(policy).toContain("`--effort high`");

    const sectionStart = policy.indexOf("## Parent orchestrator availability");
    const sectionEnd = policy.indexOf("## Backend availability fallback");
    const section = policy.slice(sectionStart, sectionEnd);
    expect(section.indexOf("CC-Fable")).toBeLessThan(section.indexOf("Codex-Sol"));
    expect(section.indexOf("Codex-Sol")).toBeLessThan(
      section.indexOf("Cursor-Fable-High"),
    );
  });
});

describe("routing-policy: Composer orchestrator mode", () => {
  test("documents the fixed opt-in economy route stack and exclusions", () => {
    const policy = renderRoutingPolicyMd();
    const section = renderComposerOrchestratorModeSection();

    expect(policy).toContain("## Composer orchestrator mode");
    expect(policy).toContain(section);
    expect(section).toContain("fixed opt-in economy policy");
    expect(section).toContain(`Fixed opt-in economy tree: ${COMPOSER_ORCHESTRATOR_MODE_STACK}.`);
    expect(COMPOSER_ORCHESTRATOR_MODE_STACK).toBe(
      "(O) Composer -> opus-explore -> composer-implement -> opus-check",
    );
    expect(section).toContain(
      "explicitly exclude Fable, Codex 5.6 Sol, and default Codex workers",
    );
    expect(section).toContain("`codex-explore`");
    expect(section).toContain("`codex-implement`");
    expect(section).toContain("`codex-check`");
    expect(section).toContain(
      "remain on the economy stack unless a worker fails",
    );
    expect(section).toContain(
      "never silently upgrade to Fable, Sol, or default Codex workers",
    );
    expect(section).toContain(
      "explicit parent decision before leaving the economy stack",
    );
    expect(section).toContain("`analyze` to `opus-explore`");
    expect(section).toContain("`implement` to `composer-implement`");
    expect(section).toContain("`review` to `opus-check`");
    expect(section).toContain("independently of rollout-stage selection flags");
    expect(section).toContain("conflicting direct engine API request");

    const parentSection = policy.slice(
      policy.indexOf("## Parent orchestrator availability"),
      policy.indexOf("## Composer orchestrator mode"),
    );
    expect(parentSection).toContain("CC-Fable");
    expect(parentSection).toContain("Codex-Sol");
    expect(parentSection).toContain("Cursor-Fable-High");
  });
});

describe("routing-policy: availability fallback chain", () => {
  test("documents Codex to Opus to Grok two-tier fallback", () => {
    const policy = renderRoutingPolicyMd();
    expect(policy).toContain("## Backend availability fallback");
    expect(policy).toContain("### Tier 1 — Codex → Opus (Claude)");
    expect(policy).toContain("### Tier 2 — Opus → Grok (Composer)");
    expect(policy).toContain("grok-explore");
    expect(policy).toContain("grok-check");
    expect(policy).toContain("grok-implement");
    expect(policy).toContain("backend_unavailable");
    expect(policy).toContain("opus-explore");
    expect(policy).toContain('backend: "claude"');
    expect(policy).toContain('backend: "composer"');
    expect(policy).toContain("FABLE_ORCHESTRATOR_FALLBACK=claude");
    expect(policy).toContain("opus-review");
    expect(policy).toContain("not taste escalation");
  });
});

describe("routing-policy: Mechanical ops (dumb models)", () => {
  test("defines exactly three active task classes as the bounded worker exception", () => {
    const section = renderMechanicalOpsPolicySection();

    expect(MECHANICAL_OPS_TASK_CLASSES).toEqual([
      "post-github-comment",
      "commit-push",
      "merge",
    ]);
    for (const taskClass of MECHANICAL_OPS_TASK_CLASSES) {
      expect(section).toContain(`\`${taskClass}\``);
    }
    expect(renderRoutingPolicyMd()).toContain(section);
    expect(section).toContain("three named mechanical-ops routes are active");
    expect(section).toContain("Opening a pull request is **not** a mechanical route");
    expect(section).toContain("open PRs directly with `gh pr create`");
    expect(section).toContain("non-writing Composer 2.5 operation-plan proposal");
    expect(section).toContain("runner-side canonical argv validation");
    expect(section).toContain("shell-free execution of trusted `git` or `gh` binaries");
    expect(section).toContain("only bounded exception");
    expect(section).toContain("Deployment remains prohibited for every route");
    expect(section).not.toContain("future");
    expect(section).not.toContain("does not make these routes executable");
  });

  test("fixes Composer as the proposal model without fallback or override", () => {
    const section = renderMechanicalOpsPolicySection();

    expect(MECHANICAL_OPS_PRIMARY_MODEL).toBe("composer-2.5");
    expect(section).toContain("Composer 2.5 is the only proposal model");
    expect(section).toContain("no automatic fallback or model override");
    expect(section).toContain(
      "If Composer 2.5 is unavailable or its proposal fails validation, the operation stops",
    );
    expect(section).not.toContain("Sonnet 5");
    expect(section).not.toContain("Haiku 4.5");
  });

  test("requires every named parent to delegate every mechanical operation", () => {
    const section = renderMechanicalOpsPolicySection();

    for (const parent of ["Fable", "Sol", "Composer"]) {
      expect(section).toContain(parent);
    }
    expect(section).toContain(
      "must delegate every corresponding operation to its named mechanical-ops route",
    );
    for (const command of [
      "git commit",
      "git push",
      "gh pr merge",
      "gh issue comment",
      "gh pr comment",
    ]) {
      expect(section).toContain(`\`${command}\``);
    }
    expect(section).toContain("open PRs directly with `gh pr create`");
    expect(section).toContain("Parents must never directly run");
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
