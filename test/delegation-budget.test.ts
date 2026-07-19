import { describe, expect, test } from "bun:test";
import {
  BUDGET_LIMITS_V1,
  BUDGET_EXHAUSTION_REASONS,
  createRootBudgetLedger,
  getActiveReservation,
  reconcileDispatch,
  refreshRootWallTime,
  tryReserveDispatch,
  toRoutingTraceV2BudgetContext,
} from "../plugins/fable-orchestrator/lib/delegation-budget";
import {
  DelegationScheduler,
  normalizeTaskIdentity,
} from "../plugins/fable-orchestrator/lib/delegation-scheduler";
import { buildRoutingTraceV2 } from "../plugins/fable-orchestrator/lib/trace-schema";

const TEST_CHECKOUT_RAW = "/tmp/fable-orchestrator-test-checkout";

function createScheduler() {
  const scheduler = new DelegationScheduler("sched-budget");
  const authority = scheduler.issueParentAuthority();
  return { scheduler, authority };
}

function rootRouting(alias = "composer-implement") {
  return { requestedRoute: alias };
}

function readOnlyRouting(alias = "fable-check") {
  return { requestedRoute: alias };
}

function admit(
  scheduler: DelegationScheduler,
  authority: ReturnType<DelegationScheduler["issueParentAuthority"]>,
  taskKey: string,
  parentTaskKey: string | null,
  runId: string,
  routing = rootRouting(),
) {
  return scheduler.admitDispatch(authority, {
    taskKey,
    parentTaskKey,
    runId,
    routing,
    ...(parentTaskKey == null ? { checkoutRaw: TEST_CHECKOUT_RAW } : {}),
  });
}

