import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  cpSync,
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
  ROUTING_POLICY_LABEL,
  WORKLOAD_CLASSES,
} from "../plugins/arc-orchestrator/lib/routes";
import { RUNNER_ROUTING_V4_POLICY } from "../plugins/arc-orchestrator/lib/routing-intent";
import { PUBLIC_ROUTE_SUFFIXES } from "../plugins/arc-orchestrator/lib/trace-schema";
import { renderArcDelegatePolicySection } from "../plugins/orchestrator-core/routing-policy";

const projectRoot = resolve(import.meta.dir, "..");
const digestOf = (policy: unknown) =>
  createHash("sha256").update(JSON.stringify(policy)).digest("hex");
const rungIds = (stack: NonNullable<ReturnType<typeof candidateStackForRoute>>) =>
  stackRungs(stack).map((rung) => `${rung.stableId}@${rung.effort}`);

describe("model policy synchronization (runner copy)", () => {
  test("a hand-edited or partially regenerated copy is rejected", () => {
    const tampered = {
      ...MODEL_POLICY,
      workloadChains: {
        ...MODEL_POLICY.workloadChains,
        "hard-heavy": ["gpt-6-sol@high"],
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
  });

  test("every public binding alias pins exactly its policy model", () => {
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

  test("workload chains equal policy chains plus the policy tail", () => {
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
  });

  test("policy label matches the accepted CLI marker and Analyze has no worker stack", () => {
    expect(ROUTING_POLICY_LABEL).toBe(RUNNER_ROUTING_V4_POLICY);
    expect(
      candidateStackForRoute("explore.read-only.v1", null, null, "analyze"),
    ).toBeNull();
  });

  test("the synchronized Markdown copy re-derives the generated copy without arc-pi", () => {
    const documentPath = resolve(projectRoot, RUNNER_POLICY_DOCUMENT_PATH);
    const markdown = readFileSync(documentPath, "utf8");
    const policy = parsePolicyDocument(markdown);
    expect(policyDigest(policy)).toBe(MODEL_POLICY_SOURCE.digest);
    expect(policy).toEqual(MODEL_POLICY);

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
        '"opus-5.5@high"',
        '"opus-5.5@low"',
      ),
    );
    const editedResult = checkRunnerModelPolicy(edited);
    expect(editedResult.ok).toBe(false);
    expect(editedResult.problems[0]).toMatch(/edited by hand/);

    const divergedDoc = scaffold();
    writeFileSync(
      documentPath(divergedDoc),
      readFileSync(documentPath(divergedDoc), "utf8").replace(
        "workload hard-light: gpt-6-sol@high, cursor-grok-4.7-high@high",
        "workload hard-light: cursor-grok-4.7-high@high, gpt-6-sol@high",
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

  test("the registry/policy divergence check reports tampered registry entries", () => {
    expect(registryPolicyDivergences()).toEqual([]);

    const tamperedRegistry = MODEL_REGISTRY.map((entry) =>
      entry.stableId === "opus-4.8"
        ? { ...entry, providerModelId: "claude-opus-4-7" }
        : entry.stableId === "cursor-grok-4.7-high"
          ? { ...entry, fixedEffort: undefined }
          : entry,
    );
    const divergences = registryPolicyDivergences(tamperedRegistry);
    expect(divergences).toContain(
      "policy binding opus-4.8: registry providerModelId claude-opus-4-7 != policy claude-opus-4-8",
    );
    expect(divergences).toContain(
      "policy surface cursor-grok-4.7-high: registry fixedEffort null != policy high",
    );
    expect(divergences).toHaveLength(3);
  });

  test("rendered surfaces carry the policy chains and source digest", () => {
    const section = renderArcDelegatePolicySection();
    expect(section).toContain(`(${MODEL_POLICY.label})`);
    expect(section).toContain(MODEL_POLICY_SOURCE.digest.slice(0, 12));
    expect(section).toContain(
      "| Hard–Heavy | CC Fable (high) → Codex Sol (high) → Cursor Grok 4.7 High → OpenCode Go GLM 5.3 |",
    );
    expect(section).toContain(
      "| Verify | Codex Luna (max) → Codex GPT-5.5 (low) → OpenCode Go DeepSeek V4 Pro → CC Opus 4.8 (low) → Cursor Grok 4.7 High |",
    );
    expect(section).toContain(
      "| Easy–Light | OpenCode Go GLM 5.3 Flash → Codex GPT-5.5 (low) → Cursor Grok 4.7 High |",
    );
    expect(section).toContain(
      "| Deploy | Codex GPT-5.5 (low) → CC Opus 4.8 (low) → Cursor Grok 4.7 High |",
    );
  });
});
