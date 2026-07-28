import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  ANNOTATION_SHADOW_REPORT_CONTRACT,
  buildAnnotationShadowReport,
  replayAnnotationShadowJsonl,
} from "../plugins/arc-orchestrator/lib/annotation-shadow";
import type {
  AnnotationRecord,
  Outcome,
} from "../plugins/arc-orchestrator/lib/annotation";

const runner = resolve(
  import.meta.dir,
  "../plugins/arc-orchestrator/bin/arc-orchestrator",
);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function annotation(runId: string, outcome: Outcome): AnnotationRecord {
  return {
    schema: 1,
    run_id: runId,
    timestamp: "2026-07-27T00:00:00.000Z",
    outcome,
    escalated_to: null,
    note: null,
  };
}

function run(
  runId: string,
  status: "completed" | "blocked" | "error" = "completed",
  escalationOf?: string,
): Record<string, unknown> {
  return {
    schema: 4,
    run_id: runId,
    status,
    ...(escalationOf ? { escalation_of: escalationOf } : {}),
  };
}

describe("annotation shadow replay", () => {
  test("empty corpus returns a versioned, honest zero-denominator report", () => {
    const report = buildAnnotationShadowReport({ annotations: [], runs: [] });

    expect(report.contract).toBe(ANNOTATION_SHADOW_REPORT_CONTRACT);
    expect(report.accounting).toEqual({
      total: 0,
      agreements: 0,
      divergences: 0,
      indeterminate: 0,
      unavailable: 0,
    });
    expect(report.failureRatio).toMatchObject({
      failQuality: 0,
      failApproach: 0,
      denominator: 0,
      ratio: null,
      failApproachObservable: false,
    });
    expect(report.assumedPolicy.budget.maxEscalations).toBe(1);
    expect(report.unavailableInputs).toEqual({
      historicalTaskPolicy: true,
      historicalBudgetLedger: true,
      historicalCapabilityBands: true,
      failApproachLabels: true,
    });
  });

  test("accepted, blocked, and verification-failed agree through step()", () => {
    const report = buildAnnotationShadowReport({
      annotations: [
        annotation("accepted", "accepted"),
        annotation("blocked", "blocked"),
        annotation("failed", "verification-failed"),
      ],
      runs: [run("accepted"), run("blocked", "blocked"), run("failed")],
    });

    expect(report.accounting).toMatchObject({
      total: 3,
      agreements: 3,
      divergences: 0,
    });
    expect(report.failureRatio).toMatchObject({
      failQuality: 1,
      failApproach: 0,
      denominator: 1,
      ratio: 1,
      failApproachObservable: false,
    });
    expect(
      report.transitionDiff.map((entry) => ({
        outcome: entry.annotationOutcome,
        verdict: entry.shadow.verdict,
        state: entry.shadow.projectedState,
        events: entry.shadow.events,
      })),
    ).toEqual([
      {
        outcome: "accepted",
        verdict: "pass",
        state: "accepted",
        events: ["verified:pass"],
      },
      {
        outcome: "blocked",
        verdict: "fail-blocked",
        state: "blocked",
        events: ["verified:fail-blocked"],
      },
      {
        outcome: "verification-failed",
        verdict: "fail-quality",
        state: "verification-failed",
        events: ["verified:fail-quality", "escalation-denied"],
      },
    ]);
  });

  test("one escalation chain agrees with implied floor+1 authorization", () => {
    const report = buildAnnotationShadowReport({
      annotations: [annotation("root", "escalated")],
      runs: [run("root"), run("child", "completed", "root")],
    });

    expect(report.accounting.agreements).toBe(1);
    expect(report.transitionDiff[0]).toMatchObject({
      observed: { state: "dispatch", escalationChildRunId: "child" },
      shadow: {
        verdict: "fail-quality",
        events: [
          "verified:fail-quality",
          "escalation-authorized:floor+1",
        ],
        projectedState: "dispatch",
        escalationDepth: 0,
        impliedEscalationBand: "floor+1",
      },
      classification: "agreement",
    });
  });

  test("a second escalation diverges under default maxEscalations", () => {
    const report = buildAnnotationShadowReport({
      annotations: [
        annotation("root", "escalated"),
        annotation("child", "escalated"),
      ],
      runs: [
        run("root"),
        run("child", "completed", "root"),
        run("grandchild", "completed", "child"),
      ],
    });

    expect(report.accounting).toMatchObject({
      agreements: 1,
      divergences: 1,
    });
    expect(report.transitionDiff[1]).toMatchObject({
      runId: "child",
      observed: {
        state: "dispatch",
        escalationChildRunId: "grandchild",
      },
      shadow: {
        events: ["verified:fail-quality"],
        projectedState: "verification-failed",
        escalationDepth: 1,
      },
      classification: "divergence",
    });
  });

  test("rejected completed is indeterminate while error and blocked agree", () => {
    const report = buildAnnotationShadowReport({
      annotations: [
        annotation("completed", "rejected"),
        annotation("error", "rejected"),
        annotation("blocked", "rejected"),
      ],
      runs: [
        run("completed"),
        run("error", "error"),
        run("blocked", "blocked"),
      ],
    });

    expect(
      report.transitionDiff.map((entry) => [
        entry.runId,
        entry.classification,
        entry.shadow.projectedState,
      ]),
    ).toEqual([
      ["completed", "indeterminate", null],
      ["error", "agreement", "rejected"],
      ["blocked", "agreement", "rejected"],
    ]);
    expect(report.verdictCounts.terminalRejected).toBe(2);
  });

  test("the latest valid annotation wins for each run", () => {
    const report = buildAnnotationShadowReport({
      annotations: [
        annotation("run-1", "accepted"),
        annotation("run-1", "blocked"),
      ],
      runs: [run("run-1")],
    });

    expect(report.inputs.annotations).toMatchObject({
      validRecords: 2,
      latestRecords: 1,
      supersededRecords: 1,
    });
    expect(report.transitionDiff[0]?.annotationOutcome).toBe("blocked");
  });

  test("malformed JSON and unknown shapes are skipped with diagnostics", () => {
    const report = replayAnnotationShadowJsonl({
      annotationsJsonl: [
        "{",
        JSON.stringify({ ...annotation("run-1", "accepted"), schema: 99 }),
        JSON.stringify(annotation("run-1", "accepted")),
      ].join("\n"),
      runsJsonl: [
        "not-json",
        JSON.stringify({ run_id: "", status: "completed" }),
        JSON.stringify(run("run-1")),
      ].join("\n"),
    });

    expect(report.inputs.annotations.skippedRecords).toBe(2);
    expect(report.inputs.runs.skippedRecords).toBe(2);
    expect(report.accounting.agreements).toBe(1);
    expect(report.diagnostics.map((entry) => entry.code)).toEqual([
      "malformed-annotation",
      "malformed-run",
      "unknown-annotation",
      "unknown-run",
    ]);
  });

  test("an annotation without a trace join is unavailable", () => {
    const report = buildAnnotationShadowReport({
      annotations: [annotation("missing", "accepted")],
      runs: [],
    });

    expect(report.accounting.unavailable).toBe(1);
    expect(report.transitionDiff[0]).toMatchObject({
      runId: "missing",
      runStatus: null,
      classification: "unavailable",
    });
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "run-join-unavailable",
        runId: "missing",
      }),
    );
  });

  test("fail-approach is never fabricated and an accepted-only ratio is null", () => {
    const report = buildAnnotationShadowReport({
      annotations: [annotation("run-1", "accepted")],
      runs: [run("run-1")],
    });

    expect(report.verdictCounts.failApproach).toBe(0);
    expect(report.failureRatio).toMatchObject({
      failQuality: 0,
      failApproach: 0,
      denominator: 0,
      ratio: null,
      failApproachObservable: false,
    });
  });

  test("shadow-replay --json reads a temp trace dir and leaves report output unchanged", async () => {
    const traceDirectory = mkdtempSync(`${tmpdir()}/annotation-shadow-`);
    temporaryDirectories.push(traceDirectory);
    const runRecord = {
      ...run("run-1"),
      backend: "codex",
      mode: "analyze",
      model: "gpt-test",
      task_class: null,
      duration_ms: 5,
      tokens: null,
      budget: null,
    };
    writeFileSync(
      resolve(traceDirectory, "runs.jsonl"),
      `${JSON.stringify(runRecord)}\n`,
    );
    writeFileSync(
      resolve(traceDirectory, "annotations.jsonl"),
      `${JSON.stringify(annotation("run-1", "accepted"))}\n`,
    );

    const invoke = async (args: string[]) => {
      const child = Bun.spawn([runner, ...args], {
        cwd: resolve(import.meta.dir, ".."),
        env: {
          ...Bun.env,
          ARC_ORCHESTRATOR_TRACE_DIR: traceDirectory,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { stdout, stderr, exitCode };
    };

    const reportBefore = await invoke(["report", "--json"]);
    const shadow = await invoke(["shadow-replay", "--json"]);
    const reportAfter = await invoke(["report", "--json"]);

    expect(shadow.exitCode).toBe(0);
    expect(shadow.stderr).toBe("");
    expect(JSON.parse(shadow.stdout)).toMatchObject({
      contract: ANNOTATION_SHADOW_REPORT_CONTRACT,
      accounting: { total: 1, agreements: 1 },
    });
    expect(reportBefore.exitCode).toBe(0);
    expect(reportAfter.exitCode).toBe(0);
    expect(reportAfter.stdout).toBe(reportBefore.stdout);
  });
});