describe("delegation-budget: reservation and reconciliation", () => {
  test("reserves dispatch ceilings from a fresh root ledger", () => {
    const ledger = createRootBudgetLedger("root-a");
    const reserved = tryReserveDispatch(ledger, "task-a", 0);
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) {
      return;
    }
    expect(reserved.reservation.reserved.token).toBe(BUDGET_LIMITS_V1.dispatch.token);
    expect(reserved.reservation.reserved.cost).toBe(BUDGET_LIMITS_V1.dispatch.cost);
    expect(ledger.remaining.token).toBe(
      BUDGET_LIMITS_V1.root.token - BUDGET_LIMITS_V1.dispatch.token,
    );
  });

  test("reconciles success down and returns unused reservation to root remaining", () => {
    const ledger = createRootBudgetLedger("root-a");
    tryReserveDispatch(ledger, "task-a", 0);
    const reconciled = reconcileDispatch(
      ledger,
      "task-a",
      { token: 100_000, wallTimeMs: 60_000, call: 1, cost: 1.25, concurrency: 1 },
      "success",
    );
    expect(reconciled.ok).toBe(true);
    expect(ledger.consumed.token).toBe(100_000);
    expect(ledger.remaining.token).toBe(
      BUDGET_LIMITS_V1.root.token - 100_000,
    );
    expect(getActiveReservation(ledger, "task-a")).toBeUndefined();
  });

  test("unknown token and cost reconcile at full reservation", () => {
    const ledger = createRootBudgetLedger("root-a");
    tryReserveDispatch(ledger, "task-a", 0);
    reconcileDispatch(
      ledger,
      "task-a",
      { tokenMeasurement: "unknown", costMeasurement: "unknown" },
      "success",
    );
    expect(ledger.consumed.token).toBe(BUDGET_LIMITS_V1.dispatch.token);
    expect(ledger.consumed.cost).toBe(BUDGET_LIMITS_V1.dispatch.cost);
  });

  test("null call actuals charge full reservation for success failure and cancelled", () => {
    const outcomes = ["success", "failure", "cancelled"] as const;
    for (const outcome of outcomes) {
      const ledger = createRootBudgetLedger(`root-${outcome}`);
      tryReserveDispatch(ledger, "task-a", 0);
      const reconciled = reconcileDispatch(ledger, "task-a", {}, outcome);
      expect(reconciled.ok).toBe(true);
      if (!reconciled.ok) {
        continue;
      }
      expect(reconciled.charged.call).toBe(BUDGET_LIMITS_V1.dispatch.call);
      expect(ledger.consumed.call).toBe(BUDGET_LIMITS_V1.dispatch.call);
    }
  });

  test("rejects the 26th dispatch on call exhaustion", () => {
    const ledger = createRootBudgetLedger("root-a");
    for (let index = 0; index < BUDGET_LIMITS_V1.root.call; index += 1) {
      const taskIdentity = `task-${index}`;
      const reserved = tryReserveDispatch(ledger, taskIdentity, 0);
      expect(reserved.ok).toBe(true);
      reconcileDispatch(
        ledger,
        taskIdentity,
        { call: 1, token: 0, wallTimeMs: 0, cost: 0, concurrency: 0 },
        "success",
      );
    }
    const overflow = tryReserveDispatch(ledger, "task-overflow", 0);
    expect(overflow.ok).toBe(false);
    if (overflow.ok) {
      return;
    }
    expect(overflow.reason).toBe(BUDGET_EXHAUSTION_REASONS.call);
  });

  test("charges measured overage above reservation with negative remaining", () => {
    const ledger = createRootBudgetLedger("root-a");
    tryReserveDispatch(ledger, "task-a", 0);
    reconcileDispatch(
      ledger,
      "task-a",
      { token: 2_100_000, wallTimeMs: 20 * 60 * 1000, cost: 12.0, call: 1 },
      "success",
    );
    expect(ledger.consumed.token).toBe(2_100_000);
    expect(ledger.remaining.token).toBeLessThan(0);
    expect(ledger.consumed.cost).toBe(12.0);
    expect(ledger.remaining.cost).toBeLessThan(0);
  });

  test("root wall-time consumed tracks elapsed clock not summed worker-minutes", () => {
    let now = 1_000_000;
    const clock = () => now;
    const ledger = createRootBudgetLedger("root-a", { clock, createdAtMs: now });
    tryReserveDispatch(ledger, "worker-a", 1);
    now += 120_000;
    tryReserveDispatch(ledger, "worker-b", 1);
    now += 60_000;
    refreshRootWallTime(ledger);
    expect(ledger.consumed.wallTimeMs).toBe(180_000);
    reconcileDispatch(
      ledger,
      "worker-a",
      { token: 0, wallTimeMs: 900_000, call: 1, cost: 0 },
      "success",
    );
    refreshRootWallTime(ledger);
    expect(ledger.consumed.wallTimeMs).toBe(180_000);
  });
});

describe("delegation-budget: remaining inheritance", () => {
  test("depth-1 reserves min(dispatch ceiling, root remaining) not original limits", () => {
    const ledger = createRootBudgetLedger("root-a");
    ledger.consumed.token = 1_700_000;
    ledger.remaining.token = 300_000;

    const reserved = tryReserveDispatch(ledger, "child-1", 1);
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) {
      return;
    }
    expect(reserved.reservation.reserved.token).toBe(300_000);
    expect(reserved.reservation.reserved.token).toBeLessThan(
      BUDGET_LIMITS_V1.dispatch.token,
    );
  });

  test("depth-2 reserves from current root remaining after prior reconciliation", () => {
    const ledger = createRootBudgetLedger("root-a");
    ledger.consumed.token = 1_650_000;
    ledger.remaining.token = 350_000;

    const depth2 = tryReserveDispatch(ledger, "depth-2", 2);
    expect(depth2.ok).toBe(true);
    if (!depth2.ok) {
      return;
    }
    expect(depth2.reservation.depth).toBe(2);
    expect(depth2.reservation.reserved.token).toBe(350_000);
  });
});

