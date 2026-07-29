import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { capabilityRouteFor } from "../plugins/arc-orchestrator/lib/capability-routes";
import type { RouteCapability } from "../plugins/arc-orchestrator/lib/routes";
import { resolveRoutingShadow } from "../plugins/arc-orchestrator/lib/routing-shadow";
import type { CapabilitySnapshot } from "../plugins/arc-orchestrator/lib/capability-snapshot";
import type { ModelRegistryEntry } from "../plugins/arc-orchestrator/lib/model-registry";
import {
  DEFAULT_CAPABILITY_SNAPSHOT,
  defaultCodexRouteDefaults,
  defaultRouteCapabilities,
  ECO_ORCHESTRATOR_MODE_STACK,
  WORKER_DESCRIPTIONS,
  gpt56WorkerRoutingBullets,
  renderCapabilitySnapshotRankingSection,
  renderEcoOrchestratorModeSection,
  renderMechanicalOpsPolicySection,
  renderRoutingPolicyMd,
  renderRolloutGatesSection,
  renderWorkloadMatrixGuidanceSection,
  type CodexRouteDefaults,
} from "../plugins/orchestrator-core/routing-policy";
import { renderCursorOrchestratorRule } from "../plugins/orchestrator-core/surface-templates";
import { CANDIDATE_STACKS } from "../plugins/arc-orchestrator/lib/model-registry";

const empty = {};
const root = new URL("..", import.meta.url);

function read(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

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

  test("override to fable-5 is applied when contract-eligible", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "check.read-only.v1",
      env: empty,
      override: { model: "fable-5" },
    });

    expect(report.overrideOutcome).toMatchObject({
      status: "applied",
      stableId: "fable-5",
    });
    expect(report.proposedSelection).toEqual({
      backend: "claude",
      model: "claude-fable-5",
    });
  });

  test("override to gpt-5.6-sol is applied without explicitParentAuthorization", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "implement.workspace-write.v1",
      env: empty,
      workloadClass: "hard-light-work",
      override: { model: "gpt-5.6-sol" },
    });

    expect(report.overrideOutcome).toEqual({
      status: "applied",
      model: "gpt-5.6-sol",
      stableId: "gpt-5.6-sol",
    });
    expect(report.proposedSelection).toEqual({
      backend: "codex",
      model: "gpt-5.6-sol",
    });
  });

  test("override to gpt-5.6-sol may still record explicitParentAuthorization when supplied", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "implement.workspace-write.v1",
      env: empty,
      workloadClass: "hard-light-work",
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
        ...(route.id === "composer-implement"
          ? { model: "composer-3.0" }
          : {}),
      }),
    );

    // Codex automatic defaults are no longer exposed as public route aliases;
    // they are injected through the dedicated codexDefaults input (still derived
    // from the same `profileFor` resolver by default).
    const baseCodex = defaultCodexRouteDefaults();
    const changedCodexDefaults: CodexRouteDefaults = {
      explore: { ...baseCodex.explore, model: "gpt-6.0-scout" },
      implement: { ...baseCodex.implement, model: "gpt-6.0-builder" },
      check: { ...baseCodex.check, model: "gpt-6.0-auditor" },
    };

    const policy = renderRoutingPolicyMd(changedCapabilities, changedCodexDefaults);
    expect(policy).toContain(
      "default Codex analyze model remains `gpt-6.0-scout` when the chain lands on Codex.",
    );
    expect(policy).toContain("defaults to Composer 3.0.");

    const codexImplementSection = policy.slice(
      policy.indexOf("## Prefer automatic implement"),
      policy.indexOf("## Prefer automatic check"),
    );
    expect(codexImplementSection).toContain(
      "a rerun after Composer 3.0 misses the quality bar;",
    );
    expect(codexImplementSection).toContain(
      "work where GPT-6.0 Builder's steerability is more important than cost.",
    );
    expect(codexImplementSection).not.toContain("Composer 2.5");
    expect(codexImplementSection).not.toContain("GPT-5.6 Terra");

    const bullets = gpt56WorkerRoutingBullets(
      changedCapabilities,
      undefined,
      changedCodexDefaults,
    );
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
      "`gpt-5.6-sol`: flagship Sol has no explicit route alias — reach it through automatic implement with `workload_class: hard-light-work` (Sol leads that stack, and is second behind Fable 5 on the automatic analyze/review chains) or a non-empty Codex model override such as `ARC_ORCHESTRATOR_IMPLEMENT_MODEL=gpt-5.6-sol`; `task_class` never selects this model.",
    );
    expect(bullets).toContain(
      "Composer 3.0 is the Cursor candidate when an automatic stack reaches it; `composer-implement` remains an explicit single-candidate pin outside Eco mode; `ARC_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit override escape hatch, not the default.",
    );

    const rule = renderCursorOrchestratorRule(
      changedCapabilities,
      changedCodexDefaults,
    );
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
      "Composer 3.0 is the Cursor candidate when an automatic stack reaches it;",
    );
    expect(ruleWorkerModelsSection).not.toContain("Composer 2.5");
    expect(rule).toContain(
      "Use Codex review for read-only correctness, regression, security, and acceptance-criteria checks; defaults to GPT-6.0 Auditor at high reasoning effort unless `--effort` overrides.",
    );
    expect(rule).not.toContain("GPT-5.6 Luna");
    expect(rule).not.toContain("GPT-5.6 Terra");
    expect(rule).not.toContain("Sol for taste-sensitive task classes");

    const workloadGuidance = renderWorkloadMatrixGuidanceSection(
      changedCapabilities,
      changedCodexDefaults,
    );
    expect(workloadGuidance).toContain(
      "| `gpt-6.0-builder` | Codex | Default hard implementation at high reasoning effort unless `--effort` overrides:",
    );
    expect(workloadGuidance).toContain(
      "| `gpt-6.0-auditor` | Codex | Default read-only review at high reasoning effort unless `--effort` overrides:",
    );
    expect(workloadGuidance).toContain(
      "| `gpt-5.6-sol` | Codex | No explicit route alias; reached through automatic `workload_class` stacks (`hard-light-work` leads with Sol) or a Codex model override. Never selected by `task_class`.",
    );
    expect(workloadGuidance).not.toContain("gpt-6.0-polish");
    expect(workloadGuidance).not.toContain("gpt-6.0-inspector");
  });
});

