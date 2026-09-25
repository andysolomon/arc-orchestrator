import { describe, expect, test } from "bun:test";
import {
  CHECKOUT_WRITE_CONFLICT_REASON,
  MISSING_CHECKOUT_IDENTITY_REASON,
  normalizeWriteScopeId,
  PERMISSION_ENVELOPE_BROADER_THAN_PARENT_REASON,
  PERMISSION_NOT_IN_ROUTE_MAXIMUM_REASON,
  validatePermissionsAgainstRouteMaximum,
} from "../plugins/arc-orchestrator/lib/delegation-worktree-sandbox";
import { DelegationScheduler } from "../plugins/arc-orchestrator/lib/delegation-scheduler";
import { normalizeCheckoutId } from "../plugins/arc-orchestrator/lib/trace-schema";

const CHECKOUT_A = "/Users/secret/project-alpha";
const WRITE_SCOPE = "/Users/secret/project-alpha/src/lib";

function createScheduler() {
  const scheduler = new DelegationScheduler("sched-worktree");
  const authority = scheduler.issueParentAuthority();
  return { scheduler, authority };
}

function admit(
  scheduler: DelegationScheduler,
  authority: ReturnType<DelegationScheduler["issueParentAuthority"]>,
  taskKey: string,
  parentTaskKey: string | null,
  runId: string,
  options: {
    checkoutRaw?: string;
    writeScopeRaw?: string;
    route?: string;
    requestedPermissions?: readonly ("read" | "write")[];
  } = {},
) {
  return scheduler.admitDispatch(authority, {
    taskKey,
    parentTaskKey,
    runId,
    routing: { requestedRoute: options.route ?? "composer-implement" },
    checkoutRaw: options.checkoutRaw,
    writeScopeRaw: options.writeScopeRaw,
    requestedPermissions: options.requestedPermissions,
  });
}

function completeWrite(
  scheduler: DelegationScheduler,
  authority: ReturnType<DelegationScheduler["issueParentAuthority"]>,
  taskIdentity: string,
) {
  scheduler.completeDispatch(authority, taskIdentity, {
    token: 0,
    wallTimeMs: 0,
    call: 1,
    cost: 0,
    concurrency: 1,
  });
}

describe("delegation-worktree-sandbox: permission envelope narrowing", () => {
  test("rejects requested permissions outside route maximum", () => {
    const result = validatePermissionsAgainstRouteMaximum(
      ["read", "write"],
      "read-only",
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe(PERMISSION_NOT_IN_ROUTE_MAXIMUM_REASON);
  });

  test("scheduler rejects child write route under read-only parent", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root", {
      checkoutRaw: CHECKOUT_A,
      // Review routes are the read-only surface; analyze is workspace-write.
      route: "fable-check",
    });
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    const child = admit(scheduler, authority, "child-write", "root-task", "run-child", {
      route: "composer-implement",
    });
    expect(child.admitted).toBe(false);
    if (child.admitted) {
      return;
    }
    expect(child.reason).toBe(PERMISSION_ENVELOPE_BROADER_THAN_PARENT_REASON);
  });

  test("scheduler narrowed implement envelope is read-only and lock-free under write parent", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root", {
      checkoutRaw: CHECKOUT_A,
    });
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    const checkoutId = scheduler.getWorktreeContext(root.taskIdentity)!.checkoutId;
    expect(scheduler.isCheckoutWriteOwned(checkoutId)).toBe(true);

    const narrowed = admit(scheduler, authority, "child-narrowed", "root-task", "run-narrowed", {
      route: "composer-implement",
      requestedPermissions: ["read"],
    });
    expect(narrowed.admitted).toBe(true);
    if (!narrowed.admitted) {
      return;
    }

    const context = scheduler.getWorktreeContext(narrowed.taskIdentity)!;
    expect(context.envelope).toEqual({
      sandbox: "read-only",
      permissions: ["read"],
    });
    expect(context.writeScopeId).toBeNull();
    expect(scheduler.isCheckoutWriteOwned(checkoutId)).toBe(true);
  });
});

