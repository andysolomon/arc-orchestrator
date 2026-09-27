// Routing trace contracts: the schema-4 `TraceRecord`, the named
// `orchestrator-routing-trace/v2` record, the selection block, and the
// additive `workload_profile` block. Types, constants, and pure string
// sanitizers live here; the record *builder* stays in the runtime because it
// hashes the checkout identity with a Node/Bun hasher.

import type { WorkloadClass, Difficulty, Volume } from "./vocabulary";
import type {
  Backend,
  BackendOutageReason,
  Effort,
  Mode,
  OrchestratorIdentity,
  TaskPhase,
  TraceSandbox,
} from "./vocabulary";

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

// ---------------------------------------------------------------------------
// workload-profile/v1 — additive trace block
// ---------------------------------------------------------------------------
// Structured facts only: the classification, the signals that produced it, and
// the source of the class that routed. Never task text, never model reasoning.

export const WORKLOAD_PROFILE_TRACE_CONTRACT = "workload-profile/v1" as const;

export type WorkloadProfileRecord = {
  contract: typeof WORKLOAD_PROFILE_TRACE_CONTRACT;
  difficulty: Difficulty;
  volume: Volume;
  workload_class: WorkloadClass;
  reasons: string[];
  // Which class actually routed: the profiled one, an explicit --workload-class
  // that won over it, or none (profile recorded on a non-implement phase).
  routed_class: WorkloadClass | null;
  class_source: "profiled" | "explicit" | "none";
  // Present when an explicit class disagreed with the profile.
  disagreement: { explicit: WorkloadClass; profiled: WorkloadClass } | null;
  evidence_coverage: string[];
};

export type TraceRecord = {
  schema: number;
  run_id: string;
  timestamp: string;
  backend: Backend;
  // Public parent-orchestrator identity selected by the CLI/env contract. Null
  // means it was not selected; it is never inferred from a chat UI model.
  orchestrator_identity?: OrchestratorIdentity | null;
  mode: Mode;
  // User-facing orchestration phase. Older trace records omit this and can be
  // interpreted from mode (analyze -> analyze, implement -> implement,
  // review -> verify).
  phase?: TaskPhase;
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
  // Separate from task_class: this is the finite policy key used only for
  // implementation candidate-stack selection. Older records omit it.
  workload_class?: string | null;
  // Additive (workload-profile/v1): the profiler's classification when the
  // caller supplied structured evidence. Older records omit it.
  workload_profile?: WorkloadProfileRecord | null;
  // Optional fail-closed CLI compatibility marker (`--routing-policy
  // runner-routing-v4`). Present only when the caller asserted the marker;
  // does not change selection behavior. Older records omit it.
  routing_policy?: string | null;
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
  fallback?:
    | { backend: "claude"; model: string }
    | { backend: "composer"; model: string }
    | { backend: "minimax"; model: string }
    | { backend: "kimi"; model: string };
  fallback_of?: string;
  escalation_of?: string;
};

export const TRACE_SCHEMA_VERSION = 4;

// ---------------------------------------------------------------------------
// orchestrator-routing-trace/v2 contract
// ---------------------------------------------------------------------------

export const ROUTING_TRACE_V2_CONTRACT =
  "orchestrator-routing-trace/v2" as const;
export const ROUTING_TRACE_V2_SCHEMA_VERSION = 2;

export type RoutingTraceV2AliasKind = "executable-route" | "public-surface";

export type RoutingTraceV2Route = {
  requested_public_alias: string | null;
  requested_alias_kind: RoutingTraceV2AliasKind | null;
  canonical_capability_route: string | null;
};

export type RoutingTraceV2Models = {
  requested: string | null;
  candidate: string | null;
  attempted: string | null;
  selected: string | null;
};

export type RoutingTraceV2Serving = {
  provider: string | null;
  provider_model_id: string | null;
  transport_backend: string | null;
  adapter_id: string | null;
  adapter_version: string | null;
  stable_id: string | null;
};

export type RoutingTraceV2Traversal = {
  candidate_index: number | null;
  attempt_index: number | null;
  stack_size: number | null;
  traversal_id: string | null;
};

export type RoutingTraceV2Failure = {
  normalized_class: string | null;
  detail: string | null;
  fallback_source: string | null;
  fallback_destination: string | null;
  fallback_reason: string | null;
  terminal_reason: string | null;
};

export type RoutingTraceV2Authorization = {
  override_requested: boolean;
  override_applied: boolean;
  explicit_parent_escalation: boolean;
  sol_authorized: boolean;
};

export type RoutingTraceV2Lineage = {
  root_run_id: string;
  parent_run_id: string | null;
  run_id: string;
  task_id: string | null;
  depth: number;
  scheduler_id: string | null;
};

