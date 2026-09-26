// Jev (TypeSafe System One) client for arc-orchestrator decisions.
//
// One place owns the TypeSafe API: the key comes from TYPESAFE_API_KEY and is
// never logged, every call has a per-attempt timeout, SDK retries, and a
// wall-clock deadline, and every failure returns a typed `ok: false` result
// so callers fall back to the existing parent-owned decision instead of
// throwing. Each call is appended to jev-decisions.jsonl beside the run traces.
//
// The SDK is loaded lazily so installs without it (and every run with
// USE_JEV_DECISIONS unset) never touch it.

import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type {
  ChoiceResponse,
  EntryType,
  NoulResponse,
  Question,
  RequestOptions,
  ScoreResponse,
} from "@typesafe-ai/sdk";
import type { EnvLike } from "../routes";
import {
  type JevClientSettings,
  type JevDecisionMode,
  resolveJevClientSettings,
} from "./config";

export type JevQuestions = Record<string, Question>;
export type JevAnswer = NoulResponse | ChoiceResponse | ScoreResponse;

export type JevRequest = {
  state: EntryType;
  questions: JevQuestions;
  model?: string;
};

export type JevResponse = {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens: number; output_tokens: number };
};

// The subset of TypeSafeClient this module uses; tests inject a fake.
export interface JevClient {
  systemOne(request: JevRequest, options?: RequestOptions): PromiseLike<JevResponse>;
}

export type JevClientFactory = (
  env: EnvLike,
  settings: JevClientSettings,
) => Promise<JevClient>;

export type JevErrorKind =
  | "missing_api_key"
  | "sdk_unavailable"
  | "timeout"
  | "rate_limited"
  | "auth"
  | "invalid_request"
  | "server_error"
  | "connection"
  | "invalid_response"
  | "unknown";

export class JevSetupError extends Error {
  readonly kind: JevErrorKind;
  constructor(kind: JevErrorKind, message: string) {
    super(message);
    this.name = "JevSetupError";
    this.kind = kind;
  }
}

export type JevDecisionName = "route" | "assess" | "completion";

export type JevCallResult =
  | {
      ok: true;
      model: string;
      answers: Record<string, JevAnswer>;
      usage: { input_tokens: number; output_tokens: number } | null;
      requestId: string | null;
      latencyMs: number;
    }
  | {
      ok: false;
      errorKind: JevErrorKind;
      error: string;
      latencyMs: number;
    };

export type JevLogAnswer = {
  type: JevAnswer["type"];
  choice?: string;
  score?: number;
  noul?: number;
  confidence?: number;
  probabilities?: Record<string, number>;
};

export type JevDecisionLogRecord = {
  schema: "arc-orchestrator/jev-decision/v1";
  at: string;
  decision_id: string;
  decision: JevDecisionName;
  mode: JevDecisionMode;
  source: string;
  kind: "call" | "gate";
  // call records
  ok?: boolean;
  latency_ms?: number;
  model?: string | null;
  request_id?: string | null;
  usage?: { input_tokens: number; output_tokens: number } | null;
  error_kind?: JevErrorKind;
  error?: string;
  inputs?: { state: unknown; questions: string[] };
  answers?: Record<string, JevLogAnswer>;
  // gate records
  gate?: unknown;
  applied?: unknown;
  agrees?: boolean | null;
};

export type JevDeps = {
  env: EnvLike;
  // Injected client (tests). When absent, `createClient` builds one.
  client?: JevClient;
  createClient?: JevClientFactory;
  // Decision log sink. Defaults to jev-decisions.jsonl in the trace directory.
  log?: (record: JevDecisionLogRecord) => void;
  now?: () => number;
};

export type JevCallContext = {
  decision: JevDecisionName;
  decisionId: string;
  mode: JevDecisionMode;
  source: string;
};

export const JEV_DECISION_LOG_FILE = "jev-decisions.jsonl";
const LOG_STRING_LIMIT = 1000;
const ERROR_LIMIT = 300;

export function newDecisionId(): string {
  return randomUUID();
}

// All SDK log output goes to stderr: the CLI's stdout carries JSON results.
const STDERR_LOGGER = {
  debug: (message: string, ...args: unknown[]) =>
    console.error(`arc-orchestrator: jev: ${message}`, ...args),
  info: (message: string, ...args: unknown[]) =>
    console.error(`arc-orchestrator: jev: ${message}`, ...args),
  warn: (message: string, ...args: unknown[]) =>
    console.error(`arc-orchestrator: jev: ${message}`, ...args),
  error: (message: string, ...args: unknown[]) =>
    console.error(`arc-orchestrator: jev: ${message}`, ...args),
};