describe("delegation-budget: trace context conversion", () => {
  test("exposes ledger remaining after active reservations via explicit remaining", () => {
    const ledger = createRootBudgetLedger("root-a");
    tryReserveDispatch(ledger, "task-a", 0);
    const reservation = getActiveReservation(ledger, "task-a")!;
    const context = toRoutingTraceV2BudgetContext(ledger, reservation);

    expect(context.rootBudget.token?.remaining).toBe(
      BUDGET_LIMITS_V1.root.token - BUDGET_LIMITS_V1.dispatch.token,
    );
    expect(context.rootBudget.token?.consumed).toBe(0);

    const record = buildRoutingTraceV2({
      legacy: {
        schema: 4,
        run_id: "run-a",
        timestamp: "2026-07-12T00:00:00.000Z",
        backend: "composer",
        mode: "implement",
        model: "composer-2.5",
        sandbox: "workspace-write",
        project: "abc123def456",
        label: null,
        task_class: null,
        route_rationale: null,
        duration_ms: 1000,
        status: "completed",
        exit_code: 0,
        changed_files: 0,
        tokens: null,
        budget: null,
        error: null,
      },
      route: {
        requestedPublicAlias: "composer-implement",
        requestedAliasKind: "executable-route",
        canonicalCapabilityRoute: "implement.workspace-write.v1",
      },
      models: {
        requested: "composer-2.5",
        candidate: "composer-2.5",
        attempted: "composer-2.5",
        selected: "composer-2.5",
      },
      serving: {
        provider: "Cursor",
        providerModelId: "composer-2.5",
        transportBackend: "composer",
        adapterId: "cursor-agent",
        adapterVersion: "1",
        stableId: "composer-2.5",
      },
      traversal: {
        candidateIndex: 0,
        attemptIndex: 0,
        stackSize: 1,
        traversalId: "trav-a",
      },
      lineage: { rootRunId: "run-a", depth: 1 },
      budgets: {
        root: {
          token: {
            allocated: context.rootBudget.token?.allocated,
            consumed: context.rootBudget.token?.consumed ?? 0,
            remaining: context.rootBudget.token?.remaining,
          },
        },
        dispatch: {
          token: {
            allocated: context.dispatchBudget.token?.allocated,
            consumed: 50_000,
          },
        },
      },
    });

    expect(record.budgets.root.token.allocated).toBe(BUDGET_LIMITS_V1.root.token);
    expect(record.budgets.dispatch.token.allocated).toBe(BUDGET_LIMITS_V1.dispatch.token);
    expect(record.budgets.root.token.consumed).toBe(0);
    expect(record.budgets.root.token.remaining).toBe(
      BUDGET_LIMITS_V1.root.token - BUDGET_LIMITS_V1.dispatch.token,
    );
    expect(record.budgets.dispatch.token.remaining).toBe(
      BUDGET_LIMITS_V1.dispatch.token - 50_000,
    );
  });

  test("derived remaining is preserved when explicit remaining is omitted", () => {
    const record = buildRoutingTraceV2({
      legacy: {
        schema: 4,
        run_id: "run-a",
        timestamp: "2026-07-12T00:00:00.000Z",
        backend: "composer",
        mode: "implement",
        model: "composer-2.5",
        sandbox: "workspace-write",
        project: "abc123def456",
        label: null,
        task_class: null,
        route_rationale: null,
        duration_ms: 1000,
        status: "completed",
        exit_code: 0,
        changed_files: 0,
        tokens: null,
        budget: null,
        error: null,
      },
      route: {
        requestedPublicAlias: "composer-implement",
        requestedAliasKind: "executable-route",
        canonicalCapabilityRoute: "implement.workspace-write.v1",
      },
      models: {
        requested: "composer-2.5",
        candidate: "composer-2.5",
        attempted: "composer-2.5",
        selected: "composer-2.5",
      },
      serving: {
        provider: "Cursor",
        providerModelId: "composer-2.5",
        transportBackend: "composer",
        adapterId: "cursor-agent",
        adapterVersion: "1",
        stableId: "composer-2.5",
      },
      traversal: {
        candidateIndex: 0,
        attemptIndex: 0,
        stackSize: 1,
        traversalId: "trav-a",
      },
      lineage: { rootRunId: "run-a", depth: 0 },
      budgets: {
        root: { token: { allocated: 100, consumed: 30 } },
      },
    });
    expect(record.budgets.root.token.remaining).toBe(70);
  });

  test("scheduler buildRoutingTraceV2Context matches ledger state", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root");
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    const context = scheduler.buildRoutingTraceV2Context(root.taskIdentity);
    expect(context).not.toBeNull();
    expect(context!.rootBudget.token?.allocated).toBe(BUDGET_LIMITS_V1.root.token);
    expect(context!.dispatchBudget.cost?.allocated).toBe(BUDGET_LIMITS_V1.dispatch.cost);
    expect(context!.depth).toBe(0);
    expect(context!.schedulerId).toBe("sched-budget");
    expect(context!.rootRunId).toBe("run-root");
    expect(context!.parentRunId).toBeNull();
  });

  test("scheduler buildRoutingTraceV2Context resolves depth-2 lineage from run IDs", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root");
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    const depth1 = admit(
      scheduler,
      authority,
      "child-1",
      "root-task",
      "run-child-1",
      readOnlyRouting(),
    );
    expect(depth1.admitted).toBe(true);
    if (!depth1.admitted) {
      return;
    }

    const depth2 = admit(
      scheduler,
      authority,
      "child-2",
      "child-1",
      "run-child-2",
      readOnlyRouting(),
    );
    expect(depth2.admitted).toBe(true);
    if (!depth2.admitted) {
      return;
    }

    const context = scheduler.buildRoutingTraceV2Context(depth2.taskIdentity);
    expect(context).not.toBeNull();
    expect(context!.rootRunId).toBe("run-root");
    expect(context!.parentRunId).toBe("run-child-1");
    expect(context!.rootRunId).not.toBe("run-child-2");
    expect(context!.parentRunId).not.toBe(normalizeTaskIdentity("child-1"));
    expect(context!.depth).toBe(2);
  });
});

