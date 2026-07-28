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
import type { RootBudgetLedger } from "../plugins/arc-orchestrator/lib/delegation-budget";
import {
  DEFAULT_TASK_BUDGET_POLICY,
  TASK_MACHINE_SCHEMA_VERSION,
  TASK_TRANSITION_TABLE,
  step,
  type TaskEvent,
  type TaskPolicy,
  type TaskState,
  type TaskTransition,
  type VerificationEvidence,
} from "../plugins/arc-orchestrator/lib/task-machine";

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

const EVIDENCE: VerificationEvidence = {
  mode: "parent",
  rungId: null,
  criteriaChecked: ["acceptance criterion"],
  commandsRun: ["bun test test/phase-14-11-matrix.test.ts"],
};

function stateOf(overrides: Partial<TaskState> = {}): TaskState {
  return {
    schemaVersion: TASK_MACHINE_SCHEMA_VERSION,
    taskIdentity: "task-1",
    rootIdentity: "root-1",
    depth: 0,
    name: "intake",
    axis: "swe",
    capabilityRoute: "implement.workspace-write.v1",
    capabilityFloor: 2,
    originalFloor: 2,
    acceptanceCriteria: ["acceptance criterion"],
    escalationsUsed: 0,
    replansUsed: 0,
    runIds: [],
    selectedRung: null,
    ...overrides,
  };
}

function policyOf(overrides: Partial<TaskPolicy> = {}): TaskPolicy {
  return {
    budget: { ...DEFAULT_TASK_BUDGET_POLICY },
    authorization: { kind: "parent" },
    verification: "parent",
    ...overrides,
  };
}

function ledgerOf(remainingCost = 10): RootBudgetLedger {
  const limits = {
    token: 2_000_000,
    wallTimeMs: 3_600_000,
    call: 25,
    cost: 10,
    concurrency: 3,
  };
  return {
    rootIdentity: "root-1",
    limits: { ...limits },
    consumed: {
      token: 0,
      wallTimeMs: 0,
      call: 0,
      cost: 0,
      concurrency: 0,
    },
    remaining: { ...limits, cost: remainingCost },
    reservations: new Map(),
    createdAtMs: 1_000,
    clock: () => {
      throw new Error("phase 14.11 matrix must keep step() pure");
    },
  };
}

function run(
  state: TaskState,
  event: TaskEvent,
  policy = policyOf(),
  ledger = ledgerOf(),
): TaskTransition {
  return step({ state, event, policy, ledger, nowMs: 2_000 });
}

function expectOk(result: TaskTransition): Extract<TaskTransition, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result;
}

function expectRejected(
  result: TaskTransition,
  reason: string,
): Extract<TaskTransition, { ok: false }> {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`expected ${reason}, got ${result.next.name}`);
  }
  expect(result.reason).toBe(reason);
  expect(result.explanation.rejection).toBe(reason);
  return result;
}

