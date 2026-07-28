import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  BUDGET_LIMITS_V1,
  type BudgetVector,
  type RootBudgetLedger,
} from "./delegation-budget";
import {
  step,
  type TaskEvent,
  type TaskPolicy,
  type TaskState,
  type TaskTransition,
} from "./task-machine";

export const TASK_EVENTS_CONTRACT = "orchestrator-task-events/v1" as const;
export const TASK_EVENTS_SCHEMA_VERSION = 1;
export const TASK_EVENTS_FILE_NAME = "task-events.jsonl";
export const DEFAULT_TASK_EVENTS_LIMIT = 1000;

export type TaskEventsSeedRecord = {
  contract: typeof TASK_EVENTS_CONTRACT;
  schema: typeof TASK_EVENTS_SCHEMA_VERSION;
  kind: "seed";
  taskIdentity: string;
  sequence: 0;
  state: TaskState;
};

export type TaskEventsEventRecord = {
  contract: typeof TASK_EVENTS_CONTRACT;
  schema: typeof TASK_EVENTS_SCHEMA_VERSION;
  kind: "event";
  taskIdentity: string;
  sequence: number;
  event: TaskEvent;
  policy: TaskPolicy;
  remainingBudgetCost: number;
  nowMs: number;
};

export type TaskEventsRecord = TaskEventsSeedRecord | TaskEventsEventRecord;

export type TaskEventsDiagnosticKind =
  | "malformed-line"
  | "truncated-line"
  | "missing-seed"
  | "retention-truncated-head"
  | "sequence-gap"
  | "transition-rejected";

export type TaskEventsDiagnostic = {
  kind: TaskEventsDiagnosticKind;
  line: number | null;
  sequence: number | null;
  message: string;
};

export type ParseTaskEventsJsonlResult = {
  records: TaskEventsRecord[];
  diagnostics: TaskEventsDiagnostic[];
};

export type TaskEventsReplayResult = {
  ok: boolean;
  taskIdentity: string | null;
  seed: TaskState | null;
  finalState: TaskState | null;
  transitions: TaskTransition[];
  diagnostics: TaskEventsDiagnostic[];
};

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTaskEventsRecord(value: unknown): value is TaskEventsRecord {
  if (!isRecord(value)) {
    return false;
  }
  if (
    value.contract !== TASK_EVENTS_CONTRACT ||
    value.schema !== TASK_EVENTS_SCHEMA_VERSION ||
    typeof value.taskIdentity !== "string" ||
    value.taskIdentity.trim() === "" ||
    typeof value.sequence !== "number" ||
    !Number.isInteger(value.sequence) ||
    value.sequence < 0
  ) {
    return false;
  }
  if (value.kind === "seed") {
    return value.sequence === 0 && isRecord(value.state);
  }
  if (value.kind === "event") {
    return (
      value.sequence > 0 &&
      isRecord(value.event) &&
      isRecord(value.policy) &&
      typeof value.remainingBudgetCost === "number" &&
      Number.isFinite(value.remainingBudgetCost) &&
      typeof value.nowMs === "number" &&
      Number.isFinite(value.nowMs)
    );
  }
  return false;
}

function compareObjectKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function stableJsonStringify(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJsonStringify(entry)).join(",")}]`;
  }
  const entries = Object.entries(value)
    .filter((entry): entry is [string, JsonValue] => entry[1] !== undefined)
    .sort(([left], [right]) => compareObjectKeys(left, right));
  return `{${entries
    .map(
      ([key, entry]) =>
        `${JSON.stringify(key)}:${stableJsonStringify(entry)}`,
    )
    .join(",")}}`;
}

export function serializeTaskEventsRecord(record: TaskEventsRecord): string {
  return stableJsonStringify(record as unknown as JsonValue);
}

function malformed(
  kind: "malformed-line" | "truncated-line",
  line: number,
  message: string,
): TaskEventsDiagnostic {
  return { kind, line, sequence: null, message };
}

function looksTruncated(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("{") &&
    !trimmed.endsWith("}") &&
    !trimmed.endsWith("]")
  );
}

export function parseTaskEventsJsonl(text: string): ParseTaskEventsJsonlResult {
  const records: TaskEventsRecord[] = [];
  const diagnostics: TaskEventsDiagnostic[] = [];
  const lines = text.split("\n");

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line === "") {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isTaskEventsRecord(parsed)) {
        diagnostics.push(
          malformed("malformed-line", index + 1, "record shape is invalid"),
        );
        continue;
      }
      records.push(parsed);
    } catch (error) {
      const kind =
        index === lines.length - 1 && looksTruncated(line)
          ? "truncated-line"
          : "malformed-line";
      diagnostics.push(
        malformed(
          kind,
          index + 1,
          error instanceof Error ? error.message : "invalid JSON",
        ),
      );
    }
  }

  return { records, diagnostics };
}

function enforceTaskEventsRetention(path: string, limit: number): void {
  if (limit === 0) {
    return;
  }
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim());
  if (lines.length <= limit) {
    return;
  }
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${lines.slice(-limit).join("\n")}\n`);
  renameSync(temporaryPath, path);
}

