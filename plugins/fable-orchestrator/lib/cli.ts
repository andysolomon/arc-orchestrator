import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  type BudgetConfig,
  compactText,
  errorSummary,
  executeRun,
} from "./engine";
import {
  type Profile,
  resolveProfile,
  routeCapabilities,
  routesContract,
} from "./routes";
import {
  createSpawnBackendInvoker,
  findExecutable,
} from "./spawn-adapter";
import {
  type Backend,
  type Effort,
  type Mode,
  type RouteId,
  type RoutingTraceV2,
  type TraceRecord,
} from "./trace-schema";
import type { RoutingTraceV2Context } from "./engine";
import { resolveTraceV2Writing } from "./rollout-gates";
import {
  COMPOSER_ECONOMY_ROUTES,
  orchestratorIdentityContract,
  resolveOrchestratorIdentity,
  type OrchestratorIdentity,
} from "./orchestrator-identity";
import {
  isMechanicalRouteAlias,
  mechanicalTaskClassForAlias,
} from "./mechanical-ops-sandbox";
import { minimaxBaseUrl, minimaxConfigured, minimaxModel } from "./minimax";

const EFFORT_LEVELS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

// The parent model's judgment of a completed worker run, recorded after the
// fact and joined to the run by run_id.
type Outcome =
  | "accepted"
  | "rejected"
  | "blocked"
  | "verification-failed"
  | "escalated";

type AnnotationRecord = {
  schema: number;
  run_id: string;
  timestamp: string;
  outcome: Outcome;
  escalated_to: string | null;
  note: string | null;
};

const TRACE_FILE_NAME = "runs.jsonl";
// Sidecar for the named orchestrator-routing-trace/v2 writer. Kept separate from
// runs.jsonl so schema-4 readers are untouched; emitted only when opted in.
const ROUTING_TRACE_V2_FILE_NAME = "routing-trace-v2.jsonl";
const ANNOTATION_SCHEMA_VERSION = 1;

// budget-limits/v1 ceilings (docs/orchestrator/decisions/0003). Recorded as the
// allocated budgets in each v2 record; enforcement is a later phase.
const BUDGET_LIMITS_V1 = {
  root: {
    token: 2_000_000,
    wallTimeMs: 60 * 60 * 1000,
    call: 25,
    cost: 10,
    concurrency: 3,
  },
  dispatch: {
    token: 400_000,
    wallTimeMs: 15 * 60 * 1000,
    call: 1,
    cost: 2.5,
    concurrency: 1,
  },
} as const;
const ANNOTATION_FILE_NAME = "annotations.jsonl";
const OUTCOMES: Outcome[] = [
  "accepted",
  "rejected",
  "blocked",
  "verification-failed",
  "escalated",
];
const LABEL_LIMIT = 80;
const ROUTE_RATIONALE_LIMIT = 240;
const DEFAULT_TRACE_LIMIT = 1000;

function usage(): string {
  return [
    "Usage:",
    "  fable-orchestrator run --backend <codex|composer|claude|minimax> --mode <analyze|implement|review> --task <text> [--orchestrator <fable|sol|composer|opus|cursor-fable-high>] [--route <public route>] [--cwd <path>] [--label <safe text>] [--task-class <safe text>] [--route-rationale <safe text>] [--effort <none|low|medium|high|xhigh|max>] [--fallback claude] [--worker-model <model>]",
    "  fable-orchestrator annotate --run <run id|latest> --outcome <accepted|rejected|blocked|verification-failed|escalated> [--escalated-to <model>] [--note <safe text>]",
    "  fable-orchestrator runs [--json] [--limit <count>]",
    "  fable-orchestrator report [--json] [--group-by <model|backend|mode|task_class>] [--limit <count>]",
    "  fable-orchestrator observability [--json] [--limit <count>]",
    "  fable-orchestrator doctor [--json] [--orchestrator <identity>]",
    "  fable-orchestrator routes --json [--orchestrator <identity>]",
    "",
    "Environment:",
    "  FABLE_ORCHESTRATOR_ORCHESTRATOR (fable|sol|composer|opus|cursor-fable-high; blank/unset means not selected)",
    "  FABLE_ORCHESTRATOR_CODEX_BIN",
    "  FABLE_ORCHESTRATOR_CURSOR_BIN",
    "  FABLE_ORCHESTRATOR_CLAUDE_BIN",
    "  FABLE_ORCHESTRATOR_CLAUDE_MODEL",
    "  FABLE_ORCHESTRATOR_FALLBACK (claude walks the codex -> claude -> grok availability chain, plus minimax when a MiniMax key is configured)",
    "  FABLE_ORCHESTRATOR_COMPOSER_MODEL",
    "  FABLE_ORCHESTRATOR_MINIMAX_MODEL (default MiniMax-M3)",
    "  FABLE_ORCHESTRATOR_MINIMAX_BASE_URL (default https://api.minimax.io/anthropic)",
    "  FABLE_ORCHESTRATOR_MINIMAX_API_KEY (or MINIMAX_API_KEY; enables the minimax backend and fallback tier)",
    "  FABLE_ORCHESTRATOR_ANALYZE_MODEL",
    "  FABLE_ORCHESTRATOR_IMPLEMENT_MODEL",
    "  FABLE_ORCHESTRATOR_REVIEW_MODEL",
    "  FABLE_ORCHESTRATOR_TRACE (0 disables local trace records)",
    "  FABLE_ORCHESTRATOR_TRACE_V2 (0 disables routing-trace-v2 sidecar writes)",
    "  FABLE_ORCHESTRATOR_ROLLOUT_STAGE (fixture|shadow|opt-in|limited-cohort|default)",
    "  FABLE_ORCHESTRATOR_ROLLOUT_OPT_IN (exact 1 activates opt-in stage projection)",
    "  FABLE_ORCHESTRATOR_COHORT_ID (bounded non-sensitive cohort identity)",
    "  FABLE_ORCHESTRATOR_ROLLOUT_COHORT_PERCENT (0-100, default 10)",
    "  FABLE_ORCHESTRATOR_ROLLOUT_SELECTION|FALLBACK|TRACE_V2|DELEGATION (0 rolls back feature)",
    "  FABLE_ORCHESTRATOR_TRACE_DIR (default ~/.fable-orchestrator/traces)",
    "  FABLE_ORCHESTRATOR_TRACE_LIMIT (retained records, default 1000, 0 keeps all)",
    "  FABLE_ORCHESTRATOR_MAX_DURATION_MS (hard stop: kill the worker at this deadline)",
    "  FABLE_ORCHESTRATOR_MAX_TOKENS (flag completed runs that exceed this token total)",
    "  FABLE_ORCHESTRATOR_WRITE_LOCK (0 disables per-project write serialization)",
    "  FABLE_ORCHESTRATOR_LOCK_WAIT_MS (wait this long for the write lock before failing)",
    "  FABLE_ORCHESTRATOR_LAMINAR (1 exports run metadata to Laminar)",
    "  LMNR_PROJECT_API_KEY, LMNR_BASE_URL, LMNR_PROJECT_NAME",
  ].join("\n");
}

