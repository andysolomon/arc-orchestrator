// Semantic policy diff: what changed for routing, not which JSON lines moved.
// Each change names a scope (a chain, the tail, a binding, the parent defaults,
// exclusions, or the policy metadata) and a kind a reader can act on.

import { parseRungId } from "./model-schema";
import type { RoutingPolicy, RouteBinding, RungId } from "./policy-schema";
import { allChainRefs, chainLabel, chainOf, chainPath, type ChainRef } from "./validate-policy";

export type PolicyChangeKind =
  | "lead-changed"
  | "rung-added"
  | "rung-removed"
  | "rung-reordered"
  | "effort-changed"
  | "exclusion-added"
  | "exclusion-removed"
  | "parent-default-changed"
  | "binding-added"
  | "binding-removed"
  | "binding-changed"
  | "surface-changed"
  | "metadata-changed";

export type PolicyChange = {
  kind: PolicyChangeKind;
  // "workload:hard-medium", "phase:verify", "tail", "binding:sol",
  // "parent:pi", "exclusions", "global".
  scope: string;
  path: string;
  summary: string;
  before: string | null;
  after: string | null;
};

export type PolicyDiff = {
  changes: PolicyChange[];
  changedScopes: string[];
  identical: boolean;
};

function scopeOf(ref: ChainRef): string {
  if (ref.kind === "tail") return "tail";
  return `${ref.kind}:${ref.key}`;
}

function describeRung(rung: RungId): string {
  return rung;
}

function diffChain(
  current: readonly RungId[],
  candidate: readonly RungId[],
  ref: ChainRef,
): PolicyChange[] {
  const changes: PolicyChange[] = [];
  const scope = scopeOf(ref);
  const path = chainPath(ref);
  const label = chainLabel(ref);
  if (current.join(",") === candidate.join(",")) {
    return changes;
  }
  const currentLead = current[0] ?? null;
  const candidateLead = candidate[0] ?? null;
  if (currentLead !== candidateLead) {
    changes.push({
      kind: "lead-changed",
      scope,
      path: `${path}[0]`,
      summary: `${label}: lead changed ${currentLead ?? "(none)"} → ${candidateLead ?? "(none)"}`,
      before: currentLead,
      after: candidateLead,
    });
  }

  // Compare by stable id first so an effort change on the same model reads as
  // an effort change rather than as an unrelated remove+add.
  const byModel = (chain: readonly RungId[]) => {
    const map = new Map<string, RungId[]>();
    for (const rung of chain) {
      const parsed = parseRungId(rung);
      const key = parsed?.stableId ?? rung;
      map.set(key, [...(map.get(key) ?? []), rung]);
    }
    return map;
  };
  const currentByModel = byModel(current);
  const candidateByModel = byModel(candidate);
  const currentSet = new Set(current);
  const candidateSet = new Set(candidate);

  for (const rung of current) {
    if (candidateSet.has(rung)) continue;
    const parsed = parseRungId(rung);
    const model = parsed?.stableId ?? rung;
    const replacement = (candidateByModel.get(model) ?? []).find((other) => !currentSet.has(other));
    if (replacement) {
      changes.push({
        kind: "effort-changed",
        scope,
        path,
        summary: `${label}: ${model} effort ${parsed?.effort ?? "?"} → ${parseRungId(replacement)?.effort ?? "?"}`,
        before: rung,
        after: replacement,
      });
      candidateSet.delete(replacement);
      continue;
    }
    changes.push({
      kind: "rung-removed",
      scope,
      path,
      summary: `${label}: removed ${describeRung(rung)}`,
      before: rung,
      after: null,
    });
  }
  for (const rung of candidate) {
    if (currentSet.has(rung) || !candidateSet.has(rung)) continue;
    const parsed = parseRungId(rung);
    const model = parsed?.stableId ?? rung;
    if ((currentByModel.get(model) ?? []).some((other) => !candidateSet.has(other) && changes.some((change) => change.kind === "effort-changed" && change.after === rung))) {
      continue;
    }
    changes.push({
      kind: "rung-added",
      scope,
      path,
      summary: `${label}: added ${describeRung(rung)}`,
      before: null,
      after: rung,
    });
  }

  // Order change among rungs present in both.
  const shared = current.filter((rung) => candidate.includes(rung));
  const sharedInCandidate = candidate.filter((rung) => current.includes(rung));
  if (
    shared.join(",") !== sharedInCandidate.join(",") &&
    !(changes.length === 1 && changes[0]!.kind === "lead-changed")
  ) {
    changes.push({
      kind: "rung-reordered",
      scope,
      path,
      summary: `${label}: reordered ${shared.join(" → ")} → ${sharedInCandidate.join(" → ")}`,
      before: shared.join(", "),
      after: sharedInCandidate.join(", "),
    });
  }
  return changes;
}

function bindingSignature(binding: RouteBinding): string {
  return [binding.displayName, binding.stableId, binding.providerModelId, binding.backend, binding.defaultEffort ?? ""].join("|");
}

