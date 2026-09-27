// Export a candidate policy as artifacts a human can review and apply:
// canonical JSON, the fenced `arc-model-policy` block, a Markdown summary of
// the semantic changes, and a unified patch against the current policy
// document. Nothing here writes files or touches a repository.

import { diffPolicies, groupChangesByScope, type PolicyDiff } from "./diff-policy";
import { extractPolicyBlock, POLICY_DOCUMENT } from "./parse-policy";
import {
  ROUTING_POLICY_CONTRACT,
  ROUTING_POLICY_SCHEMA_VERSION,
  canonicalPolicyJson,
  type RoutingPolicy,
  type RoutingPolicyDocument,
} from "./policy-schema";
import { renderFencedPolicyBlock, renderPolicyBlock } from "./render-policy";
import { policyHasErrors, validatePolicy, type PolicyIssue, type ValidatePolicyOptions } from "./validate-policy";
import { WORKER_PHASES, WORKLOAD_CLASSES } from "./vocabulary";

export type PolicyExportBundle = {
  json: string;
  block: string;
  fencedBlock: string;
  markdown: string;
  patch: string | null;
  issues: PolicyIssue[];
  valid: boolean;
};

/** Canonical JSON document. The digest must be computed by the caller over `canonicalPolicyJson(policy)`. */
export function policyDocumentFor(
  policy: RoutingPolicy,
  digest: string,
  document = POLICY_DOCUMENT,
): RoutingPolicyDocument {
  return {
    contract: ROUTING_POLICY_CONTRACT,
    schemaVersion: ROUTING_POLICY_SCHEMA_VERSION,
    source: { document, updated: policy.updated, digest },
    policy,
  };
}

export function exportPolicyJson(policy: RoutingPolicy, digest: string, document = POLICY_DOCUMENT): string {
  return `${JSON.stringify(policyDocumentFor(policy, digest, document), null, 2)}\n`;
}

export function exportPolicyMarkdown(
  current: RoutingPolicy,
  candidate: RoutingPolicy,
  options: { title?: string; digest?: string | null } = {},
): string {
  const diff = diffPolicies(current, candidate);
  const lines: string[] = [];
  lines.push(`# ${options.title ?? `Routing policy change: ${candidate.label} (${candidate.updated})`}`);
  lines.push("");
  lines.push(`Base: ${current.label} updated ${current.updated}. Candidate: ${candidate.label} updated ${candidate.updated}${options.digest ? `, digest \`${options.digest.slice(0, 12)}\`` : ""}.`);
  lines.push("");
  lines.push("## Semantic changes");
  lines.push("");
  if (diff.identical) {
    lines.push("No routing changes: the candidate policy is identical to the base.");
  } else {
    for (const group of groupChangesByScope(diff)) {
      lines.push(`### ${group.scope}`);
      lines.push("");
      for (const change of group.changes) {
        lines.push(`- ${change.summary}`);
      }
      lines.push("");
    }
  }
  lines.push("## Candidate chains");
  lines.push("");
  lines.push("| Chain | Ordered rungs |");
  lines.push("| --- | --- |");
  lines.push(`| tail | ${candidate.emergencyTail.join(" → ")} |`);
  for (const phase of WORKER_PHASES) {
    lines.push(`| phase ${phase} | ${candidate.phaseChains[phase].join(" → ")} |`);
  }
  for (const klass of WORKLOAD_CLASSES) {
    lines.push(`| workload ${klass} | ${candidate.workloadChains[klass].join(" → ")} |`);
  }
  lines.push("");
  lines.push("## Apply");
  lines.push("");
  lines.push("1. Replace the fenced `arc-model-policy` block in arc-pi `policy/arc-model-policy.md` with the exported block.");
  lines.push("2. Run `npm run policy:sync` in arc-pi, then `bun run generate:surfaces` and `bun run routing-core:export` in arc-orchestrator.");
  lines.push("3. Re-sync arc-router (`npm run sync:routing-core`) and commit all repositories together.");
  lines.push("");
  lines.push("Estimated cost and capability-band figures in this change are routing evidence, not evaluation results.");
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Minimal unified diff (line-based LCS). Enough for a policy block; no external
// dependency so the control plane stays small.
// ---------------------------------------------------------------------------

