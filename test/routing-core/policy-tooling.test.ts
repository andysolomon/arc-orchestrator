// Policy validation, semantic diff, rendering, export, and the trace reader.
// These guard the control plane's editing surfaces: an invalid state must be
// reported (never silently accepted), a change must be described in routing
// terms, and an exported artifact must re-parse to the policy it came from.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MODEL_POLICY } from "../../plugins/arc-orchestrator/lib/model-policy";
import { MODEL_REGISTRY } from "../../plugins/arc-orchestrator/lib/model-registry";
import {
  clonePolicy,
  diffPolicies,
  exportPolicyBundle,
  exportPolicyPatch,
  parsePolicyBlock,
  parsePolicyDocument,
  parseTraceJsonl,
  readRoutingTrace,
  renderPolicyBlock,
  unifiedDiff,
  validateChain,
  validatePolicy,
  type RoutingPolicy,
} from "../../packages/routing-core/src/index";
import { policyDigest } from "../../packages/routing-core/src/runtime";

const policyDocument = readFileSync(resolve(import.meta.dir, "../../docs/arc-model-policy.md"), "utf8");
const base = (): RoutingPolicy => clonePolicy(MODEL_POLICY);
const errors = (policy: RoutingPolicy) => validatePolicy(policy, { registry: MODEL_REGISTRY }).filter((issue) => issue.severity === "error");

describe("validatePolicy", () => {
  test("reports an excluded model used in a chain, at the exact path", () => {
    const policy = base();
    (policy.workloadChains["easy-light"] as string[]).push("sonnet-5@high");
    const found = errors(policy);
    expect(found.map((issue) => issue.code)).toContain("excluded-model");
    expect(found.find((issue) => issue.code === "excluded-model")?.path).toBe("workloadChains.easy-light[3]");
  });

  test("reports an excluded effort, an unbound model, and a duplicate rung", () => {
    const policy = base();
    (policy.phaseChains.verify as string[]).push("gpt-5.5@xhigh", "no-such-model@high", "gpt-5.5@low");
    const codes = errors(policy).map((issue) => issue.code);
    expect(codes).toContain("excluded-effort");
    expect(codes).toContain("unbound-model");
    expect(codes).toContain("duplicate-rung");
    expect(codes).toContain("unknown-registry-model");
  });

  test("a rung that repeats a tail rung is a duplicate", () => {
    const policy = base();
    (policy.phaseChains.plan as string[]).push("minimax-m3@high");
    expect(errors(policy).some((issue) => issue.code === "duplicate-rung" && issue.message.includes("tail already carries"))).toBe(true);
  });

  test("fixed-effort profiles cannot be routed at another effort", () => {
    const policy = base();
    (policy.workloadChains["hard-light"] as string[])[1] = "cursor-grok-4.7-high@low";
    const found = errors(policy);
    expect(found.map((issue) => issue.code)).toContain("fixed-effort-mismatch");
    expect(found.map((issue) => issue.code)).toContain("effort-not-selectable");
  });

  test("an effort the transport cannot forward is not selectable", () => {
    const policy = base();
    (policy.phaseChains.explore as string[])[0] = "opencode-go-glm-5.3@high";
    expect(errors(policy).map((issue) => issue.code)).toContain("effort-not-selectable");
  });

  test("empty chains and an empty tail warn rather than error", () => {
    const policy = base();
    (policy as { emergencyTail: string[] }).emergencyTail = [];
    (policy.workloadChains["easy-light"] as string[]).length = 0;
    const issues = validatePolicy(policy);
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(issues.map((issue) => issue.code)).toContain("empty-tail");
    expect(issues.map((issue) => issue.code)).toContain("empty-chain");
  });

  test("workload chains must be in canonical order and complete", () => {
    const policy = base();
    const chains = policy.workloadChains as Record<string, readonly string[]>;
    const reordered: Record<string, readonly string[]> = {};
    for (const key of Object.keys(chains).reverse()) reordered[key] = chains[key]!;
    (policy as { workloadChains: unknown }).workloadChains = reordered;
    expect(errors(policy).map((issue) => issue.code)).toContain("workload-order");
    delete reordered["easy-light"];
    expect(errors(policy).map((issue) => issue.code)).toContain("missing-field");
  });

  test("registry parity: a binding whose provider id or backend disagrees with the registry is an error", () => {
    const policy = base();
    const binding = policy.routeBindings.find((entry) => entry.base === "sol")! as { providerModelId: string; backend: string };
    binding.providerModelId = "gpt-6-sol-preview";
    binding.backend = "claude";
    expect(errors(policy).filter((issue) => issue.code === "registry-binding-mismatch")).toHaveLength(2);
  });

  test("validateChain reports per-row issues for live editing", () => {
    const policy = base();
    (policy.workloadChains["medium-light"] as string[]).unshift("haiku-4.5@low");
    const issues = validateChain(policy, { kind: "workload", key: "medium-light" }, { registry: MODEL_REGISTRY });
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["excluded-model", "unbound-model"]));
    expect(issues.every((issue) => issue.path.startsWith("workloadChains.medium-light"))).toBe(true);
  });
});

