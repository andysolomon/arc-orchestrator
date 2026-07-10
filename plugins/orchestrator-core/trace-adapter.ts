import {
  type Access,
  type RouteId,
  type RunOutcome,
  type RunRecord,
  validateRunRecord,
} from "arc-contracts";

export type TraceBackend = "codex" | "composer" | "claude";
export type TraceMode = "analyze" | "implement" | "review";

/** One record from `fable-orchestrator runs --json` (trace schema 4 + joined outcome). */
export interface OrchestratorTraceRun {
  schema: number;
  run_id: string;
  timestamp: string;
  backend: TraceBackend;
  mode: TraceMode;
  model: string;
  sandbox: "read-only" | "workspace-write";
  project: string;
  label: string | null;
  task_class: string | null;
  route_rationale: string | null;
  duration_ms: number;
  status: "completed" | "blocked" | "error";
  exit_code: number;
  changed_files: number | null;
  tokens: {
    input_tokens: number;
    cached_input_tokens: number | null;
    output_tokens: number;
    total_tokens: number;
  } | null;
  budget: unknown;
  error: string | null;
  failure_class?: "backend_unavailable";
  outage_reason?: string;
  fallback?: { backend: "claude"; model: string };
  fallback_of?: string;
  outcome: "accepted" | "rejected" | "blocked" | "verification-failed" | "escalated" | null;
}

export interface TraceAdapterContext {
  storyId: string;
  repo: string;
}

const TRACE_BACKENDS: readonly TraceBackend[] = ["codex", "composer", "claude"];
const TRACE_MODES: readonly TraceMode[] = ["analyze", "implement", "review"];
const TRACE_SANDBOXES = ["read-only", "workspace-write"] as const;

const ROUTE_MATRIX: Record<TraceBackend, Record<TraceMode, RouteId>> = {
  codex: {
    analyze: "codex-explore",
    implement: "codex-implement",
    review: "codex-check",
  },
  composer: {
    analyze: "composer-explore",
    implement: "composer-implement",
    review: "composer-check",
  },
  claude: {
    analyze: "opus-explore",
    implement: "opus-implement",
    review: "opus-check",
  },
};

function assertContext(context: TraceAdapterContext): void {
  if (!context.storyId) {
    throw new Error("TraceAdapterContext.storyId must be non-empty");
  }
  if (!context.repo) {
    throw new Error("TraceAdapterContext.repo must be non-empty");
  }
}

function assertTraceEnums(trace: OrchestratorTraceRun): void {
  if (!TRACE_BACKENDS.includes(trace.backend)) {
    throw new Error(`Unknown trace backend: ${String(trace.backend)}`);
  }
  if (!TRACE_MODES.includes(trace.mode)) {
    throw new Error(`Unknown trace mode: ${String(trace.mode)}`);
  }
  if (!TRACE_SANDBOXES.includes(trace.sandbox)) {
    throw new Error(`Unknown trace sandbox: ${String(trace.sandbox)}`);
  }
}

function traceBackendToRunRecordBackend(backend: TraceBackend): string {
  return backend === "composer" ? "cursor" : backend;
}

function traceSandboxToAccess(sandbox: OrchestratorTraceRun["sandbox"]): Access {
  return sandbox === "workspace-write" ? "write" : "read-only";
}

function traceStatusToRunStatus(status: OrchestratorTraceRun["status"]): RunRecord["status"] {
  return status === "completed" ? "completed" : "failed";
}

function traceLabel(trace: OrchestratorTraceRun): string {
  if (trace.label && trace.label.length > 0) {
    return trace.label;
  }
  return `${trace.backend}/${trace.mode}`;
}

function traceOutcomeToRunOutcome(outcome: OrchestratorTraceRun["outcome"]): RunOutcome {
  return outcome ?? "unrated";
}

export function traceRunToRunRecord(
  trace: OrchestratorTraceRun,
  context: TraceAdapterContext,
): RunRecord {
  assertContext(context);
  assertTraceEnums(trace);

  const record: RunRecord = {
    id: trace.run_id,
    storyId: context.storyId,
    label: traceLabel(trace),
    repo: context.repo,
    route: ROUTE_MATRIX[trace.backend][trace.mode],
    backend: traceBackendToRunRecordBackend(trace.backend),
    model: trace.model,
    access: traceSandboxToAccess(trace.sandbox),
    tokens: trace.tokens?.total_tokens ?? 0,
    durMs: trace.duration_ms,
    status: traceStatusToRunStatus(trace.status),
    changed: trace.changed_files ?? 0,
    outcome: traceOutcomeToRunOutcome(trace.outcome),
  };

  validateRunRecord(record);
  return record;
}

export function traceRunsToRunRecords(
  traces: OrchestratorTraceRun[],
  context: TraceAdapterContext,
): RunRecord[] {
  return traces.map((trace) => traceRunToRunRecord(trace, context));
}

function parseCliArgs(argv: string[]): {
  storyId: string;
  repo: string;
  runIds: string[];
} {
  let storyId = "";
  let repo = "";
  const runIds: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--story") {
      storyId = argv[++i] ?? "";
      continue;
    }
    if (arg === "--repo") {
      repo = argv[++i] ?? "";
      continue;
    }
    if (arg === "--run") {
      const runId = argv[++i] ?? "";
      if (runId) runIds.push(runId);
      continue;
    }
    throw new Error(`Unknown or incomplete flag: ${arg}`);
  }

  if (!storyId || !repo) {
    throw new Error("Required flags: --story <id> and --repo <owner/name>");
  }

  return { storyId, repo, runIds };
}

async function readStdinJson(): Promise<unknown> {
  const text = await Bun.stdin.text();
  if (!text.trim()) {
    throw new Error("Expected JSON array on stdin");
  }
  return JSON.parse(text);
}

async function main(): Promise<void> {
  const { storyId, repo, runIds } = parseCliArgs(process.argv.slice(2));
  const parsed = await readStdinJson();
  if (!Array.isArray(parsed)) {
    throw new Error("Expected JSON array on stdin");
  }

  let traces = parsed as OrchestratorTraceRun[];
  if (runIds.length > 0) {
    const filter = new Set(runIds);
    traces = traces.filter((trace) => filter.has(trace.run_id));
  }

  const records = traceRunsToRunRecords(traces, { storyId, repo });
  console.log(JSON.stringify(records));
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