export function diffPolicies(current: RoutingPolicy, candidate: RoutingPolicy): PolicyDiff {
  const changes: PolicyChange[] = [];

  for (const key of ["label", "updated", "supersedes", "fallback"] as const) {
    const before = current[key] ?? null;
    const after = candidate[key] ?? null;
    if (before !== after) {
      changes.push({
        kind: "metadata-changed",
        scope: "global",
        path: key,
        summary: `global: ${key} ${String(before)} → ${String(after)}`,
        before: before == null ? null : String(before),
        after: after == null ? null : String(after),
      });
    }
  }
  if (current.parentLocalPhases.join(",") !== candidate.parentLocalPhases.join(",")) {
    changes.push({
      kind: "metadata-changed",
      scope: "global",
      path: "parentLocalPhases",
      summary: `global: parent-local ${current.parentLocalPhases.join(", ")} → ${candidate.parentLocalPhases.join(", ")}`,
      before: current.parentLocalPhases.join(", "),
      after: candidate.parentLocalPhases.join(", "),
    });
  }

  const parentSurfaces = new Set([
    ...Object.keys(current.parentDefaults),
    ...Object.keys(candidate.parentDefaults),
  ]);
  for (const surface of parentSurfaces) {
    const before = current.parentDefaults[surface];
    const after = candidate.parentDefaults[surface];
    const fmt = (parent: typeof before) => (parent ? `${parent.provider}/${parent.model}@${parent.effort}` : null);
    if (fmt(before) !== fmt(after)) {
      changes.push({
        kind: "parent-default-changed",
        scope: `parent:${surface}`,
        path: `parentDefaults.${surface}`,
        summary: `parent ${surface}: ${fmt(before) ?? "(none)"} → ${fmt(after) ?? "(none)"}`,
        before: fmt(before),
        after: fmt(after),
      });
    }
  }

  const currentBindings = new Map(current.routeBindings.map((binding) => [binding.base, binding] as const));
  const candidateBindings = new Map(candidate.routeBindings.map((binding) => [binding.base, binding] as const));
  for (const [base, binding] of currentBindings) {
    const other = candidateBindings.get(base);
    if (!other) {
      changes.push({ kind: "binding-removed", scope: `binding:${base}`, path: `routeBindings.${base}`, summary: `binding ${base}: removed (${binding.stableId})`, before: bindingSignature(binding), after: null });
    } else if (bindingSignature(binding) !== bindingSignature(other)) {
      changes.push({ kind: "binding-changed", scope: `binding:${base}`, path: `routeBindings.${base}`, summary: `binding ${base}: ${bindingSignature(binding)} → ${bindingSignature(other)}`, before: bindingSignature(binding), after: bindingSignature(other) });
    }
  }
  for (const [base, binding] of candidateBindings) {
    if (!currentBindings.has(base)) {
      changes.push({ kind: "binding-added", scope: `binding:${base}`, path: `routeBindings.${base}`, summary: `binding ${base}: added (${binding.stableId} on ${binding.backend})`, before: null, after: bindingSignature(binding) });
    }
  }
  const surfaceIds = new Set([...Object.keys(current.surfaces), ...Object.keys(candidate.surfaces)]);
  for (const stableId of surfaceIds) {
    const before = current.surfaces[stableId];
    const after = candidate.surfaces[stableId];
    const fmt = (surface: typeof before) => (surface ? `${surface.name}${surface.fixedEffort ? ` (fixed ${surface.fixedEffort})` : ""}` : null);
    if (fmt(before) !== fmt(after)) {
      changes.push({ kind: "surface-changed", scope: `binding:${stableId}`, path: `surfaces.${stableId}`, summary: `surface ${stableId}: ${fmt(before) ?? "(none)"} → ${fmt(after) ?? "(none)"}`, before: fmt(before), after: fmt(after) });
    }
  }

  for (const ref of allChainRefs()) {
    changes.push(...diffChain(chainOf(current, ref), chainOf(candidate, ref), ref));
  }

  for (const [field, label] of [["excludedModels", "exclude-models"], ["excludedEfforts", "exclude-efforts"]] as const) {
    const before = new Set<string>(current[field]);
    const after = new Set<string>(candidate[field]);
    for (const value of before) {
      if (!after.has(value)) {
        changes.push({ kind: "exclusion-removed", scope: "exclusions", path: field, summary: `global: ${label} no longer excludes ${value}`, before: value, after: null });
      }
    }
    for (const value of after) {
      if (!before.has(value)) {
        changes.push({ kind: "exclusion-added", scope: "exclusions", path: field, summary: `global: ${label} now excludes ${value}`, before: null, after: value });
      }
    }
  }

  const changedScopes = [...new Set(changes.map((change) => change.scope))];
  return { changes, changedScopes, identical: changes.length === 0 };
}

/** Group changes by scope in a stable order for rendering. */
export function groupChangesByScope(diff: PolicyDiff): Array<{ scope: string; changes: PolicyChange[] }> {
  const groups = new Map<string, PolicyChange[]>();
  for (const change of diff.changes) {
    groups.set(change.scope, [...(groups.get(change.scope) ?? []), change]);
  }
  return [...groups.entries()].map(([scope, changes]) => ({ scope, changes }));
}