describe("diffPolicies", () => {
  test("describes lead changes, added/removed rungs, effort changes, exclusions, and parent defaults", () => {
    const candidate = base();
    (candidate.workloadChains["hard-medium"] as string[])[0] = "opus-5.5@high";
    (candidate.phaseChains.verify as string[]).push("opencode-go-deepseek-v4-flash@none");
    (candidate.workloadChains["easy-light"] as string[]).splice(1, 1);
    (candidate.workloadChains["medium-medium"] as string[])[0] = "opus-5.5@low";
    (candidate as { excludedEfforts: string[] }).excludedEfforts = ["xhigh", "max"];
    (candidate.parentDefaults as Record<string, { provider: string; model: string; effort: string }>).pi = { provider: "anthropic", model: "claude-opus-5-5", effort: "high" };
    const diff = diffPolicies(MODEL_POLICY, candidate);
    const summaries = diff.changes.map((change) => change.summary);
    expect(summaries).toContain("workload hard-medium: lead changed gpt-6-sol@high → opus-5.5@high");
    expect(summaries).toContain("phase verify: added opencode-go-deepseek-v4-flash@none");
    expect(summaries).toContain("workload easy-light: removed gpt-5.5@low");
    expect(summaries).toContain("workload medium-medium: opus-5.5 effort high → low");
    expect(summaries).toContain("global: exclude-efforts now excludes max");
    expect(summaries).toContain("parent pi: openai-codex/gpt-6-sol@high → anthropic/claude-opus-5-5@high");
    expect(diff.identical).toBe(false);
    expect(diff.changedScopes).toEqual(expect.arrayContaining(["workload:hard-medium", "phase:verify", "exclusions", "parent:pi"]));
  });

  test("a reorder without membership change is reported as a reorder", () => {
    const candidate = base();
    const chain = candidate.workloadChains["easy-light"] as string[];
    [chain[1], chain[2]] = [chain[2]!, chain[1]!];
    const diff = diffPolicies(MODEL_POLICY, candidate);
    expect(diff.changes.map((change) => change.kind)).toEqual(["rung-reordered"]);
  });

  test("identical policies diff to nothing", () => {
    expect(diffPolicies(MODEL_POLICY, base()).identical).toBe(true);
  });
});

