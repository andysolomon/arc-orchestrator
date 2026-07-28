import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TASK_BUDGET_POLICY,
  TASK_MACHINE_SCHEMA_VERSION,
  step,
  type TaskEvent,
  type TaskPolicy,
  type TaskState,
} from "../plugins/arc-orchestrator/lib/task-machine";
import {
  appendTaskEventsRecord,
  parseTaskEventsJsonl,
  replayLedgerForTaskEvent,
  replayTaskEvents,
  serializeTaskEventsRecord,
  stableJsonStringify,
  taskEventsPath,
  TASK_EVENTS_CONTRACT,
  TASK_EVENTS_FILE_NAME,
  TASK_EVENTS_SCHEMA_VERSION,
  type TaskEventsEventRecord,
  type TaskEventsRecord,
  type TaskEventsSeedRecord,
} from "../plugins/arc-orchestrator/lib/task-events";
import type { SelectionDecision } from "../plugins/arc-orchestrator/lib/capability-selection";

const NOW = 2_000;

const EVIDENCE = {
  mode: "parent" as const,
  rungId: null,
  criteriaChecked: ["focused tests pass"],
  commandsRun: ["bun test test/task-events.test.ts"],
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
    acceptanceCriteria: [],
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

function selectedDecision(rungId = "composer-2.5@none"): SelectionDecision {
  return {
    outcome: "selected",
    stack: [
      {
        rungId: rungId as "composer-2.5@none",
        stableId: rungId.split("@")[0] ?? rungId,
        effort: "none",
        backend: "composer",
        band: 2,
        estimatedUsd: 1,
        quotaPool: null,
      },
    ],
    explanation: {
      policyVersion: "capability-rung/v1",
      snapshotVersion: "test",
      registryVersion: 1,
      axis: "swe",
      requestedFloor: 2,
      effectiveFloor: 2,
      floorLowered: false,
      overrideApplied: false,
      eligible: [rungId as "composer-2.5@none"],
      rejected: [],
      pruned: [],
      budgetConstrained: [],
      unranked: [],
      leadBackend: "composer",
    },
  };
}

function seedRecord(state = stateOf()): TaskEventsSeedRecord {
  return {
    contract: TASK_EVENTS_CONTRACT,
    schema: TASK_EVENTS_SCHEMA_VERSION,
    kind: "seed",
    taskIdentity: state.taskIdentity,
    sequence: 0,
    state,
  };
}

function eventRecord(
  sequence: number,
  event: TaskEvent,
  policy = policyOf(),
  remainingBudgetCost = 10,
  nowMs = NOW,
): TaskEventsEventRecord {
  return {
    contract: TASK_EVENTS_CONTRACT,
    schema: TASK_EVENTS_SCHEMA_VERSION,
    kind: "event",
    taskIdentity: "task-1",
    sequence,
    event,
    policy,
    remainingBudgetCost,
    nowMs,
  };
}

function acceptedHistory(): TaskEventsRecord[] {
  return [
    seedRecord(),
    eventRecord(1, {
      kind: "classified",
      axis: "swe",
      capabilityRoute: "implement.workspace-write.v1",
      floor: 2,
    }),
    eventRecord(2, { kind: "planned", acceptanceCriteria: ["works"] }),
    eventRecord(3, { kind: "decomposed", childTaskKeys: [] }),
    eventRecord(4, {
      kind: "dispatch-selected",
      decision: selectedDecision(),
    }),
    eventRecord(5, {
      kind: "dispatch-completed",
      runId: "run-ok",
      disposition: null,
    }),
    eventRecord(6, {
      kind: "verified",
      verdict: { kind: "pass", evidence: EVIDENCE },
    }),
  ];
}

function manuallyFold(records: readonly TaskEventsRecord[]): TaskState {
  const seed = records[0];
  if (seed?.kind !== "seed") {
    throw new Error("expected seed");
  }
  let state = structuredClone(seed.state);
  for (const record of records.slice(1)) {
    if (record.kind !== "event") {
      continue;
    }
    const transition = step({
      state,
      event: structuredClone(record.event),
      policy: structuredClone(record.policy),
      ledger: replayLedgerForTaskEvent(
        state.rootIdentity,
        record.remainingBudgetCost,
        record.nowMs,
      ),
      nowMs: record.nowMs,
    });
    expect(transition.ok).toBe(true);
    if (!transition.ok) {
      throw new Error(transition.reason);
    }
    state = transition.next;
  }
  return state;
}

describe("task-events.jsonl sidecar contract", () => {
  test("round-trips deterministic JSONL records with exact replay inputs", () => {
    const records = acceptedHistory();
    const text = `${records.map(serializeTaskEventsRecord).join("\n")}\n`;
    expect(serializeTaskEventsRecord(records[1]!)).toBe(
      serializeTaskEventsRecord(records[1]!),
    );
    expect(stableJsonStringify({ z: 1, a: { b: 2, a: 1 } })).toBe(
      '{"a":{"a":1,"b":2},"z":1}',
    );

    const parsed = parseTaskEventsJsonl(text);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.records).toEqual(records);
    expect(parsed.records[1]).toMatchObject({
      kind: "event",
      event: records[1]!.kind === "event" ? records[1]!.event : null,
      policy: records[1]!.kind === "event" ? records[1]!.policy : null,
      remainingBudgetCost: 10,
      nowMs: NOW,
    });
  });

  test("replay matches step() for a full accepted lifecycle", () => {
    const records = acceptedHistory();
    const replay = replayTaskEvents(records);
    expect(replay.diagnostics).toEqual([]);
    expect(replay.ok).toBe(true);
    expect(replay.finalState).toEqual(manuallyFold(records));
    expect(replay.finalState?.name).toBe("accepted");
    expect(replay.transitions.at(-1)).toMatchObject({
      ok: true,
      next: { name: "accepted" },
    });
  });

  test("retryable lateral dispatch events record the run but produce no task transition", () => {
    const records = acceptedHistory();
    records.splice(
      5,
      0,
      eventRecord(5, {
        kind: "dispatch-completed",
        runId: "run-retry",
        disposition: {
          kind: "retryable",
          classification: "timeout",
          detail: null,
        },
      }),
    );
    for (let index = 6; index < records.length; index += 1) {
      const record = records[index];
      if (record?.kind === "event") {
        record.sequence += 1;
      }
    }

    const replay = replayTaskEvents(records);
    expect(replay.diagnostics).toEqual([]);
    expect(replay.transitions[4]).toMatchObject({
      ok: true,
      next: { name: "dispatch", runIds: ["run-retry"] },
      explanation: { to: null },
    });
    expect(replay.finalState).toEqual(manuallyFold(records));
    expect(replay.finalState?.runIds).toEqual(["run-retry", "run-ok"]);
  });

  test("replay matches step() for an escalation history", () => {
    const records: TaskEventsRecord[] = [
      ...acceptedHistory().slice(0, 6),
      eventRecord(6, {
        kind: "verified",
        verdict: {
          kind: "fail-quality",
          unmetCriteria: ["quality"],
          evidence: EVIDENCE,
        },
      }),
      eventRecord(7, { kind: "escalation-authorized", toBand: 3 }),
      eventRecord(8, {
        kind: "dispatch-selected",
        decision: selectedDecision("gpt-5.5@high"),
      }),
      eventRecord(9, {
        kind: "dispatch-completed",
        runId: "run-escalated",
        disposition: null,
      }),
      eventRecord(10, {
        kind: "verified",
        verdict: { kind: "pass", evidence: EVIDENCE },
      }),
    ];

    const replay = replayTaskEvents(records);
    expect(replay.diagnostics).toEqual([]);
    expect(replay.finalState).toEqual(manuallyFold(records));
    expect(replay.finalState).toMatchObject({
      name: "accepted",
      capabilityFloor: 3,
      escalationsUsed: 1,
      runIds: ["run-ok", "run-escalated"],
    });
  });

  test("reports malformed and truncated lines without dropping valid records", () => {
    const records = acceptedHistory().slice(0, 2);
    const text = [
      serializeTaskEventsRecord(records[0]!),
      "{not-json",
      serializeTaskEventsRecord(records[1]!),
      '{"contract":"orchestrator-task-events/v1"',
    ].join("\n");

    const parsed = parseTaskEventsJsonl(text);
    expect(parsed.records).toEqual(records);
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.kind)).toEqual([
      "malformed-line",
      "truncated-line",
    ]);
  });

  test("reports sequence gaps without mutating inputs", () => {
    const records = [
      seedRecord(),
      eventRecord(1, {
        kind: "classified",
        axis: "swe",
        capabilityRoute: "implement.workspace-write.v1",
        floor: 2,
      }),
      eventRecord(3, { kind: "planned", acceptanceCriteria: ["works"] }),
    ];
    const before = structuredClone(records);
    const replay = replayTaskEvents(records);
    expect(replay.ok).toBe(false);
    expect(replay.diagnostics).toEqual([
      {
        kind: "sequence-gap",
        line: null,
        sequence: 3,
        message: "expected sequence 2, got 3",
      },
    ]);
    expect(records).toEqual(before);
    expect(replay.finalState?.name).toBe("plan");
  });

  test("append retention follows the sidecar tail-retention precedent", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "task-events-"));
    try {
      const path = taskEventsPath(directory);
      const records = acceptedHistory();
      for (const record of records) {
        appendTaskEventsRecord(path, record, 3);
      }
      expect(path.endsWith(TASK_EVENTS_FILE_NAME)).toBe(true);
      const lines = readFileSync(path, "utf8").trim().split("\n");
      expect(lines).toHaveLength(3);
      expect(parseTaskEventsJsonl(readFileSync(path, "utf8")).records).toEqual(
        records.slice(-3),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("replay reports retention-truncated heads when the seed was retained away", () => {
    const retainedTail = acceptedHistory().slice(-3);
    const replay = replayTaskEvents(retainedTail);
    expect(replay.ok).toBe(false);
    expect(replay.diagnostics).toEqual([
      {
        kind: "retention-truncated-head",
        line: null,
        sequence: 4,
        message: "history starts after the seed record",
      },
    ]);
    expect(replay.finalState).toBeNull();
  });
});
