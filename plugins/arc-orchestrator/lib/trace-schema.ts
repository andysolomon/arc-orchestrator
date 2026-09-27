// Runtime trace schema. The record *types*, contract constants, the trace
// reader, and every pure redaction helper live in the shared routing-core
// package so the control plane reads traces with the same definitions. This
// module keeps what is runtime-only: the policy-bound public route bindings,
// the checkout hash (Bun hasher), and the v2 record builder.

import { MODEL_POLICY } from "./model-policy";
import {
  ROUTING_TRACE_V2_CONTRACT,
  ROUTING_TRACE_V2_SCHEMA_VERSION,
  boundedLabel,
  boundedStructuredString,
  isSafeInternalId,
  sanitizeFailureDetail,
  sanitizeSelectionForV2,
  sanitizeWorkloadProfileForTrace,
  type EmittedRoutingTraceV2,
  type RoutingTraceV2AliasKind,
  type RoutingTraceV2BudgetDimension,
  type RoutingTraceV2BudgetMeasurement,
  type RoutingTraceV2BudgetScope,
  type RoutingTraceV2Selection,
  type TraceRecord,
  type WorkloadProfileRecord,
} from "../../../packages/routing-core/src/trace-schema";
import { PUBLIC_ROUTE_SUFFIXES } from "../../../packages/routing-core/src/capability-routes";
import { ROUTING_CORE_VERSION } from "../../../packages/routing-core/src/vocabulary";
import type { Backend, Effort } from "../../../packages/routing-core/src/vocabulary";

export * from "../../../packages/routing-core/src/trace-schema";
export {
  EFFORT_LEVELS,
  TASK_PHASES,
  type Backend,
  type BackendOutageReason,
  type Effort,
  type Mode,
  type TaskPhase,
  type TraceSandbox,
} from "../../../packages/routing-core/src/vocabulary";
export { PUBLIC_ROUTE_SUFFIXES };

// Public v4 model aliases are a closed allowlist. Stable semantic names and
// their current versioned counterparts intentionally share one model binding;
// obsolete names are rejected rather than redirected. Every base supports the
// same explore/implement/check capability suffixes. The binding list is
// generated from the authoritative arc-model-policy block; order is
// contract-significant.
export const PUBLIC_ROUTE_MODEL_BINDINGS =
  MODEL_POLICY.routeBindings satisfies readonly {
    base: string;
    stableId: string;
    providerModelId: string;
    backend: Backend;
    defaultEffort?: Effort;
  }[];

export type PublicRouteAliasBase = (typeof PUBLIC_ROUTE_MODEL_BINDINGS)[number]["base"];
export type PublicRouteSuffix = (typeof PUBLIC_ROUTE_SUFFIXES)[number];
export type RouteId = `${PublicRouteAliasBase}-${PublicRouteSuffix}`;

// Builder input. Nested camelCase keeps the call sites readable; the builder
// applies redaction/normalization and computes `remaining`.
export type RoutingTraceV2BudgetDimensionInput = {
  allocated?: number | null;
  consumed?: number;
  // When set, the builder preserves this ledger remaining instead of deriving
  // allocated - consumed (which ignores active reservations).
  remaining?: number | null;
  measurement?: RoutingTraceV2BudgetMeasurement;
};

export type RoutingTraceV2BudgetScopeInput = {
  token?: RoutingTraceV2BudgetDimensionInput;
  wallTimeMs?: RoutingTraceV2BudgetDimensionInput;
  call?: RoutingTraceV2BudgetDimensionInput;
  cost?: RoutingTraceV2BudgetDimensionInput;
  concurrency?: RoutingTraceV2BudgetDimensionInput;
};

