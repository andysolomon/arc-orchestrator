import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AnnotationRecord, Outcome } from "../plugins/arc-orchestrator/lib/annotation";

const projectRoot = resolve(import.meta.dir, "..");
const runner = resolve(
  projectRoot,
  "plugins/arc-orchestrator/bin/arc-orchestrator",
);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function completedRun(runId: string, escalationOf?: string): Record<string, unknown> {
  return {
    schema: 4,
    run_id: runId,
    timestamp: "2026-07-28T00:00:00.000Z",
    backend: "codex",
    mode: "analyze",
    model: "gpt-test",
    sandbox: "read-only",
    project: "phase-14-11",
    label: null,
    task_class: null,
    route_rationale: null,
    duration_ms: 10,
    status: "completed",
    exit_code: 0,
    changed_files: 0,
    tokens: null,
    budget: null,
    error: null,
    ...(escalationOf ? { escalation_of: escalationOf } : {}),
  };
}

function annotation(runId: string, outcome: Outcome): AnnotationRecord {
  return {
    schema: 1,
    run_id: runId,
    timestamp: "2026-07-28T00:01:00.000Z",
    outcome,
    escalated_to: outcome === "escalated" ? "gpt-5.6-terra" : null,
    note: null,
  };
}

async function invoke(
  traceDirectory: string,
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([runner, ...args], {
    cwd: projectRoot,
    env: { ...Bun.env, ARC_ORCHESTRATOR_TRACE_DIR: traceDirectory },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

describe("Phase 14.11 ADR 0011 closing matrix", () => {
  test("report arithmetic is identical before and after shadow-replay", async () => {
    const traceDirectory = mkdtempSync(`${tmpdir()}/phase-14-11-`);
    temporaryDirectories.push(traceDirectory);
    const runRecords = [
      completedRun("run-accepted"),
      completedRun("run-rejected"),
      completedRun("run-blocked"),
      completedRun("run-verification-failed"),
      completedRun("run-escalated", "run-accepted"),
      completedRun("run-unrated"),
    ];
    const annotations = [
      annotation("run-accepted", "accepted"),
      annotation("run-rejected", "rejected"),
      annotation("run-blocked", "blocked"),
      annotation("run-verification-failed", "verification-failed"),
      annotation("run-escalated", "escalated"),
    ];
    writeFileSync(
      resolve(traceDirectory, "runs.jsonl"),
      `${runRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
    );
    writeFileSync(
      resolve(traceDirectory, "annotations.jsonl"),
      `${annotations.map((record) => JSON.stringify(record)).join("\n")}\n`,
    );

    const before = await invoke(traceDirectory, ["report", "--json"]);
    const shadow = await invoke(traceDirectory, ["shadow-replay", "--json"]);
    const after = await invoke(traceDirectory, ["report", "--json"]);

    expect(before.exitCode).toBe(0);
    expect(shadow.exitCode).toBe(0);
    expect(after.exitCode).toBe(0);
    expect(before.stderr).toBe("");
    expect(shadow.stderr).toBe("");
    expect(after.stderr).toBe("");
    expect(after.stdout).toBe(before.stdout);

    const report = JSON.parse(after.stdout);
    expect(report.runs).toBe(6);
    const [group] = report.groups;
    expect(group).toMatchObject({
      key: "gpt-test",
      runs: 6,
      rated: 5,
      acceptance_rate: 0.2,
      by_outcome: {
        accepted: 1,
        rejected: 1,
        blocked: 1,
        "verification-failed": 1,
        escalated: 1,
      },
    });
    expect(group.acceptance_rate).toBe(
      group.by_outcome.accepted / group.rated,
    );
    expect(Object.keys(group.by_outcome)).not.toContain("cancelled");

    const shadowReport = JSON.parse(shadow.stdout);
    expect(shadowReport.accounting.total).toBe(5);
    expect(
      readFileSync(resolve(traceDirectory, "annotations.jsonl"), "utf8"),
    ).toContain("\"outcome\":\"escalated\"");
  });
});
