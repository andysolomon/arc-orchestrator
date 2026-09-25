import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createRootBudgetLedger } from "../plugins/arc-orchestrator/lib/delegation-budget";
import {
  DelegationScheduler,
  normalizeTaskIdentity,
} from "../plugins/arc-orchestrator/lib/delegation-scheduler";
import type { DelegationRoutingInput } from "../plugins/arc-orchestrator/lib/delegation-routing";
import {
  DEFAULT_TASK_BUDGET_POLICY,
  TASK_MACHINE_SCHEMA_VERSION,
  type TaskPolicy,
  type TaskState,
} from "../plugins/arc-orchestrator/lib/task-machine";
import {
  parseTaskEventsJsonl,
  type TaskEventsRecord,
} from "../plugins/arc-orchestrator/lib/task-events";
import {
  createTaskOrchestrator,
  type TaskDispatchExecutionInput,
  type TaskOrchestrator,
  type TaskOrchestratorDeps,
  type TaskSession,
} from "../plugins/arc-orchestrator/lib/task-orchestrator";
import type {
  SelectionDecision,
  SelectionInputs,
  SelectedRung,
} from "../plugins/arc-orchestrator/lib/capability-selection";
import type { Outcome } from "../plugins/arc-orchestrator/lib/annotation";

const TEST_CHECKOUT = "/tmp/arc-orchestrator-task-orchestrator-checkout";
const NOW = 42_000;

const STACK: SelectedRung[] = [
  {
    rungId: "composer-2.5@none",
    stableId: "composer-2.5",
    effort: "none",
    backend: "composer",
    band: 2,
    estimatedUsd: 1,
    quotaPool: null,
  },
];

function selectedDecision(): SelectionDecision {
  return {
    outcome: "selected",
    stack: STACK,
    explanation: {
      policyVersion: "capability-rung/v1",
      snapshotVersion: "test",
      registryVersion: 1,
      axis: "swe",
      requestedFloor: 2,
      effectiveFloor: 2,
      floorLowered: false,
      overrideApplied: false,
      eligible: ["composer-2.5@none"],
      rejected: [],
      pruned: [],
      budgetConstrained: [],
      unranked: [],
      leadBackend: "composer",
    },
  };
}

function intakeState(taskIdentity: string, rootIdentity: string): TaskState {
  return {
    schemaVersion: TASK_MACHINE_SCHEMA_VERSION,
    taskIdentity,
    rootIdentity,
    depth: 0,
    name: "intake",
    axis: "swe",
    capabilityRoute: "check.read-only.v1",
    capabilityFloor: 2,
    originalFloor: 2,
    acceptanceCriteria: [],
    escalationsUsed: 0,
    replansUsed: 0,
    runIds: [],
    selectedRung: null,
  };
}

function skipVerifyPolicy(): TaskPolicy {
  return {
    budget: { ...DEFAULT_TASK_BUDGET_POLICY },
    authorization: { kind: "parent" },
    verification: "skip",
  };
}

function parentVerifyPolicy(): TaskPolicy {
  return {
    budget: { ...DEFAULT_TASK_BUDGET_POLICY },
    authorization: { kind: "parent" },
    verification: "parent",
  };
}

type HarnessOptions = {
  routingForStack?: (
    stack: SelectedRung[],
    state: TaskState,
  ) => DelegationRoutingInput;
  executeDispatch?: TaskOrchestratorDeps["executeDispatch"];
  selectFn?: TaskOrchestratorDeps["selectFn"];
};

function createHarness(options: HarnessOptions = {}): {
  orchestrator: TaskOrchestrator;
  scheduler: DelegationScheduler;
  authority: ReturnType<DelegationScheduler["issueParentAuthority"]>;
  eventsDir: string;
  annotations: Array<{ runId: string; outcome: Outcome }>;
  dispatchCalls: TaskDispatchExecutionInput[];
} {
  const eventsDir = mkdtempSync(join(tmpdir(), "task-orchestrator-"));
  const scheduler = new DelegationScheduler("task-orchestrator-test");
  const authority = scheduler.issueParentAuthority();
  const annotations: Array<{ runId: string; outcome: Outcome }> = [];
  const dispatchCalls: TaskDispatchExecutionInput[] = [];

  const orchestrator = createTaskOrchestrator({
    scheduler,
    authority,
    taskEventsDirectory: eventsDir,
    checkoutRaw: TEST_CHECKOUT,
    nowMs: () => NOW,
    buildSelectionInputs: (request, session) =>
      ({
        request,
        registry: [],
        snapshot: {
          schema: 1,
          version: "test",
          generatedAt: "2026-01-01",
          axisScores: {},
        },
        ledger: createRootBudgetLedger(session.state.rootIdentity),
        availability: { backends: {} },
        policyVersion: "test",
        nowMs: NOW,
      }) as unknown as SelectionInputs,
    selectFn:
      options.selectFn ??
      (() => selectedDecision()),
    routingForStack:
      options.routingForStack ??
      (() => ({ requestedRoute: "composer-check" })),
    executeDispatch:
      options.executeDispatch ??
      (async (input) => {
        dispatchCalls.push(input);
        return {
          runId: input.runId,
          disposition: null,
        };
      }),
    annotate: (runId, outcome) => {
      annotations.push({ runId, outcome });
    },
  });

  return {
    orchestrator,
    scheduler,
    authority,
    eventsDir,
    annotations,
    dispatchCalls,
  };
}

