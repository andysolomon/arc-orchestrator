import { describe, expect, test } from "bun:test";
import type { Fetch } from "@typesafe-ai/sdk";
import {
  type BackendInvocationInput,
  type BackendInvocationOutput,
  executeRun,
  type InvokeBackend,
} from "../plugins/arc-orchestrator/lib/engine";
import { CANDIDATE_STACKS } from "../plugins/arc-orchestrator/lib/model-registry";
import {
  adviseJevRouting,
  jevRoutingObservability,
  type JevRoutingAdvisory,
  type JevRoutingClient,
  type JevRoutingRequest,
} from "../plugins/arc-orchestrator/lib/jev-routing";
import {
  PARENT_LOCAL_PHASES,
  WORKLOAD_CLASSES,
} from "../plugins/arc-orchestrator/lib/routes";
import { TASK_PHASES, type TraceRecord } from "../plugins/arc-orchestrator/lib/trace-schema";

const API_KEY = "ts_test_key_not_a_secret_value";

const completedResult = {
  status: "completed",
  summary: "done",
  changes: ["src/app.ts"],
  verification: ["checked"],
  risks: [],
  next_actions: [],
};

function baseRequest(
  overrides: Partial<JevRoutingRequest> = {},
): JevRoutingRequest {
  return {
    env: {
      ARC_JEV_ROUTING: "1",
      TYPESAFE_API_KEY: API_KEY,
    },
    task: "Implement the bounded helper and add a unit test.",
    phase: "implement",
    workloadClass: "hard-light",
    mode: "implement",
    routingIntent: "automatic",
    label: "jev-advisory",
    taskClass: null,
    routeRationale: null,
    requestedAlias: null,
    ...overrides,
  };
}

function hardLightCandidates(): string[] {
  const stack = CANDIDATE_STACKS.find(
    (candidate) =>
      candidate.automaticFallback &&
      candidate.phase === "implement" &&
      candidate.workloadClass === "hard-light",
  );
  if (!stack) {
    throw new Error("hard-light stack missing");
  }
  return [...stack.candidates];
}

function successAnswers(confidence = 0.92) {
  const workers = hardLightCandidates();
  return {
    model: "jev-1.13.0",
    usage: { input_tokens: 20, output_tokens: 8 },
    answers: {
      difficulty: {
        type: "score",
        score: 2,
        confidence,
        legend: { "0": "easy", "1": "medium", "2": "hard" },
        probabilities: { "0": 0.02, "1": 0.06, "2": 0.92 },
      },
      volume: {
        type: "score",
        score: 0.1,
        confidence,
        legend: { "0": "light", "1": "medium", "2": "heavy" },
        probabilities: { "0": 0.9, "1": 0.08, "2": 0.02 },
      },
      worker: {
        type: "choice",
        choice: "composer-2.5",
        confidence,
        probabilities: Object.fromEntries(
          workers.map((id) => [id, id === "composer-2.5" ? 0.9 : 0.01]),
        ),
      },
      parent_local: { type: "noul", noul: 0.08 },
      hitl: { type: "noul", noul: 0.11 },
    },
  };
}

function recordingClient(
  response: unknown,
): { client: JevRoutingClient; calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    client: {
      async systemOne(request) {
        calls.push(request);
        return response;
      },
    },
  };
}

