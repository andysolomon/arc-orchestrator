export type Mode = "analyze" | "implement" | "review";
export type Backend = "codex" | "composer" | "claude";
export type BackendOutageReason = "usage_limit" | "auth" | "missing_binary";

export type Effort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export type RouteId =
  | "codex-explore"
  | "composer-implement"
  | "codex-implement"
  | "codex-check"
  | "opus-explore"
  | "opus-implement"
  | "opus-check"
  | "grok-explore"
  | "grok-check"
  | "grok-implement";

export type TraceSandbox = "read-only" | "workspace-write";

export type TokenUsage = {
  input_tokens: number;
  cached_input_tokens: number | null;
  output_tokens: number;
  total_tokens: number;
};

export type BudgetRecord = {
  max_tokens: number | null;
  max_duration_ms: number | null;
  tokens_exceeded: boolean;
  duration_exceeded: boolean;
};

export type TraceRecord = {
  schema: number;
  run_id: string;
  timestamp: string;
  backend: Backend;
  mode: Mode;
  model: string;
  sandbox: TraceSandbox;
  // Opaque project identifier; the absolute working directory is never
  // recorded so default traces stay free of filesystem paths.
  project: string;
  // Present only when the caller passes an explicit --label; never derived
  // from task text.
  label: string | null;
  // The parent model's own, bounded classification of the work and its
  // stated reason for choosing this route. Never derived from task text.
  task_class: string | null;
  route_rationale: string | null;
  duration_ms: number;
  status: "completed" | "blocked" | "error";
  exit_code: number;
  changed_files: number | null;
  tokens: TokenUsage | null;
  budget: BudgetRecord | null;
  error: string | null;
  effort?: Effort;
  failure_class?: "backend_unavailable";
  outage_reason?: BackendOutageReason;
  fallback?: { backend: "claude"; model: string };
  fallback_of?: string;
};

export const TRACE_SCHEMA_VERSION = 4;

// ---------------------------------------------------------------------------
// orchestrator-routing-trace/v2 writer contract
// ---------------------------------------------------------------------------
// A named, versioned selection-trace record emitted for every dispatch and
// candidate attempt (docs/orchestrator/model-tier-routing-plan.md, "Trace and
// observability contract"). It is additive: the legacy schema-4 TraceRecord is
// embedded verbatim under `legacy` so existing consumers can dual-read v2
// records, and rollback leaves v2 events intact for later replay. This module
// stays dependency-free; the enum-valued fields carry the normalized string
// values produced by capability-routes / failure-classification / the registry.

export const ROUTING_TRACE_V2_CONTRACT = "orchestrator-routing-trace/v2" as const;
export const ROUTING_TRACE_V2_SCHEMA_VERSION = 2;

export type RoutingTraceV2AliasKind = "executable-route" | "public-surface";

// Requested public route/surface and the canonical capability route it binds to.
export type RoutingTraceV2Route = {
  requested_public_alias: string | null;
  requested_alias_kind: RoutingTraceV2AliasKind | null;
  canonical_capability_route: string | null;
};

// Requested, candidate, attempted, and selected model as distinct fields.
export type RoutingTraceV2Models = {
  requested: string | null;
  candidate: string | null;
  attempted: string | null;
  selected: string | null;
};

// Serving provider, safe provider model ID, transport backend, adapter+version,
// plus the bounded registry stable ID for low-cardinality joins and metrics.
export type RoutingTraceV2Serving = {
  provider: string | null;
  provider_model_id: string | null;
  transport_backend: string | null;
  adapter_id: string | null;
  adapter_version: string | null;
  stable_id: string | null;
};

// Candidate index, monotonic attempt index, stack size, and traversal ID.
export type RoutingTraceV2Traversal = {
  candidate_index: number | null;
  attempt_index: number | null;
  stack_size: number | null;
  traversal_id: string | null;
};

