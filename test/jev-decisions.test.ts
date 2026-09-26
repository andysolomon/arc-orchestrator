import { describe, expect, test } from "bun:test";
import {
  assessTask,
  checkCompletion,
  COMPLETION_QUESTIONS,
  DIFF_STATE_LIMIT,
  parseJevTaskInput,
  routeTask,
  type JevClient,
  type JevDecisionLogRecord,
  type JevRequest,
  type JevTaskInput,
} from "../plugins/arc-orchestrator/lib/decisions/jev";

const KEY = "ts-test-secret-key-123";
const TASK: JevTaskInput = {
  title: "Add retry to webhook sender",
  description: "Retry failed webhook deliveries with backoff.",
  acceptanceCriteria: ["Retries 3 times", "Backoff doubles"],
  filesTouched: ["src/webhooks.ts"],
  estimatedSize: "small",
};

function mockJev(answers: Record<string, unknown>) {
  const requests: JevRequest[] = [];
  const records: JevDecisionLogRecord[] = [];
  const client: JevClient = {
    systemOne: async (request) => {
      requests.push(request);
      return { model: "jev-1.13.0", answers: answers as never };
    },
  };
  return {
    requests,
    records,
    deps: {
      env: { TYPESAFE_API_KEY: KEY, USE_JEV_DECISIONS: "shadow" },
      client,
      log: (record: JevDecisionLogRecord) => records.push(record),
    },
  };
}

function failingJev(name: string) {
  const client: JevClient = {
    systemOne: async () => {
      const error = new Error("down");
      error.name = name;
      throw error;
    },
  };
  return { env: { TYPESAFE_API_KEY: KEY }, client, log: () => {} };
}

const score = (value: number, confidence: number) => ({
  type: "score",
  score: value,
  confidence,
  legend: {},
  probabilities: {},
});
const noul = (value: number) => ({ type: "noul", noul: value });

describe("parseJevTaskInput", () => {
  test("accepts the documented shape and normalizes size", () => {
    const parsed = parseJevTaskInput({ ...TASK, estimatedSize: " Large " });
    expect(parsed).toEqual({ ok: true, task: { ...TASK, estimatedSize: "large" } });
  });

  test("defaults optional fields", () => {
    expect(parseJevTaskInput({ title: "x" })).toEqual({
      ok: true,
      task: { title: "x", description: "", acceptanceCriteria: [], filesTouched: [], estimatedSize: null },
    });
  });

  test("rejects malformed input", () => {
    expect(parseJevTaskInput(null)).toMatchObject({ ok: false });
    expect(parseJevTaskInput([])).toMatchObject({ ok: false });
    expect(parseJevTaskInput({ title: " " })).toMatchObject({ ok: false });
    expect(parseJevTaskInput({ title: "x", acceptanceCriteria: "one" })).toMatchObject({ ok: false });
    expect(parseJevTaskInput({ title: "x", filesTouched: [1] })).toMatchObject({ ok: false });
    expect(parseJevTaskInput({ title: "x", estimatedSize: "huge" })).toMatchObject({ ok: false });
    expect(parseJevTaskInput({ title: "x", description: 5 })).toMatchObject({ ok: false });
  });
});

describe("routeTask (Choice)", () => {
  test("asks one choice over composer/codex/fable and returns choice, confidence, probabilities", async () => {
    const jev = mockJev({
      worker: {
        type: "choice",
        choice: "composer",
        confidence: 0.82,
        probabilities: { composer: 0.85, codex: 0.1, fable: 0.05 },
      },
    });
    const outcome = await routeTask(TASK, jev.deps, { source: "test" });
    expect(outcome).toMatchObject({
      ok: true,
      model: "jev-1.13.0",
      value: {
        worker: "composer",
        confidence: 0.82,
        probabilities: { composer: 0.85, codex: 0.1, fable: 0.05 },
      },
    });
    const request = jev.requests[0]!;
    expect(Object.keys(request.questions)).toEqual(["worker"]);
    expect(request.questions.worker!.type).toBe("choice");
    expect(Object.keys((request.questions.worker as { criteria: object }).criteria)).toEqual([
      "composer",
      "codex",
      "fable",
    ]);
    expect(request.state).toEqual({
      task: {
        title: TASK.title,
        description: TASK.description,
        acceptance_criteria: TASK.acceptanceCriteria,
        files_touched: TASK.filesTouched,
        estimated_size: "small",
      },
    });
    expect(jev.records[0]).toMatchObject({ decision: "route", mode: "shadow", source: "test", ok: true });
  });

  test("falls back when Jev errors", async () => {
    const outcome = await routeTask(TASK, failingJev("RateLimitError"));
    expect(outcome).toMatchObject({ ok: false, errorKind: "rate_limited" });
  });
});