type DiffOp = { kind: "same" | "add" | "del"; line: string };

function lcsDiff(a: readonly string[], b: readonly string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "same", line: a[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      ops.push({ kind: "del", line: a[i]! });
      i += 1;
    } else {
      ops.push({ kind: "add", line: b[j]! });
      j += 1;
    }
  }
  while (i < n) ops.push({ kind: "del", line: a[i++]! });
  while (j < m) ops.push({ kind: "add", line: b[j++]! });
  return ops;
}

export function unifiedDiff(
  before: string,
  after: string,
  paths: { oldPath: string; newPath: string },
  contextLines = 3,
): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const ops = lcsDiff(a, b);
  if (ops.every((op) => op.kind === "same")) {
    return "";
  }
  const out: string[] = [`--- ${paths.oldPath}`, `+++ ${paths.newPath}`];
  // Collect hunks: ranges of ops with changes, padded by context.
  let index = 0;
  let oldLine = 1;
  let newLine = 1;
  while (index < ops.length) {
    if (ops[index]!.kind === "same") {
      index += 1;
      oldLine += 1;
      newLine += 1;
      continue;
    }
    const start = Math.max(0, index - contextLines);
    let end = index;
    let trailing = 0;
    while (end < ops.length && (ops[end]!.kind !== "same" || trailing < contextLines)) {
      trailing = ops[end]!.kind === "same" ? trailing + 1 : 0;
      end += 1;
    }
    // Rewind counters to hunk start.
    let hunkOld = oldLine;
    let hunkNew = newLine;
    for (let k = index - 1; k >= start; k -= 1) {
      hunkOld -= 1;
      hunkNew -= 1;
    }
    const body: string[] = [];
    let oldCount = 0;
    let newCount = 0;
    for (let k = start; k < end; k += 1) {
      const op = ops[k]!;
      if (op.kind === "same") {
        body.push(` ${op.line}`);
        oldCount += 1;
        newCount += 1;
      } else if (op.kind === "del") {
        body.push(`-${op.line}`);
        oldCount += 1;
      } else {
        body.push(`+${op.line}`);
        newCount += 1;
      }
    }
    out.push(`@@ -${hunkOld},${oldCount} +${hunkNew},${newCount} @@`);
    out.push(...body);
    for (let k = index; k < end; k += 1) {
      const op = ops[k]!;
      if (op.kind !== "add") oldLine += 1;
      if (op.kind !== "del") newLine += 1;
    }
    index = end;
  }
  return `${out.join("\n")}\n`;
}

/**
 * A patch that replaces the fenced block inside the current policy document
 * with the candidate's rendered block, leaving prose and comments outside the
 * fence untouched. Returns null when the document has no single block.
 */
export function exportPolicyPatch(
  currentDocument: string,
  candidate: RoutingPolicy,
  documentPath = POLICY_DOCUMENT,
): string | null {
  let block;
  try {
    block = extractPolicyBlock(currentDocument);
  } catch {
    return null;
  }
  const lines = currentDocument.split(/\r?\n/);
  const nextLines = [
    ...lines.slice(0, block.fenceOpenIndex + 1),
    renderPolicyBlock(candidate),
    ...lines.slice(block.fenceCloseIndex),
  ];
  return unifiedDiff(currentDocument, nextLines.join("\n"), {
    oldPath: `a/${documentPath}`,
    newPath: `b/${documentPath}`,
  });
}

export function exportPolicyBundle(input: {
  current: RoutingPolicy;
  candidate: RoutingPolicy;
  digest: string;
  currentDocument?: string | null;
  registry?: ValidatePolicyOptions["registry"];
  documentPath?: string;
}): PolicyExportBundle {
  const issues = validatePolicy(input.candidate, { registry: input.registry ?? null });
  return {
    json: exportPolicyJson(input.candidate, input.digest, input.documentPath),
    block: renderPolicyBlock(input.candidate),
    fencedBlock: renderFencedPolicyBlock(input.candidate),
    markdown: exportPolicyMarkdown(input.current, input.candidate, { digest: input.digest }),
    patch: input.currentDocument ? exportPolicyPatch(input.currentDocument, input.candidate, input.documentPath) : null,
    issues,
    valid: !policyHasErrors(issues),
  };
}

export type { PolicyDiff };
export { canonicalPolicyJson };