describe("jev routing advisory", () => {
  test("stays disabled unless the flag is exactly 1, and makes no client call", async () => {
    const client = recordingClient(successAnswers());
    const logs: string[] = [];
    for (const flag of [undefined, "", "0", "true", "yes"]) {
      const advisory = await adviseJevRouting(
        baseRequest({
          env: {
            ARC_JEV_ROUTING: flag,
            TYPESAFE_API_KEY: API_KEY,
          },
        }),
        {
          client: client.client,
          emitStderr: (line) => logs.push(line),
        },
      );
      expect(advisory.status).toBe("disabled");
      expect(advisory.applied).toBe(false);
      expect(advisory.authority).toBe("runner-routing-v4");
    }
    expect(client.calls).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });

  test("fails soft when the flag is on and the API key is missing", async () => {
    const client = recordingClient(successAnswers());
    const logs: string[] = [];
    const advisory = await adviseJevRouting(
      baseRequest({ env: { ARC_JEV_ROUTING: "1" } }),
      {
        client: client.client,
        emitStderr: (line) => logs.push(line),
      },
    );
    expect(advisory.status).toBe("error");
    expect(advisory.applied).toBe(false);
    expect(advisory.error).toContain("TYPESAFE_API_KEY");
    expect(client.calls).toHaveLength(0);
    expect(logs[0]).toContain("status=error");
    expect(logs[0]).toContain("applied=false");
  });

  test("records Choice, Score, and Noul answers without applying them", async () => {
    const payload = successAnswers();
    payload.answers = {
      ...payload.answers,
      phase: {
        type: "choice",
        choice: "explore",
        confidence: 0.92,
        probabilities: { explore: 0.92 },
      },
    };
    const client = recordingClient(payload);
    const logs: string[] = [];
    const advisory = await adviseJevRouting(
      baseRequest({ phase: null }),
      {
        client: client.client,
        emitStderr: (line) => logs.push(line),
      },
    );
    const request = client.calls[0] as {
      state: { task: string };
      questions: Record<string, { type: string; criteria?: unknown }>;
    };
    expect(request.questions.phase?.type).toBe("choice");
    expect(Object.keys(request.questions.phase?.criteria ?? {})).toEqual(
      TASK_PHASES.filter((phase) => !PARENT_LOCAL_PHASES.includes(phase)),
    );
    expect(request.questions.difficulty?.type).toBe("score");
    expect(request.questions.volume?.type).toBe("score");
    expect(request.questions.worker?.type).toBe("choice");
    const workerOptions = Object.keys(request.questions.worker?.criteria ?? {});
    for (const stableId of hardLightCandidates()) {
      expect(workerOptions).toContain(stableId);
    }
    expect(request.questions.parent_local?.type).toBe("noul");
    expect(request.questions.hitl?.type).toBe("noul");

    expect(advisory.status).toBe("ok");
    expect(advisory.applied).toBe(false);
    expect(advisory.authority).toBe("runner-routing-v4");
    expect(advisory.model).toBe("jev-1.13.0");
    expect(advisory.suggestions.phase).toMatchObject({
      type: "choice",
      choice: "explore",
      disposition: "advisory",
    });
    expect(advisory.suggestions.workloadClass).toMatchObject({
      type: "workload-class",
      workloadClass: "hard-light",
      disposition: "advisory",
      difficulty: { type: "score", level: "hard", disposition: "advisory" },
      volume: { type: "score", level: "light", disposition: "advisory" },
    });
    expect(WORKLOAD_CLASSES).toContain(
      advisory.suggestions.workloadClass &&
        "workloadClass" in advisory.suggestions.workloadClass
        ? advisory.suggestions.workloadClass.workloadClass
        : "",
    );
    expect(advisory.suggestions.worker).toMatchObject({
      type: "choice",
      choice: "composer-2.5",
      candidateScope: "automatic-union",
      disposition: "advisory",
    });
    expect(advisory.suggestions.parentLocal).toMatchObject({
      type: "noul",
      noul: 0.08,
      disposition: "advisory",
    });
    expect(advisory.suggestions.hitl).toMatchObject({
      type: "noul",
      noul: 0.11,
      disposition: "advisory",
    });
    expect(logs[0]).toContain("applied=false");
    expect(logs[0]).toContain("authority=runner-routing-v4");
    expect(logs.join("\n")).not.toContain(API_KEY);
  });

  test("tags low-confidence Choice, Score, and Noul answers and still does not apply them", async () => {
    const answers = successAnswers(0.95);
    answers.answers.difficulty.confidence = 0.42;
    answers.answers.parent_local = { type: "noul", noul: 0.5 };
    const client = recordingClient(answers);
    const advisory = await adviseJevRouting(baseRequest(), {
      client: client.client,
      emitStderr: () => {},
    });
    expect(advisory.status).toBe("low_confidence");
    expect(advisory.applied).toBe(false);
    expect(advisory.suggestions.phase).toEqual({ skipped: "phase-fixed" });
    expect(advisory.suggestions.workloadClass?.disposition).toBe(
      "low_confidence",
    );
    expect(advisory.suggestions.workloadClass?.difficulty.disposition).toBe(
      "low_confidence",
    );
    expect(advisory.suggestions.worker).toMatchObject({
      disposition: "advisory",
    });
    expect(advisory.suggestions.parentLocal).toMatchObject({
      noul: 0.5,
      confidence: 0.5,
      disposition: "low_confidence",
    });
    expect(advisory.suggestions.hitl?.disposition).toBe("advisory");
  });

  test("fails soft when the client throws", async () => {
    const logs: string[] = [];
    const advisory = await adviseJevRouting(baseRequest(), {
      emitStderr: (line) => logs.push(line),
      client: {
        async systemOne() {
          throw new Error(`socket closed for ${API_KEY}`);
        },
      },
    });
    expect(advisory.status).toBe("error");
    expect(advisory.applied).toBe(false);
    expect(advisory.suggestions.workloadClass).toBeNull();
    expect(advisory.error).not.toContain(API_KEY);
    expect(logs.join("\n")).not.toContain(API_KEY);
    expect(logs[0]).toContain("continuing with runner-routing-v4");
  });

  test("redacts secrets from the state sent to Jev and skips a fixed phase", async () => {
    const client = recordingClient({
      ...successAnswers(),
      answers: {
        ...successAnswers().answers,
        phase: {
          type: "choice",
          choice: "deploy",
          confidence: 0.99,
          probabilities: { deploy: 1 },
        },
      },
    });
    const advisory = await adviseJevRouting(
      baseRequest({
        phase: "implement",
        routingIntent: "explicit",
        task: "Look at /home/ubuntu/secret/plan.md and TYPESAFE_API_KEY=supersecretvalue plus sk-supersecretvalue",
      }),
      { client: client.client, emitStderr: () => {} },
    );
    const request = client.calls[0] as {
      state: { task: string };
      questions: Record<string, unknown>;
    };
    expect(request.questions.phase).toBeUndefined();
    expect(request.questions.worker).toBeUndefined();
    expect(advisory.suggestions.phase).toEqual({ skipped: "phase-fixed" });
    expect(advisory.suggestions.worker).toEqual({
      skipped: "policy-does-not-select-among-candidates",
    });
    expect(request.state.task).not.toContain("supersecretvalue");
    expect(request.state.task).not.toContain("sk-supersecretvalue");
    expect(request.state.task).not.toContain("/home/ubuntu/secret/plan.md");
    expect(request.state.task).toContain("<path>");
  });

  test("uses the TypeSafe SDK client and fails soft on HTTP errors", async () => {
    const seen: Array<{ url: string; authorization: string; body: string }> =
      [];
    const fetchImpl: Fetch = async (url, init) => {
      const headers = init?.headers as Record<string, string>;
      seen.push({
        url,
        authorization: headers.Authorization ?? "",
        body: String(init?.body ?? ""),
      });
      const questions = JSON.parse(String(init?.body)).questions as Record<
        string,
        { type: string; criteria?: Record<string, unknown> | string[] }
      >;
      const answers: Record<string, unknown> = {};
      for (const [id, question] of Object.entries(questions)) {
        if (question.type === "choice") {
          const labels = Object.keys(question.criteria ?? {});
          answers[id] = {
            type: "choice",
            choice: labels[0],
            confidence: 0.88,
            probabilities: Object.fromEntries(
              labels.map((label, index) => [label, index === 0 ? 0.88 : 0]),
            ),
          };
        } else if (question.type === "score") {
          answers[id] = {
            type: "score",
            score: 1,
            confidence: 0.8,
            legend: { "0": "low", "1": "mid", "2": "high" },
            probabilities: { "0": 0.1, "1": 0.8, "2": 0.1 },
          };
        } else {
          answers[id] = { type: "noul", noul: 0.2 };
        }
      }
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers,
          usage: { input_tokens: 11, output_tokens: 4 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    const advisory = await adviseJevRouting(baseRequest({ phase: null }), {
      fetch: fetchImpl,
      emitStderr: () => {},
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(seen[0]?.authorization).toBe(`Bearer ${API_KEY}`);
    const sent = JSON.parse(seen[0]?.body ?? "{}") as {
      questions: Record<string, { type: string }>;
    };
    expect(sent.questions.phase?.type).toBe("choice");
    expect(sent.questions.difficulty?.type).toBe("score");
    expect(sent.questions.parent_local?.type).toBe("noul");
    expect(advisory.status).toBe("ok");
    expect(advisory.applied).toBe(false);
    expect(advisory.suggestions.workloadClass?.workloadClass).toBe(
      "medium-medium",
    );

    const failingFetch: Fetch = async () =>
      new Response(JSON.stringify({ error: "unavailable" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    const failed = await adviseJevRouting(baseRequest(), {
      fetch: failingFetch,
      emitStderr: () => {},
    });
    expect(failed.status).toBe("error");
    expect(failed.applied).toBe(false);
    expect(failed.authority).toBe("runner-routing-v4");
  });

  test("observability reports readiness without the API key", () => {
    expect(
      jevRoutingObservability({
        ARC_JEV_ROUTING: "1",
        TYPESAFE_API_KEY: API_KEY,
        ARC_JEV_CONFIDENCE_THRESHOLD: "0.75",
      }),
    ).toEqual({
      enabled: true,
      api_key_configured: true,
      advisory_ready: true,
      confidence_threshold: 0.75,
      authority: "runner-routing-v4",
    });
    const off = jevRoutingObservability({ TYPESAFE_API_KEY: API_KEY });
    expect(off.advisory_ready).toBe(false);
    expect(off).not.toHaveProperty("api_key");
    expect(JSON.stringify(off)).not.toContain(API_KEY);
  });
});

function successFor(input: BackendInvocationInput): BackendInvocationOutput {
  if (input.backend === "codex") {
    return {
      stdout:
        '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}',
      stderr: "",
      exitCode: 0,
      resultText: JSON.stringify(completedResult),
    };
  }
  return {
    stdout: JSON.stringify({
      is_error: false,
      result: JSON.stringify(completedResult),
    }),
    stderr: "",
    exitCode: 0,
  };
}

function automaticInput() {
  return {
    backend: "codex" as const,
    mode: "implement" as const,
    phase: "implement" as const,
    task: "UNIQUE_TASK_MARKER add the helper",
    cwd: process.cwd(),
    label: "jev-engine",
    taskClass: null,
    workloadClass: "hard-light",
    routeRationale: null,
    budget: { maxTokens: null, maxDurationMs: null },
    effort: null,
    fallback: null as const,
    backendExplicit: false,
    routingIntent: "automatic" as const,
  };
}

describe("jev routing engine hook", () => {
  test("disabled advisory does not change the worker runner-routing-v4 selects", async () => {
    const calls: unknown[] = [];
    const client: JevRoutingClient = {
      async systemOne(request) {
        calls.push(request);
        return successAnswers();
      },
    };
    const fake: { invocations: BackendInvocationInput[] } = { invocations: [] };
    const invokeBackend: InvokeBackend = async (input) => {
      fake.invocations.push(input);
      return successFor(input);
    };
    const traces: TraceRecord[] = [];
    const result = await executeRun(automaticInput(), {
      env: { TYPESAFE_API_KEY: API_KEY },
      invokeBackend,
      jevClient: client,
      onTrace: (trace) => traces.push(trace),
      emitStderr: () => {},
    });
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(0);
    expect(fake.invocations).toHaveLength(1);
    expect(fake.invocations[0]?.backend).toBe("codex");
    expect(fake.invocations[0]?.profile.model).toBe("gpt-5.6-sol");
    expect(traces[0]).not.toHaveProperty("jevRouting");
  });

  test("a conflicting Jev suggestion is logged and does not replace the policy worker", async () => {
    const payload = successAnswers();
    payload.answers.difficulty.score = 0;
    payload.answers.difficulty.probabilities = {
      "0": 0.91,
      "1": 0.05,
      "2": 0.04,
    };
    const client = recordingClient(payload);
    const logs: string[] = [];
    const invocations: BackendInvocationInput[] = [];
    const traces: TraceRecord[] = [];
    const result = await executeRun(automaticInput(), {
      env: {
        ARC_JEV_ROUTING: "1",
        TYPESAFE_API_KEY: API_KEY,
      },
      jevClient: client.client,
      invokeBackend: async (input) => {
        invocations.push(input);
        return successFor(input);
      },
      onTrace: (trace) => traces.push(trace),
      emitStderr: (line) => logs.push(line),
    });
    expect(result.success).toBe(true);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.backend).toBe("codex");
    expect(invocations[0]?.profile.model).toBe("gpt-5.6-sol");
    expect(invocations[0]?.prompt).toContain("UNIQUE_TASK_MARKER");
    expect(invocations[0]?.prompt).not.toContain("composer-2.5");
    const trace = traces[0] as TraceRecord & {
      jevRouting?: JevRoutingAdvisory;
    };
    expect(trace?.model).toBe("gpt-5.6-sol");
    expect(trace?.workload_class).toBe("hard-light");
    expect(trace?.jevRouting?.applied).toBe(false);
    expect(trace?.jevRouting?.authority).toBe("runner-routing-v4");
    expect(trace?.jevRouting?.suggestions.worker).toMatchObject({
      choice: "composer-2.5",
    });
    expect(trace?.workload_class).toBe("hard-light");
    expect(trace?.jevRouting?.suggestions.workloadClass?.workloadClass).toBe(
      "easy-light",
    );
    expect(logs.join("\n")).not.toContain(API_KEY);
    expect(logs.join("\n")).not.toContain("UNIQUE_TASK_MARKER");
  });

  test("an API failure still runs the policy worker", async () => {
    const invocations: BackendInvocationInput[] = [];
    const traces: TraceRecord[] = [];
    const result = await executeRun(automaticInput(), {
      env: { ARC_JEV_ROUTING: "1", TYPESAFE_API_KEY: API_KEY },
      jevClient: {
        async systemOne() {
          throw new Error("timeout talking to jev");
        },
      },
      invokeBackend: async (input) => {
        invocations.push(input);
        return successFor(input);
      },
      onTrace: (trace) => traces.push(trace),
      emitStderr: () => {},
    });
    expect(result.success).toBe(true);
    expect(invocations[0]?.profile.model).toBe("gpt-5.6-sol");
    const trace = traces[0] as TraceRecord & {
      jevRouting?: JevRoutingAdvisory;
    };
    expect(trace?.jevRouting?.status).toBe("error");
    expect(trace?.jevRouting?.applied).toBe(false);
  });
});
