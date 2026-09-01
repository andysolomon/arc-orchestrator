import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  MODEL_POLICY,
  MODEL_POLICY_SOURCE,
  assertModelPolicyIntegrity,
} from "../plugins/arc-orchestrator/lib/model-policy";
import {
  CANDIDATE_STACKS,
  MODEL_REGISTRY,
  candidateStackForRoute,
  registryPolicyDivergences,
  stackRungs,
} from "../plugins/arc-orchestrator/lib/model-registry";
import { checkRunnerModelPolicy } from "../scripts/check-model-policy.mjs";
import {
  RUNNER_POLICY_DOCUMENT_PATH,
  RUNNER_POLICY_MODULE_PATH,
  parsePolicyDocument,
  policyDigest,
} from "../scripts/model-policy.mjs";
import {
  PARENT_LOCAL_PHASES,
  ROUTING_POLICY_LABEL,
  WORKLOAD_CLASSES,
  routesContract,
} from "../plugins/arc-orchestrator/lib/routes";
import { RUNNER_ROUTING_V4_POLICY } from "../plugins/arc-orchestrator/lib/routing-intent";
import {
  PUBLIC_ROUTE_MODEL_BINDINGS,
  PUBLIC_ROUTE_SUFFIXES,
} from "../plugins/arc-orchestrator/lib/trace-schema";
import {
  renderArcDelegatePolicySection,
  renderPolicyRung,
} from "../plugins/orchestrator-core/routing-policy";

const projectRoot = resolve(import.meta.dir, "..");
const digestOf = (policy: unknown) =>
  createHash("sha256").update(JSON.stringify(policy)).digest("hex");
const rungIds = (stack: NonNullable<ReturnType<typeof candidateStackForRoute>>) =>
  stackRungs(stack).map((rung) => `${rung.stableId}@${rung.effort}`);