// Normalized failure class, sanitized detail, fallback source/destination/reason,
// and terminal reason.
export type RoutingTraceV2Failure = {
  normalized_class: string | null;
  detail: string | null;
  fallback_source: string | null;
  fallback_destination: string | null;
  fallback_reason: string | null;
  terminal_reason: string | null;
};

// Override requested/applied and explicit parent escalation / Sol authorization.
export type RoutingTraceV2Authorization = {
  override_requested: boolean;
  override_applied: boolean;
  explicit_parent_escalation: boolean;
  sol_authorized: boolean;
};

// Root / parent / run-or-attempt / task IDs, lineage depth, and scheduler ID.
export type RoutingTraceV2Lineage = {
  root_run_id: string;
  parent_run_id: string | null;
  run_id: string;
  task_id: string | null;
  depth: number;
  scheduler_id: string | null;
};

// Non-sensitive bounded worktree/checkout identity.
export type RoutingTraceV2Worktree = {
  checkout_id: string;
};

// Policy and registry versions travelling with each record.
export type RoutingTraceV2Versions = {
  policy: string;
  budget_policy: string;
  registry: number;
  capability_routes: number;
  routing_shadow: number;
  routing_trace: number;
};

// Measured vs conservatively reconciled consumption for a budget dimension.
export type RoutingTraceV2BudgetMeasurement = "known" | "unknown";

// One budget dimension: allocated / consumed / remaining. Consumption is
// cumulative and never resets across fallback or delegation.
export type RoutingTraceV2BudgetDimension = {
  allocated: number | null;
  consumed: number;
  remaining: number | null;
  // Explicit reconciliation state; required on cost when pricing is unavailable.
  measurement?: RoutingTraceV2BudgetMeasurement;
};

// token, wall-time, call, cost, and concurrency budgets for one scope.
export type RoutingTraceV2BudgetScope = {
  token: RoutingTraceV2BudgetDimension;
  wall_time_ms: RoutingTraceV2BudgetDimension;
  call: RoutingTraceV2BudgetDimension;
  cost: RoutingTraceV2BudgetDimension;
  concurrency: RoutingTraceV2BudgetDimension;
};

export type RoutingTraceV2Budgets = {
  root: RoutingTraceV2BudgetScope;
  dispatch: RoutingTraceV2BudgetScope;
};

export type RoutingTraceV2 = {
  contract: typeof ROUTING_TRACE_V2_CONTRACT;
  schema: number;
  timestamp: string;
  status: TraceRecord["status"];
  route: RoutingTraceV2Route;
  models: RoutingTraceV2Models;
  serving: RoutingTraceV2Serving;
  traversal: RoutingTraceV2Traversal;
  failure: RoutingTraceV2Failure;
  authorization: RoutingTraceV2Authorization;
  lineage: RoutingTraceV2Lineage;
  worktree: RoutingTraceV2Worktree;
  versions: RoutingTraceV2Versions;
  budgets: RoutingTraceV2Budgets;
  // Embedded legacy schema-4 record for dual-read and rollback; never rewritten.
  legacy: TraceRecord;
};

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
  versions?: {
    policy?: string;
    budgetPolicy?: string;
    registry?: number;
    capabilityRoutes?: number;
    routingShadow?: number;
  };
};

const V2_BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const V2_TOKEN_PATTERN =
  /\b(?:sk|ghp|gho|ghs|ghu|ghr|xox[baprs]|AKIA|AIza)[A-Za-z0-9_-]{6,}\b/g;
const V2_PATH_PATTERN = /(?:file:\/\/)?\/(?:[\w.@+~-]+\/)+[\w.@+~-]+/g;
const V2_ENV_SECRET_PATTERN = /\b[A-Z][A-Z0-9_]{2,}=[^\s]+/g;
const V2_FILE_CONTENTS_PATTERN = /\bcontents:\s*\S+/gi;
const V2_WORKER_PROMPT_PATTERN =
  /You are a worker reporting to Claude Fable 5[^]*?(?=Return only one valid JSON|Task:|$)/gi;