function commandStatus(command: string[]): {
  ok: boolean;
  detail: string;
} {
  const result = Bun.spawnSync(command, {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const stdout = result.stdout.toString().trim();
  const stderr = result.stderr.toString().trim();

  return {
    ok: result.exitCode === 0,
    detail: stdout || stderr || `exited with status ${result.exitCode}`,
  };
}

function hasForeignCursorState(): boolean {
  if (process.platform !== "darwin" || typeof process.getuid !== "function") {
    return false;
  }

  const home = process.env.HOME;
  if (!home) {
    return false;
  }

  const paths = [
    resolve(home, ".cursor"),
    resolve(home, ".cursor/cli-config.json"),
    resolve(home, ".cursor/agent-cli-state.json"),
  ];
  const currentUserId = process.getuid();

  return paths.some((path) => {
    try {
      return existsSync(path) && statSync(path).uid !== currentUserId;
    } catch {
      return false;
    }
  });
}

function tracingEnabled(): boolean {
  return process.env.FABLE_ORCHESTRATOR_TRACE?.trim() !== "0";
}

function positiveEnvInteger(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return null;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    fail(`${name} must be a positive integer`);
  }
  return value;
}

function resolveBudget(): BudgetConfig {
  return {
    maxTokens: positiveEnvInteger("FABLE_ORCHESTRATOR_MAX_TOKENS"),
    maxDurationMs: positiveEnvInteger("FABLE_ORCHESTRATOR_MAX_DURATION_MS"),
  };
}

const LOCK_DIRECTORY_NAME = "locks";
const LOCK_POLL_INTERVAL_MS = 250;

type LockHolder = {
  pid: number;
  run_id: string;
  timestamp: string;
};

function writeLockPath(project: string): string {
  return resolve(traceDirectory(), LOCK_DIRECTORY_NAME, `${project}.lock`);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function tryClaimWriteLock(path: string, holder: LockHolder): boolean {
  try {
    writeFileSync(path, JSON.stringify(holder), { flag: "wx" });
    return true;
  } catch {
    // The lock exists. Reclaim it only when the recorded holder is gone.
    try {
      const existing = JSON.parse(readFileSync(path, "utf8")) as LockHolder;
      if (typeof existing.pid === "number" && processAlive(existing.pid)) {
        return false;
      }
    } catch {
      // An unreadable lock file is treated as stale.
    }

    rmSync(path, { force: true });
    try {
      writeFileSync(path, JSON.stringify(holder), { flag: "wx" });
      return true;
    } catch {
      return false;
    }
  }
}

// Write-capable runs serialize per project so two workers never edit the
// same checkout concurrently. Read-only runs never take the lock, and
// separate worktrees resolve to different projects, so safe parallelism
// stays available.
async function acquireWriteLock(
  project: string,
  runId: string,
): Promise<() => void> {
  if (process.env.FABLE_ORCHESTRATOR_WRITE_LOCK?.trim() === "0") {
    return () => {};
  }

  mkdirSync(resolve(traceDirectory(), LOCK_DIRECTORY_NAME), {
    recursive: true,
  });
  const path = writeLockPath(project);
  const holder: LockHolder = {
    pid: process.pid,
    run_id: runId,
    timestamp: new Date().toISOString(),
  };
  const waitMs = positiveEnvInteger("FABLE_ORCHESTRATOR_LOCK_WAIT_MS") ?? 0;
  const deadline = Date.now() + waitMs;

  for (;;) {
    if (tryClaimWriteLock(path, holder)) {
      return () => rmSync(path, { force: true });
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    await Bun.sleep(Math.min(LOCK_POLL_INTERVAL_MS, remaining));
  }

  throw new Error(
    `another write-capable run holds the write lock for this project (${path}). Wait for it to finish, run from a separate worktree, extend FABLE_ORCHESTRATOR_LOCK_WAIT_MS, or set FABLE_ORCHESTRATOR_WRITE_LOCK=0 if you accept overlapping writes`,
  );
}

function traceDirectory(): string {
  return (
    process.env.FABLE_ORCHESTRATOR_TRACE_DIR?.trim() ||
    resolve(homedir(), ".fable-orchestrator", "traces")
  );
}

function traceLimit(): number {
  const raw = process.env.FABLE_ORCHESTRATOR_TRACE_LIMIT?.trim();
  if (!raw) {
    return DEFAULT_TRACE_LIMIT;
  }

  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_TRACE_LIMIT;
}

function enforceTraceRetention(path: string, limit: number): void {
  if (limit === 0) {
    return;
  }

  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim());
  if (lines.length <= limit) {
    return;
  }

  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${lines.slice(-limit).join("\n")}\n`);
  renameSync(temporaryPath, path);
}

function appendTrace(record: TraceRecord): void {
  if (!tracingEnabled()) {
    return;
  }

  try {
    const directory = traceDirectory();
    mkdirSync(directory, { recursive: true });
    const path = resolve(directory, TRACE_FILE_NAME);
    appendFileSync(path, `${JSON.stringify(record)}\n`);
    enforceTraceRetention(path, traceLimit());
  } catch (error) {
    console.error(
      `fable-orchestrator: failed to write trace record: ${errorSummary(error)}`,
    );
  }
}

function routingTraceV2Enabled(): boolean {
  return resolveTraceV2Writing(process.env);
}

function appendRoutingTraceV2(record: RoutingTraceV2): void {
  if (!tracingEnabled() || !routingTraceV2Enabled()) {
    return;
  }

  try {
    const directory = traceDirectory();
    mkdirSync(directory, { recursive: true });
    const path = resolve(directory, ROUTING_TRACE_V2_FILE_NAME);
    appendFileSync(path, `${JSON.stringify(record)}\n`);
    enforceTraceRetention(path, traceLimit());
  } catch (error) {
    console.error(
      `fable-orchestrator: failed to write routing-trace-v2 record: ${errorSummary(error)}`,
    );
  }
}

// Root/dispatch allocated budgets and lineage identity for the v2 writer. Task
// IDs and scheduler IDs are read from the environment as bounded, non-sensitive
// identifiers; task text is never used.
function routingTraceV2Context(): RoutingTraceV2Context {
  const budgetScope = (scope: (typeof BUDGET_LIMITS_V1)["root"]) => ({
    token: { allocated: scope.token },
    wallTimeMs: { allocated: scope.wallTimeMs },
    call: { allocated: scope.call },
    cost: { allocated: scope.cost },
    concurrency: { allocated: scope.concurrency },
  });
  const schedulerId = process.env.FABLE_ORCHESTRATOR_SCHEDULER_ID?.trim();
  const taskId = process.env.FABLE_ORCHESTRATOR_TASK_ID?.trim();
  return {
    depth: 0,
    parentRunId: null,
    schedulerId: schedulerId ? compactText(schedulerId, LABEL_LIMIT) : null,
    taskId: taskId ? compactText(taskId, LABEL_LIMIT) : null,
    rootBudget: budgetScope(BUDGET_LIMITS_V1.root),
    dispatchBudget: budgetScope(BUDGET_LIMITS_V1.dispatch),
  };
}

function readJsonLines<T>(fileName: string): T[] {
  const path = resolve(traceDirectory(), fileName);
  if (!existsSync(path)) {
    return [];
  }

  const records: T[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) {
      continue;
    }

    try {
      records.push(JSON.parse(line) as T);
    } catch {
      continue;
    }
  }

  return records;
}

function readTraceRecords(): TraceRecord[] {
  return readJsonLines<TraceRecord>(TRACE_FILE_NAME);
}

function readAnnotations(): AnnotationRecord[] {
  return readJsonLines<AnnotationRecord>(ANNOTATION_FILE_NAME);
}

// The most recent annotation for each run wins, so a later "accepted" can
// correct an earlier "escalated" and vice versa.
function latestOutcomeByRun(): Map<string, AnnotationRecord> {
  const latest = new Map<string, AnnotationRecord>();
  for (const annotation of readAnnotations()) {
    latest.set(annotation.run_id, annotation);
  }
  return latest;
}

function appendAnnotation(record: AnnotationRecord): void {
  const directory = traceDirectory();
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, ANNOTATION_FILE_NAME);
  appendFileSync(path, `${JSON.stringify(record)}\n`);
  enforceTraceRetention(path, traceLimit());
}

function parseLimitArguments(
  args: string[],
  command: string,
): { asJson: boolean; limit: number } {
  let asJson = false;
  let limit = 20;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--json") {
      asJson = true;
      continue;
    }

    if (argument === "--limit") {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        fail("--limit must be a positive integer");
      }
      limit = value;
      index += 1;
      continue;
    }

    fail(`${command} does not accept ${argument ?? ""}`);
  }

  return { asJson, limit };
}

// Runs enriched with the parent model's latest outcome for programmatic use.
function runsWithOutcomes(limit: number): (TraceRecord & {
  outcome: Outcome | null;
})[] {
  const outcomes = latestOutcomeByRun();
  return readTraceRecords()
    .slice(-limit)
    .map((record) => ({
      ...record,
      outcome: outcomes.get(record.run_id)?.outcome ?? null,
    }));
}

function runRuns(args: string[]): void {
  const { asJson, limit } = parseLimitArguments(args, "runs");
  const records = runsWithOutcomes(limit);

  if (asJson) {
    process.stdout.write(`${JSON.stringify(records)}\n`);
    return;
  }

  if (records.length === 0) {
    console.log(`No recorded runs in ${traceDirectory()}.`);
    return;
  }

  const byModel = new Map<string, { runs: number; tokens: number }>();

  for (const record of records) {
    const tokens = record.tokens
      ? `${record.tokens.total_tokens} tokens`
      : "tokens unknown";
    // Schema 1 records carried task_label instead of an explicit label.
    const legacy = record as TraceRecord & { task_label?: string };
    const label = record.label ?? legacy.task_label ?? "";
    const outcome = record.outcome ? `[${record.outcome}]` : "[unrated]";
    const fallbackMarker = record.fallback_of ? " [fallback]" : "";
    console.log(
      `${record.timestamp}  ${record.backend}/${record.mode}  ${record.model}  ${record.status}  ${outcome}  ${record.duration_ms}ms  ${tokens}  ${record.project ?? ""}  ${label}${fallbackMarker}`.trimEnd(),
    );

    const entry = byModel.get(record.model) ?? { runs: 0, tokens: 0 };
    entry.runs += 1;
    entry.tokens += record.tokens?.total_tokens ?? 0;
    byModel.set(record.model, entry);
  }

  console.log("");
  console.log(`Last ${records.length} runs by model:`);
  for (const [model, entry] of byModel) {
    console.log(`- ${model}: ${entry.runs} runs, ${entry.tokens} tokens`);
  }
}

function runObservability(args: string[]): void {
  const { asJson, limit } = parseLimitArguments(args, "observability");
  const records = readTraceRecords();
  const outcomes = latestOutcomeByRun();
  const recent = records.slice(-limit).map((record) => ({
    ...record,
    outcome: outcomes.get(record.run_id)?.outcome ?? null,
  }));
  const tokens = records.reduce(
    (total, record) => total + (record.tokens?.total_tokens ?? 0),
    0,
  );
  const byModel = new Map<string, { runs: number; tokens: number }>();

  for (const record of records) {
    const entry = byModel.get(record.model) ?? { runs: 0, tokens: 0 };
    entry.runs += 1;
    entry.tokens += record.tokens?.total_tokens ?? 0;
    byModel.set(record.model, entry);
  }

  const byOutcome: Record<string, number> = { unrated: 0 };
  for (const outcome of OUTCOMES) {
    byOutcome[outcome] = 0;
  }
  for (const record of records) {
    const outcome = outcomes.get(record.run_id)?.outcome ?? "unrated";
    byOutcome[outcome] = (byOutcome[outcome] ?? 0) + 1;
  }

  const laminarEnabled = process.env.FABLE_ORCHESTRATOR_LAMINAR?.trim() === "1";
  const laminarApiKeyConfigured = Boolean(
    process.env.LMNR_PROJECT_API_KEY?.trim(),
  );
  const summary = {
    trace: {
      enabled: process.env.FABLE_ORCHESTRATOR_TRACE?.trim() !== "0",
      directory: traceDirectory(),
      file: resolve(traceDirectory(), TRACE_FILE_NAME),
      limit: traceLimit(),
      records: records.length,
    },
    laminar: {
      enabled: laminarEnabled,
      api_key_configured: laminarApiKeyConfigured,
      export_ready: laminarEnabled && laminarApiKeyConfigured,
      group_name: process.env.LMNR_PROJECT_NAME?.trim() || "fable-orchestrator",
      base_url: process.env.LMNR_BASE_URL?.trim() || "https://api.lmnr.ai",
    },
    totals: {
      runs: records.length,
      tokens,
      by_model: Object.fromEntries(byModel),
      by_outcome: byOutcome,
    },
    recent,
  };

  if (asJson) {
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return;
  }

  console.log("Fable Orchestrator observability");
  console.log(
    `Local trace: ${summary.trace.enabled ? "enabled" : "disabled"} (${summary.trace.records} records)`,
  );
  console.log(`Trace file: ${summary.trace.file}`);
  console.log(
    `Laminar: ${summary.laminar.export_ready ? "ready" : "not ready"} (enabled=${summary.laminar.enabled}, api_key_configured=${summary.laminar.api_key_configured}, group=${summary.laminar.group_name})`,
  );
  console.log(`Total tokens recorded: ${tokens}`);
  console.log("Runs by model:");
  if (byModel.size === 0) {
    console.log("- none yet");
  } else {
    for (const [model, entry] of byModel) {
      console.log(`- ${model}: ${entry.runs} runs, ${entry.tokens} tokens`);
    }
  }

  console.log("Runs by parent outcome:");
  for (const [outcome, count] of Object.entries(byOutcome)) {
    if (count > 0) {
      console.log(`- ${outcome}: ${count}`);
    }
  }

  console.log("");
  runRuns(["--limit", String(limit)]);
}

function runAnnotate(args: string[]): void {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument?.startsWith("--")) {
      fail(`unexpected argument: ${argument ?? ""}`);
    }

    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`missing value for ${argument}`);
    }

    if (
      !["--run", "--outcome", "--escalated-to", "--note"].includes(argument)
    ) {
      fail(`unknown option: ${argument}`);
    }

    values.set(argument, value);
    index += 1;
  }

  const outcome = values.get("--outcome");
  if (!outcome || !OUTCOMES.includes(outcome as Outcome)) {
    fail(`--outcome must be one of ${OUTCOMES.join(", ")}`);
  }

  const runSelector = values.get("--run")?.trim();
  if (!runSelector) {
    fail("--run is required (a run id or 'latest')");
  }

  const records = readTraceRecords();
  let runId = runSelector as string;

  if (runSelector === "latest") {
    const last = records[records.length - 1];
    if (!last) {
      fail("no recorded runs to annotate");
    }
    runId = last.run_id;
  } else if (!records.some((record) => record.run_id === runSelector)) {
    // The run may have aged out of the bounded trace file; record the
    // annotation anyway but make the mismatch visible.
    console.error(
      `fable-orchestrator: no local run ${runSelector}; recording annotation anyway`,
    );
  }

  const escalatedTo = values.get("--escalated-to")?.trim();
  const note = values.get("--note")?.trim();
  const record: AnnotationRecord = {
    schema: ANNOTATION_SCHEMA_VERSION,
    run_id: runId,
    timestamp: new Date().toISOString(),
    outcome: outcome as Outcome,
    escalated_to: escalatedTo ? compactText(escalatedTo, LABEL_LIMIT) : null,
    note: note ? compactText(note, ROUTE_RATIONALE_LIMIT) : null,
  };

  try {
    appendAnnotation(record);
  } catch (error) {
    fail(`failed to write annotation: ${errorSummary(error)}`);
  }

  console.log(`Recorded ${record.outcome} for run ${runId}.`);
}

type ReportDimension = "model" | "backend" | "mode" | "task_class";

const REPORT_DIMENSIONS: ReportDimension[] = [
  "model",
  "backend",
  "mode",
  "task_class",
];

type ReportGroup = {
  key: string;
  runs: number;
  by_status: { completed: number; blocked: number; error: number };
  completion_rate: number;
  rated: number;
  by_outcome: Record<Outcome, number>;
  acceptance_rate: number | null;
  budget_exceeded: number;
  tokens_total: number;
  tokens_runs: number;
  tokens_mean: number | null;
  duration_ms_total: number;
  duration_ms_mean: number | null;
};

function groupKeyFor(record: TraceRecord, dimension: ReportDimension): string {
  if (dimension === "task_class") {
    return record.task_class ?? "(unclassified)";
  }
  return record[dimension];
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function buildReport(
  records: TraceRecord[],
  dimension: ReportDimension,
): ReportGroup[] {
  const outcomes = latestOutcomeByRun();
  const groups = new Map<string, ReportGroup>();

  for (const record of records) {
    const key = groupKeyFor(record, dimension);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        runs: 0,
        by_status: { completed: 0, blocked: 0, error: 0 },
        completion_rate: 0,
        rated: 0,
        by_outcome: {
          accepted: 0,
          rejected: 0,
          blocked: 0,
          "verification-failed": 0,
          escalated: 0,
        },
        acceptance_rate: null,
        budget_exceeded: 0,
        tokens_total: 0,
        tokens_runs: 0,
        tokens_mean: null,
        duration_ms_total: 0,
        duration_ms_mean: null,
      };
      groups.set(key, group);
    }

    group.runs += 1;
    group.by_status[record.status] += 1;
    group.duration_ms_total += record.duration_ms;
    if (record.tokens) {
      group.tokens_total += record.tokens.total_tokens;
      group.tokens_runs += 1;
    }
    if (record.budget?.tokens_exceeded || record.budget?.duration_exceeded) {
      group.budget_exceeded += 1;
    }

    const outcome = outcomes.get(record.run_id)?.outcome;
    if (outcome) {
      group.rated += 1;
      group.by_outcome[outcome] += 1;
    }
  }

  const report = [...groups.values()];
  for (const group of report) {
    group.completion_rate = round(group.by_status.completed / group.runs);
    group.acceptance_rate =
      group.rated > 0 ? round(group.by_outcome.accepted / group.rated) : null;
    group.tokens_mean =
      group.tokens_runs > 0
        ? round(group.tokens_total / group.tokens_runs, 1)
        : null;
    group.duration_ms_mean =
      group.runs > 0 ? round(group.duration_ms_total / group.runs, 1) : null;
  }

  // Busiest groups first so the most-used routes lead the comparison.
  report.sort((left, right) => right.runs - left.runs);
  return report;
}

function runReport(args: string[]): void {
  let asJson = false;
  let dimension: ReportDimension = "model";
  let limit: number | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--json") {
      asJson = true;
      continue;
    }

    if (argument === "--group-by") {
      const value = args[index + 1];
      if (!value || !REPORT_DIMENSIONS.includes(value as ReportDimension)) {
        fail(`--group-by must be one of ${REPORT_DIMENSIONS.join(", ")}`);
      }
      dimension = value as ReportDimension;
      index += 1;
      continue;
    }

    if (argument === "--limit") {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        fail("--limit must be a positive integer");
      }
      limit = value;
      index += 1;
      continue;
    }

    fail(`report does not accept ${argument ?? ""}`);
  }

  const all = readTraceRecords();
  const records = limit === null ? all : all.slice(-limit);
  const groups = buildReport(records, dimension);

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ group_by: dimension, runs: records.length, groups })}\n`,
    );
    return;
  }

  if (records.length === 0) {
    console.log(`No recorded runs in ${traceDirectory()}.`);
    return;
  }

  console.log(
    `Comparative report by ${dimension} (${records.length} runs)`,
  );
  for (const group of groups) {
    const acceptance =
      group.acceptance_rate === null
        ? "n/a"
        : `${round(group.acceptance_rate * 100, 1)}%`;
    const tokensMean =
      group.tokens_mean === null ? "n/a" : String(group.tokens_mean);
    const durationMean =
      group.duration_ms_mean === null
        ? "n/a"
        : `${group.duration_ms_mean}ms`;
    const budgetNote =
      group.budget_exceeded > 0
        ? `  budget_exceeded=${group.budget_exceeded}`
        : "";
    console.log("");
    console.log(`- ${group.key}`);
    console.log(
      `    runs=${group.runs}  completion=${round(group.completion_rate * 100, 1)}%  (completed=${group.by_status.completed}, blocked=${group.by_status.blocked}, error=${group.by_status.error})${budgetNote}`,
    );
    console.log(
      `    rated=${group.rated}  acceptance=${acceptance}  (accepted=${group.by_outcome.accepted}, rejected=${group.by_outcome.rejected}, escalated=${group.by_outcome.escalated}, verification-failed=${group.by_outcome["verification-failed"]})`,
    );
    console.log(
      `    tokens: mean=${tokensMean}  total=${group.tokens_total}  |  duration: mean=${durationMean}  total=${group.duration_ms_total}ms`,
    );
  }
}