describe("routing-policy: parent orchestrator availability", () => {
  test("defines identity as an explicit contract distinct from chat parents and workers", () => {
    const policy = renderRoutingPolicyMd();
    expect(policy).toContain("--orchestrator <identity>");
    expect(policy).toContain("ARC_ORCHESTRATOR_ORCHESTRATOR=<identity>");
    expect(policy).toContain("incidental chat parent/model");
    expect(policy).toContain("bounded workers");
    expect(policy).toContain("never infers orchestrator identity from a chat UI model");
    expect(policy).toContain("CLI selection takes precedence");
    expect(policy).toContain("`null` / not selected");
    expect(policy).toContain(
      "exactly `fable`, `sol`, `eco`, `opus`, and `cursor-fable-high`",
    );
    expect(policy).toContain(
      "`eco` identity activates the fixed eco policy",
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
    expect(policy).toContain("legitimate *workers*");
    expect(policy).toContain("exact automatic stack positions");
    expect(policy).not.toContain("never an automatic *worker* fallback");
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

describe("routing-policy: Eco orchestrator mode", () => {
  test("documents the fixed opt-in economy route stack and exclusions", () => {
    const policy = renderRoutingPolicyMd();
    const section = renderEcoOrchestratorModeSection();

    expect(policy).toContain("## Eco orchestrator mode");
    expect(policy).toContain(section);
    expect(section).toContain("fixed opt-in economy policy");
    expect(section).toContain(`Fixed opt-in economy tree: ${ECO_ORCHESTRATOR_MODE_STACK}.`);
    expect(ECO_ORCHESTRATOR_MODE_STACK).toBe(
      "(O) Eco -> opus-explore [| grok-explore] -> composer-implement -> opus-check [| grok-check]",
    );
    expect(section).toContain(
      "explicitly exclude Fable, Codex 5.6 Sol, and direct Codex `--backend codex` workers",
    );
    expect(section).not.toContain("`codex-explore`");
    expect(section).not.toContain("`codex-implement`");
    expect(section).not.toContain("`codex-check`");
    expect(section).toContain("remain on the eco stack");
    expect(section).toContain("grok-explore");
    expect(section).toContain("grok-check");
    expect(section).toContain(
      "never silently upgrade to Fable, Sol, or default Codex workers",
    );
    expect(section).toContain(
      "explicit parent decision before leaving the eco stack",
    );
    expect(section).toContain("`analyze` to `opus-explore`");
    expect(section).toContain("`implement` to `composer-implement`");
    expect(section).toContain("`review` to `opus-check`");
    expect(section).toContain("independently of rollout-stage selection flags");
    expect(section).toContain("conflicting direct engine API request");

    const parentSection = policy.slice(
      policy.indexOf("## Parent orchestrator availability"),
      policy.indexOf("## Eco orchestrator mode"),
    );
    expect(parentSection).toContain("CC-Fable");
    expect(parentSection).toContain("Codex-Sol");
    expect(parentSection).toContain("Cursor-Fable-High");
  });
});

describe("routing-policy: availability fallback chain", () => {
  test("documents Codex to Opus to Grok to MiniMax to Kimi fallback", () => {
    const policy = renderRoutingPolicyMd();
    expect(policy).toContain("## Backend availability fallback");
    expect(policy).toContain("### Tier 1 — Codex → Opus (Claude)");
    expect(policy).toContain("### Tier 2 — Opus → Grok (Composer)");
    expect(policy).toContain("### Tier 3 — Grok → MiniMax (key-gated)");
    expect(policy).toContain("### Tier 4 — MiniMax → Kimi (terminal, key-gated)");
    expect(policy).toContain("grok-explore");
    expect(policy).toContain("grok-check");
    expect(policy).toContain("grok-implement");
    expect(policy).toContain("--backend minimax");
    expect(policy).toContain("--backend kimi");
    expect(policy).toContain("kimi-k3[1m]");
    expect(policy).toContain("backend_unavailable");
    expect(policy).toContain("opus-explore");
    expect(policy).toContain('backend: "claude"');
    expect(policy).toContain('backend: "composer"');
    expect(policy).toContain("ARC_ORCHESTRATOR_FALLBACK=claude");
    expect(policy).toContain("opus-review");
    expect(policy).toContain("not taste escalation");
  });
});

describe("routing-policy: Shipping authority", () => {
  test("removes mechanical routes and asserts parent-direct shipping", () => {
    const section = renderMechanicalOpsPolicySection();

    expect(renderRoutingPolicyMd()).toContain(section);
    expect(section).toContain("## Shipping authority");
    expect(section).toContain("no mechanical worker routes or aliases");
    expect(section).toContain("parent orchestrator performs the authorized");
    expect(section).toContain("Workers are prohibited");
    expect(section).not.toContain("mechanical-post-comment");
    expect(section).not.toContain("mechanical-commit-push");
    expect(section).not.toContain("mechanical-merge");
    expect(section).not.toContain("three named mechanical-ops routes are active");
  });
});

describe("routing-policy: rollout gates section", () => {
  test("includes capability-derived defaults without hard-coded duplicate bullets", () => {
    const section = renderRolloutGatesSection();
    expect(section).toContain("Staged routing rollout");
    expect(section).toContain("`gpt-5.6-luna`");
    expect(section).toContain("fixture-to-shadow");
    expect(section).toContain("humanApproved=true");
    expect(section).toContain("ARC_ORCHESTRATOR_ROLLOUT_HUMAN_APPROVED=1");

    const policy = renderRoutingPolicyMd();
    expect(policy).toContain("## Staged routing rollout");
    expect(policy).toContain("ARC_ORCHESTRATOR_ROLLOUT_STAGE");
  });
});

describe("routing-policy: ranking prose is snapshot-derived", () => {
  test("renders model evidence from an injected snapshot and registry", () => {
    const snapshot: CapabilitySnapshot = structuredClone(DEFAULT_CAPABILITY_SNAPSHOT);
    const sol = snapshot.rungs.find((rung) => rung.rungId === "gpt-5.6-sol@high");
    expect(sol).toBeDefined();
    sol!.measurements.find((m) => m.axis === "swe")!.score = 0.8123;

    const registry: ModelRegistryEntry[] = [
      {
        stableId: "gpt-5.6-sol",
        family: "gpt",
        version: "5.6",
        publisher: "OpenAI",
        servingProvider: "OpenAI",
        providerModelId: "gpt-5.6-sol",
        transportBackend: "codex",
        adapterId: "codex",
        adapterVersion: "1",
        endpoint: null,
        region: null,
        authAccountScope: "local-user-subscription",
        runnerSupport: ["codex:implement"],
        routeEligibility: ["implement.workspace-write.v1"],
        sandboxPermissionSupport: ["workspace-write"],
        outputContracts: ["implementation-result.v1"],
        maturity: "available",
        provenance: {
          sources: ["test"],
          capturedAt: "2026-07-26",
          verificationResult: "verified",
          approver: "test",
        },
        priceBand: "$$",
        numericPricing: null,
        aliases: [],
        displayName: "GPT-5.6 Sol",
        roleRestriction: null,
        evidence: null,
      },
    ];

    const rendered = renderCapabilitySnapshotRankingSection(snapshot, registry);
    expect(rendered).toContain("`2026-07-25+deepswe.v1.1+cursorbench.3.2`");
    expect(rendered).toContain("| `gpt-5.6-sol` | Codex (`codex exec`) |");
    expect(rendered).toContain("81% +/-1 (high)");
  });

  test("checked-in human-readable ranking sections match the renderer", () => {
    const rendered = renderCapabilitySnapshotRankingSection();
    expect(read("CLAUDE.md")).toContain(rendered);
    expect(read("README.md")).toContain(rendered);
  });

  test("stale hand-authored ranking authorities are gone from routing-policy", () => {
    const source = read("plugins/orchestrator-core/routing-policy.ts");
    expect(source).not.toContain("export const MODEL_RANKINGS");
    expect(source).not.toContain("export const GPT56_PLACEMENTS");
    expect(source).not.toContain("export const HOW_TO_APPLY_RANKINGS");
    expect(source).not.toContain("usageHeadroom");
    expect(source).not.toContain("intelligence: number");
  });
});

describe("routing-policy: worker prose matches the authored stacks", () => {
  // Which stack a model leads is a routing fact, not a description, so the claim
  // is checked against CANDIDATE_STACKS rather than against a phrase. #237 ranked
  // grok-4.5 into second place in medium-work and wrote prose saying it led there
  // — the two disagreed in the same commit, and ADR 0010 step 7 exists to keep
  // that lead where it is.
  function leadOf(workloadClass: string): string {
    const stack = CANDIDATE_STACKS.find(
      (candidate) =>
        candidate.route === "implement.workspace-write.v1" &&
        candidate.workloadClass === workloadClass,
    );
    if (!stack) {
      throw new Error(`no authored stack for ${workloadClass}`);
    }
    return stack.candidates[0]!;
  }

  test("grok-4.5 is not described as leading a stack it does not lead", () => {
    const grokDescription = WORKER_DESCRIPTIONS.find((entry) =>
      entry.includes("`grok-implement`"),
    );
    expect(grokDescription).toBeDefined();
    for (const workloadClass of ["medium-work", "medium-light-work"]) {
      if (leadOf(workloadClass) === "grok-4.5") {
        continue; // A "leads" claim would be true; nothing to guard.
      }
      expect(grokDescription).not.toContain(
        `leads the automatic ${workloadClass} stack`,
      );
    }
  });

  test("the stack grok-4.5 is described as leading is the one it leads", () => {
    expect(leadOf("light-work")).toBe("grok-4.5");
    const grokDescription = WORKER_DESCRIPTIONS.find((entry) =>
      entry.includes("`grok-implement`"),
    )!;
    expect(grokDescription).toContain("leads the automatic light-work stack");
  });

  test("medium-work still leads with gpt-5.5, per #237", () => {
    expect(leadOf("medium-work")).toBe("gpt-5.5");
    expect(leadOf("medium-light-work")).toBe("opus-5");
  });
});