export type RoutingTraceV2Input = {
  legacy: TraceRecord;
  route: {
    requestedPublicAlias?: string | null;
    requestedAliasKind?: RoutingTraceV2AliasKind | null;
    canonicalCapabilityRoute?: string | null;
  };
  models: {
    requested?: string | null;
    candidate?: string | null;
    attempted?: string | null;
    selected?: string | null;
  };
  serving: {
    provider?: string | null;
    providerModelId?: string | null;
    transportBackend?: string | null;
    adapterId?: string | null;
    adapterVersion?: string | null;
    stableId?: string | null;
  };
  traversal: {
    candidateIndex?: number | null;
    attemptIndex?: number | null;
    stackSize?: number | null;
    traversalId?: string | null;
  };
  failure?: {
    normalizedClass?: string | null;
    detail?: string | null;
    fallbackSource?: string | null;
    fallbackDestination?: string | null;
    fallbackReason?: string | null;
    terminalReason?: string | null;
  };
  authorization?: {
    overrideRequested?: boolean;
    overrideApplied?: boolean;
    explicitParentEscalation?: boolean;
    solAuthorized?: boolean;
  };
  lineage: {
    rootRunId: string;
    parentRunId?: string | null;
    taskId?: string | null;
    depth: number;
    schedulerId?: string | null;
  };
  budgets?: {
    root?: RoutingTraceV2BudgetScopeInput;
    dispatch?: RoutingTraceV2BudgetScopeInput;
  };
  // Passed already assembled, the way `legacy` is, and sanitized by the builder.
  // Omit for a record whose writer predates a selector; pass null to say the
  // selector did not run.
  selection?: RoutingTraceV2Selection | null;
  // workload-profile/v1. Omit for a writer that has no profiler wired in; pass
  // null to say no structured evidence was supplied for this dispatch.
  workloadProfile?: WorkloadProfileRecord | null;
  versions?: {
    policy?: string;
    budgetPolicy?: string;
    registry?: number;
    capabilityRoutes?: number;
    routingShadow?: number;
  };
};

function preserveOrBoundStructuredId(value: string, limit = 64): string {
  const trimmed = value.trim();
  if (isSafeInternalId(trimmed)) {
    return trimmed.length <= limit ? trimmed : trimmed.slice(0, limit);
  }
  return boundedStructuredString(trimmed, limit) ?? trimmed.slice(0, limit);
}