type LaminarConfig = {
  apiKey: string;
  baseUrl: string;
  groupName: string;
};

function resolveLaminarConfig(): LaminarConfig | null {
  if (process.env.FABLE_ORCHESTRATOR_LAMINAR?.trim() !== "1") {
    return null;
  }

  const apiKey = process.env.LMNR_PROJECT_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "fable-orchestrator: FABLE_ORCHESTRATOR_LAMINAR=1 requires LMNR_PROJECT_API_KEY; skipping Laminar export",
    );
    return null;
  }

  return {
    apiKey,
    baseUrl: (
      process.env.LMNR_BASE_URL?.trim() || "https://api.lmnr.ai"
    ).replace(/\/+$/, ""),
    groupName: process.env.LMNR_PROJECT_NAME?.trim() || "fable-orchestrator",
  };
}

// Mirrors the Laminar SDK's mapping from API host to dashboard host.
function laminarFrontendUrl(baseUrl: string): string {
  return baseUrl === "https://api.lmnr.ai" ? "https://www.laminar.sh" : baseUrl;
}

async function laminarPost(
  config: LaminarConfig,
  path: string,
  body: unknown,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    throw new Error(`Laminar ${path} responded ${response.status}: ${detail}`);
  }

  return (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
}

async function exportRunToLaminar(record: TraceRecord): Promise<void> {
  const config = resolveLaminarConfig();
  if (!config) {
    return;
  }

  // Same boundary as the local trace: routing facts and counters only,
  // never prompts, secrets, or file contents.
  const metadata = {
    "run.id": record.run_id,
    "run.orchestrator_identity": record.orchestrator_identity ?? null,
    "run.backend": record.backend,
    "run.mode": record.mode,
    "run.sandbox": record.sandbox,
    "run.status": record.status,
    "gen_ai.request.model": record.model,
  };

  try {
    const evaluation = await laminarPost(config, "/v1/evals", {
      name: `${record.backend}:${record.mode} ${record.timestamp}`,
      groupName: config.groupName,
      metadata,
    });
    const evaluationId = evaluation?.id;
    if (typeof evaluationId !== "string") {
      throw new Error("Laminar /v1/evals did not return an evaluation id");
    }

    const datapointId = crypto.randomUUID();
    await laminarPost(config, `/v1/evals/${evaluationId}/datapoints`, {
      points: [
        {
          id: datapointId,
          data: {
            backend: record.backend,
            orchestrator_identity: record.orchestrator_identity ?? null,
            mode: record.mode,
            model: record.model,
            label: record.label,
            project: record.project,
            task_class: record.task_class,
            route_rationale: record.route_rationale,
          },
          index: 0,
          traceId: crypto.randomUUID(),
          executorSpanId: crypto.randomUUID(),
          metadata,
        },
      ],
      groupName: config.groupName,
    });

    const scores: Record<string, number> = {
      completed: record.status === "completed" ? 1 : 0,
      duration_ms: record.duration_ms,
    };
    if (record.changed_files !== null) {
      scores.changed_files = record.changed_files;
    }
    if (record.tokens) {
      scores.input_tokens = record.tokens.input_tokens;
      scores.output_tokens = record.tokens.output_tokens;
      scores.total_tokens = record.tokens.total_tokens;
      if (record.tokens.cached_input_tokens !== null) {
        scores.cached_input_tokens = record.tokens.cached_input_tokens;
      }
    }

    await laminarPost(
      config,
      `/v1/evals/${evaluationId}/datapoints/${datapointId}`,
      {
        executorOutput: {
          status: record.status,
          changed_files: record.changed_files,
          error: record.error,
        },
        scores,
      },
    );

    // Printed only after the datapoint has fully landed; stderr keeps
    // stdout reserved for the structured worker result.
    const projectId = evaluation.projectId;
    if (typeof projectId === "string") {
      console.error(
        `fable-orchestrator: laminar: ${laminarFrontendUrl(config.baseUrl)}/project/${projectId}/evaluations/${evaluationId}`,
      );
    }
  } catch (error) {
    console.error(
      `fable-orchestrator: Laminar export failed: ${errorSummary(error)}`,
    );
  }
}