export type RoutingTraceV2Worktree = {
  checkout_id: string;
};

export type RoutingTraceV2Versions = {
  policy: string;
  budget_policy: string;
  registry: number;
  capability_routes: number;
  routing_shadow: number;
  routing_trace: number;
  // Additive: the shared routing-core contract version that produced the record.
  routing_core?: string;
};

export type RoutingTraceV2BudgetMeasurement = "known" | "unknown";

export type RoutingTraceV2BudgetDimension = {
  allocated: number | null;
  consumed: number;
  remaining: number | null;
  measurement?: RoutingTraceV2BudgetMeasurement;
};

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

export type RoutingTraceV2SelectionTruncation = {
  eligible: number;
  rejected: number;
  pruned: number;
  budget_constrained: number;
  unranked: number;
};

export type RoutingTraceV2Selection = {
  outcome: "selected" | "refused";
  refusal_reason: string | null;
  executed: boolean;
  policy_version: string;
  snapshot_version: string;
  registry_version: number;
  axis: string;
  requested_floor: number;
  effective_floor: number;
  floor_lowered: boolean;
  override_applied: boolean;
  eligible: string[];
  rejected: Array<{ rung_id: string; reason: string }>;
  pruned: Array<{ rung_id: string; dominated_by: string }>;
  budget_constrained: string[];
  unranked: string[];
  lead_backend: string | null;
  lead_repair?: { from: string; to: string; reason: string } | null;
  lead_displaced?: boolean;
  lead_displaced_by_availability?: boolean;
  truncated: RoutingTraceV2SelectionTruncation;
};

export type RoutingTraceV2 = {
  contract: typeof ROUTING_TRACE_V2_CONTRACT;
  schema: number;
  timestamp: string;
  status: TraceRecord["status"];
  orchestrator_identity?: OrchestratorIdentity | null;
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
  selection?: RoutingTraceV2Selection | null;
  // Additive (workload-profile/v1). Records written before the profiler
  // legitimately omit it; current writers emit the block or null.
  workload_profile?: WorkloadProfileRecord | null;
  legacy: TraceRecord;
};

export type EmittedRoutingTraceV2 = RoutingTraceV2 & {
  orchestrator_identity: OrchestratorIdentity | null;
};

// budget-limits/v1 dispatch cost ceiling (docs/orchestrator/decisions/0003).
export const DISPATCH_COST_RESERVATION_V1 = 2.5;

// ---------------------------------------------------------------------------
// Pure redaction helpers (shared by the runtime builder and the corpus writer)
// ---------------------------------------------------------------------------

const V2_BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const V2_TOKEN_PATTERN =
  /\b(?:sk|ghp|gho|ghs|ghu|ghr|xox[baprs]|AKIA|AIza)[A-Za-z0-9_-]{6,}\b/g;
const V2_PATH_PATTERN = /(?:file:\/\/)?\/(?:[\w.@+~-]+\/)+[\w.@+~-]+/g;
const V2_ENV_SECRET_PATTERN = /\b[A-Z][A-Z0-9_]{2,}=[^\s]+/g;
const V2_FILE_CONTENTS_PATTERN = /\bcontents:\s*\S+/gi;
const V2_WORKER_PROMPT_PATTERN =
  /You are a worker reporting to Claude Fable 5(?:\.1)?[^]*?(?=Return only one valid JSON|Task:|$)/gi;

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
  return redacted.length <= limit
    ? redacted
    : `${redacted.slice(0, limit - 1)}…`;
}

const SAFE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_RUN_ID_PATTERN = /^run-[a-z0-9-]+$/i;
const SAFE_TRAVERSAL_ID_PATTERN = /^trav-[a-z0-9-]+$/i;
const SAFE_CHECKOUT_ID_PATTERN = /^[a-f0-9]{12}$/i;

export function isSafeInternalId(value: string): boolean {
  const trimmed = value.trim();
  return (
    SAFE_UUID_PATTERN.test(trimmed) ||
    SAFE_RUN_ID_PATTERN.test(trimmed) ||
    SAFE_TRAVERSAL_ID_PATTERN.test(trimmed) ||
    SAFE_CHECKOUT_ID_PATTERN.test(trimmed)
  );
}

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

export function boundedLabel(
  value: string | null | undefined,
  limit = 64,
): string | null {
  return boundedStructuredString(value, limit);
}