async function driveCheckSkipPath(
  orchestrator: TaskOrchestrator,
  taskKey = "root-check",
): Promise<TaskSession> {
  const rootIdentity = normalizeTaskIdentity(taskKey);
  const session = orchestrator.startTask({
    taskKey,
    state: intakeState(rootIdentity, rootIdentity),
    policy: skipVerifyPolicy(),
  });
  await orchestrator.applyEvent(session, {
    kind: "classified",
    axis: "swe",
    capabilityRoute: "check.read-only.v1",
    floor: 2,
  });
  await orchestrator.applyEvent(session, {
    kind: "planned",
    acceptanceCriteria: [],
  });
  return session;
}

function readEvents(eventsDir: string): TaskEventsRecord[] {
  return parseTaskEventsJsonl(
    readFileSync(join(eventsDir, "task-events.jsonl"), "utf8"),
  ).records;
}

function eventKinds(records: readonly TaskEventsRecord[]): string[] {
  return records.map((record) =>
    record.kind === "seed" ? "seed" : record.event.kind,
  );
}

function expectReplayOk(
  orchestrator: TaskOrchestrator,
  taskIdentity: string,
): ReturnType<TaskOrchestrator["replay"]> {
  const replay = orchestrator.replay(taskIdentity);
  expect(replay.ok).toBe(true);
  expect(replay.diagnostics).toEqual([]);
  return replay;
}