export const createTypeSafeClient: JevClientFactory = async (env, settings) => {
  const apiKey = env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) {
    throw new JevSetupError("missing_api_key", "TYPESAFE_API_KEY is not set");
  }
  let sdk: typeof import("@typesafe-ai/sdk");
  try {
    sdk = await import("@typesafe-ai/sdk");
  } catch {
    throw new JevSetupError(
      "sdk_unavailable",
      "@typesafe-ai/sdk is not installed; run bun install in the arc-orchestrator package",
    );
  }
  const baseURL = env.TYPESAFE_BASE_URL?.trim();
  const defaultModel = env.TYPESAFE_DEFAULT_MODEL?.trim();
  return new sdk.TypeSafeClient({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    ...(defaultModel ? { defaultModel } : {}),
    timeout: settings.timeoutMs,
    retry: { maxRetries: settings.maxRetries },
    logger: STDERR_LOGGER,
  }) as unknown as JevClient;
};

// Removes the API key from any text that might reach a log or stderr.
export function redactSecrets(text: string, env: EnvLike): string {
  const key = env.TYPESAFE_API_KEY?.trim();
  return key ? text.split(key).join("[REDACTED]") : text;
}

function errorKindFor(error: unknown, deadlineHit: boolean): JevErrorKind {
  if (error instanceof JevSetupError) {
    return error.kind;
  }
  if (deadlineHit) {
    return "timeout";
  }
  const name = error instanceof Error ? error.name : "";
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status: unknown }).status)
      : NaN;
  switch (name) {
    case "APITimeoutError":
      return "timeout";
    case "RateLimitError":
      return "rate_limited";
    case "AuthenticationError":
    case "PermissionDeniedError":
      return "auth";
    case "BadRequestError":
    case "NotFoundError":
    case "UnprocessableEntityError":
      return "invalid_request";
    case "InternalServerError":
      return "server_error";
    case "APIConnectionError":
      return "connection";
    default:
      if (Number.isFinite(status) && status >= 500) {
        return "server_error";
      }
      if (name === "TypeSafeError") {
        return "invalid_request";
      }
      return "unknown";
  }
}

function probability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

// Checks every requested question came back with the right answer shape, so
// the decision functions can trust the answers without re-checking.
export function validateJevAnswers(
  questions: JevQuestions,
  answers: unknown,
): string | null {
  if (!answers || typeof answers !== "object") {
    return "response has no answers object";
  }
  const byName = answers as Record<string, unknown>;
  for (const [name, question] of Object.entries(questions)) {
    const answer = byName[name] as Record<string, unknown> | undefined;
    if (!answer || typeof answer !== "object") {
      return `missing answer for ${name}`;
    }
    if (answer.type !== question.type) {
      return `answer for ${name} has type ${String(answer.type)}, expected ${question.type}`;
    }
    if (question.type === "noul" && !probability(answer.noul)) {
      return `answer for ${name} has no noul probability`;
    }
    if (question.type === "choice") {
      if (!probability(answer.confidence)) {
        return `answer for ${name} has no confidence`;
      }
      if (typeof answer.choice !== "string" || !(answer.choice in question.criteria)) {
        return `answer for ${name} chose an unknown option`;
      }
    }
    if (question.type === "score") {
      if (!probability(answer.confidence)) {
        return `answer for ${name} has no confidence`;
      }
      const top = question.criteria.length - 1;
      const score = answer.score;
      if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > top) {
        return `answer for ${name} has a score outside 0-${top}`;
      }
    }
  }
  return null;
}

function truncateForLog(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > LOG_STRING_LIMIT
      ? `${value.slice(0, LOG_STRING_LIMIT)}... [${value.length - LOG_STRING_LIMIT} more chars]`
      : value;
  }
  if (Array.isArray(value)) {
    return value.map(truncateForLog);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, truncateForLog(entry)]),
    );
  }
  return value;
}

function summarizeAnswer(answer: JevAnswer): JevLogAnswer {
  switch (answer.type) {
    case "noul":
      return { type: "noul", noul: answer.noul };
    case "choice":
      return {
        type: "choice",
        choice: answer.choice,
        confidence: answer.confidence,
        probabilities: { ...answer.probabilities },
      };
    case "score":
      return {
        type: "score",
        score: answer.score,
        confidence: answer.confidence,
        probabilities: { ...answer.probabilities },
      };
  }
}