describe("render and export", () => {
  test("an edited policy renders, re-parses, and digests deterministically", () => {
    const candidate = base();
    (candidate.workloadChains["hard-medium"] as string[])[0] = "opus-5.5@high";
    const block = renderPolicyBlock(candidate);
    const reparsed = parsePolicyBlock(block);
    expect(reparsed).toEqual(JSON.parse(JSON.stringify(candidate)));
    expect(policyDigest(reparsed)).toBe(policyDigest(candidate));
    expect(policyDigest(reparsed)).not.toBe(policyDigest(MODEL_POLICY));
  });

  test("the patch replaces only the fenced block and applies to the document", () => {
    const candidate = base();
    (candidate.workloadChains["easy-light"] as string[]).push("opus-5.5@low");
    const patch = exportPolicyPatch(policyDocument, candidate)!;
    expect(patch.startsWith("--- a/policy/arc-model-policy.md\n+++ b/policy/arc-model-policy.md\n")).toBe(true);
    expect(patch).toContain("+workload easy-light: opencode-go-glm-5.3-flash@none, gpt-5.5@low, cursor-grok-4.7-high@high, opus-5.5@low");
    // Prose outside the fence is untouched: no hunk touches the heading.
    expect(patch).not.toContain("-# ARC model policy");
    // Comments inside the fence are dropped by the canonical renderer, so the
    // patched document must still parse to the candidate.
    const bundle = exportPolicyBundle({ current: MODEL_POLICY, candidate, digest: policyDigest(candidate), currentDocument: policyDocument, registry: MODEL_REGISTRY });
    expect(bundle.valid).toBe(true);
    expect(JSON.parse(bundle.json).policy).toEqual(JSON.parse(JSON.stringify(candidate)));
    expect(bundle.markdown).toContain("workload easy-light: added opus-5.5@low");
    const lines = policyDocument.split("\n");
    const open = lines.findIndex((line) => line.trim() === "```arc-model-policy");
    const close = lines.findIndex((line, index) => index > open && line.trim() === "```");
    const patched = [...lines.slice(0, open + 1), bundle.block, ...lines.slice(close)].join("\n");
    expect(parsePolicyDocument(patched)).toEqual(JSON.parse(JSON.stringify(candidate)));
  });

  test("an invalid candidate exports with issues and valid=false", () => {
    const candidate = base();
    (candidate.workloadChains["easy-light"] as string[]).push("haiku-4.5@low");
    const bundle = exportPolicyBundle({ current: MODEL_POLICY, candidate, digest: "x", registry: MODEL_REGISTRY });
    expect(bundle.valid).toBe(false);
    expect(bundle.issues.some((issue) => issue.code === "excluded-model")).toBe(true);
  });

  test("unifiedDiff produces hunks with correct line numbers", () => {
    const patch = unifiedDiff("a\nb\nc\nd\ne\nf\ng\nh", "a\nb\nc\nX\ne\nf\ng\nh", { oldPath: "a/x", newPath: "b/x" });
    expect(patch).toBe("--- a/x\n+++ b/x\n@@ -1,7 +1,7 @@\n a\n b\n c\n-d\n+X\n e\n f\n g\n");
    expect(unifiedDiff("same", "same", { oldPath: "a", newPath: "b" })).toBe("");
  });
});

describe("trace reader", () => {
  const fixture = readFileSync(resolve(import.meta.dir, "../fixtures/trace-v2/routing-trace-v2.json"), "utf8");

  test("reads a v2 record, a legacy record, and rejects garbage", () => {
    const v2 = readRoutingTrace(JSON.parse(fixture));
    expect(v2.kind).toBe("v2");
    const legacy = readRoutingTrace(JSON.parse(fixture).legacy);
    expect(legacy.kind).toBe("legacy");
    expect(readRoutingTrace({ hello: "world" }).kind).toBe("invalid");
    expect(readRoutingTrace({ ...JSON.parse(fixture), schema: 99 }).kind).toBe("invalid");
  });

  test("parses JSONL and a runs --json array, keeping invalid lines out of band", () => {
    const parsed = parseTraceJsonl([fixture.replace(/\n/g, ""), "not json", JSON.stringify([JSON.parse(fixture).legacy])].join("\n"));
    expect(parsed.records).toHaveLength(2);
    expect(parsed.invalid).toEqual([{ line: 2, error: expect.stringContaining("invalid JSON") }]);
  });

  test("records without the workload_profile block still read (version compatibility)", () => {
    const v2 = readRoutingTrace(JSON.parse(fixture));
    expect(v2.kind === "v2" && "workload_profile" in v2.record).toBe(false);
  });
});