function probeClaudeAuth(claudePath: string): {
  authenticated: boolean;
  detail: string;
} {
  const result = commandStatus([claudePath, "auth", "status"]);
  if (!result.ok) {
    return { authenticated: false, detail: result.detail };
  }

  try {
    const status = JSON.parse(result.detail) as Record<string, unknown>;
    const authenticated = status.loggedIn === true;
    const authMethod =
      typeof status.authMethod === "string"
        ? status.authMethod
        : typeof status.email === "string"
          ? status.email
          : "unknown";
    return {
      authenticated,
      detail: authenticated
        ? `Logged in (${authMethod})`
        : `Not logged in (${authMethod})`,
    };
  } catch {
    return { authenticated: false, detail: result.detail };
  }
}

const CODEX_MODELS = ["gpt-5.5", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"] as const;
const COMPOSER_MODELS = ["composer-2.5", "grok-4.5"] as const;

function modelAvailability(
  backendReady: boolean,
  models: readonly string[],
): Record<string, { available: boolean }> {
  return Object.fromEntries(
    models.map((model) => [model, { available: backendReady }]),
  );
}

function runDoctor(
  asJson: boolean,
  orchestratorIdentity: OrchestratorIdentity | null,
): void {
  const codexName =
    process.env.FABLE_ORCHESTRATOR_CODEX_BIN?.trim() || "codex";
  const cursorName =
    process.env.FABLE_ORCHESTRATOR_CURSOR_BIN?.trim() || "cursor-agent";
  const claudeName =
    process.env.FABLE_ORCHESTRATOR_CLAUDE_BIN?.trim() || "claude";
  const codexPath = findExecutable(codexName);
  const cursorPath = findExecutable(cursorName);
  const claudePath = findExecutable(claudeName);
  const codexStatus = codexPath
    ? commandStatus([codexPath, "login", "status"])
    : { ok: false, detail: "Codex CLI is not installed or not on PATH" };
  const cursorStatus = cursorPath
    ? process.env.CURSOR_API_KEY
      ? { ok: true, detail: "CURSOR_API_KEY is configured" }
      : commandStatus([cursorPath, "status"])
    : { ok: false, detail: "Cursor Agent is not installed or not on PATH" };
  const claudeAuth = claudePath
    ? probeClaudeAuth(claudePath)
    : {
        authenticated: false,
        detail: "Claude CLI is not installed or not on PATH",
      };
  const foreignCursorState = hasForeignCursorState();
  const nextActions: string[] = [];

  if (orchestratorIdentity !== "composer") {
    if (!codexPath) {
      nextActions.push("Install the Codex CLI.");
    } else if (!codexStatus.ok) {
      nextActions.push("Run `codex login` without sudo.");
    }
  }

  if (!cursorPath) {
    nextActions.push("Install Cursor Agent from https://cursor.com/install.");
  } else if (!cursorStatus.ok) {
    nextActions.push(
      "Run `cursor-agent login` without sudo, or configure `CURSOR_API_KEY`.",
    );
  }

  if (foreignCursorState) {
    nextActions.push(
      'Repair sudo-created state with `sudo chown -R "$(id -un)":"$(id -gn)" "$HOME/.cursor"`; never run Cursor Agent with sudo.',
    );
  }

  const codexHealthy = Boolean(codexPath) && codexStatus.ok;
  const composerHealthy =
    Boolean(cursorPath) && cursorStatus.ok && !foreignCursorState;
  const claudeReady = Boolean(claudePath) && claudeAuth.authenticated;
  const minimaxReady =
    Boolean(claudePath) && minimaxConfigured(process.env);
  if (orchestratorIdentity === "composer" && !claudeReady) {
    nextActions.push(
      claudePath
        ? "Authenticate the Claude CLI for the opus-explore and opus-check economy workers."
        : "Install the Claude CLI for the opus-explore and opus-check economy workers.",
    );
  }
  if (
    orchestratorIdentity !== "composer" &&
    !codexHealthy &&
    claudeReady
  ) {
    nextActions.push(
      "Codex is unavailable; the claude backend (Opus 4.8) can take delegated runs: --backend claude, or set FABLE_ORCHESTRATOR_FALLBACK=claude for automatic retry.",
    );
  }
  if (
    orchestratorIdentity !== "composer" &&
    !codexHealthy &&
    !claudeReady &&
    minimaxReady
  ) {
    nextActions.push(
      "Codex and Claude are unavailable; the minimax backend (MiniMax-M3 through the Claude CLI) can take delegated runs: --backend minimax.",
    );
  }

  const report = {
    status:
      (orchestratorIdentity === "composer"
        ? composerHealthy && claudeReady
        : codexPath &&
          codexStatus.ok &&
          cursorPath &&
          cursorStatus.ok &&
          !foreignCursorState)
        ? "ready"
        : "attention_required",
    ...(orchestratorIdentity === "composer"
      ? routesContract(process.env, orchestratorIdentity)
      : orchestratorIdentityContract(orchestratorIdentity)),
    codex: {
      installed: Boolean(codexPath),
      authenticated: codexStatus.ok,
      detail: codexStatus.detail,
      models: modelAvailability(codexHealthy, CODEX_MODELS),
    },
    composer: {
      installed: Boolean(cursorPath),
      authenticated: cursorStatus.ok,
      detail: cursorStatus.detail,
      foreign_owned_state: foreignCursorState,
      models: modelAvailability(composerHealthy, COMPOSER_MODELS),
    },
    claude: {
      installed: Boolean(claudePath),
      authenticated: claudeAuth.authenticated,
      detail: claudeAuth.detail,
    },
    minimax: {
      configured: minimaxReady,
      model: minimaxModel(process.env),
      base_url: minimaxBaseUrl(process.env),
      detail: minimaxReady
        ? "API key configured (runs through the Claude CLI)"
        : Boolean(claudePath)
          ? "Set FABLE_ORCHESTRATOR_MINIMAX_API_KEY or MINIMAX_API_KEY to enable"
          : "Requires the Claude CLI plus a MiniMax API key",
    },
    next_actions: nextActions,
  };

  if (asJson) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }

  console.log(`Fable Orchestrator: ${report.status}`);
  console.log(
    `Codex: ${report.codex.installed ? "installed" : "missing"}, ${report.codex.authenticated ? "authenticated" : "not authenticated"}`,
  );
  if (codexHealthy) {
    console.log(`  models: ${CODEX_MODELS.join(", ")} available`);
  }
  console.log(
    `Composer: ${report.composer.installed ? "installed" : "missing"}, ${report.composer.authenticated ? "authenticated" : "not authenticated"}`,
  );
  if (composerHealthy) {
    console.log(`  models: ${COMPOSER_MODELS.join(", ")} available`);
  }
  console.log(
    `Claude: ${report.claude.installed ? "installed" : "missing"}, ${report.claude.authenticated ? "authenticated" : "not authenticated"}`,
  );
  console.log(
    `MiniMax: ${report.minimax.configured ? "configured" : "not configured"} (${report.minimax.model})`,
  );
  for (const action of nextActions) {
    console.log(`- ${action}`);
  }
}

