import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  jevDecisionMode,
  resolveJevClientSettings,
  resolveJevThresholds,
  DEFAULT_JEV_THRESHOLDS,
} from "../plugins/arc-orchestrator/lib/decisions/config";
import {
  appendJevDecisionLog,
  askJev,
  createTypeSafeClient,
  validateJevAnswers,
  type JevCallContext,
  type JevClient,
  type JevDecisionLogRecord,
  type JevQuestions,
} from "../plugins/arc-orchestrator/lib/decisions/jev";

const KEY = "ts-test-secret-key-123";
const CONTEXT: JevCallContext = {
  decision: "route",
  decisionId: "d-1",
  mode: "on",
  source: "test",
};
const QUESTIONS: JevQuestions = {
  worker: {
    type: "choice",
    instructions: "Which worker?",
    criteria: { composer: null, codex: null, fable: null },
  },
  risk: { type: "score", instructions: "Risk?", criteria: ["low", "mid", "high"] },
  done: { type: "noul", instructions: "Done?" },
};
const GOOD_ANSWERS = {
  worker: {
    type: "choice",
    choice: "codex",
    confidence: 0.9,
    probabilities: { composer: 0.05, codex: 0.9, fable: 0.05 },
  },
  risk: {
    type: "score",
    score: 1.2,
    confidence: 0.8,
    legend: { "0": "low", "1": "mid", "2": "high" },
    probabilities: { "0": 0.1, "1": 0.6, "2": 0.3 },
  },
  done: { type: "noul", noul: 0.7 },
};

function fakeClient(respond: () => Promise<unknown>): JevClient {
  return { systemOne: () => respond() as Promise<never> };
}

function recorder() {
  const records: JevDecisionLogRecord[] = [];
  return { records, log: (record: JevDecisionLogRecord) => records.push(record) };
}

describe("jev config", () => {
  test("USE_JEV_DECISIONS defaults off and recognizes shadow and on", () => {
    expect(jevDecisionMode({})).toBe("off");
    expect(jevDecisionMode({ USE_JEV_DECISIONS: "" })).toBe("off");
    expect(jevDecisionMode({ USE_JEV_DECISIONS: "garbage" })).toBe("off");
    expect(jevDecisionMode({ USE_JEV_DECISIONS: "0" })).toBe("off");
    expect(jevDecisionMode({ USE_JEV_DECISIONS: " Shadow " })).toBe("shadow");
    expect(jevDecisionMode({ USE_JEV_DECISIONS: "on" })).toBe("on");
    expect(jevDecisionMode({ USE_JEV_DECISIONS: "1" })).toBe("on");
    expect(jevDecisionMode({ USE_JEV_DECISIONS: "TRUE" })).toBe("on");
  });

  test("thresholds default, parse overrides, and reject out-of-range values", () => {
    expect(resolveJevThresholds({}).thresholds).toEqual(DEFAULT_JEV_THRESHOLDS);
    const { thresholds, warnings } = resolveJevThresholds({
      ROUTE_MIN_CONFIDENCE: "0.9",
      RISK_HUMAN_THRESHOLD: "3.5",
      HUMAN_REVIEW_THRESHOLD: "1.5",
      ASSESS_MIN_CONFIDENCE: "abc",
    });
    expect(thresholds.routeMinConfidence).toBe(0.9);
    expect(thresholds.riskHuman).toBe(3.5);
    expect(thresholds.humanReviewNoul).toBe(0.6);
    expect(thresholds.assessMinConfidence).toBe(0.75);
    expect(warnings).toHaveLength(2);
  });

  test("an inverted yes/no completion band falls back to defaults", () => {
    const { thresholds, warnings } = resolveJevThresholds({
      COMPLETION_YES_THRESHOLD: "0.3",
      COMPLETION_NO_THRESHOLD: "0.5",
    });
    expect(thresholds.completionYes).toBe(0.8);
    expect(thresholds.completionNo).toBe(0.2);
    expect(warnings).toHaveLength(1);
  });

  test("client settings default and parse overrides", () => {
    expect(resolveJevClientSettings({}).settings).toEqual({
      timeoutMs: 10_000,
      maxRetries: 2,
      totalTimeoutMs: 30_000,
    });
    expect(
      resolveJevClientSettings({
        JEV_TIMEOUT_MS: "500",
        JEV_MAX_RETRIES: "0",
        JEV_TOTAL_TIMEOUT_MS: "900",
      }).settings,
    ).toEqual({ timeoutMs: 500, maxRetries: 0, totalTimeoutMs: 900 });
  });
});

