import { describe, expect, test } from "bun:test";
import { validateRunRecord } from "arc-contracts";
import {
  type OrchestratorTraceRun,
  type TraceAdapterContext,
  type TraceBackend,
  type TraceMode,
  traceRunToRunRecord,
  traceRunsToRunRecords,
} from "../plugins/orchestrator-core/trace-adapter";

const CONTEXT: TraceAdapterContext = {
  storyId: "st-123",
  repo: "owner/name",
};

function baselineTrace(overrides: Partial<OrchestratorTraceRun> = {}): OrchestratorTraceRun {
  return {
    schema: 4,
    run_id: "run-abc",
    timestamp: "2026-07-09T00:00:00.000Z",
    backend: "codex",
    mode: "implement",
    model: "gpt-5.6-terra",
    sandbox: "workspace-write",
    project: "opaque-project-id",
    label: "W-000009-trace-adapter",
    task_class: "feature",
    route_rationale: "default implement route",
    duration_ms: 42_000,
    status: "completed",
    exit_code: 0,
    changed_files: 3,
    tokens: {
      input_tokens: 100,
      cached_input_tokens: 20,
      output_tokens: 50,
      total_tokens: 999,
    },
    budget: null,
    error: null,
    outcome: "accepted",
    ...overrides,
  };
}

describe("traceRunToRunRecord", () => {
  test("maps a completed codex/implement trace with all fields", () => {
    const trace = baselineTrace();
    const record = traceRunToRunRecord(trace, CONTEXT);

    expect(record).toEqual({
      id: "run-abc",
      storyId: "st-123",
      label: "W-000009-trace-adapter",
      repo: "owner/name",
      route: "codex-implement",
      backend: "codex",
      model: "gpt-5.6-terra",
      access: "write",
      tokens: 999,
      durMs: 42_000,
      status: "completed",
      changed: 3,
      outcome: "accepted",
    });
    expect(validateRunRecord(record)).toBe(true);
  });

  test("route matrix maps all nine backend×mode combinations", () => {
    const backends: TraceBackend[] = ["codex", "composer", "claude"];
    const modes: TraceMode[] = ["analyze", "implement", "review"];
    const expected: Record<TraceBackend, Record<TraceMode, string>> = {
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

    for (const backend of backends) {
      for (const mode of modes) {
        const record = traceRunToRunRecord(baselineTrace({ backend, mode }), CONTEXT);
        expect(record.route).toBe(expected[backend][mode]);
      }
    }
  });

  test("renames composer backend to cursor; codex and claude pass through", () => {
    expect(traceRunToRunRecord(baselineTrace({ backend: "composer" }), CONTEXT).backend).toBe(
      "cursor",
    );
    expect(traceRunToRunRecord(baselineTrace({ backend: "codex" }), CONTEXT).backend).toBe(
      "codex",
    );
    expect(traceRunToRunRecord(baselineTrace({ backend: "claude" }), CONTEXT).backend).toBe(
      "claude",
    );
  });

  test("maps annotate outcomes 1:1 and null to unrated", () => {
    const outcomes = [
      "accepted",
      "rejected",
      "blocked",
      "verification-failed",
      "escalated",
    ] as const;

    for (const outcome of outcomes) {
      expect(traceRunToRunRecord(baselineTrace({ outcome }), CONTEXT).outcome).toBe(outcome);
    }
    expect(traceRunToRunRecord(baselineTrace({ outcome: null }), CONTEXT).outcome).toBe("unrated");
  });

  test("maps blocked and error trace statuses to failed; completed stays completed", () => {
    expect(traceRunToRunRecord(baselineTrace({ status: "completed" }), CONTEXT).status).toBe(
      "completed",
    );
    expect(traceRunToRunRecord(baselineTrace({ status: "blocked" }), CONTEXT).status).toBe(
      "failed",
    );
    expect(traceRunToRunRecord(baselineTrace({ status: "error" }), CONTEXT).status).toBe("failed");
  });

  test("defaults null tokens and changed_files; falls back label to backend/mode", () => {
    const record = traceRunToRunRecord(
      baselineTrace({
        tokens: null,
        changed_files: null,
        label: null,
        backend: "codex",
        mode: "review",
      }),
      CONTEXT,
    );

    expect(record.tokens).toBe(0);
    expect(record.changed).toBe(0);
    expect(record.label).toBe("codex/review");
  });

  test("throws on empty storyId", () => {
    expect(() => traceRunToRunRecord(baselineTrace(), { ...CONTEXT, storyId: "" })).toThrow(
      /storyId/,
    );
  });

  test("throws on unknown backend or mode", () => {
    expect(() =>
      traceRunToRunRecord(baselineTrace({ backend: "unknown" as TraceBackend }), CONTEXT),
    ).toThrow(/backend/);
    expect(() =>
      traceRunToRunRecord(baselineTrace({ mode: "unknown" as TraceMode }), CONTEXT),
    ).toThrow(/mode/);
  });
});

describe("traceRunsToRunRecords", () => {
  test("maps arrays in order", () => {
    const traces = [
      baselineTrace({ run_id: "run-1" }),
      baselineTrace({ run_id: "run-2" }),
    ];
    const records = traceRunsToRunRecords(traces, CONTEXT);

    expect(records.map((record) => record.id)).toEqual(["run-1", "run-2"]);
  });
});
