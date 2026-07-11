import {
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import type { Profile, EnvLike } from "./routes";
import { resolveProfile } from "./routes";
import {
  extractClaudeResult,
  extractComposerResult,
  validateResult,
} from "./envelope";
import {
  buildFallbackHint,
  classifyBackendOutage,
  collectCodexErrors,
} from "./outage";
import {
  type Backend,
  type BackendOutageReason,
  type Effort,
  type Mode,
  type TokenUsage,
  type TraceRecord,
  TRACE_SCHEMA_VERSION,
} from "./trace-schema";

export const RESULT_SCHEMA = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["completed", "blocked"],
    },
    summary: { type: "string" },
    changes: {
      type: "array",
      items: { type: "string" },
    },
    verification: {
      type: "array",
      items: { type: "string" },
    },
    risks: {
      type: "array",
      items: { type: "string" },
    },
    next_actions: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "status",
    "summary",
    "changes",
    "verification",
    "risks",
    "next_actions",
  ],
  additionalProperties: false,
} as const;

export type BudgetConfig = {
  maxTokens: number | null;
  maxDurationMs: number | null;
};

export type BackendInvocationInput = {
  backend: Backend;
  mode: Mode;
  task: string;
  cwd: string;
  taskClass: string | null;
  temporaryDirectory: string;
  budget: BudgetConfig;
  effort: Effort | null;
  profile: Profile;
  prompt: string;
  resultSchema: typeof RESULT_SCHEMA;
};

export type BackendInvocationOutput = {
  stdout: string;
  stderr: string;
  exitCode: number;
  resultText?: string;
};

export type InvokeBackend = (
  input: BackendInvocationInput,
) => Promise<BackendInvocationOutput>;

export type RunAttemptInput = {
  backend: Backend;
  mode: Mode;
  task: string;
  cwd: string;
  label: string | null;
  taskClass: string | null;
  routeRationale: string | null;
  budget: BudgetConfig;
  effort: Effort | null;
  fallbackOf?: string;
};

export type RunAttemptResult = {
  success: boolean;
  result?: Record<string, unknown>;
  trace: TraceRecord;
  outageReason?: BackendOutageReason;
};

export type RunExecutionInput = Omit<RunAttemptInput, "fallbackOf"> & {
  fallback: "claude" | null;
};

export type RunExecutionResult =
  | {
      success: true;
      result: Record<string, unknown>;
      trace: TraceRecord;
      traces: TraceRecord[];
    }
  | {
      success: false;
      trace: TraceRecord;
      traces: TraceRecord[];
    };

export type EngineOptions = {
  env: EnvLike;
  invokeBackend: InvokeBackend;
  emitStderr?: (line: string) => void;
  onTrace?: (trace: TraceRecord) => Promise<void> | void;
  acquireWriteLock?: (
    project: string,
    runId: string,
  ) => Promise<() => void> | (() => void);
};

export function firstNumber(...candidates: unknown[]): number | null {
  for (const candidate of candidates) {
    if (typeof candidate === "number") {
      return candidate;
    }
  }
  return null;
}

// Codex events use snake_case usage keys; the Cursor envelope uses camelCase.
export function tokenUsageFrom(value: unknown): TokenUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const usage = value as Record<string, unknown>;
  const input = firstNumber(usage.input_tokens, usage.inputTokens);
  const output = firstNumber(usage.output_tokens, usage.outputTokens);
  if (input === null || output === null) {
    return null;
  }

  return {
    input_tokens: input,
    cached_input_tokens: firstNumber(
      usage.cached_input_tokens,
      usage.cache_read_input_tokens,
      usage.cacheReadTokens,
    ),
    output_tokens: output,
    total_tokens:
      firstNumber(usage.total_tokens, usage.totalTokens) ?? input + output,
  };
}

export function findTokenUsage(value: unknown, depth = 0): TokenUsage | null {
  if (!value || typeof value !== "object" || depth > 3) {
    return null;
  }

  const direct = tokenUsageFrom(value);
  if (direct) {
    return direct;
  }

  for (const child of Object.values(value)) {
    const found = findTokenUsage(child, depth + 1);
    if (found) {
      return found;
    }
  }

  return null;
}

export function parseCodexTokenUsage(eventStream: string): TokenUsage | null {
  let usage: TokenUsage | null = null;

  for (const line of eventStream.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    try {
      usage = findTokenUsage(JSON.parse(trimmed)) ?? usage;
    } catch {
      continue;
    }
  }

  return usage;
}

