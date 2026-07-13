import { describe, expect, test } from "bun:test";
import { BUDGET_LIMITS_V1, BUDGET_EXHAUSTION_REASONS } from "../plugins/fable-orchestrator/lib/delegation-budget";
import { ROOT_CANCELLED_REASON } from "../plugins/fable-orchestrator/lib/delegation-cancellation";
import { normalizeCheckoutId } from "../plugins/fable-orchestrator/lib/trace-schema";
import {
  DelegationScheduler,
  normalizeTaskIdentity,
} from "../plugins/fable-orchestrator/lib/delegation-scheduler";

const TEST_CHECKOUT_RAW = "/tmp/fable-orchestrator-test-checkout";
const TEST_CHECKOUT_ID = normalizeCheckoutId(TEST_CHECKOUT_RAW);

function createScheduler() {
  const scheduler = new DelegationScheduler("sched-cancel");
  const authority = scheduler.issueParentAuthority();
  return { scheduler, authority };
}

function admit(
  scheduler: DelegationScheduler,
  authority: ReturnType<DelegationScheduler["issueParentAuthority"]>,
  taskKey: string,
  parentTaskKey: string | null,
  runId: string,
  routing: { requestedRoute: string } = { requestedRoute: "composer-implement" },
) {
  return scheduler.admitDispatch(authority, {
    taskKey,
    parentTaskKey,
    runId,
    routing,
    ...(parentTaskKey == null ? { checkoutRaw: TEST_CHECKOUT_RAW } : {}),
  });
}

function readOnlyChildRouting() {
  return { requestedRoute: "codex-check" };
}

describe("delegation-cancellation: root propagation", () => {
  test("root cancellation propagates to active descendants", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root");
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    const child = admit(
      scheduler,
      authority,
      "child-1",
      "root-task",
      "run-child-1",
      readOnlyChildRouting(),
    );
    expect(child.admitted).toBe(true);
    if (!child.admitted) {
      return;
    }

    const cancelled = scheduler.cancelRoot(authority, "root-task");
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) {
      return;
    }

    expect(cancelled.cancelledTaskIdentities).toContain(
      normalizeTaskIdentity("root-task"),
    );
    expect(cancelled.cancelledTaskIdentities).toContain(
      normalizeTaskIdentity("child-1"),
    );
    expect(scheduler.getNode(child.taskIdentity)?.status).toBe("cancelled");
    expect(scheduler.isRootCancelled(root.rootIdentity)).toBe(true);
  });

  test("rejects every new dispatch after root cancellation", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root");
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    scheduler.cancelRoot(authority, "root-task");

    const rejected = admit(scheduler, authority, "child-after", "root-task", "run-after");
    expect(rejected.admitted).toBe(false);
    if (rejected.admitted) {
      return;
    }
    expect(rejected.reason).toBe(ROOT_CANCELLED_REASON);
  });

  test("rejects new root dispatch after cancellation", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root");
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    scheduler.cancelRoot(authority, "root-task");

    const rejected = admit(scheduler, authority, "root-task", null, "run-root-2");
    expect(rejected.admitted).toBe(false);
    if (rejected.admitted) {
      return;
    }
    expect(rejected.reason).toBe(ROOT_CANCELLED_REASON);
  });
});

describe("delegation-cancellation: reconciliation on cancel", () => {
  test("cancel reconciles consumed-so-far and unknown dimensions at full reservation", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root");
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    const ledger = scheduler.getRootBudgetLedger(root.rootIdentity)!;
    const remainingBefore = ledger.remaining.token;

    scheduler.cancelDispatch(authority, root.taskIdentity, {
      token: 120_000,
      wallTimeMs: 30_000,
      call: 0,
      concurrency: 0,
    });

    expect(ledger.consumed.token).toBe(120_000);
    expect(ledger.remaining.token).toBe(remainingBefore + BUDGET_LIMITS_V1.dispatch.token - 120_000);
    expect(getNoActiveReservation(scheduler, root.taskIdentity)).toBe(true);
  });

  test("cancellation cannot mint budget above consumed actuals", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root");
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    const ledger = scheduler.getRootBudgetLedger(root.rootIdentity)!;
    const consumedBefore = { ...ledger.consumed };

    scheduler.cancelDispatch(authority, root.taskIdentity, {
      token: 0,
      wallTimeMs: 0,
      call: 0,
      concurrency: 0,
      tokenMeasurement: "unknown",
      costMeasurement: "unknown",
    });

    expect(ledger.consumed.token).toBeGreaterThanOrEqual(consumedBefore.token);
    expect(ledger.consumed.cost).toBe(BUDGET_LIMITS_V1.dispatch.cost);
    expect(ledger.remaining.token).toBeLessThanOrEqual(BUDGET_LIMITS_V1.root.token);
  });

  test("rejects admission after budget exhaustion", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root");
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    const ledger = scheduler.getRootBudgetLedger(root.rootIdentity)!;
    for (const dimension of Object.keys(ledger.remaining) as Array<
      keyof typeof ledger.remaining
    >) {
      ledger.remaining[dimension] = 0;
    }

    const rejected = admit(
      scheduler,
      authority,
      "child-1",
      "root-task",
      "run-child",
      readOnlyChildRouting(),
    );
    expect(rejected.admitted).toBe(false);
    if (rejected.admitted) {
      return;
    }
    expect(rejected.reason).toBe(BUDGET_EXHAUSTION_REASONS.token);
  });
});