// Redact credentials, secrets, raw provider tokens, prompts, file contents, and
// absolute paths from a failure detail, then collapse whitespace and bound the
// length. Returns null for empty input so the record never carries an empty string.
export function sanitizeFailureDetail(
  detail: string | null | undefined,
  limit = 240,
): string | null {
  if (detail == null) {
    return null;
  }
  const collapsed = detail.replace(/\s+/g, " ").trim();
  if (collapsed === "") {
    return null;
  }
  const redacted = collapsed
    .replace(V2_WORKER_PROMPT_PATTERN, "<prompt>")
    .replace(V2_BEARER_PATTERN, "<redacted>")
    .replace(V2_TOKEN_PATTERN, "<redacted>")
    .replace(V2_ENV_SECRET_PATTERN, "<secret>")
    .replace(V2_FILE_CONTENTS_PATTERN, "contents: <redacted>")
    .replace(V2_PATH_PATTERN, "<path>");
  return redacted.length <= limit ? redacted : `${redacted.slice(0, limit - 1)}…`;
}

const SAFE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_RUN_ID_PATTERN = /^run-[a-z0-9-]+$/i;
const SAFE_TRAVERSAL_ID_PATTERN = /^trav-[a-z0-9-]+$/i;
const SAFE_CHECKOUT_ID_PATTERN = /^[a-f0-9]{12}$/i;

// Approved internal identifiers (UUIDs, run/traversal prefixes, checkout hashes)
// may pass through without redaction when they match known safe shapes.
export function isSafeInternalId(value: string): boolean {
  const trimmed = value.trim();
  return (
    SAFE_UUID_PATTERN.test(trimmed) ||
    SAFE_RUN_ID_PATTERN.test(trimmed) ||
    SAFE_TRAVERSAL_ID_PATTERN.test(trimmed) ||
    SAFE_CHECKOUT_ID_PATTERN.test(trimmed)
  );
}

function preserveOrBoundStructuredId(value: string, limit = 64): string {
  const trimmed = value.trim();
  if (isSafeInternalId(trimmed)) {
    return trimmed.length <= limit ? trimmed : trimmed.slice(0, limit);
  }
  return boundedStructuredString(trimmed, limit) ?? trimmed.slice(0, limit);
}

// Every bounded structured string passes the v2 redaction boundary before
// truncation so secrets, tokens, and absolute paths never survive serialization.
export function boundedStructuredString(
  value: string | null | undefined,
  limit = 64,
): string | null {
  if (value == null) {
    return null;
  }
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed === "") {
    return null;
  }
  if (isSafeInternalId(collapsed)) {
    return collapsed.length <= limit ? collapsed : collapsed.slice(0, limit);
  }
  return sanitizeFailureDetail(collapsed, limit);
}

// Normalize a user/model/provider string to a bounded-cardinality label.
export function boundedLabel(
  value: string | null | undefined,
  limit = 64,
): string | null {
  return boundedStructuredString(value, limit);
}

// budget-limits/v1 dispatch cost ceiling (docs/orchestrator/decisions/0003).
export const DISPATCH_COST_RESERVATION_V1 = 2.5;

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
export function buildRoutingTraceV2(input: RoutingTraceV2Input): RoutingTraceV2 {
  return {
    contract: ROUTING_TRACE_V2_CONTRACT,
    schema: ROUTING_TRACE_V2_SCHEMA_VERSION,
    timestamp: input.legacy.timestamp,
    status: input.legacy.status,
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
      transport_backend: boundedStructuredString(input.serving.transportBackend),
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
    },
    budgets: {
      root: budgetScope(input.budgets?.root),
      dispatch: budgetScope(input.budgets?.dispatch),
    },
    legacy: sanitizeLegacyForV2(input.legacy),
  };
}

export function isRoutingTraceV2(value: unknown): value is RoutingTraceV2 {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { contract?: unknown }).contract === ROUTING_TRACE_V2_CONTRACT
  );
}