function traceDirectory(env: EnvLike): string {
  return (
    env.ARC_ORCHESTRATOR_TRACE_DIR?.trim() ||
    resolve(homedir(), ".arc-orchestrator", "traces")
  );
}

// Default log sink: honors ARC_ORCHESTRATOR_TRACE=0 like the run traces, and
// never fails the caller.
export function appendJevDecisionLog(env: EnvLike) {
  return (record: JevDecisionLogRecord): void => {
    if (env.ARC_ORCHESTRATOR_TRACE?.trim() === "0") {
      return;
    }
    try {
      const directory = traceDirectory(env);
      mkdirSync(directory, { recursive: true });
      appendFileSync(
        resolve(directory, JEV_DECISION_LOG_FILE),
        `${redactSecrets(JSON.stringify(record), env)}\n`,
      );
    } catch (error) {
      console.error(
        `arc-orchestrator: failed to write jev decision log: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };
}

export function logJevRecord(
  deps: JevDeps,
  context: JevCallContext,
  fields: Omit<
    JevDecisionLogRecord,
    "schema" | "at" | "decision_id" | "decision" | "mode" | "source"
  >,
): void {
  const log = deps.log ?? appendJevDecisionLog(deps.env);
  const now = deps.now ?? Date.now;
  try {
    log({
      schema: "arc-orchestrator/jev-decision/v1",
      at: new Date(now()).toISOString(),
      decision_id: context.decisionId,
      decision: context.decision,
      mode: context.mode,
      source: context.source,
      ...fields,
    });
  } catch {
    // Logging is evidence, never a reason to change the decision.
  }
}

// Asks Jev one set of questions about one state. Never throws: every failure
// (missing key, missing SDK, timeout, HTTP error, malformed answer) comes back
// as `ok: false` so the caller can fall back to the existing decision.
export async function askJev(
  state: EntryType,
  questions: JevQuestions,
  context: JevCallContext,
  deps: JevDeps,
): Promise<JevCallResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const { settings } = resolveJevClientSettings(deps.env);
  const controller = new AbortController();
  let deadlineHit = false;
  const deadline = setTimeout(() => {
    deadlineHit = true;
    controller.abort();
  }, settings.totalTimeoutMs);

  let result: JevCallResult;
  try {
    const client =
      deps.client ??
      (await (deps.createClient ?? createTypeSafeClient)(deps.env, settings));
    const pending = client.systemOne(
      { state, questions },
      { signal: controller.signal },
    ) as PromiseLike<JevResponse> & {
      withResponse?: () => Promise<{ data: JevResponse; requestId?: string }>;
    };
    // The real SDK exposes the request id through withResponse(); fakes
    // may return a plain promise.
    const abort = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () =>
        reject(new Error("Jev deadline exceeded")),
      );
    });
    const { data, requestId } = await Promise.race([
      typeof pending.withResponse === "function"
        ? pending.withResponse()
        : Promise.resolve(pending).then((data) => ({ data, requestId: undefined })),
      abort,
    ]);
    const invalid = validateJevAnswers(questions, data?.answers);
    if (invalid) {
      result = {
        ok: false,
        errorKind: "invalid_response",
        error: invalid,
        latencyMs: now() - started,
      };
    } else {
      result = {
        ok: true,
        model: typeof data.model === "string" ? data.model : "unknown",
        answers: data.answers,
        usage: data.usage ?? null,
        requestId: requestId ?? null,
        latencyMs: now() - started,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result = {
      ok: false,
      errorKind: errorKindFor(error, deadlineHit),
      error: redactSecrets(message, deps.env).slice(0, ERROR_LIMIT),
      latencyMs: now() - started,
    };
  } finally {
    clearTimeout(deadline);
  }

  logJevRecord(deps, context, {
    kind: "call",
    ok: result.ok,
    latency_ms: result.latencyMs,
    inputs: {
      state: truncateForLog(state),
      questions: Object.keys(questions),
    },
    ...(result.ok
      ? {
          model: result.model,
          request_id: result.requestId,
          usage: result.usage,
          answers: Object.fromEntries(
            Object.entries(result.answers)
              .filter(([name]) => name in questions)
              .map(([name, answer]) => [name, summarizeAnswer(answer)]),
          ),
        }
      : { error_kind: result.errorKind, error: result.error }),
  });

  return result;
}