export function compactText(text: string, limit: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`;
}

function redactErrorText(text: string, task: string): string {
  const withoutTask = task ? text.split(task).join("<task>") : text;
  return withoutTask.replace(
    /(?:file:\/\/)?\/(?:[\w.@+~-]+\/)+[\w.@+~-]+/g,
    "<path>",
  );
}

export function errorSummary(error: unknown): string {
  return compactText(error instanceof Error ? error.message : String(error), 240);
}

export function projectIdentifier(cwd: string): string {
  return new Bun.CryptoHasher("sha256").update(cwd).digest("hex").slice(0, 12);
}

export function createPrompt(
  mode: Mode,
  instruction: string,
  task: string,
): string {
  return [
    `You are a worker reporting to Claude Fable 5. Mode: ${mode}.`,
    instruction,
    "Return only one valid JSON object with exactly these keys: status, summary, changes, verification, risks, next_actions.",
    'status must be "completed" or "blocked". changes, verification, risks, and next_actions must be arrays of strings.',
    "Keep the summary and evidence compact so the parent model can evaluate it cheaply.",
    `Task: ${task}`,
  ].join("\n\n");
}

function parseBackendResult(
  backend: Backend,
  output: BackendInvocationOutput,
): { result: Record<string, unknown>; tokens: TokenUsage | null } {
  if (backend === "codex") {
    if (output.exitCode !== 0) {
      const detail =
        [output.stderr.trim(), ...collectCodexErrors(output.stdout)]
          .filter(Boolean)
          .join("\n") || `Codex exited with status ${output.exitCode}`;
      throw new Error(`Codex invocation failed\n${detail}`);
    }

    if (!output.resultText) {
      throw new Error("Codex completed without writing a structured result");
    }

    const result = JSON.parse(output.resultText.trim());
    validateResult(result);
    return { result, tokens: parseCodexTokenUsage(output.stdout) };
  }

  if (backend === "composer") {
    if (output.exitCode !== 0) {
      const detail =
        output.stderr.trim() ||
        `Cursor Agent exited with status ${output.exitCode}`;
      throw new Error(
        `Cursor Composer invocation failed\n${detail}\nRun \`cursor-agent login\` and ensure the macOS login keychain is unlocked.`,
      );
    }

    const envelope = JSON.parse(output.stdout.trim()) as Record<string, unknown>;
    if (envelope.is_error === true) {
      throw new Error(
        `Cursor Composer reported an error\n${compactText(String(envelope.result ?? ""), 240)}`,
      );
    }

    return {
      result: extractComposerResult(envelope),
      tokens: findTokenUsage(envelope),
    };
  }

  if (output.exitCode !== 0) {
    const detail = output.stderr.trim() || `Claude exited with status ${output.exitCode}`;
    throw new Error(`Claude invocation failed\n${detail}`);
  }

  const envelope = JSON.parse(output.stdout.trim()) as Record<string, unknown>;
  if (envelope.is_error === true) {
    throw new Error(
      `Claude reported an error\n${compactText(String(envelope.result ?? ""), 240)}`,
    );
  }

  return {
    result: extractClaudeResult(envelope),
    tokens: findTokenUsage(envelope),
  };
}

function buildBudgetRecord(budget: BudgetConfig): TraceRecord["budget"] {
  return budget.maxTokens !== null || budget.maxDurationMs !== null
    ? {
        max_tokens: budget.maxTokens,
        max_duration_ms: budget.maxDurationMs,
        tokens_exceeded: false,
        duration_exceeded: false,
      }
    : null;
}

function recordBackendOutage(
  trace: TraceRecord,
  reason: BackendOutageReason,
  env: EnvLike,
  mode: Mode,
  taskClass: string | null,
): string {
  const hint = buildFallbackHint(
    reason,
    resolveProfile(env, "claude", mode, taskClass).model,
  );
  trace.failure_class = hint.failure_class;
  trace.outage_reason = hint.outage_reason;
  trace.fallback = hint.fallback;
  return JSON.stringify(hint);
}

