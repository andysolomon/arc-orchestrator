// Structural and registry-aware validation of a RoutingPolicy object. The
// control plane runs this live while a policy is edited; the runtime runs it
// as a load-time and CI check. Issues are typed (never thrown) so a UI can show
// every invalid state at once, and each issue names the exact path it is about.

import { parseRungId, selectableEffortsFor, type ModelDefinition } from "./model-schema";
import type { RoutingPolicy, RungId } from "./policy-schema";
import {
  EFFORT_LEVELS,
  TASK_PHASES,
  WORKER_PHASES,
  WORKLOAD_CLASSES,
  isBackend,
} from "./vocabulary";

export const POLICY_VALIDATION_VERSION = "policy-validation/v1" as const;

export type PolicyIssueSeverity = "error" | "warning";

export type PolicyIssueCode =
  | "missing-field"
  | "invalid-value"
  | "unknown-phase"
  | "unknown-workload-class"
  | "workload-order"
  | "parent-local-conflict"
  | "malformed-rung"
  | "unbound-model"
  | "excluded-model"
  | "excluded-effort"
  | "duplicate-rung"
  | "duplicate-binding"
  | "missing-surface"
  | "orphan-surface"
  | "fixed-effort-mismatch"
  | "empty-chain"
  | "empty-tail"
  | "unknown-registry-model"
  | "registry-not-available"
  | "effort-not-selectable"
  | "registry-binding-mismatch";

export type PolicyIssue = {
  severity: PolicyIssueSeverity;
  code: PolicyIssueCode;
  // Dot path into the policy object: "workloadChains.hard-medium[1]".
  path: string;
  message: string;
};

export type ChainRef =
  | { kind: "tail" }
  | { kind: "phase"; key: (typeof WORKER_PHASES)[number] }
  | { kind: "workload"; key: (typeof WORKLOAD_CLASSES)[number] };

export function chainPath(ref: ChainRef): string {
  if (ref.kind === "tail") return "emergencyTail";
  if (ref.kind === "phase") return `phaseChains.${ref.key}`;
  return `workloadChains.${ref.key}`;
}

export function chainLabel(ref: ChainRef): string {
  if (ref.kind === "tail") return "tail";
  if (ref.kind === "phase") return `phase ${ref.key}`;
  return `workload ${ref.key}`;
}

export function chainOf(policy: RoutingPolicy, ref: ChainRef): readonly RungId[] {
  if (ref.kind === "tail") return policy.emergencyTail;
  if (ref.kind === "phase") return policy.phaseChains[ref.key] ?? [];
  return policy.workloadChains[ref.key] ?? [];
}

export function allChainRefs(): ChainRef[] {
  return [
    { kind: "tail" },
    ...WORKER_PHASES.map((key): ChainRef => ({ kind: "phase", key })),
    ...WORKLOAD_CLASSES.map((key): ChainRef => ({ kind: "workload", key })),
  ];
}

export type ValidatePolicyOptions = {
  // When supplied, chain rungs are checked against the registry: the model
  // must exist and be `available`, and the effort must be selectable on it.
  registry?: readonly ModelDefinition[] | null;
};

function issue(
  severity: PolicyIssueSeverity,
  code: PolicyIssueCode,
  path: string,
  message: string,
): PolicyIssue {
  return { severity, code, path, message };
}

/**
 * Validate one chain in the context of the whole policy (exclusions, bindings,
 * fixed-effort surfaces, tail). Suitable for per-row live validation.
 */