describe("askJev with an injected client", () => {
  test("returns validated answers and logs inputs, answers, confidences, latency", async () => {
    const { records, log } = recorder();
    let clock = 1_000;
    const result = await askJev({ title: "t" }, QUESTIONS, CONTEXT, {
      env: { TYPESAFE_API_KEY: KEY, JEV_LOG_INPUTS: "1" },
      client: fakeClient(async () => {
        clock += 42;
        return { model: "jev-1.13.0", answers: GOOD_ANSWERS, usage: { input_tokens: 10, output_tokens: 2 } };
      }),
      log,
      now: () => clock,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model).toBe("jev-1.13.0");
    expect(result.latencyMs).toBe(42);
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.kind).toBe("call");
    expect(record.ok).toBe(true);
    expect(record.latency_ms).toBe(42);
    expect(record.inputs).toEqual({ state: { title: "t" }, questions: ["worker", "risk", "done"] });
    expect(record.answers?.worker).toEqual({
      type: "choice",
      choice: "codex",
      confidence: 0.9,
      probabilities: { composer: 0.05, codex: 0.9, fable: 0.05 },
    });
    expect(record.answers?.risk?.confidence).toBe(0.8);
    expect(record.answers?.done).toEqual({ type: "noul", noul: 0.7 });
    expect(JSON.stringify(records)).not.toContain(KEY);
  });

  test("by default the log identifies inputs by digest, not content", async () => {
    const { records, log } = recorder();
    await askJev({ task: { title: "secret project" }, diff: "private diff" }, QUESTIONS, CONTEXT, {
      env: { TYPESAFE_API_KEY: KEY },
      client: fakeClient(async () => ({ model: "jev", answers: GOOD_ANSWERS })),
      log,
    });
    const state = records[0]!.inputs!.state as { sha256: string; chars: number; fields: string[] };
    expect(state.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(state.fields).toEqual(["task", "diff"]);
    expect(JSON.stringify(records)).not.toContain("secret project");
    expect(JSON.stringify(records)).not.toContain("private diff");
    expect(records[0]!.answers?.worker?.confidence).toBe(0.9);
  });

  test("missing API key falls back without calling the network", async () => {
    const { records, log } = recorder();
    const result = await askJev("state", QUESTIONS, CONTEXT, { env: {}, log });
    expect(result).toMatchObject({ ok: false, errorKind: "missing_api_key" });
    expect(records[0]).toMatchObject({ ok: false, error_kind: "missing_api_key" });
  });

  test("a client that never answers hits the wall-clock deadline", async () => {
    const result = await askJev("state", QUESTIONS, CONTEXT, {
      env: { TYPESAFE_API_KEY: KEY, JEV_TOTAL_TIMEOUT_MS: "20" },
      client: fakeClient(() => new Promise(() => {})),
      log: () => {},
    });
    expect(result).toMatchObject({ ok: false, errorKind: "timeout" });
  });

  test("SDK errors are classified by name and the key is redacted", async () => {
    const cases: Array<[string, string]> = [
      ["RateLimitError", "rate_limited"],
      ["AuthenticationError", "auth"],
      ["UnprocessableEntityError", "invalid_request"],
      ["InternalServerError", "server_error"],
      ["APIConnectionError", "connection"],
      ["APITimeoutError", "timeout"],
      ["SomethingElse", "unknown"],
    ];
    for (const [name, kind] of cases) {
      const { records, log } = recorder();
      const result = await askJev("state", QUESTIONS, CONTEXT, {
        env: { TYPESAFE_API_KEY: KEY },
        client: fakeClient(async () => {
          const error = new Error(`boom with ${KEY}`);
          error.name = name;
          throw error;
        }),
        log,
      });
      expect(result).toMatchObject({ ok: false, errorKind: kind });
      if (!result.ok) expect(result.error).not.toContain(KEY);
      expect(JSON.stringify(records)).not.toContain(KEY);
    }
  });

  test("malformed answers are rejected as invalid_response", async () => {
    const bad = [
      { ...GOOD_ANSWERS, done: undefined },
      { ...GOOD_ANSWERS, done: { type: "noul", noul: 1.4 } },
      { ...GOOD_ANSWERS, worker: { ...GOOD_ANSWERS.worker, choice: "gemini" } },
      { ...GOOD_ANSWERS, risk: { ...GOOD_ANSWERS.risk, score: 7 } },
      { ...GOOD_ANSWERS, risk: { ...GOOD_ANSWERS.risk, type: "choice" } },
    ];
    for (const answers of bad) {
      const result = await askJev("state", QUESTIONS, CONTEXT, {
        env: { TYPESAFE_API_KEY: KEY },
        client: fakeClient(async () => ({ model: "jev", answers })),
        log: () => {},
      });
      expect(result).toMatchObject({ ok: false, errorKind: "invalid_response" });
    }
    expect(validateJevAnswers(QUESTIONS, GOOD_ANSWERS)).toBeNull();
  });
});

describe("askJev with the real SDK against a local server", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;
  afterEach(() => {
    server?.stop(true);
    server = null;
  });

  test("sends Bearer auth and the documented request body to /v1/systemone", async () => {
    let seen: { path: string; auth: string | null; body: any } | null = null;
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        seen = {
          path: new URL(request.url).pathname,
          auth: request.headers.get("authorization"),
          body: await request.json(),
        };
        return Response.json(
          { model: "jev-1.13.0", answers: GOOD_ANSWERS, usage: { input_tokens: 5, output_tokens: 1 } },
          { headers: { "x-typesafe-request-id": "req-7" } },
        );
      },
    });
    const { records, log } = recorder();
    const result = await askJev({ title: "t" }, QUESTIONS, CONTEXT, {
      env: { TYPESAFE_API_KEY: KEY, TYPESAFE_BASE_URL: `http://127.0.0.1:${server.port}` },
      log,
    });
    expect(result).toMatchObject({ ok: true, requestId: "req-7" });
    expect(seen!.path).toBe("/v1/systemone");
    expect(seen!.auth).toBe(`Bearer ${KEY}`);
    expect(seen!.body.state).toEqual({ title: "t" });
    expect(seen!.body.model).toBe("jev-latest");
    expect(Object.keys(seen!.body.questions)).toEqual(["worker", "risk", "done"]);
    expect(records[0]?.request_id).toBe("req-7");
    expect(JSON.stringify(records)).not.toContain(KEY);
  });

  test("retries a 500 and then succeeds", async () => {
    let calls = 0;
    server = Bun.serve({
      port: 0,
      fetch() {
        calls += 1;
        return calls === 1
          ? Response.json({ error: "down" }, { status: 500 })
          : Response.json({ model: "jev", answers: GOOD_ANSWERS });
      },
    });
    const result = await askJev("s", QUESTIONS, CONTEXT, {
      env: { TYPESAFE_API_KEY: KEY, TYPESAFE_BASE_URL: `http://127.0.0.1:${server.port}` },
      log: () => {},
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  test("a 401 falls back as auth without retrying", async () => {
    let calls = 0;
    server = Bun.serve({
      port: 0,
      fetch() {
        calls += 1;
        return Response.json({ error: "bad key" }, { status: 401 });
      },
    });
    const result = await askJev("s", QUESTIONS, CONTEXT, {
      env: { TYPESAFE_API_KEY: KEY, TYPESAFE_BASE_URL: `http://127.0.0.1:${server.port}` },
      log: () => {},
    });
    expect(result).toMatchObject({ ok: false, errorKind: "auth" });
    expect(calls).toBe(1);
  });

  test("a slow server times out per attempt and falls back", async () => {
    server = Bun.serve({
      port: 0,
      async fetch() {
        await Bun.sleep(300);
        return Response.json({ model: "jev", answers: GOOD_ANSWERS });
      },
    });
    const result = await askJev("s", QUESTIONS, CONTEXT, {
      env: {
        TYPESAFE_API_KEY: KEY,
        TYPESAFE_BASE_URL: `http://127.0.0.1:${server.port}`,
        JEV_TIMEOUT_MS: "50",
        JEV_MAX_RETRIES: "0",
      },
      log: () => {},
    });
    expect(result).toMatchObject({ ok: false, errorKind: "timeout" });
  });

  test("createTypeSafeClient refuses to build without a key", async () => {
    await expect(
      createTypeSafeClient({}, { timeoutMs: 1, maxRetries: 0, totalTimeoutMs: 1 }),
    ).rejects.toMatchObject({ kind: "missing_api_key" });
  });
});

describe("decision log sink", () => {
  test("appends JSONL to the trace directory with the key redacted", () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-log-"));
    try {
      const env = { ARC_ORCHESTRATOR_TRACE_DIR: dir, TYPESAFE_API_KEY: KEY };
      appendJevDecisionLog(env)({
        schema: "arc-orchestrator/jev-decision/v1",
        at: "2026-01-01T00:00:00.000Z",
        decision_id: "d",
        decision: "route",
        mode: "on",
        source: "test",
        kind: "call",
        error: `leaked ${KEY}`,
      });
      const text = readFileSync(join(dir, "jev-decisions.jsonl"), "utf8");
      expect(text).toContain("[REDACTED]");
      expect(text).not.toContain(KEY);
      expect(JSON.parse(text.trim()).decision_id).toBe("d");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ARC_ORCHESTRATOR_TRACE=0 disables the decision log", () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-log-"));
    try {
      appendJevDecisionLog({ ARC_ORCHESTRATOR_TRACE_DIR: dir, ARC_ORCHESTRATOR_TRACE: "0" })({
        schema: "arc-orchestrator/jev-decision/v1",
        at: "x",
        decision_id: "d",
        decision: "route",
        mode: "on",
        source: "test",
        kind: "call",
      });
      expect(existsSync(join(dir, "jev-decisions.jsonl"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