// Map checkout/project identity to a bounded non-sensitive identifier. Accepts
// the schema-4 sha256(cwd).slice(0,12) form; hashes anything path-like or unsafe.
export function normalizeCheckoutId(project: string): string {
  const trimmed = project.trim();
  if (/^[a-f0-9]{12}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return new Bun.CryptoHasher("sha256")
    .update(trimmed)
    .digest("hex")
    .slice(0, 12);
}

// Clone a schema-4 trace for v2 embedding: sanitize string fields and normalize
// checkout identity while preserving adapter-compatible field names.
export function sanitizeLegacyForV2(legacy: TraceRecord): TraceRecord {
  const project = normalizeCheckoutId(legacy.project);
  const safeLabel = (value: string | null, limit = 64): string | null => {
    if (value == null) {
      return null;
    }
    return boundedLabel(sanitizeFailureDetail(value, limit), limit);
  };
  return {
    ...legacy,
    project,
    label: safeLabel(legacy.label, 80),
    task_class: safeLabel(legacy.task_class),
    route_rationale: safeLabel(legacy.route_rationale, 240),
    error: legacy.error ? sanitizeFailureDetail(legacy.error) : null,
    ...(legacy.fallback
      ? {
          fallback: {
            backend: legacy.fallback.backend,
            model: safeLabel(legacy.fallback.model) ?? legacy.fallback.model,
          },
        }
      : {}),
  };
}

function budgetDimension(
  input: RoutingTraceV2BudgetDimensionInput | undefined,
): RoutingTraceV2BudgetDimension {
  const allocated = input?.allocated ?? null;
  const consumed = input?.consumed ?? 0;
  const measurement = input?.measurement;
  const remaining =
    input?.remaining !== undefined
      ? input.remaining
      : allocated === null
        ? null
        : allocated - consumed;
  return {
    allocated,
    consumed,
    // Overage stays visible (may go negative) so one-pass accounting is auditable.
    remaining,
    ...(measurement ? { measurement } : {}),
  };
}

function budgetScope(
  input: RoutingTraceV2BudgetScopeInput | undefined,
): RoutingTraceV2BudgetScope {
  return {
    token: budgetDimension(input?.token),
    wall_time_ms: budgetDimension(input?.wallTimeMs),
    call: budgetDimension(input?.call),
    cost: budgetDimension(input?.cost),
    concurrency: budgetDimension(input?.concurrency),
  };
}

// Pure builder for the orchestrator-routing-trace/v2 writer contract.
export function buildRoutingTraceV2(
  input: RoutingTraceV2Input,
): EmittedRoutingTraceV2 {
  return {
    contract: ROUTING_TRACE_V2_CONTRACT,
    schema: ROUTING_TRACE_V2_SCHEMA_VERSION,
    timestamp: input.legacy.timestamp,
    status: input.legacy.status,
    orchestrator_identity: input.legacy.orchestrator_identity ?? null,
    route: {
      requested_public_alias: boundedStructuredString(
        input.route.requestedPublicAlias,
      ),
      requested_alias_kind: input.route.requestedAliasKind ?? null,
      canonical_capability_route: boundedStructuredString(
        input.route.canonicalCapabilityRoute,
      ),
    },
    models: {
      requested: boundedStructuredString(input.models.requested),
      candidate: boundedStructuredString(input.models.candidate),
      attempted: boundedStructuredString(input.models.attempted),
      selected: boundedStructuredString(input.models.selected),
    },
    serving: {
      provider: boundedStructuredString(input.serving.provider),
      provider_model_id: boundedStructuredString(input.serving.providerModelId),
      transport_backend: boundedStructuredString(
        input.serving.transportBackend,
      ),
      adapter_id: boundedStructuredString(input.serving.adapterId),
      adapter_version: boundedStructuredString(input.serving.adapterVersion),
      stable_id: boundedStructuredString(input.serving.stableId),
    },
    traversal: {
      candidate_index: input.traversal.candidateIndex ?? null,
      attempt_index: input.traversal.attemptIndex ?? null,
      stack_size: input.traversal.stackSize ?? null,
      traversal_id: input.traversal.traversalId
        ? preserveOrBoundStructuredId(input.traversal.traversalId)
        : null,
    },
    failure: {
      normalized_class: input.failure?.normalizedClass ?? null,
      detail: sanitizeFailureDetail(input.failure?.detail),
      fallback_source: boundedStructuredString(input.failure?.fallbackSource),
      fallback_destination: boundedStructuredString(
        input.failure?.fallbackDestination,
      ),
      fallback_reason: boundedStructuredString(
        input.failure?.fallbackReason,
        120,
      ),
      terminal_reason: boundedStructuredString(
        input.failure?.terminalReason,
        120,
      ),
    },
    authorization: {
      override_requested: input.authorization?.overrideRequested ?? false,
      override_applied: input.authorization?.overrideApplied ?? false,
      explicit_parent_escalation:
        input.authorization?.explicitParentEscalation ?? false,
      sol_authorized: input.authorization?.solAuthorized ?? false,
    },
    lineage: {
      root_run_id: preserveOrBoundStructuredId(input.lineage.rootRunId),
      parent_run_id: input.lineage.parentRunId
        ? preserveOrBoundStructuredId(input.lineage.parentRunId)
        : null,
      run_id: preserveOrBoundStructuredId(input.legacy.run_id),
      task_id: boundedStructuredString(input.lineage.taskId),
      depth: input.lineage.depth,
      scheduler_id: boundedStructuredString(input.lineage.schedulerId),
    },
    worktree: {
      checkout_id: normalizeCheckoutId(input.legacy.project),
    },
    versions: {
      policy:
        boundedStructuredString(input.versions?.policy) ??
        "candidate-stacks/v1",
      budget_policy:
        boundedStructuredString(input.versions?.budgetPolicy) ??
        "budget-limits/v1",
      registry: input.versions?.registry ?? 1,
      capability_routes: input.versions?.capabilityRoutes ?? 1,
      routing_shadow: input.versions?.routingShadow ?? 1,
      routing_trace: ROUTING_TRACE_V2_SCHEMA_VERSION,
      routing_core: ROUTING_CORE_VERSION,
    },
    budgets: {
      root: budgetScope(input.budgets?.root),
      dispatch: budgetScope(input.budgets?.dispatch),
    },
    // Absent input omits the key entirely — a writer with no selector wired in
    // should not claim the selector produced nothing.
    ...("selection" in input
      ? {
          selection:
            input.selection == null
              ? null
              : sanitizeSelectionForV2(input.selection),
        }
      : {}),
    // Same precedent for the profiler block.
    ...("workloadProfile" in input
      ? {
          workload_profile:
            input.workloadProfile == null
              ? null
              : sanitizeWorkloadProfileForTrace(input.workloadProfile),
        }
      : {}),
    legacy: sanitizeLegacyForV2(input.legacy),
  };
}