export function validateChain(
  policy: RoutingPolicy,
  ref: ChainRef,
  options: ValidatePolicyOptions = {},
): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  const base = chainPath(ref);
  const label = chainLabel(ref);
  const primary = chainOf(policy, ref);
  const tail = ref.kind === "tail" ? [] : policy.emergencyTail;
  const bound = new Set(policy.routeBindings.map((binding) => binding.stableId));
  const registryById = options.registry
    ? new Map(options.registry.map((entry) => [entry.stableId, entry] as const))
    : null;

  if (primary.length === 0) {
    issues.push(
      ref.kind === "tail"
        ? issue("warning", "empty-tail", base, "Tail is empty: exhausted chains have no availability backup.")
        : issue("warning", "empty-chain", base, `${label} is empty: every task goes straight to the emergency tail.`),
    );
  }

  const seen = new Set<string>();
  const full = [...primary.map((rung, index) => ({ rung, path: `${base}[${index}]`, fromTail: false })), ...tail.map((rung, index) => ({ rung, path: `emergencyTail[${index}]`, fromTail: true }))];
  for (const { rung, path, fromTail } of full) {
    const parsed = parseRungId(rung);
    if (!parsed) {
      if (!fromTail) {
        issues.push(issue("error", "malformed-rung", path, `"${rung}" must be <stable-id>@<effort>.`));
      }
      continue;
    }
    if (seen.has(rung)) {
      issues.push(issue("error", "duplicate-rung", fromTail ? base : path, `${label} repeats rung "${rung}"${fromTail ? " (the tail already carries it)" : ""}.`));
    }
    seen.add(rung);
    if (fromTail) {
      // Tail rungs are validated once, on the tail itself.
      continue;
    }
    if (!bound.has(parsed.stableId)) {
      issues.push(issue("error", "unbound-model", path, `${label} references unbound model "${parsed.stableId}".`));
    }
    if (policy.excludedModels.includes(parsed.stableId)) {
      issues.push(issue("error", "excluded-model", path, `${parsed.stableId} is in exclude-models.`));
    }
    if (policy.excludedEfforts.includes(parsed.effort)) {
      issues.push(issue("error", "excluded-effort", path, `${rung} uses excluded effort ${parsed.effort}.`));
    }
    const surface = policy.surfaces[parsed.stableId];
    if (surface?.fixedEffort != null && parsed.effort !== surface.fixedEffort) {
      issues.push(issue("error", "fixed-effort-mismatch", path, `${parsed.stableId} is a fixed-effort ${surface.fixedEffort} profile and cannot run at ${parsed.effort}.`));
    }
    if (registryById) {
      const entry = registryById.get(parsed.stableId);
      if (!entry) {
        issues.push(issue("error", "unknown-registry-model", path, `${parsed.stableId} is not in the model registry.`));
      } else {
        if (entry.maturity !== "available") {
          issues.push(issue("error", "registry-not-available", path, `${parsed.stableId} is ${entry.maturity} in the registry, not available.`));
        }
        const selectable = selectableEffortsFor(entry);
        if (!selectable.includes(parsed.effort)) {
          issues.push(issue("error", "effort-not-selectable", path, `${parsed.effort} is not selectable on ${parsed.stableId} (${selectable.join(", ")}).`));
        }
      }
    }
  }
  return issues;
}

