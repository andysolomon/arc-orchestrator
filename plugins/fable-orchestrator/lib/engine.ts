import {
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import type { Profile, EnvLike } from "./routes";
import {
  grokModelFor,
  grokProfileFor,
  profileFor,
  resolveProfile,
} from "./routes";
import {
  compactResult,
  extractClaudeResult,
  extractComposerResult,
  RESULT_COMPACT_LIMITS,
  validateResult,
} from "./envelope";
import {
  buildFallbackHint,
  classifyBackendOutage,
  collectCodexErrors,
  collectOpenCodeErrors,
  formatBackendOutageMessage,
  type BackendFallback,
} from "./outage";
import { minimaxConfigured, minimaxModel } from "./minimax";
import { kimiConfigured, kimiModel } from "./kimi";
import {
  executableAliasForBackendMode,
  resolveRoutingShadow,
  type RoutingShadowReport,
} from "./routing-shadow";
import {
  resolveRoutingIntent,
  type RoutingIntent,
} from "./routing-intent";
import {
  MODEL_REGISTRY,
  MODEL_REGISTRY_SCHEMA_VERSION,
  candidateStackForRoute,
  type ModelRegistryEntry,
} from "./model-registry";
import {
  CAPABILITY_ROUTES,
  CAPABILITY_ROUTES_SCHEMA_VERSION,
  resolvePublicAlias,
} from "./capability-routes";
import {
  normalizeBackendOutage,
  dispositionFor,
  type FailureDisposition,
} from "./failure-classification";
import { runFallbackTraversal } from "./fallback-engine";
import {
  resolveFallbackStage,
} from "./rollout-gates";
import { ROUTING_SHADOW_SCHEMA_VERSION } from "./routing-shadow";
import {
  buildRoutingTraceV2,
  DISPATCH_COST_RESERVATION_V1,
  type Backend,
  type BackendOutageReason,
  type Effort,
  type Mode,
  type RouteId,
  type RoutingTraceV2,
  type RoutingTraceV2BudgetScopeInput,
  type RoutingTraceV2BudgetMeasurement,
  type RoutingTraceV2Input,
  type TokenUsage,
  type TraceRecord,
  TRACE_SCHEMA_VERSION,
} from "./trace-schema";
import {
  COMPOSER_ECONOMY_POLICY,
  COMPOSER_ECONOMY_ROUTES,
  type OrchestratorIdentity,
} from "./orchestrator-identity";

type TraceRecordWithRoutingShadow = TraceRecord & {
  routingShadow?: RoutingShadowReport;
  routing_shadow_error?: string;
};

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
  workloadClass?: string | null;
  temporaryDirectory: string;
  budget: BudgetConfig;
  effort: Effort | null;
  profile: Profile;
  prompt: string;
  resultSchema: typeof RESULT_SCHEMA;
  requestedAlias?: string | null;
  // Emits only bounded lifecycle milestones; backend transcripts remain private.
  emitProgress?: (message: string) => void;
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
  workloadClass?: string | null;
  // Optional asserted CLI compatibility marker; traced only, never selects.
  routingPolicy?: string | null;
  routeRationale: string | null;
  budget: BudgetConfig;
  effort: Effort | null;
  orchestratorIdentity?: OrchestratorIdentity | null;
  fallbackOf?: string;
  // Canonical selection passes the already-validated profile so an activated
  // route cannot be changed again by broad legacy model environment overrides.
  profileOverride?: Profile;
  // Keep shadow evidence keyed to the caller's public alias across fallback
  // attempts instead of changing it to the selected backend/mode alias.
  requestedAlias?: string;
  // Preserve the validated active-selection report, including override outcome,
  // rather than recomputing observational shadow data without the override.
  routingShadowOverride?: RoutingShadowReport;
  // Canonical traversal records actual previous→current transitions in v2.
  // Suppress legacy hard-coded next-hop hints so traces do not emit wrong
  // backend chains during screenshot-stack availability walks.
  suppressLegacyFallbackHint?: boolean;
};

export type RunAttemptResult = {
  success: boolean;
  result?: Record<string, unknown>;
  trace: TraceRecord;
  outageReason?: BackendOutageReason;
};

export type RunExecutionInput = Omit<RunAttemptInput, "fallbackOf"> & {
  fallback: "claude" | null;
  // Explicit worker model pin for the requested backend on the default path.
  // Fallback tiers keep their own defaults because a model id rarely resolves
  // across backends.
  workerModel?: string | null;
  // Optional lineage/budget context for the v2 writer. Ignored unless
  // `EngineOptions.onRoutingTraceV2` is provided.
  v2?: RoutingTraceV2Context;
  // Explicit routing intent from the CLI/engine caller. When omitted, inferred
  // from route/backend/worker-model/selection-stage signals.
  routingIntent?: RoutingIntent | null;
  // true when the caller supplied --backend; false when omitted.
  backendExplicit?: boolean;
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
  // Optional named orchestrator-routing-trace/v2 writer. When omitted (the
  // default) no v2 record is built and execution is byte-for-byte unchanged.
  onRoutingTraceV2?: (record: RoutingTraceV2) => Promise<void> | void;
  acquireWriteLock?: (
    project: string,
    runId: string,
  ) => Promise<() => void> | (() => void);
};

// Lineage/scheduler identity threaded into every v2 record. Depth 0 with a null
// parent is a root run; a delegating scheduler passes the inherited root id and
// its already-consumed budget so consumption never resets across delegation.
export type RoutingTraceV2Context = {
  rootRunId?: string;
  parentRunId?: string | null;
  taskId?: string | null;
  depth?: number;
  schedulerId?: string | null;
  // Root-scope allocated ceilings and any pre-consumed amount inherited from an
  // ancestor (so root consumption never resets across delegation).
  rootBudget?: RoutingTraceV2BudgetScopeInput;
  // Dispatch-scope allocated ceilings for one worker dispatch/traversal.
  dispatchBudget?: RoutingTraceV2BudgetScopeInput;
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

// OpenCode `--format json` emits one JSON object per line (JSONL events).
// Completed assistant text arrives as `{ type: "text", part: { text } }`.
export function parseOpenCodeJsonl(eventStream: string): {
  resultText: string;
  tokens: TokenUsage | null;
} {
  const textChunks: string[] = [];
  let tokens: TokenUsage | null = null;

  for (const line of eventStream.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      tokens = findTokenUsage(event) ?? tokens;
      if (event.type === "text") {
        const part = event.part;
        if (part && typeof part === "object") {
          const text = (part as { text?: unknown }).text;
          if (typeof text === "string" && text.trim()) {
            textChunks.push(text);
          }
        }
      }
    } catch {
      continue;
    }
  }

  return { resultText: textChunks.join("\n").trim(), tokens };
}