export function appendTaskEventsRecord(
  path: string,
  record: TaskEventsRecord,
  limit = DEFAULT_TASK_EVENTS_LIMIT,
): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${serializeTaskEventsRecord(record)}\n`);
  enforceTaskEventsRetention(path, limit);
}

export function taskEventsPath(directory: string): string {
  return resolve(directory, TASK_EVENTS_FILE_NAME);
}

export function readTaskEventsJsonl(path: string): ParseTaskEventsJsonlResult {
  if (!existsSync(path)) {
    return { records: [], diagnostics: [] };
  }
  return parseTaskEventsJsonl(readFileSync(path, "utf8"));
}

function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

function budgetVectorWithRemainingCost(remainingCost: number): BudgetVector {
  return {
    ...BUDGET_LIMITS_V1.root,
    cost: remainingCost,
  };
}

export function replayLedgerForTaskEvent(
  rootIdentity: string,
  remainingBudgetCost: number,
  nowMs: number,
): RootBudgetLedger {
  return {
    rootIdentity,
    limits: { ...BUDGET_LIMITS_V1.root },
    consumed: {
      token: 0,
      wallTimeMs: 0,
      call: 0,
      cost: BUDGET_LIMITS_V1.root.cost - remainingBudgetCost,
      concurrency: 0,
    },
    remaining: budgetVectorWithRemainingCost(remainingBudgetCost),
    reservations: new Map(),
    createdAtMs: nowMs,
    clock: () => {
      throw new Error("task event replay must not read ledger.clock");
    },
  };
}

export function replayTaskEvents(
  records: readonly TaskEventsRecord[],
  taskIdentity?: string,
): TaskEventsReplayResult {
  const diagnostics: TaskEventsDiagnostic[] = [];
  const selectedTaskIdentity =
    taskIdentity ??
    records.find((record) => record.kind === "seed")?.taskIdentity ??
    records[0]?.taskIdentity ??
    null;
  const matching =
    selectedTaskIdentity === null
      ? []
      : records.filter((record) => record.taskIdentity === selectedTaskIdentity);
  const first = matching[0];

  if (first === undefined) {
    diagnostics.push({
      kind: "missing-seed",
      line: null,
      sequence: null,
      message: "no task event records found",
    });
    return {
      ok: false,
      taskIdentity: selectedTaskIdentity,
      seed: null,
      finalState: null,
      transitions: [],
      diagnostics,
    };
  }

  if (first.kind !== "seed") {
    diagnostics.push({
      kind: "retention-truncated-head",
      line: null,
      sequence: first.sequence,
      message: "history starts after the seed record",
    });
    return {
      ok: false,
      taskIdentity: selectedTaskIdentity,
      seed: null,
      finalState: null,
      transitions: [],
      diagnostics,
    };
  }

  let expectedSequence = 0;
  const seed = cloneJson(first.state);
  let state = cloneJson(first.state);
  const transitions: TaskTransition[] = [];

  for (const record of matching) {
    if (record.sequence !== expectedSequence) {
      diagnostics.push({
        kind: "sequence-gap",
        line: null,
        sequence: record.sequence,
        message: `expected sequence ${expectedSequence}, got ${record.sequence}`,
      });
      break;
    }
    expectedSequence += 1;
    if (record.kind === "seed") {
      continue;
    }

    const transition = step({
      state,
      event: cloneJson(record.event),
      policy: cloneJson(record.policy),
      ledger: replayLedgerForTaskEvent(
        state.rootIdentity,
        record.remainingBudgetCost,
        record.nowMs,
      ),
      nowMs: record.nowMs,
    });
    transitions.push(transition);
    if (!transition.ok) {
      diagnostics.push({
        kind: "transition-rejected",
        line: null,
        sequence: record.sequence,
        message: transition.reason,
      });
      break;
    }
    state = transition.next;
  }

  return {
    ok: diagnostics.length === 0,
    taskIdentity: selectedTaskIdentity,
    seed,
    finalState: state,
    transitions,
    diagnostics,
  };
}
