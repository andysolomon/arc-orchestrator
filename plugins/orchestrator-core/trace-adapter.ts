import {
  type Access,
  type RouteId as ContractRouteId,
  type RunOutcome,
  type RunRecord,
  validateRunRecord,
} from "arc-contracts";
import {
  type Backend,
  type Mode,
  type RoutingTraceV2,
  type TraceRecord,
  type RouteId,
  isRoutingTraceV2,
} from "./trace-schema";

/** One record from `fable-orchestrator runs --json` (trace schema 4 + joined outcome). */
export type OrchestratorTraceRun = TraceRecord & {
  outcome: "accepted" | "rejected" | "blocked" | "verification-failed" | "escalated" | null;
};

/**
 * A named orchestrator-routing-trace/v2 record, optionally carrying a joined
 * parent outcome. During the rollout the adapter must dual-read these alongside
 * legacy schema-4 records; the richer routing/lineage/budget fields are consumed
 * by the board migration (issue #125), so here we only unwrap the embedded
 * legacy record for the existing RunRecord mapping.
 */
export type RoutingTraceV2Run = RoutingTraceV2 & {
  outcome?: OrchestratorTraceRun["outcome"];
};

export type TraceRunInput = OrchestratorTraceRun | RoutingTraceV2Run;

/** Normalize either a legacy schema-4 run or a v2 record to an OrchestratorTraceRun. */
export function toOrchestratorTraceRun(record: TraceRunInput): OrchestratorTraceRun {
  if (isRoutingTraceV2(record)) {
    return { ...record.legacy, outcome: record.outcome ?? null };
  }
  return record;
}

export type { Backend, Mode } from "./trace-schema";

export interface TraceAdapterContext {
  storyId: string;
  repo: string;
}

const TRACE_BACKENDS: readonly Backend[] = ["codex", "composer", "claude"];
const TRACE_MODES: readonly Mode[] = ["analyze", "implement", "review"];
const TRACE_SANDBOXES = ["read-only", "workspace-write"] as const;

const ROUTE_MATRIX: Partial<Record<Backend, Partial<Record<Mode, RouteId>>>> = {
  codex: {
    analyze: "codex-explore",
    implement: "codex-implement",
    review: "codex-check",
  },
  composer: {
    implement: "composer-implement",
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

function resolveRoute(backend: Backend, mode: Mode): RouteId {
  const route = ROUTE_MATRIX[backend]?.[mode];
  if (!route) {
    throw new Error(`No route for backend ${backend} and mode ${mode}`);
  }
  return route;
}

function traceBackendToRunRecordBackend(backend: Backend): string {
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
  input: TraceRunInput,
  context: TraceAdapterContext,
): RunRecord {
  assertContext(context);
  const trace = toOrchestratorTraceRun(input);
  assertTraceEnums(trace);

  const record: RunRecord = {
    id: trace.run_id,
    storyId: context.storyId,
    label: traceLabel(trace),
    repo: context.repo,
    route: resolveRoute(trace.backend, trace.mode) as ContractRouteId,
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
  traces: TraceRunInput[],
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

  let traces = parsed as TraceRunInput[];
  if (runIds.length > 0) {
    const filter = new Set(runIds);
    traces = traces.filter((trace) => filter.has(toOrchestratorTraceRun(trace).run_id));
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