describe("delegation-worktree-sandbox: write ownership", () => {
  test("read-only dispatches do not acquire checkout write ownership", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root", {
      checkoutRaw: CHECKOUT_A,
      // Review routes are the read-only surface; analyze is workspace-write.
      route: "fable-check",
    });
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    const checkoutId = scheduler.getWorktreeContext(root.taskIdentity)!.checkoutId;
    expect(scheduler.isCheckoutWriteOwned(checkoutId)).toBe(false);

    const concurrent = admit(
      scheduler,
      authority,
      "read-concurrent",
      "root-task",
      "run-read-2",
      { route: "fable-check" },
    );
    expect(concurrent.admitted).toBe(true);
    expect(scheduler.isCheckoutWriteOwned(checkoutId)).toBe(false);
  });

  test("serializes overlapping writes on the same checkout", () => {
    const { scheduler, authority } = createScheduler();
    const first = admit(scheduler, authority, "write-1", null, "run-write-1", {
      checkoutRaw: CHECKOUT_A,
    });
    expect(first.admitted).toBe(true);
    if (!first.admitted) {
      return;
    }

    const checkoutId = scheduler.getWorktreeContext(first.taskIdentity)!.checkoutId;
    expect(scheduler.isCheckoutWriteOwned(checkoutId)).toBe(true);

    const second = admit(scheduler, authority, "write-2", null, "run-write-2", {
      checkoutRaw: CHECKOUT_A,
    });
    expect(second.admitted).toBe(false);
    if (second.admitted) {
      return;
    }
    expect(second.reason).toBe(CHECKOUT_WRITE_CONFLICT_REASON);
  });

  test("rejects child write dispatch while parent write holds inherited checkout", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root", {
      checkoutRaw: CHECKOUT_A,
    });
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    const checkoutId = scheduler.getWorktreeContext(root.taskIdentity)!.checkoutId;
    expect(scheduler.isCheckoutWriteOwned(checkoutId)).toBe(true);

    const child = admit(scheduler, authority, "child-write", "root-task", "run-child");
    expect(child.admitted).toBe(false);
    if (child.admitted) {
      return;
    }
    expect(child.reason).toBe(CHECKOUT_WRITE_CONFLICT_REASON);
  });

  test("releases ownership on completion before a later write admits", () => {
    const { scheduler, authority } = createScheduler();
    const first = admit(scheduler, authority, "write-1", null, "run-1", {
      checkoutRaw: CHECKOUT_A,
    });
    expect(first.admitted).toBe(true);
    if (!first.admitted) {
      return;
    }

    completeWrite(scheduler, authority, first.taskIdentity);
    expect(scheduler.isCheckoutWriteOwned(normalizeCheckoutId(CHECKOUT_A))).toBe(false);

    const second = admit(scheduler, authority, "write-2", null, "run-2", {
      checkoutRaw: CHECKOUT_A,
    });
    expect(second.admitted).toBe(true);
  });

  test("stores hashed checkout on node without retaining raw paths", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root", {
      checkoutRaw: CHECKOUT_A,
      writeScopeRaw: WRITE_SCOPE,
    });
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    const context = scheduler.getWorktreeContext(root.taskIdentity)!;
    expect(context.checkoutId).toBe(normalizeCheckoutId(CHECKOUT_A));
    expect(context.writeScopeId).toBe(normalizeWriteScopeId(WRITE_SCOPE));
    expect(JSON.stringify(context)).not.toContain("secret");
    expect(JSON.stringify(context)).not.toContain("/Users");
  });
});

describe("delegation-worktree-sandbox: admission validation", () => {
  test("rejects root dispatch without checkout identity", () => {
    const { scheduler, authority } = createScheduler();
    const rejected = scheduler.admitDispatch(authority, {
      taskKey: "root-task",
      parentTaskKey: null,
      runId: "run-root",
      routing: { requestedRoute: "composer-implement" },
    });
    expect(rejected.admitted).toBe(false);
    if (rejected.admitted) {
      return;
    }
    expect(rejected.reason).toBe(MISSING_CHECKOUT_IDENTITY_REASON);
  });
});