describe("delegation-cancellation: queued descendants", () => {
  test("cancelRoot marks queued descendants cancelled without budget charge", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root");
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    scheduler.completeDispatch(authority, root.taskIdentity, {
      token: 0,
      wallTimeMs: 0,
      call: 1,
      cost: 0,
      concurrency: 1,
    });

    const queued = scheduler.queueDispatch(authority, {
      taskKey: "child-1",
      parentTaskKey: "root-task",
      runId: "run-child-1",
      routing: { requestedRoute: "composer-implement" },
    });
    expect(queued.queued).toBe(true);
    if (!queued.queued) {
      return;
    }

    const ledger = scheduler.getRootBudgetLedger(root.rootIdentity)!;
    const remainingBefore = { ...ledger.remaining };

    const cancelled = scheduler.cancelRoot(authority, "root-task");
    expect(cancelled.ok).toBe(true);
    expect(cancelled.cancelledTaskIdentities).toContain(queued.taskIdentity);
    expect(scheduler.getNode(queued.taskIdentity)?.status).toBe("cancelled");
    expect(ledger.remaining).toEqual(remainingBefore);
  });

  test("active cancellation charges admitted call slot with unknown token/cost", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root");
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    const ledger = scheduler.getRootBudgetLedger(root.rootIdentity)!;
    scheduler.cancelRoot(authority, "root-task");

    expect(ledger.consumed.call).toBe(1);
    expect(ledger.consumed.token).toBe(BUDGET_LIMITS_V1.dispatch.token);
    expect(ledger.consumed.cost).toBe(BUDGET_LIMITS_V1.dispatch.cost);
  });
});

describe("delegation-cancellation: wall-time exhaustion", () => {
  test("completion wall-time exhaustion cancels descendants without double reconcile", () => {
    let now = 0;
    const scheduler = new DelegationScheduler("sched-wall", { clock: () => now });
    const authority = scheduler.issueParentAuthority();

    const root = admit(scheduler, authority, "root-task", null, "run-root");
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    const child = admit(
      scheduler,
      authority,
      "child-1",
      "root-task",
      "run-child",
      readOnlyChildRouting(),
    );
    expect(child.admitted).toBe(true);
    if (!child.admitted) {
      return;
    }

    const ledger = scheduler.getRootBudgetLedger(root.rootIdentity)!;
    now = BUDGET_LIMITS_V1.root.wallTimeMs;

    const completed = scheduler.completeDispatch(authority, root.taskIdentity, {
      token: 0,
      wallTimeMs: 1_000,
      call: 1,
      cost: 0,
      concurrency: 1,
    });
    expect(completed.ok).toBe(true);
    expect(scheduler.getNode(child.taskIdentity)?.status).toBe("cancelled");
    expect(scheduler.isRootCancelled(root.rootIdentity)).toBe(true);
    expect(ledger.reservations.size).toBe(0);
  });
});

function getNoActiveReservation(
  scheduler: DelegationScheduler,
  taskIdentity: string,
): boolean {
  const node = scheduler.getNode(taskIdentity);
  if (!node) {
    return true;
  }
  const ledger = scheduler.getRootBudgetLedger(node.rootIdentity);
  return ledger?.reservations.has(taskIdentity) !== true;
}

describe("delegation-cancellation: worktree ownership release", () => {
  test("root cancellation releases checkout write ownership", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root");
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }
    expect(scheduler.isCheckoutWriteOwned(TEST_CHECKOUT_ID)).toBe(true);

    scheduler.cancelRoot(authority, "root-task");
    expect(scheduler.isCheckoutWriteOwned(TEST_CHECKOUT_ID)).toBe(false);
  });

  test("completion releases ownership so a new write dispatch can start", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root");
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    scheduler.completeDispatch(authority, root.taskIdentity, {
      token: 0,
      wallTimeMs: 0,
      call: 1,
      cost: 0,
      concurrency: 1,
    });
    expect(scheduler.isCheckoutWriteOwned(TEST_CHECKOUT_ID)).toBe(false);

    const next = admit(scheduler, authority, "root-task-2", null, "run-root-2");
    expect(next.admitted).toBe(true);
  });

  test("cancelled queued write does not retain ownership and later write can start", () => {
    const { scheduler, authority } = createScheduler();
    const active = admit(scheduler, authority, "active-write", null, "run-active");
    expect(active.admitted).toBe(true);
    if (!active.admitted) {
      return;
    }

    const queued = scheduler.queueDispatch(authority, {
      taskKey: "queued-write",
      parentTaskKey: null,
      runId: "run-queued",
      routing: { requestedRoute: "composer-implement" },
      checkoutRaw: TEST_CHECKOUT_RAW,
    });
    expect(queued.queued).toBe(true);
    if (!queued.queued) {
      return;
    }

    scheduler.cancelRoot(authority, "active-write");
    expect(scheduler.isCheckoutWriteOwned(TEST_CHECKOUT_ID)).toBe(false);

    const retry = admit(scheduler, authority, "retry-write", null, "run-retry");
    expect(retry.admitted).toBe(true);
  });
});
