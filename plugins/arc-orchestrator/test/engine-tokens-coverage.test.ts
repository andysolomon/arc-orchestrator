import { describe, expect, test } from "bun:test";
import {
  executeRun,
  executeRunAttempt,
  lowerBoundZeroTokenUsage,
  sessionRunTokensFromTrace,
  type BackendInvocationOutput,
  type EngineOptions,
  type RunAttemptInput,
  type RunExecutionInput,
} from "../lib/engine";
import type { RoutingTraceV2, TokenUsage, TraceRecord } from "../lib/trace-schema";

const cwd = process.cwd();

const workerResult = (status: "completed" | "blocked" = "completed") => ({
  status,
  summary: `${status} result`,
  changes: [],
  verification: [],
  risks: [],
  next_actions: [],
});

const lowerBoundZero = {
  input_tokens: 0,
  cached_input_tokens: null,
  output_tokens: 0,
  total_tokens: 0,
} satisfies TokenUsage;

function expectNonNullTokens(trace: TraceRecord): TokenUsage {
  expect(trace.tokens).not.toBeNull();
  expect(typeof trace.tokens!.input_tokens).toBe("number");
  expect(typeof trace.tokens!.output_tokens).toBe("number");
  expect(typeof trace.tokens!.total_tokens).toBe("number");
  expect(trace.tokens!.input_tokens).toBeGreaterThanOrEqual(0);
  expect(trace.tokens!.output_tokens).toBeGreaterThanOrEqual(0);
  expect(trace.tokens!.total_tokens).toBeGreaterThanOrEqual(0);
  return trace.tokens!;
}

function expectLowerBoundZero(trace: TraceRecord): void {
  expectNonNullTokens(trace);
  expect(trace.tokens).toEqual(lowerBoundZero);
}

function options(
  invokeBackend: EngineOptions["invokeBackend"],
  extra: Partial<EngineOptions> = {},
): EngineOptions {
  return {
    env: {},
    emitStderr: () => {},
    invokeBackend,
    ...extra,
  };
}

function attemptInput(
  overrides: Partial<RunAttemptInput> = {},
): RunAttemptInput {
  return {
    backend: "codex",
    mode: "implement",
    task: "bounded token coverage test",
    cwd,
    label: "engine-tokens-coverage",
    taskClass: null,
    routeRationale: null,
    budget: { maxTokens: null, maxDurationMs: null },
    effort: null,
    ...overrides,
  };
}

function executionInput(
  overrides: Partial<RunExecutionInput> = {},
): RunExecutionInput {
  return {
    ...attemptInput(),
    fallback: null,
    ...overrides,
  };
}

describe("engine tokens coverage", () => {
  test("lowerBoundZeroTokenUsage matches the existing TokenUsage shape", () => {
    expect(lowerBoundZeroTokenUsage()).toEqual(lowerBoundZero);
  });

  test("sessionRunTokensFromTrace maps null, lower-bound-zero, and real usage", () => {
    expect(sessionRunTokensFromTrace(null)).toEqual({
      knownLowerBound: 0,
      completeness: "unknown",
    });
    expect(sessionRunTokensFromTrace(lowerBoundZeroTokenUsage())).toEqual({
      knownLowerBound: 0,
      completeness: "unknown",
    });
    const usage: TokenUsage = {
      input_tokens: 10,
      cached_input_tokens: null,
      output_tokens: 5,
      total_tokens: 15,
    };
    expect(sessionRunTokensFromTrace(usage)).toEqual({
      knownLowerBound: 15,
      completeness: "complete",
    });
  });

  test("success falls back to lower-bound-zero tokens when parsing returns none", async () => {
    const result = await executeRunAttempt(
      attemptInput(),
      options(async (): Promise<BackendInvocationOutput> => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
        resultText: JSON.stringify(workerResult("completed")),
      })),
    );

    expect(result.success).toBe(true);
    expect(result.trace.status).toBe("completed");
    expectLowerBoundZero(result.trace);
  });

  test("availability failures carry non-null tokens", async () => {
    const result = await executeRunAttempt(
      attemptInput(),
      options(async (): Promise<BackendInvocationOutput> => ({
        stdout: "",
        stderr: "usage limit reached",
        exitCode: 1,
      })),
    );

    expect(result.success).toBe(false);
    expect(result.outageReason).toBe("usage_limit");
    expect(result.trace.failure_class).toBe("backend_unavailable");
    expectLowerBoundZero(result.trace);
  });

  test("terminal failures carry non-null tokens", async () => {
    const result = await executeRunAttempt(
      attemptInput(),
      options(async (): Promise<BackendInvocationOutput> => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
        resultText: JSON.stringify({ ...workerResult(), status: "bad" }),
      })),
    );

    expect(result.success).toBe(false);
    expect(result.outageReason).toBeUndefined();
    expect(result.trace.error).toContain("result.status is invalid");
    expectLowerBoundZero(result.trace);
  });

  test("timeout budget failures carry non-null tokens", async () => {
    const result = await executeRunAttempt(
      attemptInput({ budget: { maxTokens: null, maxDurationMs: 1 } }),
      options(async () => {
        throw new Error("budget: Codex exceeded the 1ms duration budget");
      }),
    );

    expect(result.success).toBe(false);
    expect(result.trace.budget?.duration_exceeded).toBe(true);
    expectLowerBoundZero(result.trace);
  });

  test("quality-blocked results carry non-null tokens", async () => {
    const result = await executeRunAttempt(
      attemptInput(),
      options(async (): Promise<BackendInvocationOutput> => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
        resultText: JSON.stringify(workerResult("blocked")),
      })),
    );

    expect(result.success).toBe(true);
    expect(result.trace.status).toBe("blocked");
    expectLowerBoundZero(result.trace);
  });

  test("runner no-op rejection and routing-trace v2 carry non-null tokens", async () => {
    let invocations = 0;
    const routingTraces: RoutingTraceV2[] = [];
    const result = await executeRun(
      executionInput({
        requestedAlias: "unknown-route",
        routingIntent: "explicit",
      }),
      options(
        async () => {
          invocations += 1;
          return { stdout: "", stderr: "", exitCode: 0 };
        },
        {
          onRoutingTraceV2: (record) => {
            routingTraces.push(record);
          },
        },
      ),
    );

    expect(result.success).toBe(false);
    expect(invocations).toBe(0);
    expect(result.traces).toHaveLength(1);
    expectLowerBoundZero(result.trace);
    expectLowerBoundZero(result.traces[0]!);
    expect(routingTraces).toHaveLength(1);
    expectLowerBoundZero(routingTraces[0]!.legacy);
  });
});