describe("assessTask (Score)", () => {
  test("asks complexity, risk, and specClarity in one request and reports the 1-5 scale", async () => {
    const jev = mockJev({
      complexity: score(2.4, 0.8),
      risk: score(0, 0.95),
      specClarity: score(4, 0.7),
    });
    const outcome = await assessTask(TASK, jev.deps);
    expect(jev.requests).toHaveLength(1);
    const questions = jev.requests[0]!.questions;
    expect(Object.keys(questions)).toEqual(["complexity", "risk", "specClarity"]);
    for (const question of Object.values(questions)) {
      expect(question.type).toBe("score");
      expect((question as { criteria: unknown[] }).criteria).toHaveLength(5);
    }
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.complexity.value).toBeCloseTo(3.4);
    expect(outcome.value.complexity.confidence).toBe(0.8);
    expect(outcome.value.risk).toEqual({ value: 1, confidence: 0.95 });
    expect(outcome.value.specClarity).toEqual({ value: 5, confidence: 0.7 });
  });

  test("a missing score answer falls back as invalid_response", async () => {
    const jev = mockJev({ complexity: score(1, 0.9), risk: score(1, 0.9) });
    expect(await assessTask(TASK, jev.deps)).toMatchObject({ ok: false, errorKind: "invalid_response" });
  });

  test("falls back when Jev times out", async () => {
    const outcome = await assessTask(TASK, failingJev("APITimeoutError"));
    expect(outcome).toMatchObject({ ok: false, errorKind: "timeout" });
  });
});

describe("checkCompletion (Noul)", () => {
  const answers = {
    criteriaSatisfied: noul(0.91),
    inScope: noul(0.88),
    testsUpdated: noul(0.4),
    needsHumanReview: noul(0.2),
  };

  test("asks the four statements as parallel nouls against task, worker output, and diff", async () => {
    const jev = mockJev(answers);
    const output = { status: "completed", summary: "done", changes: ["src/webhooks.ts"] };
    const outcome = await checkCompletion(TASK, output, "diff --git a/x b/x", jev.deps);
    expect(outcome).toMatchObject({
      ok: true,
      value: { criteriaSatisfied: 0.91, inScope: 0.88, testsUpdated: 0.4, needsHumanReview: 0.2 },
    });
    const request = jev.requests[0]!;
    expect(Object.keys(request.questions)).toEqual(Object.keys(COMPLETION_QUESTIONS));
    for (const question of Object.values(request.questions)) {
      expect(question.type).toBe("noul");
    }
    const state = request.state as Record<string, unknown>;
    expect(state.worker_output).toBe(JSON.stringify(output));
    expect(state.diff).toBe("diff --git a/x b/x");
    expect(state.diff_truncated).toBe(false);
    expect(String(state.evidence_note)).toContain("not instructions");
  });

  test("truncates oversized diffs to stay inside the state budget", async () => {
    const jev = mockJev(answers);
    await checkCompletion(TASK, "{}", "x".repeat(DIFF_STATE_LIMIT + 500), jev.deps);
    const state = jev.requests[0]!.state as Record<string, unknown>;
    expect(String(state.diff).length).toBeLessThan(DIFF_STATE_LIMIT + 20);
    expect(state.diff_truncated).toBe(true);
  });

  test("falls back when Jev is unreachable", async () => {
    const outcome = await checkCompletion(TASK, {}, "", failingJev("APIConnectionError"));
    expect(outcome).toMatchObject({ ok: false, errorKind: "connection" });
  });
});