export function sanitizeSelectionForV2(
  selection: RoutingTraceV2Selection,
): RoutingTraceV2Selection {
  const label = (value: string): string => boundedLabel(value) ?? value;
  return {
    ...selection,
    refusal_reason:
      selection.refusal_reason == null ? null : label(selection.refusal_reason),
    policy_version: label(selection.policy_version),
    snapshot_version: label(selection.snapshot_version),
    axis: label(selection.axis),
    eligible: selection.eligible.map(label),
    rejected: selection.rejected.map((entry) => ({
      rung_id: label(entry.rung_id),
      reason: label(entry.reason),
    })),
    pruned: selection.pruned.map((entry) => ({
      rung_id: label(entry.rung_id),
      dominated_by: label(entry.dominated_by),
    })),
    budget_constrained: selection.budget_constrained.map(label),
    unranked: selection.unranked.map(label),
    lead_backend:
      selection.lead_backend == null ? null : label(selection.lead_backend),
    ...("lead_repair" in selection
      ? {
          lead_repair:
            selection.lead_repair == null
              ? null
              : {
                  from: label(selection.lead_repair.from),
                  to: label(selection.lead_repair.to),
                  reason: label(selection.lead_repair.reason),
                },
        }
      : {}),
  };
}

/** Bound every free-text field of a workload-profile block; reasons are policy prose, never task text. */
export function sanitizeWorkloadProfileForTrace(
  profile: WorkloadProfileRecord,
): WorkloadProfileRecord {
  return {
    ...profile,
    reasons: profile.reasons.map((reason) => sanitizeFailureDetail(reason, 160) ?? reason),
    evidence_coverage: profile.evidence_coverage.map(
      (item) => boundedLabel(item) ?? item,
    ),
  };
}

export function isRoutingTraceV2(value: unknown): value is RoutingTraceV2 {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { contract?: unknown }).contract === ROUTING_TRACE_V2_CONTRACT
  );
}

export function isLegacyTraceRecord(value: unknown): value is TraceRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Partial<TraceRecord> & { contract?: unknown };
  return (
    record.contract === undefined &&
    typeof record.schema === "number" &&
    typeof record.run_id === "string" &&
    typeof record.backend === "string" &&
    typeof record.mode === "string"
  );
}

// ---------------------------------------------------------------------------
// Trace reader — normalizes v2 and legacy schema-4 records for the control plane
// ---------------------------------------------------------------------------

export type ReadRoutingTrace =
  | { kind: "v2"; record: RoutingTraceV2 }
  | { kind: "legacy"; record: TraceRecord }
  | { kind: "invalid"; error: string };

export function readRoutingTrace(value: unknown): ReadRoutingTrace {
  if (isRoutingTraceV2(value)) {
    const record = value as RoutingTraceV2;
    if (typeof record.schema !== "number" || record.schema > ROUTING_TRACE_V2_SCHEMA_VERSION) {
      return { kind: "invalid", error: `unsupported routing-trace schema ${String(record.schema)}` };
    }
    if (!isLegacyTraceRecord(record.legacy)) {
      return { kind: "invalid", error: "v2 record has no embedded legacy record" };
    }
    return { kind: "v2", record };
  }
  if (isLegacyTraceRecord(value)) {
    return { kind: "legacy", record: value };
  }
  return { kind: "invalid", error: "not a routing trace record" };
}

/** Parse JSONL text into records, reporting invalid lines without aborting. */
export function parseTraceJsonl(text: string): {
  records: Array<Exclude<ReadRoutingTrace, { kind: "invalid" }>>;
  invalid: Array<{ line: number; error: string }>;
} {
  const records: Array<Exclude<ReadRoutingTrace, { kind: "invalid" }>> = [];
  const invalid: Array<{ line: number; error: string }> = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line === "") {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      invalid.push({ line: index + 1, error: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    if (Array.isArray(parsed)) {
      // `arc-orchestrator runs --json` emits one JSON array; accept it too.
      for (const item of parsed) {
        const read = readRoutingTrace(item);
        if (read.kind === "invalid") {
          invalid.push({ line: index + 1, error: read.error });
        } else {
          records.push(read);
        }
      }
      continue;
    }
    const read = readRoutingTrace(parsed);
    if (read.kind === "invalid") {
      invalid.push({ line: index + 1, error: read.error });
    } else {
      records.push(read);
    }
  }
  return { records, invalid };
}

/** The legacy record inside any trace, which is where phase/class/model live. */
export function legacyOf(read: Exclude<ReadRoutingTrace, { kind: "invalid" }>): TraceRecord {
  return read.kind === "v2" ? read.record.legacy : read.record;
}

/** Phase of a trace, interpreting pre-phase records from mode. */
export function phaseOfTrace(legacy: TraceRecord): TaskPhase {
  if (legacy.phase) {
    return legacy.phase;
  }
  return legacy.mode === "review" ? "verify" : legacy.mode;
}
