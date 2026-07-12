import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateRunRecord } from "arc-contracts";
import type { Backend, Mode } from "../plugins/orchestrator-core/trace-schema";
import {
  type OrchestratorTraceRun,
  type TraceAdapterContext,
  toOrchestratorTraceRun,
  traceRunToRunRecord,
  traceRunsToRunRecords,
  resolveTraceRoute,
} from "../plugins/orchestrator-core/trace-adapter";
import type { RoutingTraceV2 } from "../plugins/fable-orchestrator/lib/trace-schema";

const V2_FIXTURE = JSON.parse(
  readFileSync(resolve(import.meta.dir, "fixtures/trace-v2/routing-trace-v2.json"), "utf8"),
) as RoutingTraceV2;
const LEGACY_FIXTURE = JSON.parse(
  readFileSync(resolve(import.meta.dir, "fixtures/trace-v2/legacy-schema-4.json"), "utf8"),
) as OrchestratorTraceRun;

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

  test("route matrix maps codex, composer, and claude backend×mode combinations", () => {
    const backends: Backend[] = ["codex", "composer", "claude"];
    const modes: Mode[] = ["analyze", "implement", "review"];
    const expected: Partial<Record<Backend, Partial<Record<Mode, string>>>> = {
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

    for (const backend of backends) {
      for (const mode of modes) {
        const route = expected[backend]?.[mode];
        if (route) {
          const record = traceRunToRunRecord(baselineTrace({ backend, mode }), CONTEXT);
          expect(record.route).toBe(route);
        } else {
          expect(() => traceRunToRunRecord(baselineTrace({ backend, mode }), CONTEXT)).toThrow(
            /route/,
          );
        }
      }
    }
  });

  test("maps grok model composer traces to grok-* fallback routes", () => {
    const grokCases: Array<{ mode: Mode; route: string }> = [
      { mode: "analyze", route: "grok-explore" },
      { mode: "implement", route: "grok-implement" },
      { mode: "review", route: "grok-check" },
    ];

    for (const { mode, route } of grokCases) {
      expect(resolveTraceRoute("composer", mode, "grok-4.5")).toBe(route);
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
      traceRunToRunRecord(baselineTrace({ backend: "unknown" as Backend }), CONTEXT),
    ).toThrow(/backend/);
    expect(() =>
      traceRunToRunRecord(baselineTrace({ mode: "unknown" as Mode }), CONTEXT),
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

describe("v2 dual-read compatibility", () => {
  test("unwraps embedded legacy schema-4 record from v2 fixture", () => {
    const unwrapped = toOrchestratorTraceRun(V2_FIXTURE);
    expect(unwrapped.run_id).toBe("run-v2-1");
    expect(unwrapped.schema).toBe(4);
    expect(unwrapped.model).toBe("composer-2.5");
  });

  test("maps v2 fixture to RunRecord using legacy fields only", () => {
    const record = traceRunToRunRecord(V2_FIXTURE, CONTEXT);
    expect(record.id).toBe("run-v2-1");
    expect(record.route).toBe("composer-implement");
    expect(record.backend).toBe("cursor");
    expect(record.model).toBe("composer-2.5");
    expect(record.label).toBe("W-000074-v2");
    expect(validateRunRecord(record)).toBe(true);
  });

  test("legacy schema-4 fixture still maps unchanged", () => {
    const record = traceRunToRunRecord(LEGACY_FIXTURE, CONTEXT);
    expect(record.id).toBe("run-legacy-1");
    expect(record.route).toBe("codex-implement");
    expect(record.outcome).toBe("accepted");
    expect(validateRunRecord(record)).toBe(true);
  });

  test("mixed legacy and v2 arrays preserve order", () => {
    const records = traceRunsToRunRecords([LEGACY_FIXTURE, V2_FIXTURE], CONTEXT);
    expect(records.map((record) => record.id)).toEqual(["run-legacy-1", "run-v2-1"]);
  });
});