describe("delegation-budget: scheduler admission integration", () => {
  test("rejects admission with explicit budget exhaustion reasons", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root");
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    const ledger = scheduler.getRootBudgetLedger(root.rootIdentity)!;
    ledger.remaining.call = 0;

    const rejected = admit(
      scheduler,
      authority,
      "child-1",
      "root-task",
      "run-child",
      readOnlyRouting(),
    );
    expect(rejected.admitted).toBe(false);
    if (rejected.admitted) {
      return;
    }
    expect(rejected.reason).toBe(BUDGET_EXHAUSTION_REASONS.call);
  });

  test("scheduler depth-1 inherits remaining through admission", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root");
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    const ledger = scheduler.getRootBudgetLedger(root.rootIdentity)!;
    ledger.consumed.token = 1_700_000;
    ledger.remaining.token = 300_000;

    const child = admit(
      scheduler,
      authority,
      "child-1",
      "root-task",
      "run-child-1",
      readOnlyRouting(),
    );
    expect(child.admitted).toBe(true);
    if (!child.admitted) {
      return;
    }

    const reservation = getActiveReservation(ledger, child.taskIdentity)!;
    expect(reservation.reserved.token).toBe(300_000);
  });

  test("one dispatch keeps a single call reservation across fallback-sized reconciliation", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root");
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    scheduler.completeDispatch(authority, root.taskIdentity, {
      token: 10_000,
      wallTimeMs: 5_000,
      call: 1,
      cost: 2.5,
      concurrency: 1,
      costMeasurement: "unknown",
    });

    const ledger = scheduler.getRootBudgetLedger(root.rootIdentity)!;
    expect(ledger.consumed.call).toBe(1);
    expect(ledger.consumed.cost).toBe(BUDGET_LIMITS_V1.dispatch.cost);
  });
});
