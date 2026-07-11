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
  | "opus-check";

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