function fail(message: string, exitCode = 2): never {
  console.error(`fable-orchestrator: ${message}`);
  console.error(usage());
  process.exit(exitCode);
}

function resolveFallback(flagValue: string | undefined): "claude" | null {
  const envValue = process.env.FABLE_ORCHESTRATOR_FALLBACK?.trim();
  if (flagValue && flagValue !== "claude") {
    fail("--fallback must be claude");
  }
  if (envValue && envValue !== "claude") {
    fail("FABLE_ORCHESTRATOR_FALLBACK must be claude");
  }
  return flagValue === "claude" || envValue === "claude" ? "claude" : null;
}

export type ParsedRunArguments = {
  backend: Backend;
  mode: Mode;
  task: string;
  cwd: string;
  label: string | null;
  taskClass: string | null;
  routeRationale: string | null;
  fallback: "claude" | null;
  effort: Effort | null;
  workerModel: string | null;
  requestedAlias: RouteId | null;
  profileOverride: Profile | null;
  orchestratorIdentity: OrchestratorIdentity | null;
};

export function parseArguments(args: string[]): ParsedRunArguments {
  if (args[0] !== "run") {
    fail("expected the run command");
  }

  const values = new Map<string, string>();

  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];

    if (!argument?.startsWith("--")) {
      fail(`unexpected argument: ${argument ?? ""}`);
    }

    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`missing value for ${argument}`);
    }

    if (
      ![
        "--backend",
        "--mode",
        "--task",
        "--cwd",
        "--label",
        "--task-class",
        "--route-rationale",
        "--route",
        "--effort",
        "--fallback",
        "--orchestrator",
        "--worker-model",
      ].includes(argument)
    ) {
      fail(`unknown option: ${argument}`);
    }

    values.set(argument, value);
    index += 1;
  }

  const routeId = values.get("--route")?.trim().toLowerCase() as
    | RouteId
    | undefined;
  const requestedRoute = routeId
    ? routeCapabilities(process.env).find((candidate) => candidate.id === routeId)
    : undefined;
  if (routeId && !requestedRoute) {
    fail("--route must be an executable public route");
  }

  const modeRaw = values.get("--mode") ?? requestedRoute?.mode;
  if (!modeRaw || !["analyze", "implement", "review"].includes(modeRaw)) {
    fail("--mode must be analyze, implement, or review");
  }
  const mode = modeRaw as Mode;

  const task = values.get("--task")?.trim();
  if (!task) {
    fail("--task is required");
  }

  const cwd = resolve(values.get("--cwd") ?? process.cwd());
  if (!existsSync(cwd)) {
    fail(`working directory does not exist: ${cwd}`);
  }

  let orchestratorIdentity: OrchestratorIdentity | null;
  try {
    orchestratorIdentity = resolveOrchestratorIdentity(
      values.get("--orchestrator"),
      process.env,
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  const routeIsMechanical = isMechanicalRouteAlias(routeId);
  const economyRoute =
    orchestratorIdentity === "composer" && !routeIsMechanical
      ? COMPOSER_ECONOMY_ROUTES[mode]
      : null;
  if (economyRoute && routeId && routeId !== economyRoute.route) {
    fail(
      `Composer orchestrator mode requires --route ${economyRoute.route} for ${mode}`,
    );
  }
  if (
    economyRoute &&
    values.has("--backend") &&
    values.get("--backend") !== economyRoute.backend
  ) {
    fail(
      `Composer orchestrator mode requires --backend ${economyRoute.backend} for ${mode}`,
    );
  }

  const effectiveRouteId = economyRoute?.route ?? routeId;
  const route = economyRoute
    ? routeCapabilities(process.env).find(
        (candidate) => candidate.id === economyRoute.route,
      )
    : requestedRoute;
  const backend =
    economyRoute?.backend ?? values.get("--backend") ?? route?.backend ?? "codex";
  if (!["codex", "composer", "claude", "minimax"].includes(backend)) {
    fail("--backend must be codex, composer, claude, or minimax");
  }

  if (route && route.backend !== backend) {
    fail("--route must match --backend");
  }
  if (route && route.mode !== mode) {
    fail("--route must match --mode");
  }

  const effortRaw = values.get("--effort")?.trim();
  if (effortRaw && !EFFORT_LEVELS.includes(effortRaw as Effort)) {
    fail("--effort must be one of none, low, medium, high, xhigh, max");
  }
  const effort = effortRaw ? (effortRaw as Effort) : null;
  if (effort && backend !== "codex") {
    fail("--effort is only supported on the codex backend");
  }

  const workerModel = values.get("--worker-model")?.trim();
  if (
    workerModel &&
    !/^[A-Za-z0-9][A-Za-z0-9._,=/[\]-]{0,127}$/.test(workerModel)
  ) {
    fail("--worker-model contains unsupported characters");
  }
  if (workerModel && routeId) {
    fail("--worker-model cannot be combined with --route; the route contract owns its model");
  }
  if (workerModel && orchestratorIdentity === "composer") {
    fail("--worker-model is not supported in Composer orchestrator economy mode");
  }

  const label = values.get("--label")?.trim();
  const explicitTaskClass = values.get("--task-class")?.trim();
  const mechanicalTaskClass = mechanicalTaskClassForAlias(effectiveRouteId);
  const taskClass = explicitTaskClass || mechanicalTaskClass || undefined;
  const routeRationale = values.get("--route-rationale")?.trim();
  const profile = resolveProfile(
    process.env,
    backend as Backend,
    mode,
    taskClass,
    effectiveRouteId ?? null,
  );
  const effectiveProfile = economyRoute
    ? {
        ...profile,
        model: economyRoute.model,
        sandbox: economyRoute.sandbox,
      }
    : profile;

  if (
    backend === "composer" &&
    mode !== "implement" &&
    effectiveProfile.sandbox !== "read-only"
  ) {
    fail(
      "the composer backend only supports analyze/review when the resolved profile is read-only and Cursor plan mode can enforce it",
    );
  }

  return {
    backend: backend as Backend,
    mode,
    task,
    cwd,
    label: label ? compactText(label, LABEL_LIMIT) : null,
    taskClass: taskClass ? compactText(taskClass, LABEL_LIMIT) : null,
    routeRationale: routeRationale
      ? compactText(routeRationale, ROUTE_RATIONALE_LIMIT)
      : null,
    fallback: resolveFallback(values.get("--fallback")?.trim()),
    effort,
    workerModel: workerModel || null,
    requestedAlias: effectiveRouteId ?? null,
    profileOverride: effectiveRouteId ? effectiveProfile : null,
    orchestratorIdentity,
  };
}

function parseIdentityCommandArguments(
  command: "doctor" | "routes",
  args: string[],
): { asJson: boolean; orchestratorIdentity: OrchestratorIdentity | null } {
  let asJson = false;
  let cliIdentity: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      asJson = true;
      continue;
    }
    if (argument === "--orchestrator") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        fail("missing value for --orchestrator");
      }
      cliIdentity = value;
      index += 1;
      continue;
    }
    fail(`${command} only accepts --json and --orchestrator <identity>`);
  }
  if (command === "routes" && !asJson) {
    fail("routes requires --json");
  }
  try {
    return {
      asJson,
      orchestratorIdentity: resolveOrchestratorIdentity(cliIdentity, process.env),
    };
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function runRoutes(orchestratorIdentity: OrchestratorIdentity | null): void {
  process.stdout.write(
    `${JSON.stringify(routesContract(process.env, orchestratorIdentity))}\n`,
  );
}

export async function main(): Promise<void> {
  if (process.argv[2] === "routes") {
    const parsed = parseIdentityCommandArguments("routes", process.argv.slice(3));
    runRoutes(parsed.orchestratorIdentity);
    return;
  }

  if (process.argv[2] === "doctor") {
    const parsed = parseIdentityCommandArguments("doctor", process.argv.slice(3));
    runDoctor(parsed.asJson, parsed.orchestratorIdentity);
    return;
  }

  if (process.argv[2] === "runs") {
    runRuns(process.argv.slice(3));
    return;
  }

  if (process.argv[2] === "observability") {
    runObservability(process.argv.slice(3));
    return;
  }

  if (process.argv[2] === "annotate") {
    runAnnotate(process.argv.slice(3));
    return;
  }

  if (process.argv[2] === "report") {
    runReport(process.argv.slice(3));
    return;
  }

  const {
    backend: initialBackend,
    mode,
    task,
    cwd,
    label,
    taskClass,
    routeRationale,
    fallback,
    effort,
    workerModel,
    requestedAlias,
    profileOverride,
    orchestratorIdentity,
  } = parseArguments(process.argv.slice(2));
  const budget = resolveBudget();
  const v2Enabled = routingTraceV2Enabled();
  const runResult = await executeRun(
    {
      backend: initialBackend,
      mode,
      task,
      cwd,
      label,
      taskClass,
      routeRationale,
      budget,
      effort,
      orchestratorIdentity,
      fallback,
      ...(workerModel ? { workerModel } : {}),
      ...(requestedAlias ? { requestedAlias } : {}),
      ...(profileOverride ? { profileOverride } : {}),
      ...(v2Enabled ? { v2: routingTraceV2Context() } : {}),
    },
    {
      env: process.env,
      invokeBackend: createSpawnBackendInvoker(process.env),
      acquireWriteLock,
      onTrace: async (trace) => {
        appendTrace(trace);
        await exportRunToLaminar(trace);
      },
      ...(v2Enabled
        ? { onRoutingTraceV2: (record) => appendRoutingTraceV2(record) }
        : {}),
      emitStderr: console.error,
    },
  );

  if (runResult.success) {
    process.stdout.write(`${JSON.stringify(runResult.result)}\n`);
    return;
  }

  process.exitCode = 1;
}
