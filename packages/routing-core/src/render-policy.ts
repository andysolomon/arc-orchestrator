// Render a policy object back to the fenced `arc-model-policy` grammar. The
// output is comment-free and canonical (one directive per line in grammar
// order) and round-trips through `parsePolicyBlock` to an equal object; the
// control plane exports edited policies through this renderer.

import type { RoutingPolicy } from "./policy-schema";
import { POLICY_FENCE } from "./parse-policy";
import { WORKER_PHASES, WORKLOAD_CLASSES } from "./vocabulary";

export const POLICY_FOLD_MARKER = "§FOLD" as const;

export type RenderPolicyOptions = {
  // Replace the binding and surface lines with a single fold marker so a diff
  // view can collapse them. Off by default: the rendered block must parse.
  foldBindings?: boolean;
};

/** Header lines that precede the bindings. */
export function renderPolicyHeaderLines(policy: RoutingPolicy): string[] {
  const lines = [
    `policy: ${policy.label}`,
    `updated: ${policy.updated}`,
    ...(policy.supersedes ? [`supersedes: ${policy.supersedes}`] : []),
    `fallback: ${policy.fallback}`,
    `parent-local: ${policy.parentLocalPhases.join(", ")}`,
  ];
  for (const [surface, parent] of Object.entries(policy.parentDefaults)) {
    lines.push(
      `parent-default ${surface}: ${parent.provider}/${parent.model}@${parent.effort}`,
    );
  }
  return lines;
}

export function renderBindingLines(policy: RoutingPolicy): string[] {
  const lines: string[] = [];
  for (const binding of policy.routeBindings) {
    const columns = [
      binding.displayName,
      binding.stableId,
      binding.providerModelId,
      binding.backend,
      ...(binding.defaultEffort ? [binding.defaultEffort] : []),
    ];
    lines.push(`binding ${binding.base}: ${columns.join(" | ")}`);
  }
  for (const [stableId, surface] of Object.entries(policy.surfaces)) {
    lines.push(
      `surface ${stableId}: ${surface.name}${surface.fixedEffort ? ` | fixed-effort ${surface.fixedEffort}` : ""}`,
    );
  }
  return lines;
}

export function renderChainLines(policy: RoutingPolicy): string[] {
  const lines = [`tail: ${policy.emergencyTail.join(", ")}`];
  for (const phase of WORKER_PHASES) {
    lines.push(`phase ${phase}: ${policy.phaseChains[phase].join(", ")}`);
  }
  for (const workloadClass of WORKLOAD_CLASSES) {
    lines.push(
      `workload ${workloadClass}: ${policy.workloadChains[workloadClass].join(", ")}`,
    );
  }
  if (policy.excludedModels.length > 0) {
    lines.push(`exclude-models: ${policy.excludedModels.join(", ")}`);
  }
  if (policy.excludedEfforts.length > 0) {
    lines.push(`exclude-efforts: ${policy.excludedEfforts.join(", ")}`);
  }
  return lines;
}

export function renderPolicyLines(
  policy: RoutingPolicy,
  options: RenderPolicyOptions = {},
): string[] {
  return [
    ...renderPolicyHeaderLines(policy),
    ...(options.foldBindings ? [POLICY_FOLD_MARKER] : renderBindingLines(policy)),
    ...renderChainLines(policy),
  ];
}

/** The block body (no fence), suitable for `parsePolicyBlock`. */
export function renderPolicyBlock(policy: RoutingPolicy): string {
  return renderPolicyLines(policy).join("\n");
}

/** The fenced block as it appears in the policy document. */
export function renderFencedPolicyBlock(policy: RoutingPolicy): string {
  return ["```" + POLICY_FENCE, renderPolicyBlock(policy), "```"].join("\n");
}