describe("model policy synchronization (runner copy)", () => {
  test("the runner copy's digest matches its own content", () => {
    expect(String(MODEL_POLICY_SOURCE.digest)).toBe(digestOf(MODEL_POLICY));
    expect(MODEL_POLICY_SOURCE.document).toBe(
      "docs/arc-model-update-08-30-26.md",
    );
    expect(MODEL_POLICY_SOURCE.updated).toBe(MODEL_POLICY.updated);
  });

  test("a hand-edited or partially regenerated copy is rejected", () => {
    const tampered = {
      ...MODEL_POLICY,
      workloadChains: {
        ...MODEL_POLICY.workloadChains,
        "hard-heavy": ["gpt-5.6-sol@high"],
      },
    };
    expect(digestOf(tampered)).not.toBe(MODEL_POLICY_SOURCE.digest);
    expect(() => assertModelPolicyIntegrity()).not.toThrow();
    expect(() => assertModelPolicyIntegrity(tampered)).toThrow(
      /stale or was edited by hand/,
    );
    expect(() =>
      assertModelPolicyIntegrity(MODEL_POLICY, {
        ...MODEL_POLICY_SOURCE,
        updated: "2026-01-01",
      }),
    ).toThrow(/updated=/);
    const source = readFileSync(
      resolve(
        projectRoot,
        "plugins/arc-orchestrator/lib/model-policy.generated.ts",
      ),
      "utf8",
    );
    expect(source.startsWith("// GENERATED FILE — do not edit.")).toBe(true);
    expect(source).toContain(`"digest": "${MODEL_POLICY_SOURCE.digest}"`);
  });

  test("public bindings equal the policy bindings, in order", () => {
    expect(PUBLIC_ROUTE_MODEL_BINDINGS).toEqual(MODEL_POLICY.routeBindings);
    const aliases = PUBLIC_ROUTE_MODEL_BINDINGS.flatMap(({ base }) =>
      PUBLIC_ROUTE_SUFFIXES.map((suffix) => `${base}-${suffix}`),
    );
    expect(aliases).toHaveLength(MODEL_POLICY.routeBindings.length * 3);
    for (const binding of MODEL_POLICY.routeBindings) {
      for (const suffix of PUBLIC_ROUTE_SUFFIXES) {
        const stack = candidateStackForRoute(
          suffix === "explore"
            ? "explore.read-only.v1"
            : suffix === "implement"
              ? "implement.workspace-write.v1"
              : "check.read-only.v1",
          `${binding.base}-${suffix}`,
          suffix === "implement" ? "hard-heavy" : null,
          suffix === "explore"
            ? "explore"
            : suffix === "implement"
              ? "implement"
              : "verify",
        )!;
        expect(stack.candidates).toEqual([binding.stableId]);
        expect(stack.automaticFallback).toBe(false);
        if ("defaultEffort" in binding) {
          expect(stackRungs(stack)).toEqual([
            { stableId: binding.stableId, effort: binding.defaultEffort },
          ]);
        }
      }
    }
  });

  test("phase chains equal policy chains plus the policy tail", () => {
    const routeFor = {
      explore: "explore.read-only.v1",
      research: "explore.read-only.v1",
      plan: "explore.read-only.v1",
      verify: "check.read-only.v1",
      deploy: "implement.workspace-write.v1",
    } as const;
    for (const phase of Object.keys(
      MODEL_POLICY.phaseChains,
    ) as (keyof typeof MODEL_POLICY.phaseChains)[]) {
      const stack = candidateStackForRoute(routeFor[phase], null, null, phase)!;
      expect(rungIds(stack)).toEqual([
        ...MODEL_POLICY.phaseChains[phase],
        ...MODEL_POLICY.emergencyTail,
      ]);
      expect(stack.automaticFallback).toBe(true);
      expect(stack.policyVersion).toBe(MODEL_POLICY.label);
    }
  });

  test("all nine workload chains equal policy chains plus the policy tail", () => {
    expect(Object.keys(MODEL_POLICY.workloadChains)).toEqual([
      ...WORKLOAD_CLASSES,
    ]);
    expect(WORKLOAD_CLASSES).toHaveLength(9);
    for (const workloadClass of WORKLOAD_CLASSES) {
      const stack = candidateStackForRoute(
        "implement.workspace-write.v1",
        null,
        workloadClass,
        "implement",
      )!;
      expect(rungIds(stack)).toEqual([
        ...MODEL_POLICY.workloadChains[workloadClass],
        ...MODEL_POLICY.emergencyTail,
      ]);
    }
    const implementStacks = CANDIDATE_STACKS.filter(
      (stack) => stack.phase === "implement",
    );
    expect(implementStacks.map((stack) => stack.workloadClass)).toEqual([
      ...WORKLOAD_CLASSES,
    ]);
  });

  test("label, fallback, parent-local Analyze, and exclusions hold", () => {
    expect(ROUTING_POLICY_LABEL).toBe(RUNNER_ROUTING_V4_POLICY);
    expect(MODEL_POLICY.label).toBe(RUNNER_ROUTING_V4_POLICY);
    expect(MODEL_POLICY.fallback).toBe("availability-only");
    expect(PARENT_LOCAL_PHASES).toEqual(MODEL_POLICY.parentLocalPhases);
    expect(MODEL_POLICY.parentLocalPhases).toEqual(["analyze"]);
    expect(
      candidateStackForRoute("explore.read-only.v1", null, null, "analyze"),
    ).toBeNull();
    const contract = routesContract({});
    expect(contract.routing_policy.label).toBe(MODEL_POLICY.label);
    expect(contract.routing_policy.fallback).toBe(MODEL_POLICY.fallback);
    expect(contract.routing_policy.cli_marker.value).toBe(MODEL_POLICY.label);
    expect(contract.routing_policy.parent_local_phases).toEqual([
      ...MODEL_POLICY.parentLocalPhases,
    ]);
    expect(contract.routing_policy.source).toEqual({
      document: MODEL_POLICY_SOURCE.document,
      updated: MODEL_POLICY_SOURCE.updated,
      digest: MODEL_POLICY_SOURCE.digest,
    });
    expect(MODEL_POLICY.parentDefaults.pi).toEqual({
      provider: "openai-codex",
      model: "gpt-5.6-sol",
      effort: "high",
    });
    for (const stack of CANDIDATE_STACKS) {
      if (!stack.automaticFallback) continue;
      for (const rung of stackRungs(stack)) {
        expect(MODEL_POLICY.excludedModels).not.toContain(rung.stableId);
        expect(MODEL_POLICY.excludedEfforts).not.toContain(rung.effort);
      }
    }
  });

  test("the synchronized Markdown copy re-derives the generated copy without arc-pi", () => {
    const documentPath = resolve(projectRoot, RUNNER_POLICY_DOCUMENT_PATH);
    expect(existsSync(documentPath)).toBe(true);
    const markdown = readFileSync(documentPath, "utf8");
    expect(markdown.startsWith("<!-- SYNCED FILE — do not edit.")).toBe(true);
    const policy = parsePolicyDocument(markdown);
    expect(policyDigest(policy)).toBe(MODEL_POLICY_SOURCE.digest);
    expect(policy).toEqual(MODEL_POLICY);
    const parserSource = readFileSync(
      resolve(projectRoot, "scripts/model-policy.mjs"),
      "utf8",
    );
    expect(parserSource.startsWith("// SYNCED FILE — do not edit.")).toBe(true);

    const result = checkRunnerModelPolicy(projectRoot);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.digest).toBe(MODEL_POLICY_SOURCE.digest);
    expect(result.label).toBe(MODEL_POLICY.label);
  });

  test("the standalone check rejects stale, hand-edited, or missing copies", () => {
    const scaffold = () => {
      const root = mkdtempSync(resolve(tmpdir(), "runner-policy-"));
      for (const relative of [
        RUNNER_POLICY_DOCUMENT_PATH,
        RUNNER_POLICY_MODULE_PATH,
      ]) {
        mkdirSync(dirname(resolve(root, relative)), { recursive: true });
        cpSync(resolve(projectRoot, relative), resolve(root, relative));
      }
      return root;
    };
    const modulePath = (root: string) => resolve(root, RUNNER_POLICY_MODULE_PATH);
    const documentPath = (root: string) =>
      resolve(root, RUNNER_POLICY_DOCUMENT_PATH);

    const clean = scaffold();
    expect(checkRunnerModelPolicy(clean).ok).toBe(true);

    const stale = scaffold();
    writeFileSync(
      modulePath(stale),
      readFileSync(modulePath(stale), "utf8").replace(
        /"digest": "[0-9a-f]+"/,
        '"digest": "0000"',
      ),
    );
    const staleResult = checkRunnerModelPolicy(stale);
    expect(staleResult.ok).toBe(false);
    expect(staleResult.problems[0]).toMatch(/is stale: embedded digest 0000/);

    const edited = scaffold();
    writeFileSync(
      modulePath(edited),
      readFileSync(modulePath(edited), "utf8").replace(
        '"opus-5@high"',
        '"opus-5@low"',
      ),
    );
    const editedResult = checkRunnerModelPolicy(edited);
    expect(editedResult.ok).toBe(false);
    expect(editedResult.problems[0]).toMatch(/edited by hand/);

    const divergedDoc = scaffold();
    writeFileSync(
      documentPath(divergedDoc),
      readFileSync(documentPath(divergedDoc), "utf8").replace(
        "workload hard-light: gpt-5.6-sol@high, cursor-grok-4.6-high@high",
        "workload hard-light: cursor-grok-4.6-high@high, gpt-5.6-sol@high",
      ),
    );
    const divergedResult = checkRunnerModelPolicy(divergedDoc);
    expect(divergedResult.ok).toBe(false);
    expect(divergedResult.problems[0]).toMatch(/is stale: embedded digest/);

    const malformed = scaffold();
    writeFileSync(
      documentPath(malformed),
      readFileSync(documentPath(malformed), "utf8").replace(
        "fallback: availability-only",
        "fallback: silent",
      ),
    );
    expect(checkRunnerModelPolicy(malformed).problems[0]).toMatch(
      /fallback must be availability-only/,
    );

    const missing = mkdtempSync(resolve(tmpdir(), "runner-policy-missing-"));
    expect(checkRunnerModelPolicy(missing).problems).toEqual([
      `${RUNNER_POLICY_DOCUMENT_PATH} is missing`,
    ]);
  });

  test("shipped registry entries match the policy bindings and surfaces", () => {
    expect(registryPolicyDivergences()).toEqual([]);
    for (const binding of MODEL_POLICY.routeBindings) {
      const entry = MODEL_REGISTRY.find(
        (candidate) => candidate.stableId === binding.stableId,
      )!;
      expect(entry.providerModelId).toBe(binding.providerModelId);
      expect(entry.transportBackend).toBe(binding.backend);
      expect(entry.fixedEffort ?? null).toBe(
        MODEL_POLICY.surfaces[binding.stableId].fixedEffort,
      );
    }
    expect(Object.keys(MODEL_POLICY.surfaces).sort()).toEqual(
      [...new Set(MODEL_POLICY.routeBindings.map((b) => b.stableId))].sort(),
    );
    expect(MODEL_POLICY.surfaces["cursor-grok-4.6-high"].fixedEffort).toBe("high");
    expect(MODEL_POLICY.surfaces["cursor-kimi-k3"].fixedEffort).toBe("high");
    expect(MODEL_POLICY.surfaces["gpt-5.6-luna"].fixedEffort).toBeNull();
    expect(MODEL_POLICY.surfaces["opencode-go-glm-5.3"].fixedEffort).toBeNull();

    const tamperedRegistry = MODEL_REGISTRY.map((entry) =>
      entry.stableId === "opus-4.8"
        ? { ...entry, providerModelId: "claude-opus-4-7" }
        : entry.stableId === "cursor-grok-4.6-high"
          ? { ...entry, fixedEffort: undefined }
          : entry,
    );
    const divergences = registryPolicyDivergences(tamperedRegistry);
    expect(divergences).toContain(
      "policy binding opus-4.8: registry providerModelId claude-opus-4-7 != policy claude-opus-4-8",
    );
    expect(divergences).toContain(
      "policy surface cursor-grok-4.6-high: registry fixedEffort null != policy high",
    );
    expect(divergences).toHaveLength(3);
  });

  test("surface names and fixed-effort rendering come from the policy", () => {
    expect(renderPolicyRung("cursor-grok-4.6-high@high")).toBe(
      "Cursor Grok 4.6 High",
    );
    expect(renderPolicyRung("gpt-5.6-luna@max")).toBe("Codex Luna (max)");
    expect(renderPolicyRung("composer-2.5@none")).toBe("Cursor Composer 2.5");
    expect(renderPolicyRung("opencode-go-glm-5.3-flash@none")).toBe(
      "OpenCode Go GLM 5.3 Flash",
    );
    expect(() => renderPolicyRung("sonnet-5@high")).toThrow(
      /no policy surface/,
    );
  });

  test("rendered surfaces carry the policy chains and source digest", () => {
    const section = renderArcDelegatePolicySection();
    expect(section).toContain(`(${MODEL_POLICY.label})`);
    expect(section).toContain(MODEL_POLICY_SOURCE.digest.slice(0, 12));
    expect(section).toContain(
      "| Hard–Heavy | CC Fable (high) → Codex Sol (high) → Cursor Grok 4.6 High → OpenCode Go GLM 5.3 |",
    );
    expect(section).toContain(
      "| Verify | Codex Luna (max) → Codex GPT-5.5 (low) → OpenCode Go DeepSeek V4 Pro → CC Opus 4.8 (low) → Cursor Grok 4.6 High |",
    );
    expect(section).toContain(
      "| Easy–Light | OpenCode Go GLM 5.3 Flash → Codex GPT-5.5 (low) → Cursor Grok 4.6 High |",
    );
    expect(section).toContain(
      "| Deploy | Codex GPT-5.5 (low) → CC Opus 4.8 (low) → Cursor Grok 4.6 High |",
    );
  });
});