function extractOpenCodeResult(eventStream: string): {
  result: Record<string, unknown>;
  tokens: TokenUsage | null;
} {
  const { resultText, tokens } = parseOpenCodeJsonl(eventStream);
  if (!resultText) {
    throw new Error("OpenCode Kimi K3 completed without writing a structured result");
  }

  // Prefer a fenced JSON object, then a bare JSON object, then the last JSON
  // object embedded in the assistant text stream.
  const fenced = resultText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [
    fenced?.[1]?.trim(),
    resultText.trim(),
    ...Array.from(resultText.matchAll(/\{[\s\S]*\}/g)).map((match) => match[0]),
  ].filter((value): value is string => Boolean(value));

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (typeof parsed.result === "string") {
        const nested = JSON.parse(parsed.result) as Record<string, unknown>;
        validateResult(nested);
        return { result: nested, tokens: findTokenUsage(parsed) ?? tokens };
      }
      validateResult(parsed);
      return { result: parsed, tokens: findTokenUsage(parsed) ?? tokens };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("OpenCode Kimi K3 completed without a valid structured result");
}

export function compactText(text: string, limit: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`;
}

function safeProgressModel(model: string): string {
  const compact = model.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,79}$/.test(compact)
    ? compact
    : "configured-model";
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

export function resolveCodexEffort(
  backend: Backend,
  mode: Mode,
  effort: Effort | null,
): Effort | null {
  if (backend !== "codex") {
    return effort;
  }
  if (effort !== null) {
    return effort;
  }
  if (mode === "implement" || mode === "review") {
    return "high";
  }
  return null;
}

export function createPrompt(
  mode: Mode,
  instruction: string,
  task: string,
  _requestedAlias: string | null = null,
): string {
  return [
    `You are a worker reporting to Claude Fable 5. Mode: ${mode}.`,
    instruction,
    "Return only one valid JSON object with exactly these keys: status, summary, changes, verification, risks, next_actions.",
    'status must be "completed" or "blocked". changes, verification, risks, and next_actions must be arrays of strings.',
    "Keep the summary and evidence compact so the parent model can evaluate it cheaply.",
    `Size caps: summary max ${RESULT_COMPACT_LIMITS.summary} characters; changes max ${RESULT_COMPACT_LIMITS.changes} items; verification max ${RESULT_COMPACT_LIMITS.verification}; risks max ${RESULT_COMPACT_LIMITS.risks}; next_actions max ${RESULT_COMPACT_LIMITS.next_actions}; each array item max ${RESULT_COMPACT_LIMITS.item} characters. Prefer repo-relative paths in array items.`,
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

  if (backend === "opencode") {
    const jsonlErrors = collectOpenCodeErrors(output.stdout);
    if (output.exitCode !== 0) {
      const detail =
        [output.stderr.trim(), ...jsonlErrors].filter(Boolean).join("\n") ||
        `OpenCode exited with status ${output.exitCode}`;
      throw new Error(`OpenCode Kimi K3 invocation failed\n${detail}`);
    }
    return extractOpenCodeResult(output.stdout);
  }

  const claudeCliLabel =
    backend === "minimax"
      ? "MiniMax (Claude CLI)"
      : backend === "kimi"
        ? "Kimi (Claude CLI)"
        : "Claude";
  if (output.exitCode !== 0) {
    const detail =
      output.stderr.trim() ||
      `${claudeCliLabel} exited with status ${output.exitCode}`;
    throw new Error(`${claudeCliLabel} invocation failed\n${detail}`);
  }

  const envelope = JSON.parse(output.stdout.trim()) as Record<string, unknown>;
  if (envelope.is_error === true) {
    throw new Error(
      `${claudeCliLabel} reported an error\n${compactText(String(envelope.result ?? ""), 240)}`,
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
  failedBackend: Backend,
  reason: BackendOutageReason,
  env: EnvLike,
  mode: Mode,
  taskClass: string | null,
  suppressFallback: boolean,
): string | null {
  if (suppressFallback) {
    trace.failure_class = "backend_unavailable";
    trace.outage_reason = reason;
    return null;
  }
  const fallback: BackendFallback | null =
    failedBackend === "claude"
      ? { backend: "composer", model: grokModelFor(env) }
      : failedBackend === "composer"
        ? minimaxConfigured(env)
          ? { backend: "minimax", model: minimaxModel(env) }
          : kimiConfigured(env)
            ? { backend: "kimi", model: kimiModel(env) }
            : {
                backend: "claude",
                model: resolveProfile(env, "claude", mode, taskClass).model,
              }
        : failedBackend === "minimax"
          ? kimiConfigured(env)
            ? { backend: "kimi", model: kimiModel(env) }
            : null
          : failedBackend === "kimi"
            ? null
            : {
                backend: "claude",
                model: resolveProfile(env, "claude", mode, taskClass).model,
              };
  if (!fallback) {
    trace.failure_class = "backend_unavailable";
    trace.outage_reason = reason;
    return null;
  }
  const hint = buildFallbackHint(reason, fallback);
  trace.failure_class = hint.failure_class;
  trace.outage_reason = hint.outage_reason;
  trace.fallback = hint.fallback;
  return JSON.stringify(hint);
}

export async function executeRunAttempt(
  input: RunAttemptInput,
  options: EngineOptions,
): Promise<RunAttemptResult> {
  const profile =
    input.profileOverride ??
    resolveProfile(
      options.env,
      input.backend,
      input.mode,
      input.taskClass,
      input.requestedAlias as RouteId | undefined,
    );
  const effort = resolveCodexEffort(input.backend, input.mode, input.effort);
  const trace: TraceRecordWithRoutingShadow = {
    schema: TRACE_SCHEMA_VERSION,
    run_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    backend: input.backend,
    orchestrator_identity: input.orchestratorIdentity ?? null,
    mode: input.mode,
    model: profile.model,
    sandbox: profile.sandbox,
    project: projectIdentifier(input.cwd),
    label: input.label,
    task_class: input.taskClass,
    ...(input.workloadClass !== undefined ? { workload_class: input.workloadClass } : {}),
    ...(input.routingPolicy ? { routing_policy: input.routingPolicy } : {}),
    route_rationale: input.routeRationale,
    duration_ms: 0,
    status: "error",
    exit_code: 1,
    changed_files: null,
    tokens: null,
    budget: buildBudgetRecord(input.budget),
    error: null,
    ...(input.backend === "codex" && effort ? { effort } : {}),
    ...(input.fallbackOf ? { fallback_of: input.fallbackOf } : {}),
  };

  try {
    if (input.routingShadowOverride) {
      trace.routingShadow = input.routingShadowOverride;
    } else {
      // Codex models no longer have public route aliases, so
      // executableAliasForBackendMode returns null for codex backends. Fall back
      // to the canonical capability route id (resolveRoutingShadow accepts it) so
      // shadow evidence is retained on the legacy/off path instead of dropped.
      const alias =
        input.requestedAlias ??
        executableAliasForBackendMode(input.backend, input.mode) ??
        canonicalRouteForBackendMode(input.backend, input.mode);
      if (alias) {
        trace.routingShadow = resolveRoutingShadow({
          requestedAlias: alias,
          env: options.env,
          taskClass: input.taskClass,
        });
      }
    }
  } catch (error) {
    trace.routing_shadow_error = errorSummary(error);
  }

  const emitStderr = options.emitStderr ?? console.error;
  const startedAt = Date.now();
  const temporaryDirectory = mkdtempSync(`${tmpdir()}/fable-orchestrator-`);
  let releaseWriteLock: (() => void) | null = null;
  let outageReason: BackendOutageReason | undefined;
  let backendExitCode: number | null = null;

  try {
    emitStderr(
      `fable-orchestrator: progress: preparing ${input.backend} ${input.mode} worker (model ${safeProgressModel(profile.model)})`,
    );
    if (trace.sandbox === "workspace-write") {
      emitStderr(
        "fable-orchestrator: progress: waiting for project write lock",
      );
      releaseWriteLock =
        (await options.acquireWriteLock?.(trace.project, trace.run_id)) ?? null;
      emitStderr(
        "fable-orchestrator: progress: project write lock acquired",
      );
    }

    emitStderr(
      `fable-orchestrator: progress: worker is running (${input.backend}/${input.mode}); awaiting provider response`,
    );
    const output = await options.invokeBackend({
      backend: input.backend,
      mode: input.mode,
      task: input.task,
      cwd: input.cwd,
      taskClass: input.taskClass,
      temporaryDirectory,
      budget: input.budget,
      effort,
      profile,
      prompt: createPrompt(
        input.mode,
        profile.instruction,
        input.task,
        input.requestedAlias ?? null,
      ),
      resultSchema: RESULT_SCHEMA,
      requestedAlias: input.requestedAlias ?? null,
      emitProgress: (message) =>
        emitStderr(`fable-orchestrator: progress: ${message}`),
    });
    backendExitCode = output.exitCode;
    emitStderr(
      "fable-orchestrator: progress: worker returned; validating result (provider response received; parsing structured result)",
    );
    const { result: validatedResult, tokens } = parseBackendResult(
      input.backend,
      output,
    );
    const result = compactResult(validatedResult, input.cwd);
    emitStderr(
      "fable-orchestrator: progress: structured result accepted; recording evidence",
    );

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
    trace.exit_code = backendExitCode ?? 1;
    const message = error instanceof Error ? error.message : String(error);
    if (trace.budget !== null && message.startsWith("budget:")) {
      trace.budget.duration_exceeded = true;
    }
    trace.error = errorSummary(redactErrorText(message, input.task));
    if (
      input.backend === "codex" ||
      input.backend === "claude" ||
      input.backend === "minimax" ||
      input.backend === "opencode" ||
      input.backend === "kimi" ||
      // Composer failures are classified in economy mode and when the composer
      // attempt is itself a fallback tier (so traversal can continue past it).
      (input.backend === "composer" &&
        (input.orchestratorIdentity === "composer" || Boolean(input.fallbackOf)))
    ) {
      const classified = classifyBackendOutage(
        message.split("\n").filter((line) => line.trim()),
      );
      if (classified) {
        outageReason = classified;
        const fallbackHint = recordBackendOutage(
          trace,
          input.backend,
          classified,
          options.env,
          input.mode,
          input.taskClass,
          input.suppressLegacyFallbackHint === true ||
            input.orchestratorIdentity === "composer",
        );
        emitStderr(formatBackendOutageMessage(input.backend, classified));
        if (fallbackHint !== null) {
          emitStderr(fallbackHint);
        }
      } else {
        emitStderr(`fable-orchestrator: ${message}`);
      }
    } else {
      emitStderr(`fable-orchestrator: ${message}`);
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

// Registry lookup by any bounded label so the legacy path can populate v2
// serving identity (provider, adapter, provider model id) from a model string.
const REGISTRY_BY_LABEL_V2 = new Map<string, ModelRegistryEntry>();
for (const entry of MODEL_REGISTRY) {
  for (const label of [entry.stableId, entry.displayName, ...entry.aliases]) {
    const normalized = label.trim().toLowerCase();
    if (normalized !== "") {
      REGISTRY_BY_LABEL_V2.set(normalized, entry);
    }
  }
  if (entry.providerModelId) {
    REGISTRY_BY_LABEL_V2.set(entry.providerModelId.trim().toLowerCase(), entry);
  }
}

function servingFromEntry(
  entry: ModelRegistryEntry | null | undefined,
): RoutingTraceV2Input["serving"] {
  if (!entry) {
    return {};
  }
  return {
    provider: entry.servingProvider,
    providerModelId: entry.providerModelId,
    transportBackend:
      entry.transportBackend === "claude-code-parent"
        ? null
        : entry.transportBackend,
    adapterId: entry.adapterId,
    adapterVersion: entry.adapterVersion,
    stableId: entry.stableId,
  };
}

function servingFromModel(model: string | null): RoutingTraceV2Input["serving"] {
  if (!model) {
    return {};
  }
  return servingFromEntry(REGISTRY_BY_LABEL_V2.get(model.trim().toLowerCase()));
}

type V2AttemptExtras = {
  route: RoutingTraceV2Input["route"];
  models: RoutingTraceV2Input["models"];
  serving?: RoutingTraceV2Input["serving"];
  traversal: RoutingTraceV2Input["traversal"];
  failure?: RoutingTraceV2Input["failure"];
  authorization?: RoutingTraceV2Input["authorization"];
  policyVersion?: string;
};

// Phase 5 has no numeric pricing wired; measured dispatch cost is unavailable.
function measuredDispatchCost(_trace: TraceRecord): number | null {
  return null;
}

type DispatchCostState = {
  reconciled: boolean;
  consumed: number;
  measurement: RoutingTraceV2BudgetMeasurement;
};

function reconcileDispatchCost(
  trace: TraceRecord,
  dispatchBudget: RoutingTraceV2BudgetScopeInput,
  state: DispatchCostState,
): void {
  const measured = measuredDispatchCost(trace);
  if (measured !== null) {
    state.consumed += measured;
    state.measurement = "known";
    return;
  }
  if (state.reconciled) {
    return;
  }
  state.consumed =
    dispatchBudget.cost?.allocated ?? DISPATCH_COST_RESERVATION_V1;
  state.reconciled = true;
  state.measurement = "unknown";
}

// Builds one orchestrator-routing-trace/v2 record per dispatch/candidate
// attempt, maintaining cumulative consumption so totals never reset across
// fallback attempts within the traversal. Returns a no-op when no v2 writer is
// configured, so the default execution path is untouched.
function createRoutingTraceV2Emitter(
  options: EngineOptions,
  context: RoutingTraceV2Context | undefined,
): (trace: TraceRecord, extras: V2AttemptExtras) => Promise<void> {
  if (!options.onRoutingTraceV2) {
    return async () => {};
  }
  const emit = options.onRoutingTraceV2;
  const rootBudget = context?.rootBudget ?? {};
  const dispatchBudget = context?.dispatchBudget ?? {};
  const allocated = (
    scope: RoutingTraceV2BudgetScopeInput,
    dimension: keyof RoutingTraceV2BudgetScopeInput,
  ): number | null => scope[dimension]?.allocated ?? null;
  const explicitRemaining = (
    scope: RoutingTraceV2BudgetScopeInput,
    dimension: keyof RoutingTraceV2BudgetScopeInput,
  ): number | null | undefined => scope[dimension]?.remaining;

  const rootDimension = (
    dimension: keyof RoutingTraceV2BudgetScopeInput,
    consumed: number,
    extra?: { measurement?: RoutingTraceV2BudgetMeasurement },
  ) => ({
    allocated: allocated(rootBudget, dimension),
    consumed,
    ...(explicitRemaining(rootBudget, dimension) !== undefined
      ? { remaining: explicitRemaining(rootBudget, dimension) }
      : {}),
    ...extra,
  });

  // Ancestor consumption belongs to root scope only; the dispatch total starts
  // fresh for this traversal. Both accumulate monotonically across attempts.
  const ancestor = {
    token: rootBudget.token?.consumed ?? 0,
    wallTimeMs: rootBudget.wallTimeMs?.consumed ?? 0,
    call: rootBudget.call?.consumed ?? 0,
    cost: rootBudget.cost?.consumed ?? 0,
    concurrency: rootBudget.concurrency?.consumed ?? 0,
  };
  const dispatchConsumed = { token: 0, wallTimeMs: 0, call: 0 };
  const dispatchCost: DispatchCostState = {
    reconciled: false,
    consumed: 0,
    measurement: "known",
  };
  let rootRunId = context?.rootRunId ?? null;

  return async (trace, extras) => {
    if (rootRunId === null) {
      rootRunId = trace.run_id;
    }
    const attemptTokens = trace.tokens?.total_tokens ?? 0;
    dispatchConsumed.token += attemptTokens;
    dispatchConsumed.wallTimeMs += trace.duration_ms;
    dispatchConsumed.call += 1;
    reconcileDispatchCost(trace, dispatchBudget, dispatchCost);
    const dispatchConcurrencyConsumed = 1;

    const record = buildRoutingTraceV2({
      legacy: trace,
      route: extras.route,
      models: extras.models,
      serving: extras.serving ?? {},
      traversal: extras.traversal,
      failure: extras.failure,
      authorization: extras.authorization,
      lineage: {
        rootRunId,
        parentRunId: context?.parentRunId ?? null,
        taskId: context?.taskId ?? null,
        depth: context?.depth ?? 0,
        schedulerId: context?.schedulerId ?? null,
      },
      budgets: {
        root: {
          token: rootDimension("token", ancestor.token + dispatchConsumed.token),
          wallTimeMs: rootDimension(
            "wallTimeMs",
            ancestor.wallTimeMs + dispatchConsumed.wallTimeMs,
          ),
          call: rootDimension("call", ancestor.call + dispatchConsumed.call),
          cost: rootDimension("cost", ancestor.cost + dispatchCost.consumed, {
            measurement: dispatchCost.measurement,
          }),
          concurrency: rootDimension(
            "concurrency",
            ancestor.concurrency + dispatchConcurrencyConsumed,
          ),
        },
        dispatch: {
          token: {
            allocated: allocated(dispatchBudget, "token"),
            consumed: dispatchConsumed.token,
          },
          wallTimeMs: {
            allocated: allocated(dispatchBudget, "wallTimeMs"),
            consumed: dispatchConsumed.wallTimeMs,
          },
          call: {
            allocated: allocated(dispatchBudget, "call"),
            consumed: dispatchConsumed.call,
          },
          cost: {
            allocated: allocated(dispatchBudget, "cost"),
            consumed: dispatchCost.consumed,
            measurement: dispatchCost.measurement,
          },
          concurrency: {
            allocated: allocated(dispatchBudget, "concurrency"),
            consumed: dispatchConcurrencyConsumed,
          },
        },
      },
      versions: {
        policy: extras.policyVersion ?? "candidate-stacks/v1",
        registry: MODEL_REGISTRY_SCHEMA_VERSION,
        capabilityRoutes: CAPABILITY_ROUTES_SCHEMA_VERSION,
        routingShadow: ROUTING_SHADOW_SCHEMA_VERSION,
      },
    });
    await emit(record);
  };
}

function aliasRouteFor(
  requestedAlias: string | null,
): Pick<
  RoutingTraceV2Input["route"],
  "requestedPublicAlias" | "requestedAliasKind" | "canonicalCapabilityRoute"
> {
  if (!requestedAlias) {
    return {
      requestedPublicAlias: null,
      requestedAliasKind: null,
      canonicalCapabilityRoute: null,
    };
  }
  const binding = resolvePublicAlias(requestedAlias);
  const canonicalCapabilityRoute = binding
    ? binding.capabilityRoute
    : (canonicalRouteForBackendMode(
        requestedAlias as any,
        null,
      ) ?? null);
  return {
    requestedPublicAlias: requestedAlias,
    requestedAliasKind: binding?.kind ?? null,
    canonicalCapabilityRoute,
  };
}

function canonicalRouteForBackendMode(
  backend: Backend | CanonicalCapabilityRouteId,
  mode: Mode | null,
): CanonicalCapabilityRouteId | null {
  // Map automatic delegation's backend/mode to the canonical capability route.
  // Codex models no longer have public route aliases, so automatic routing must
  // resolve via the capability contract rather than PUBLIC_ALIAS_BINDINGS.
  const capabilityRoute = CAPABILITY_ROUTES.find((route) =>
    mode == null ? route.id === backend : route.id === (backend as any),
  );
  if (capabilityRoute && mode == null) {
    return capabilityRoute.id;
  }
  const route = CAPABILITY_ROUTES.find(
    (route) => route.mode === mode && route.sandbox === (mode === "implement" ? "workspace-write" : "read-only"),
  );
  return route?.id ?? null;
}

async function executeComposerEconomyRun(
  input: RunExecutionInput,
  options: EngineOptions,
  requestedAlias: string | null,
): Promise<RunExecutionResult> {
  const economyRoute = COMPOSER_ECONOMY_ROUTES[input.mode];
  const traversalId = crypto.randomUUID();
  const emitV2 = createRoutingTraceV2Emitter(options, input.v2);
  const conflicts = [
    ...(input.backend !== economyRoute.backend
      ? [`backend ${input.backend}`]
      : []),
    ...(requestedAlias !== economyRoute.route
      ? [`route ${requestedAlias ?? "(none)"}`]
      : []),
  ];

  if (conflicts.length > 0) {
    // Preserve caller backend/mode defaults. Do not let the conflicting alias
    // rewrite the reported model (resolveProfile follows alias backends).
    const requestedProfile =
      input.profileOverride ??
      resolveProfile(
        options.env,
        input.backend,
        input.mode,
        input.taskClass,
        undefined,
      );
    const requestedServing = servingFromModel(requestedProfile.model);
    const requestedRoutingShadow = requestedAlias
      ? resolveRoutingShadow({
          requestedAlias,
          env: options.env,
          taskClass: input.taskClass,
        })
      : undefined;
    const detail = `Composer orchestrator mode requires ${economyRoute.route} on ${economyRoute.backend} for ${input.mode}; received ${conflicts.join(" and ")}`;
    return rejectCanonicalSelection(
      input,
      options,
      {
        backend: input.backend,
        mode: input.mode,
        model: requestedProfile.model,
        sandbox: requestedProfile.sandbox,
        detail,
        routingShadow: requestedRoutingShadow,
      },
      (trace) =>
        emitV2(trace, {
          route: aliasRouteFor(requestedAlias),
          models: {
            requested: requestedProfile.model,
            candidate: requestedServing.stableId ?? requestedProfile.model,
          },
          serving: requestedServing,
          traversal: {
            candidateIndex: null,
            attemptIndex: null,
            stackSize: 1,
            traversalId,
          },
          failure: {
            normalizedClass: "invalid_configuration",
            detail,
            terminalReason: "conflicting Composer economy route",
          },
          policyVersion: COMPOSER_ECONOMY_POLICY,
        }),
    );
  }

  const profile: Profile = {
    ...profileFor(options.env, input.mode, input.taskClass),
    model: economyRoute.model,
    sandbox: economyRoute.sandbox,
  };
  const attempt = await executeRunAttempt(
    {
      ...input,
      backend: economyRoute.backend,
      requestedAlias: economyRoute.route,
      profileOverride: profile,
    },
    options,
  );
  await options.onTrace?.(attempt.trace);

  const disposition = attempt.success ? null : canonicalFailureDisposition(attempt);
  await emitV2(attempt.trace, {
    route: aliasRouteFor(economyRoute.route),
    models: {
      requested: economyRoute.model,
      candidate: economyRoute.stableId,
      attempted: economyRoute.model,
      selected: attempt.success ? economyRoute.model : null,
    },
    serving: servingFromModel(economyRoute.model),
    traversal: {
      candidateIndex: 0,
      attemptIndex: 0,
      stackSize: 1,
      traversalId,
    },
    ...(attempt.success
      ? {}
      : {
          failure: {
            normalizedClass:
              disposition && "classification" in disposition
                ? disposition.classification
                : null,
            detail: attempt.trace.error,
            terminalReason: attempt.trace.error,
          },
        }),
    policyVersion: COMPOSER_ECONOMY_POLICY,
  });

  return attempt.success
    ? {
        success: true,
        result: attempt.result!,
        trace: attempt.trace,
        traces: [attempt.trace],
      }
    : { success: false, trace: attempt.trace, traces: [attempt.trace] };
}

export async function executeRun(
  input: RunExecutionInput,
  options: EngineOptions,
): Promise<RunExecutionResult> {
  // Keep routing intents distinct:
  // - automatic: no --backend/--route → ADR screenshot stacks (availability-only)
  // - explicit: --route → one pinned model, no chain rewrite
  // - direct: --backend/--worker-model → legacy backend defaults
  // - economy: --orchestrator composer → fixed Composer economy tree
  const routingIntent = resolveRoutingIntent(input, options.env);
  const explicitAlias = input.requestedAlias ?? null;
  const effectiveInput = input;

  if (routingIntent === "economy" || effectiveInput.orchestratorIdentity === "composer") {
    const requestedAlias =
      explicitAlias ?? executableAliasForBackendMode(input.backend, input.mode);
    return executeComposerEconomyRun(effectiveInput, options, requestedAlias);
  }

  if (routingIntent === "automatic") {
    const canonicalRoute = canonicalRouteForBackendMode(input.backend, input.mode);
    if (canonicalRoute) {
      return executeCanonicalSelection(
        effectiveInput,
        options,
        canonicalRoute,
        routingIntent,
      );
    }
    const fallbackAlias = executableAliasForBackendMode(input.backend, input.mode);
    if (fallbackAlias) {
      return executeCanonicalSelection(
        effectiveInput,
        options,
        fallbackAlias,
        routingIntent,
      );
    }
  }

  if (routingIntent === "explicit") {
    const requestedAlias = explicitAlias ?? null;
    if (requestedAlias) {
      return executeCanonicalSelection(
        effectiveInput,
        options,
        requestedAlias,
        routingIntent,
      );
    }
  }

  const requestedAlias =
    explicitAlias ?? executableAliasForBackendMode(input.backend, input.mode);

  const emitV2 = createRoutingTraceV2Emitter(options, effectiveInput.v2);
  const routeInfo = aliasRouteFor(requestedAlias);
  const { fallback, v2: _v2, workerModel: _workerModel, ...attemptInput } =
    effectiveInput;
  const workerModel = effectiveInput.workerModel ?? null;
  const fallbackEnabled = fallback === "claude";
  const minimaxTierEnabled = minimaxConfigured(options.env);
  const kimiTierEnabled = kimiConfigured(options.env);
  const traces: TraceRecord[] = [];
  let currentBackend = effectiveInput.backend;
  // An explicit --worker-model pins the requested backend's model; fallback
  // tiers below replace this override with their own profiles. The CLI rejects
  // --worker-model alongside --route, so no alias profile is bypassed here.
  let currentProfileOverride: Profile | undefined = workerModel
    ? {
        ...resolveProfile(
          options.env,
          effectiveInput.backend,
          effectiveInput.mode,
          effectiveInput.taskClass,
          undefined,
        ),
        model: workerModel,
      }
    : undefined;
  let fallbackOf: string | undefined;
  const maxAttempts =
    fallbackEnabled && effectiveInput.backend === "codex"
      ? 3 + (minimaxTierEnabled ? 1 : 0) + (kimiTierEnabled ? 1 : 0)
      : 1;
  const emitStderr = options.emitStderr ?? console.error;

  const traversalId = crypto.randomUUID();
  const requestedModel =
    workerModel ??
    resolveProfile(
      options.env,
      effectiveInput.backend,
      effectiveInput.mode,
      effectiveInput.taskClass,
      requestedAlias as RouteId | undefined,
    ).model;
  let completedFallbackTransition: V2AttemptExtras["failure"];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptResult = await executeRunAttempt(
      {
        ...attemptInput,
        backend: currentBackend,
        profileOverride: currentProfileOverride,
        fallbackOf,
      },
      options,
    );

    traces.push(attemptResult.trace);
    await options.onTrace?.(attemptResult.trace);

    const trace = attemptResult.trace;
    const attemptIndex = attempt - 1;
    const baseExtras: V2AttemptExtras = {
      route: routeInfo,
      serving: servingFromModel(trace.model),
      traversal: {
        candidateIndex: attemptIndex,
        attemptIndex,
        stackSize: maxAttempts,
        traversalId,
      },
      models: {
        requested: requestedModel,
        candidate: trace.model,
        attempted: trace.model,
        selected: null,
      },
    };

    if (attemptResult.success) {
      await emitV2(trace, {
        ...baseExtras,
        models: { ...baseExtras.models, selected: trace.model },
        ...(completedFallbackTransition
          ? { failure: completedFallbackTransition }
          : {}),
      });
      return {
        success: true,
        result: attemptResult.result,
        trace: attemptResult.trace,
        traces,
      };
    }

    const shouldRetryToClaude =
      fallbackEnabled &&
      effectiveInput.backend === "codex" &&
      currentBackend === "codex" &&
      attemptResult.outageReason &&
      attempt === 1;
    const shouldRetryToGrok =
      fallbackEnabled &&
      effectiveInput.backend === "codex" &&
      currentBackend === "claude" &&
      attemptResult.outageReason &&
      attempt === 2;
    const shouldRetryToMinimax =
      fallbackEnabled &&
      minimaxTierEnabled &&
      effectiveInput.backend === "codex" &&
      currentBackend === "composer" &&
      attemptResult.outageReason &&
      attempt === 3;
    const shouldRetryToKimi =
      fallbackEnabled &&
      kimiTierEnabled &&
      effectiveInput.backend === "codex" &&
      attemptResult.outageReason &&
      (minimaxTierEnabled
        ? currentBackend === "minimax" && attempt === 4
        : currentBackend === "composer" && attempt === 3);

    const outageDisposition = attemptResult.outageReason
      ? normalizeBackendOutage(attemptResult.outageReason)
      : null;
    const normalizedClass =
      outageDisposition && "classification" in outageDisposition
        ? outageDisposition.classification
        : null;

    if (shouldRetryToClaude) {
      completedFallbackTransition = {
        normalizedClass,
        detail: trace.error,
        fallbackSource: currentBackend,
        fallbackDestination: "claude",
        fallbackReason: attemptResult.outageReason ?? null,
      };
      await emitV2(trace, {
        ...baseExtras,
        failure: completedFallbackTransition,
      });
      emitStderr(
        `fable-orchestrator: progress: primary backend unavailable; retrying on claude fallback`,
      );
      emitStderr(
        `fable-orchestrator: codex unavailable (${attemptResult.outageReason}); retrying on claude backend`,
      );
      currentBackend = "claude";
      currentProfileOverride = undefined;
      fallbackOf = attemptResult.trace.run_id;
      continue;
    }

    if (shouldRetryToGrok) {
      const grokProfile = grokProfileFor(options.env, effectiveInput.mode);
      completedFallbackTransition = {
        normalizedClass,
        detail: trace.error,
        fallbackSource: currentBackend,
        fallbackDestination: "composer",
        fallbackReason: attemptResult.outageReason ?? null,
      };
      await emitV2(trace, {
        ...baseExtras,
        failure: completedFallbackTransition,
      });
      emitStderr(
        `fable-orchestrator: progress: Claude backend unavailable; retrying on Grok fallback`,
      );
      emitStderr(
        `fable-orchestrator: claude unavailable (${attemptResult.outageReason}); retrying on composer backend with ${grokProfile.model}`,
      );
      currentBackend = "composer";
      currentProfileOverride = grokProfile;
      fallbackOf = attemptResult.trace.run_id;
      continue;
    }

    if (shouldRetryToMinimax) {
      const minimaxProfile = resolveProfile(
        options.env,
        "minimax",
        effectiveInput.mode,
        effectiveInput.taskClass,
      );
      completedFallbackTransition = {
        normalizedClass,
        detail: trace.error,
        fallbackSource: currentBackend,
        fallbackDestination: "minimax",
        fallbackReason: attemptResult.outageReason ?? null,
      };
      await emitV2(trace, {
        ...baseExtras,
        failure: completedFallbackTransition,
      });
      emitStderr(
        `fable-orchestrator: progress: Grok fallback unavailable; retrying on MiniMax fallback`,
      );
      emitStderr(
        `fable-orchestrator: composer unavailable (${attemptResult.outageReason}); retrying on minimax backend with ${minimaxProfile.model}`,
      );
      currentBackend = "minimax";
      currentProfileOverride = minimaxProfile;
      fallbackOf = attemptResult.trace.run_id;
      continue;
    }

    if (shouldRetryToKimi) {
      const kimiProfile = resolveProfile(
        options.env,
        "kimi",
        effectiveInput.mode,
        effectiveInput.taskClass,
      );
      completedFallbackTransition = {
        normalizedClass,
        detail: trace.error,
        fallbackSource: currentBackend,
        fallbackDestination: "kimi",
        fallbackReason: attemptResult.outageReason ?? null,
      };
      await emitV2(trace, {
        ...baseExtras,
        failure: completedFallbackTransition,
      });
      emitStderr(
        minimaxTierEnabled
          ? `fable-orchestrator: progress: MiniMax fallback unavailable; retrying on Kimi fallback`
          : `fable-orchestrator: progress: Grok fallback unavailable; retrying on Kimi fallback`,
      );
      emitStderr(
        minimaxTierEnabled
          ? `fable-orchestrator: minimax unavailable (${attemptResult.outageReason}); retrying on kimi backend with ${kimiProfile.model}`
          : `fable-orchestrator: composer unavailable (${attemptResult.outageReason}); retrying on kimi backend with ${kimiProfile.model}`,
      );
      currentBackend = "kimi";
      currentProfileOverride = kimiProfile;
      fallbackOf = attemptResult.trace.run_id;
      continue;
    }

    await emitV2(trace, {
      ...baseExtras,
      failure: {
        normalizedClass,
        detail: trace.error,
        terminalReason: trace.error,
      },
    });
    return {
      success: false,
      trace: attemptResult.trace,
      traces,
    };
  }

  throw new Error("run completed without an attempt");
}

function profileForCanonicalCandidate(
  env: EnvLike,
  mode: Mode,
  taskClass: string | null,
  model: string,
  sandbox: Profile["sandbox"],
): Profile {
  return {
    ...profileFor(env, mode, taskClass),
    model,
    sandbox,
  };
}

function canonicalFailureDisposition(
  result: RunAttemptResult,
): FailureDisposition {
  if (result.outageReason) {
    // Automatic traversal treats classified availability outages as demonstrated
    // so auth/usage/missing/model-unavailable advance the ADR stack. Direct-path
    // semantics remain unchanged (they do not call this helper).
    return normalizeBackendOutage(result.outageReason, {
      demonstratedTransient: true,
    });
  }

  const detail = result.trace.error;
  if (detail?.startsWith("budget:")) {
    // Budget exhaustion is a hard stop: it must terminate traversal and must
    // never be reclassified as a retryable timeout that advances automatic
    // fallback onto another candidate.
    return { kind: "terminal-unclassified", detail };
  }
  if (/\b(?:ENOENT|not found)\b/i.test(detail ?? "")) {
    return dispositionFor("missing_binary", detail);
  }
  return dispositionFor("deterministic_validation_error", detail);
}

// Ambient per-mode model env overrides apply only on the direct (--backend /
// --worker-model) path via resolveProfile. Automatic and explicit canonical
// routes ignore them so pinned ADR stacks and aliases stay contract-stable.

// Fail-closed result: record a rejection trace without invoking any backend, so
// an invalid or ineligible active selection can never bypass canonical safety
// by running the legacy requested backend.
async function rejectCanonicalSelection(
  input: RunExecutionInput,
  options: EngineOptions,
  params: {
    backend: Backend;
    mode: Mode;
    model: string;
    sandbox: Profile["sandbox"];
    detail: string;
    routingShadow?: RoutingShadowReport;
  },
  emitReject?: (trace: TraceRecord) => Promise<void>,
): Promise<RunExecutionResult> {
  const trace: TraceRecordWithRoutingShadow = {
    schema: TRACE_SCHEMA_VERSION,
    run_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    backend: params.backend,
    orchestrator_identity: input.orchestratorIdentity ?? null,
    mode: params.mode,
    model: params.model,
    sandbox: params.sandbox,
    project: projectIdentifier(input.cwd),
    label: input.label,
    task_class: input.taskClass,
    ...(input.routingPolicy ? { routing_policy: input.routingPolicy } : {}),
    route_rationale: input.routeRationale,
    duration_ms: 0,
    status: "error",
    exit_code: 1,
    changed_files: null,
    tokens: null,
    budget: buildBudgetRecord(input.budget),
    error: errorSummary(params.detail),
    ...(params.routingShadow ? { routingShadow: params.routingShadow } : {}),
  };
  (options.emitStderr ?? console.error)(`fable-orchestrator: ${params.detail}`);
  await options.onTrace?.(trace);
  await emitReject?.(trace);
  return { success: false, trace, traces: [trace] };
}

async function executeCanonicalSelection(
  input: RunExecutionInput,
  options: EngineOptions,
  requestedAlias: string,
  routingIntent: RoutingIntent = "explicit",
): Promise<RunExecutionResult> {
  const emitV2 = createRoutingTraceV2Emitter(options, input.v2);
  const routeInfo = aliasRouteFor(requestedAlias);
  const traversalId = crypto.randomUUID();
  const emitRejectV2 = (
    extras: Omit<V2AttemptExtras, "route" | "traversal">,
  ): ((trace: TraceRecord) => Promise<void>) => {
    return (trace) =>
      emitV2(trace, {
        ...extras,
        route: routeInfo,
        traversal: {
          candidateIndex: null,
          attemptIndex: null,
          stackSize: null,
          traversalId,
        },
      });
  };

  // Automatic and explicit intents ignore ambient FABLE_ORCHESTRATOR_*_MODEL
  // env overrides; only the direct path applies them via resolveProfile.
  // Automatic policy requests the canonical route via alias for route-id
  // resolution, but ignores that inferred backend alias when choosing the ADR
  // stack. Explicit --route pins exactly one candidate.
  const pinAlias = routingIntent === "explicit";
  const shadow = resolveRoutingShadow({
    requestedAlias,
    env: options.env,
    taskClass: input.taskClass,
    workloadClass: input.workloadClass,
    pinAlias,
  });
  const routeId = shadow.canonicalRouteId;
  const fixedContract = shadow.fixedContract;
  const stack = routeId
    ? candidateStackForRoute(
        routeId,
        pinAlias ? requestedAlias : null,
        input.workloadClass,
      )
    : null;

  // All executable public aliases resolve to an approved canonical route. If
  // that invariant is ever broken, fail closed rather than invoking the legacy
  // requested backend.
  if (!routeId || !fixedContract || !stack) {
    const legacy = resolveProfile(
      options.env,
      input.backend,
      input.mode,
      input.taskClass,
      requestedAlias as RouteId,
    );
    return rejectCanonicalSelection(
      input,
      options,
      {
        backend: input.backend,
        mode: input.mode,
        model: legacy.model,
        sandbox: legacy.sandbox,
        detail: `canonical selection rejected for ${requestedAlias}: ${shadow.error ?? "unresolved canonical route or candidate stack"}`,
        routingShadow: shadow,
      },
      emitRejectV2({
        models: { requested: legacy.model },
        serving: servingFromModel(legacy.model),
        failure: {
          normalizedClass: "invalid_configuration",
          detail: shadow.error ?? null,
          terminalReason: "unresolved canonical route or candidate stack",
        },
        authorization: { overrideRequested: false },
      }),
    );
  }

  // runner-routing-v2 is an executable availability-only policy. The stack is
  // traversed once for retryable availability failures; default/light stacks
  // deliberately contain one candidate and therefore have no fallback.
  const maxAttempts = stack.automaticFallback ? undefined : 1;
  const traces: TraceRecord[] = [];
  const attempts: RunAttemptResult[] = [];
  let fallbackOf: string | undefined;
  // Explicit pins and automatic policy both derive requested from the stack
  // head (providerModelId), never ambient FABLE_ORCHESTRATOR_*_MODEL env.
  const stackHeadStableId = stack.candidates[0]!;
  const stackHeadEntry = REGISTRY_BY_LABEL_V2.get(stackHeadStableId);
  const requestedCanonicalModel =
    stackHeadEntry?.providerModelId ?? stackHeadStableId;
  let previousCandidate: { stableId: string; classification: string | null } | null =
    null;

  await runFallbackTraversal(
    {
      route: routeId,
      contract: fixedContract,
      stack,
      registry: MODEL_REGISTRY,
      maxAttempts,
    },
    async (candidate, attemptIndex) => {
      if (
        candidate.entry.transportBackend == null ||
        candidate.entry.transportBackend === "claude-code-parent"
      ) {
        return {
          status: "failure" as const,
          disposition: dispositionFor(
            "invalid_configuration",
            "automatic candidate has no runnable transport backend",
          ),
        };
      }
      const attemptedModel = candidate.entry.providerModelId ?? candidate.stableId;
      const profile = profileForCanonicalCandidate(
        options.env,
        fixedContract.mode,
        input.taskClass,
        attemptedModel,
        fixedContract.sandbox,
      );
      const attempt = await executeRunAttempt(
        {
          ...input,
          backend: candidate.entry.transportBackend,
          mode: fixedContract.mode,
          profileOverride: profile,
          requestedAlias,
          routingShadowOverride: shadow,
          fallbackOf,
          suppressLegacyFallbackHint: true,
        },
        options,
      );
      attempts.push(attempt);
      traces.push(attempt.trace);
      await options.onTrace?.(attempt.trace);
      const disposition = attempt.success
        ? null
        : canonicalFailureDisposition(attempt);
      const traversalDisposition = disposition;
      const classification =
        traversalDisposition && "classification" in traversalDisposition
          ? traversalDisposition.classification
          : null;
      const priorCandidate = previousCandidate;
      const failureExtras: Pick<V2AttemptExtras, "failure"> =
        priorCandidate
          ? {
              failure: {
                fallbackSource: priorCandidate.stableId,
                fallbackDestination: candidate.stableId,
                fallbackReason: priorCandidate.classification,
                ...(attempt.success
                  ? {}
                  : {
                      normalizedClass: classification,
                      detail: attempt.trace.error,
                      terminalReason:
                        disposition &&
                        (disposition.kind === "terminal" ||
                          disposition.kind === "terminal-unclassified")
                          ? attempt.trace.error
                          : null,
                    }),
              },
            }
          : attempt.success
            ? {}
            : {
                failure: {
                  normalizedClass: classification,
                  detail: attempt.trace.error,
                  terminalReason:
                    disposition &&
                    (disposition.kind === "terminal" ||
                      disposition.kind === "terminal-unclassified")
                      ? attempt.trace.error
                      : null,
                },
              };
      await emitV2(attempt.trace, {
        route: routeInfo,
        models: {
          requested: requestedCanonicalModel,
          candidate: candidate.stableId,
          attempted: attemptedModel,
          selected: attempt.success ? attemptedModel : null,
        },
        serving: servingFromEntry(candidate.entry),
        traversal: {
          candidateIndex: stack.candidates.indexOf(candidate.stableId),
          attemptIndex,
          stackSize: stack.candidates.length,
          traversalId,
        },
        ...failureExtras,
        policyVersion: stack.policyVersion,
      });
      previousCandidate = {
        stableId: candidate.stableId,
        classification,
      };
      fallbackOf = attempt.trace.run_id;
      return attempt.success
        ? { status: "success" as const }
        : {
            status: "failure" as const,
            disposition: traversalDisposition ?? canonicalFailureDisposition(attempt),
          };
    },
  );

  const successful = attempts.find((attempt) => attempt.success);
  if (successful?.success) {
    return {
      success: true,
      result: successful.result!,
      trace: successful.trace,
      traces,
    };
  }

  const trace = attempts.at(-1)?.trace;
  if (trace) {
    return { success: false, trace, traces };
  }

  // The traversal recorded a configuration incompatibility (e.g. an unrunnable
  // stack or a sandbox/output-contract mismatch) without ever invoking a
  // worker. Fail closed rather than falling back to the legacy requested
  // backend, which would bypass canonical safety entirely.
  return rejectCanonicalSelection(
    input,
    options,
    {
      backend: input.backend,
      mode: fixedContract.mode,
      model: resolveProfile(
        options.env,
        input.backend,
        fixedContract.mode,
        input.taskClass,
        requestedAlias as RouteId,
      ).model,
      sandbox: fixedContract.sandbox,
      detail: `canonical traversal produced no runnable candidate for ${requestedAlias}`,
      routingShadow: shadow,
    },
    emitRejectV2({
      models: { requested: requestedCanonicalModel },
      failure: {
        normalizedClass: "invalid_configuration",
        detail: "no runnable candidate",
        terminalReason: "canonical traversal produced no runnable candidate",
      },
      policyVersion: stack.policyVersion,
    }),
  );
}