/** Validate a whole policy: scalars, vocabulary, bindings/surfaces, and every chain. */
export function validatePolicy(
  policy: RoutingPolicy,
  options: ValidatePolicyOptions = {},
): PolicyIssue[] {
  const issues: PolicyIssue[] = [];

  if (!policy.label || policy.label.trim() === "") {
    issues.push(issue("error", "missing-field", "label", "policy label is required."));
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(policy.updated ?? "")) {
    issues.push(issue("error", "invalid-value", "updated", "updated must be YYYY-MM-DD."));
  }
  if (policy.fallback !== "availability-only") {
    issues.push(issue("error", "invalid-value", "fallback", "fallback must be availability-only."));
  }
  for (const phase of policy.parentLocalPhases) {
    if (!(TASK_PHASES as readonly string[]).includes(phase)) {
      issues.push(issue("error", "unknown-phase", "parentLocalPhases", `unknown phase "${phase}".`));
    }
    if ((WORKER_PHASES as readonly string[]).includes(phase)) {
      issues.push(issue("error", "parent-local-conflict", "parentLocalPhases", `phase ${phase} cannot be both parent-local and a worker chain.`));
    }
  }
  if (!policy.parentDefaults?.pi) {
    issues.push(issue("error", "missing-field", "parentDefaults.pi", "parent-default pi is required."));
  }
  for (const [surface, parent] of Object.entries(policy.parentDefaults ?? {})) {
    if (!(EFFORT_LEVELS as readonly string[]).includes(parent.effort)) {
      issues.push(issue("error", "invalid-value", `parentDefaults.${surface}`, `unknown effort "${parent.effort}".`));
    } else if (policy.excludedEfforts.includes(parent.effort)) {
      issues.push(issue("error", "excluded-effort", `parentDefaults.${surface}`, `parent-default ${surface} uses excluded effort "${parent.effort}".`));
    }
  }

  const bases = new Set<string>();
  const bound = new Set<string>();
  policy.routeBindings.forEach((binding, index) => {
    const path = `routeBindings[${index}]`;
    if (bases.has(binding.base)) {
      issues.push(issue("error", "duplicate-binding", path, `duplicate binding ${binding.base}.`));
    }
    bases.add(binding.base);
    bound.add(binding.stableId);
    if (!isBackend(binding.backend)) {
      issues.push(issue("error", "invalid-value", `${path}.backend`, `unknown backend "${String(binding.backend)}".`));
    }
    if (policy.excludedModels.includes(binding.stableId)) {
      issues.push(issue("error", "excluded-model", path, `binding ${binding.base} exposes excluded model "${binding.stableId}".`));
    }
    if (binding.defaultEffort && policy.excludedEfforts.includes(binding.defaultEffort)) {
      issues.push(issue("error", "excluded-effort", path, `binding ${binding.base} defaults to excluded effort "${binding.defaultEffort}".`));
    }
    const surface = policy.surfaces[binding.stableId];
    if (!surface) {
      issues.push(issue("error", "missing-surface", `surfaces.${binding.stableId}`, `missing surface ${binding.stableId}.`));
    } else if (
      binding.defaultEffort != null &&
      surface.fixedEffort != null &&
      binding.defaultEffort !== surface.fixedEffort
    ) {
      issues.push(issue("error", "fixed-effort-mismatch", path, `binding ${binding.base} defaults fixed-effort model ${binding.stableId} to "${binding.defaultEffort}".`));
    }
    if (options.registry) {
      const entry = options.registry.find((row) => row.stableId === binding.stableId);
      if (!entry) {
        issues.push(issue("error", "unknown-registry-model", path, `binding ${binding.base} pins ${binding.stableId}, which is not in the registry.`));
      } else {
        if (entry.providerModelId !== binding.providerModelId) {
          issues.push(issue("error", "registry-binding-mismatch", `${path}.providerModelId`, `registry providerModelId ${String(entry.providerModelId)} != policy ${binding.providerModelId}.`));
        }
        if (entry.transportBackend !== binding.backend) {
          issues.push(issue("error", "registry-binding-mismatch", `${path}.backend`, `registry backend ${String(entry.transportBackend)} != policy ${binding.backend}.`));
        }
        if (entry.maturity !== "available") {
          issues.push(issue("error", "registry-not-available", path, `${binding.stableId} is ${entry.maturity}, not available.`));
        }
        if (surface && (entry.fixedEffort ?? null) !== surface.fixedEffort) {
          issues.push(issue("error", "fixed-effort-mismatch", `surfaces.${binding.stableId}`, `registry fixedEffort ${String(entry.fixedEffort ?? null)} != policy ${String(surface.fixedEffort)}.`));
        }
      }
    }
  });
  for (const stableId of Object.keys(policy.surfaces)) {
    if (!bound.has(stableId)) {
      issues.push(issue("error", "orphan-surface", `surfaces.${stableId}`, `surface ${stableId} has no binding.`));
    }
  }

  for (const phase of WORKER_PHASES) {
    if (!policy.phaseChains?.[phase]) {
      issues.push(issue("error", "missing-field", `phaseChains.${phase}`, `missing phase ${phase}.`));
    }
  }
  for (const phase of Object.keys(policy.phaseChains ?? {})) {
    if (!(WORKER_PHASES as readonly string[]).includes(phase)) {
      issues.push(issue("error", "unknown-phase", `phaseChains.${phase}`, `"${phase}" is not a delegable worker phase.`));
    }
  }
  const workloadKeys = Object.keys(policy.workloadChains ?? {});
  for (const klass of WORKLOAD_CLASSES) {
    if (!policy.workloadChains?.[klass]) {
      issues.push(issue("error", "missing-field", `workloadChains.${klass}`, `missing workload ${klass}.`));
    }
  }
  for (const klass of workloadKeys) {
    if (!(WORKLOAD_CLASSES as readonly string[]).includes(klass)) {
      issues.push(issue("error", "unknown-workload-class", `workloadChains.${klass}`, `"${klass}" is not a canonical workload class.`));
    }
  }
  if (
    workloadKeys.every((klass) => (WORKLOAD_CLASSES as readonly string[]).includes(klass)) &&
    workloadKeys.length === WORKLOAD_CLASSES.length &&
    workloadKeys.join(",") !== WORKLOAD_CLASSES.join(",")
  ) {
    issues.push(issue("error", "workload-order", "workloadChains", "workload chains must be listed in canonical order."));
  }
  for (const effort of policy.excludedEfforts) {
    if (!(EFFORT_LEVELS as readonly string[]).includes(effort)) {
      issues.push(issue("error", "invalid-value", "excludedEfforts", `unknown effort "${effort}".`));
    }
  }

  for (const ref of allChainRefs()) {
    if (ref.kind !== "tail" && !chainOf(policy, ref)) continue;
    issues.push(...validateChain(policy, ref, options));
  }
  return issues;
}

export function policyHasErrors(issues: readonly PolicyIssue[]): boolean {
  return issues.some((entry) => entry.severity === "error");
}