function failQualityEvent(): TaskEvent {
  return {
    kind: "verified",
    verdict: {
      kind: "fail-quality",
      unmetCriteria: ["acceptance criterion"],
      evidence: EVIDENCE,
    },
  };
}

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
  test("transition legality keeps classify parent-only and rejects illegal classify paths", () => {
    const classifyRow = TASK_TRANSITION_TABLE.find(
      (row) => row.from === "intake" && row.eventKind === "classified",
    );
    expect(classifyRow).toMatchObject({
      to: "plan",
      via: ["classify"],
      producesTaskTransition: true,
    });

    expectRejected(
      run(stateOf({ name: "intake" }), {
        kind: "planned",
        acceptanceCriteria: ["x"],
      }),
      "illegal-transition",
    );
    expectRejected(
      run(stateOf({ name: "classify" }), {
        kind: "dispatch-completed",
        runId: "run-parent-only",
        disposition: null,
      }),
      "illegal-transition",
    );

    const classified = expectOk(
      run(stateOf(), {
        kind: "classified",
        axis: "agentic-edit",
        capabilityRoute: "check.read-only.v1",
        floor: 3,
      }),
    );
    expect(classified.next).toMatchObject({
      name: "plan",
      axis: "agentic-edit",
      capabilityRoute: "check.read-only.v1",
      capabilityFloor: 3,
      originalFloor: 3,
    });
    expect(classified.explanation.notes).toContain(
      "classify is parent-executed in v1",
    );
  });

  test("TaskBudgetPolicy guard matrix refuses escalation without raising floor", () => {
    const cases = [
      {
        state: stateOf({
          name: "verify",
          runIds: ["run-limit"],
          escalationsUsed: 1,
        }),
        policy: policyOf(),
        ledger: ledgerOf(),
        reason: "escalation-limit-reached",
      },
      {
        state: stateOf({ name: "verify", runIds: ["run-budget"] }),
        policy: policyOf(),
        ledger: ledgerOf(7),
        reason: "escalation-budget-exhausted",
      },
      {
        state: stateOf({
          name: "verify",
          runIds: ["run-ceiling"],
          capabilityFloor: 4,
        }),
        policy: policyOf(),
        ledger: ledgerOf(),
        reason: "escalation-above-floor-ceiling",
      },
      {
        state: stateOf({ name: "verify", runIds: ["run-auth"] }),
        policy: policyOf({ authorization: { kind: "policy", maxBand: 2 } }),
        ledger: ledgerOf(),
        reason: "escalation-unauthorized",
      },
    ];

    for (const testCase of cases) {
      const result = expectOk(
        run(testCase.state, failQualityEvent(), testCase.policy, testCase.ledger),
      );
      expect(result.next).toMatchObject({
        name: "verification-failed",
        capabilityFloor: testCase.state.capabilityFloor,
        escalationsUsed: testCase.state.escalationsUsed,
      });
      expect(result.explanation.rejection).toBe(testCase.reason);
      expect(result.effects).toEqual([
        {
          kind: "annotate",
          runId: testCase.state.runIds.at(-1),
          outcome: "verification-failed",
        },
        { kind: "emit-task-event" },
      ]);
      expect(result.explanation.notes).toContain(
        "quality escalation guard failed",
      );
    }
  });

  test("retryable dispatch stays lateral while fail-quality verification moves vertically", () => {
    const retryable = expectOk(
      run(stateOf({ name: "dispatch", runIds: ["run-0"] }), {
        kind: "dispatch-completed",
        runId: "run-retry",
        disposition: {
          kind: "retryable",
          classification: "timeout",
          detail: null,
        },
      }),
    );
    expect(retryable.next).toMatchObject({
      name: "dispatch",
      runIds: ["run-0", "run-retry"],
    });
    expect(retryable.effects).toEqual([]);
    expect(retryable.explanation.to).toBeNull();
    expect(retryable.explanation.notes).toContain(
      "retryable failure remains inside lateral traversal",
    );

    const vertical = expectOk(
      run(stateOf({ name: "verify", runIds: ["run-quality"] }), failQualityEvent()),
    );
    expect(vertical.next.name).toBe("escalate");
    expect(vertical.effects).toEqual([
      {
        kind: "request-authorization",
        toBand: 3,
        via: { kind: "parent" },
      },
      { kind: "emit-task-event" },
    ]);
  });

  test("depth-1 tasks cannot escalate on fail-quality or authorization replay", () => {
    const quality = expectOk(
      run(
        stateOf({
          name: "verify",
          depth: 1,
          runIds: ["run-depth"],
          capabilityFloor: 2,
        }),
        failQualityEvent(),
      ),
    );
    expect(quality.next).toMatchObject({
      name: "verification-failed",
      depth: 1,
      capabilityFloor: 2,
      escalationsUsed: 0,
    });
    expect(quality.explanation.rejection).toBe("depth-limit-reached");

    expectRejected(
      run(
        stateOf({
          name: "escalate",
          depth: 1,
          runIds: ["run-depth"],
          capabilityFloor: 2,
          escalationsUsed: 0,
        }),
        { kind: "escalation-authorized", toBand: 3 },
      ),
      "depth-limit-reached",
    );
  });

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