describe("task-orchestrator (Phase 14.8)", () => {
  test("selected dispatch path admits, executes, annotates, and completes scheduler node", async () => {
    const { orchestrator, scheduler, authority, eventsDir, annotations, dispatchCalls } =
      createHarness();
    const session = await driveCheckSkipPath(orchestrator);

    expect(session.state.name).toBe("accepted");
    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0]?.runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const node = scheduler.getNode(session.taskIdentity);
    expect(node?.status).toBe("completed");

    expect(annotations.some((entry) => entry.outcome === "accepted")).toBe(true);
    expect(annotations.some((entry) => entry.outcome === "cancelled" as Outcome)).toBe(
      false,
    );

    const events = readEvents(eventsDir);
    expect(events[0]?.kind).toBe("seed");
    expect(events.at(-1)?.kind).toBe("event");
    const kinds = eventKinds(events);
    expect(kinds).toEqual([
      "seed",
      "classified",
      "planned",
      "dispatch-selected",
      "dispatch-completed",
    ]);
    expect(kinds.indexOf("dispatch-selected")).toBeLessThan(
      kinds.indexOf("dispatch-completed"),
    );
    const replay = expectReplayOk(orchestrator, session.taskIdentity);
    expect(replay.finalState?.name).toBe("accepted");

    rmSync(eventsDir, { recursive: true, force: true });
    void authority;
  });

  test("admission failure does not invoke backend and rolls back dispatch-selected", async () => {
    const { orchestrator, scheduler, eventsDir, dispatchCalls } = createHarness({
      routingForStack: () => ({ requestedRoute: "not-a-real-route" }),
    });
    const session = await driveCheckSkipPath(orchestrator);

    expect(dispatchCalls).toHaveLength(0);
    expect(session.state.name).toBe("dispatch");
    expect(session.state.selectedRung).toBeNull();

    const node = scheduler.getNode(session.taskIdentity);
    expect(node).toBeUndefined();

    const events = readEvents(eventsDir);
    expect(events.some((record) => record.kind === "event" && record.event.kind === "dispatch-selected")).toBe(
      false,
    );

    rmSync(eventsDir, { recursive: true, force: true });
  });

  test("retryable executeDispatch completes the admitted scheduler attempt", async () => {
    const { orchestrator, scheduler, eventsDir } = createHarness({
      executeDispatch: async (input) => ({
        runId: input.runId,
        disposition: {
          kind: "retryable",
          classification: "backend-unavailable",
          detail: null,
        },
      }),
    });

    const session = await driveCheckSkipPath(orchestrator, "retryable-execute");

    expect(session.state.name).toBe("dispatch");
    expect(session.state.runIds).toHaveLength(1);
    expect(scheduler.getNode(session.taskIdentity)?.status).toBe("completed");
    expect(scheduler.getNode(session.taskIdentity)?.status).not.toBe("active");

    const events = readEvents(eventsDir);
    expect(eventKinds(events)).toEqual([
      "seed",
      "classified",
      "planned",
      "dispatch-selected",
      "dispatch-completed",
    ]);
    const replay = expectReplayOk(orchestrator, session.taskIdentity);
    expect(replay.finalState?.name).toBe("dispatch");
    expect(replay.finalState?.runIds).toEqual(session.state.runIds);

    rmSync(eventsDir, { recursive: true, force: true });
  });

  test("authorized escalation annotates superseded run and passes escalationOf on next dispatch", async () => {
    const { orchestrator, annotations, dispatchCalls } = createHarness({
      executeDispatch: async (input) => {
        dispatchCalls.push(input);
        return { runId: input.runId, disposition: null };
      },
    });

    const rootIdentity = normalizeTaskIdentity("escalation-root");
    const session = orchestrator.startTask({
      taskKey: "escalation-root",
      state: intakeState(rootIdentity, rootIdentity),
      policy: parentVerifyPolicy(),
    });

    await orchestrator.applyEvent(session, {
      kind: "classified",
      axis: "swe",
      capabilityRoute: "check.read-only.v1",
      floor: 2,
    });
    await orchestrator.applyEvent(session, {
      kind: "planned",
      acceptanceCriteria: [],
    });
    expect(session.state.name).toBe("verify");

    const firstRunId = dispatchCalls[0]?.runId;
    expect(firstRunId).toBeDefined();

    await orchestrator.applyEvent(session, {
      kind: "verified",
      verdict: {
        kind: "fail-quality",
        unmetCriteria: ["quality bar"],
        evidence: {
          mode: "parent",
          rungId: null,
          criteriaChecked: ["tests"],
          commandsRun: ["bun test"],
        },
      },
    });
    expect(session.state.name).toBe("escalate");

    await orchestrator.applyEvent(session, {
      kind: "escalation-authorized",
      toBand: 3,
    });

    expect(annotations).toContainEqual({
      runId: firstRunId!,
      outcome: "escalated",
    });
    expect(dispatchCalls.length).toBeGreaterThanOrEqual(2);
    const escalatedDispatch = dispatchCalls[1]!;
    expect(escalatedDispatch.escalationOf).toBe(firstRunId);
    expect(escalatedDispatch).not.toHaveProperty("fallbackOf");
    expect(session.state.name).toBe("verify");
    const replay = expectReplayOk(orchestrator, session.taskIdentity);
    expect(replay.finalState?.name).toBe("verify");
  });

  test("root cancellation applies cancelled terminal without annotate", async () => {
    let releaseDispatch: (() => void) | undefined;
    const dispatchGate = new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    });

    const { orchestrator, scheduler, eventsDir, annotations } = createHarness({
      executeDispatch: async (input) => {
        await dispatchGate;
        return { runId: input.runId, disposition: null };
      },
    });

    const sessionPromise = driveCheckSkipPath(orchestrator);
    await Bun.sleep(10);
    const cancelled = await orchestrator.cancelRoot("root-check", "user stopped");
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) {
      return;
    }
    releaseDispatch?.();
    const session = await sessionPromise;

    expect(cancelled.cancelledTaskIdentities).toContain(session.taskIdentity);
    expect(session.state.name).toBe("cancelled");
    expect(scheduler.getNode(session.taskIdentity)?.status).toBe("cancelled");
    expect(annotations.some((entry) => entry.outcome === "cancelled" as Outcome)).toBe(
      false,
    );

    const events = readEvents(eventsDir);
    expect(
      events.some(
        (record) =>
          record.kind === "event" && record.event.kind === "cancelled",
      ),
    ).toBe(true);
    const replay = expectReplayOk(orchestrator, session.taskIdentity);
    expect(replay.finalState?.name).toBe("cancelled");

    rmSync(eventsDir, { recursive: true, force: true });
  });
});