export async function executeRunAttempt(
  input: RunAttemptInput,
  options: EngineOptions,
): Promise<RunAttemptResult> {
  const profile = resolveProfile(
    options.env,
    input.backend,
    input.mode,
    input.taskClass,
  );
  const trace: TraceRecord = {
    schema: TRACE_SCHEMA_VERSION,
    run_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    backend: input.backend,
    mode: input.mode,
    model: profile.model,
    sandbox: profile.sandbox,
    project: projectIdentifier(input.cwd),
    label: input.label,
    task_class: input.taskClass,
    route_rationale: input.routeRationale,
    duration_ms: 0,
    status: "error",
    exit_code: 1,
    changed_files: null,
    tokens: null,
    budget: buildBudgetRecord(input.budget),
    error: null,
    ...(input.backend === "codex" && input.effort
      ? { effort: input.effort }
      : {}),
    ...(input.fallbackOf ? { fallback_of: input.fallbackOf } : {}),
  };
  const emitStderr = options.emitStderr ?? console.error;
  const startedAt = Date.now();
  const temporaryDirectory = mkdtempSync(`${tmpdir()}/fable-orchestrator-`);
  let releaseWriteLock: (() => void) | null = null;
  let outageReason: BackendOutageReason | undefined;

  try {
    if (trace.sandbox === "workspace-write") {
      releaseWriteLock =
        (await options.acquireWriteLock?.(trace.project, trace.run_id)) ?? null;
    }

    const output = await options.invokeBackend({
      backend: input.backend,
      mode: input.mode,
      task: input.task,
      cwd: input.cwd,
      taskClass: input.taskClass,
      temporaryDirectory,
      budget: input.budget,
      effort: input.effort,
      profile,
      prompt: createPrompt(input.mode, profile.instruction, input.task),
      resultSchema: RESULT_SCHEMA,
    });
    const { result, tokens } = parseBackendResult(input.backend, output);

    trace.status = result.status === "blocked" ? "blocked" : "completed";
    trace.exit_code = 0;
    trace.changed_files = Array.isArray(result.changes)
      ? result.changes.length
      : null;
    trace.tokens = tokens;

    if (
      trace.budget !== null &&
      input.budget.maxTokens !== null &&
      tokens !== null &&
      tokens.total_tokens > input.budget.maxTokens
    ) {
      trace.budget.tokens_exceeded = true;
      emitStderr(
        `fable-orchestrator: budget: run used ${tokens.total_tokens} tokens, exceeding FABLE_ORCHESTRATOR_MAX_TOKENS=${input.budget.maxTokens}`,
      );
    }

    return { success: true, result, trace };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (trace.budget !== null && message.startsWith("budget:")) {
      trace.budget.duration_exceeded = true;
    }
    trace.error = errorSummary(redactErrorText(message, input.task));
    emitStderr(`fable-orchestrator: ${message}`);
    if (input.backend === "codex") {
      const classified = classifyBackendOutage(
        message.split("\n").filter((line) => line.trim()),
      );
      if (classified) {
        outageReason = classified;
        emitStderr(
          recordBackendOutage(
            trace,
            classified,
            options.env,
            input.mode,
            input.taskClass,
          ),
        );
      }
    }
    return { success: false, trace, outageReason };
  } finally {
    releaseWriteLock?.();
    trace.duration_ms = Date.now() - startedAt;
    if (existsSync(temporaryDirectory)) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

export async function executeRun(
  input: RunExecutionInput,
  options: EngineOptions,
): Promise<RunExecutionResult> {
  const { fallback, ...attemptInput } = input;
  const fallbackEnabled = fallback === "claude";
  const traces: TraceRecord[] = [];
  let currentBackend = input.backend;
  let fallbackOf: string | undefined;
  const maxAttempts = fallbackEnabled && input.backend === "codex" ? 2 : 1;
  const emitStderr = options.emitStderr ?? console.error;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptResult = await executeRunAttempt(
      {
        ...attemptInput,
        backend: currentBackend,
        fallbackOf,
      },
      options,
    );

    traces.push(attemptResult.trace);
    await options.onTrace?.(attemptResult.trace);

    if (attemptResult.success) {
      return {
        success: true,
        result: attemptResult.result,
        trace: attemptResult.trace,
        traces,
      };
    }

    const shouldRetry =
      fallbackEnabled &&
      input.backend === "codex" &&
      currentBackend === "codex" &&
      attemptResult.outageReason &&
      attempt === 1;

    if (shouldRetry) {
      emitStderr(
        `fable-orchestrator: codex unavailable (${attemptResult.outageReason}); retrying on claude backend`,
      );
      currentBackend = "claude";
      fallbackOf = attemptResult.trace.run_id;
      continue;
    }

    return {
      success: false,
      trace: attemptResult.trace,
      traces,
    };
  }

  throw new Error("run completed without an attempt");
}
