import { describe, expect, test } from "bun:test";
import {
  CHECKOUT_WRITE_CONFLICT_REASON,
  createWorktreeOwnershipRegistry,
  effectiveSandboxFromPermissions,
  envelopeFromSandbox,
  envelopeRequiresWriteOwnership,
  INCONSISTENT_READ_ONLY_WRITE_PERMISSIONS_REASON,
  isEnvelopeEqualOrNarrower,
  MISSING_CHECKOUT_IDENTITY_REASON,
  normalizePermissions,
  normalizeWriteScopeId,
  PERMISSION_ENVELOPE_BROADER_THAN_PARENT_REASON,
  PERMISSION_NOT_IN_ROUTE_MAXIMUM_REASON,
  releaseWriteOwnership,
  resolveDispatchWorktreeContext,
  ROUTE_DEFAULT_PERMISSIONS,
  tryAcquireWriteOwnership,
  validateEnvelopeNarrowing,
  validatePermissionsAgainstRouteMaximum,
  WORKTREE_SANDBOX_POLICY_VERSION,
} from "../plugins/fable-orchestrator/lib/delegation-worktree-sandbox";
import {
  DelegationScheduler,
  normalizeTaskIdentity,
} from "../plugins/fable-orchestrator/lib/delegation-scheduler";
import { normalizeCheckoutId } from "../plugins/fable-orchestrator/lib/trace-schema";

const CHECKOUT_A = "/Users/secret/project-alpha";
const CHECKOUT_B = "/Users/secret/project-beta";
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

describe("delegation-worktree-sandbox: identity normalization", () => {
  test("hashes checkout and write-scope paths to bounded non-sensitive ids", () => {
    const checkoutId = normalizeCheckoutId(CHECKOUT_A);
    const writeScopeId = normalizeWriteScopeId(WRITE_SCOPE);
    expect(checkoutId).toHaveLength(12);
    expect(writeScopeId).toHaveLength(12);
    expect(checkoutId).toMatch(/^[a-f0-9]{12}$/);
    expect(writeScopeId).not.toContain("secret");
    expect(writeScopeId).not.toContain("/Users");
    expect(normalizeCheckoutId(CHECKOUT_A)).toBe(checkoutId);
  });

  test("exposes policy version", () => {
    expect(WORKTREE_SANDBOX_POLICY_VERSION).toBe("worktree-sandbox/v1");
  });
});

describe("delegation-worktree-sandbox: permission envelope narrowing", () => {
  test("route defaults map sandbox to normalized permissions", () => {
    expect(envelopeFromSandbox("read-only")).toEqual({
      sandbox: "read-only",
      permissions: ["read"],
    });
    expect(envelopeFromSandbox("workspace-write")).toEqual({
      sandbox: "workspace-write",
      permissions: ["read", "write"],
    });
    expect(ROUTE_DEFAULT_PERMISSIONS["read-only"]).toEqual(["read"]);
    expect(ROUTE_DEFAULT_PERMISSIONS["workspace-write"]).toEqual(["read", "write"]);
  });

  test("read-only is narrower than workspace-write", () => {
    expect(
      isEnvelopeEqualOrNarrower(
        { sandbox: "read-only", permissions: ["read"] },
        { sandbox: "workspace-write", permissions: ["read", "write"] },
      ),
    ).toBe(true);
    expect(
      isEnvelopeEqualOrNarrower(
        { sandbox: "workspace-write", permissions: ["read", "write"] },
        { sandbox: "read-only", permissions: ["read"] },
      ),
    ).toBe(false);
  });

  test("rejects broader child permissions than parent on same sandbox", () => {
    const result = validateEnvelopeNarrowing(
      { sandbox: "workspace-write", permissions: ["read", "write"] },
      { sandbox: "workspace-write", permissions: ["read"] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe(PERMISSION_ENVELOPE_BROADER_THAN_PARENT_REASON);
  });

  test("rejects broader child envelope than parent sandbox", () => {
    const result = validateEnvelopeNarrowing(
      { sandbox: "workspace-write", permissions: ["read", "write"] },
      { sandbox: "read-only", permissions: ["read"] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe(PERMISSION_ENVELOPE_BROADER_THAN_PARENT_REASON);
  });

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

  test("rejects inconsistent read-only sandbox with write permission", () => {
    const result = validateEnvelopeNarrowing(
      { sandbox: "read-only", permissions: ["read", "write"] },
      null,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe(INCONSISTENT_READ_ONLY_WRITE_PERMISSIONS_REASON);
  });

  test("permission matrix allows read-only child under write parent", () => {
    const resolved = resolveDispatchWorktreeContext({
      parentContext: {
        checkoutId: normalizeCheckoutId(CHECKOUT_A),
        writeScopeId: normalizeWriteScopeId(`checkout:${normalizeCheckoutId(CHECKOUT_A)}`),
        envelope: envelopeFromSandbox("workspace-write"),
      },
      routeSandbox: "read-only",
      requestedPermissions: ["read"],
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.context.envelope).toEqual({
      sandbox: "read-only",
      permissions: ["read"],
    });
    expect(resolved.context.writeScopeId).toBeNull();
  });

  test("workspace-write route narrowed to read-only permissions derives read-only sandbox", () => {
    expect(effectiveSandboxFromPermissions(["read"])).toBe("read-only");
    expect(effectiveSandboxFromPermissions(["read", "write"])).toBe("workspace-write");

    const resolved = resolveDispatchWorktreeContext({
      parentContext: {
        checkoutId: normalizeCheckoutId(CHECKOUT_A),
        writeScopeId: normalizeWriteScopeId(`checkout:${normalizeCheckoutId(CHECKOUT_A)}`),
        envelope: envelopeFromSandbox("workspace-write"),
      },
      routeSandbox: "workspace-write",
      requestedPermissions: ["read"],
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.context.envelope).toEqual({
      sandbox: "read-only",
      permissions: ["read"],
    });
    expect(resolved.context.writeScopeId).toBeNull();
    expect(envelopeRequiresWriteOwnership(resolved.context.envelope)).toBe(false);
  });

  test("write permissions on workspace-write route still require ownership scope", () => {
    const resolved = resolveDispatchWorktreeContext({
      parentContext: null,
      routeSandbox: "workspace-write",
      checkoutRaw: CHECKOUT_A,
      requestedPermissions: ["read", "write"],
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.context.envelope).toEqual({
      sandbox: "workspace-write",
      permissions: ["read", "write"],
    });
    expect(resolved.context.writeScopeId).not.toBeNull();
    expect(envelopeRequiresWriteOwnership(resolved.context.envelope)).toBe(true);
  });

  test("permission matrix rejects write request under read-only parent", () => {
    const resolved = resolveDispatchWorktreeContext({
      parentContext: {
        checkoutId: normalizeCheckoutId(CHECKOUT_A),
        writeScopeId: null,
        envelope: envelopeFromSandbox("read-only"),
      },
      routeSandbox: "workspace-write",
      requestedPermissions: ["read", "write"],
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      return;
    }
    expect(resolved.reason).toBe(PERMISSION_ENVELOPE_BROADER_THAN_PARENT_REASON);
  });

  test("normalizes permission order and deduplication", () => {
    expect(normalizePermissions(["write", "read", "write"])).toEqual([
      "read",
      "write",
    ]);
  });

  test("scheduler rejects child write route under read-only parent", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root", {
      checkoutRaw: CHECKOUT_A,
      route: "codex-explore",
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

  test("scheduler allows narrower read-only child under write parent", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root", {
      checkoutRaw: CHECKOUT_A,
    });
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    const child = admit(scheduler, authority, "child-read", "root-task", "run-child", {
      route: "codex-check",
    });
    expect(child.admitted).toBe(true);
    expect(scheduler.getWorktreeContext(child.taskIdentity)?.envelope).toEqual({
      sandbox: "read-only",
      permissions: ["read"],
    });
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

  test("read-only dispatches do not acquire checkout write ownership", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root", {
      checkoutRaw: CHECKOUT_A,
      route: "codex-explore",
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
      { route: "codex-check" },
    );
    expect(concurrent.admitted).toBe(true);
    expect(scheduler.isCheckoutWriteOwned(checkoutId)).toBe(false);
  });

  test("rejects sibling write dispatches on the same inherited checkout", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root", {
      checkoutRaw: CHECKOUT_A,
    });
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    completeWrite(scheduler, authority, root.taskIdentity);

    const firstChild = admit(scheduler, authority, "child-1", "root-task", "run-child-1");
    expect(firstChild.admitted).toBe(true);
    if (!firstChild.admitted) {
      return;
    }

    const sibling = admit(scheduler, authority, "child-2", "root-task", "run-child-2");
    expect(sibling.admitted).toBe(false);
    if (sibling.admitted) {
      return;
    }
    expect(sibling.reason).toBe(CHECKOUT_WRITE_CONFLICT_REASON);
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

  test("allows concurrent writers on isolated checkouts", () => {
    const { scheduler, authority } = createScheduler();
    const first = admit(scheduler, authority, "write-a", null, "run-a", {
      checkoutRaw: CHECKOUT_A,
    });
    const second = admit(scheduler, authority, "write-b", null, "run-b", {
      checkoutRaw: CHECKOUT_B,
    });
    expect(first.admitted).toBe(true);
    expect(second.admitted).toBe(true);
    if (!first.admitted || !second.admitted) {
      return;
    }

    expect(
      scheduler.getWorktreeContext(first.taskIdentity)!.checkoutId,
    ).not.toBe(scheduler.getWorktreeContext(second.taskIdentity)!.checkoutId);
    expect(scheduler.isCheckoutWriteOwned(normalizeCheckoutId(CHECKOUT_A))).toBe(true);
    expect(scheduler.isCheckoutWriteOwned(normalizeCheckoutId(CHECKOUT_B))).toBe(true);
  });

  test("queue validates identity without acquiring ownership until start", () => {
    const { scheduler, authority } = createScheduler();
    const active = admit(scheduler, authority, "active-write", null, "run-active", {
      checkoutRaw: CHECKOUT_A,
    });
    expect(active.admitted).toBe(true);
    if (!active.admitted) {
      return;
    }

    const queued = scheduler.queueDispatch(authority, {
      taskKey: "queued-write",
      parentTaskKey: null,
      runId: "run-queued",
      routing: { requestedRoute: "composer-implement" },
      checkoutRaw: CHECKOUT_A,
    });
    expect(queued.queued).toBe(true);
    if (!queued.queued) {
      return;
    }

    const started = scheduler.startQueuedDispatch(authority, queued.taskIdentity);
    expect(started.admitted).toBe(false);
    if (started.admitted) {
      return;
    }
    expect(started.reason).toBe(CHECKOUT_WRITE_CONFLICT_REASON);
    expect(scheduler.getNode(queued.taskIdentity)?.status).toBe("queued");
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

  test("child inherits parent checkout when checkoutRaw is omitted", () => {
    const resolved = resolveDispatchWorktreeContext({
      parentContext: {
        checkoutId: normalizeCheckoutId(CHECKOUT_A),
        writeScopeId: normalizeWriteScopeId(`checkout:${normalizeCheckoutId(CHECKOUT_A)}`),
        envelope: envelopeFromSandbox("workspace-write"),
      },
      routeSandbox: "workspace-write",
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.context.checkoutId).toBe(normalizeCheckoutId(CHECKOUT_A));
  });
});

describe("delegation-worktree-sandbox: ownership registry unit", () => {
  test("release is idempotent", () => {
    const registry = createWorktreeOwnershipRegistry();
    const context = {
      checkoutId: normalizeCheckoutId(CHECKOUT_A),
      writeScopeId: normalizeWriteScopeId(WRITE_SCOPE),
      envelope: envelopeFromSandbox("workspace-write"),
    };
    const acquired = tryAcquireWriteOwnership(registry, "task-a", context);
    expect(acquired.ok).toBe(true);
    releaseWriteOwnership(registry, "task-a");
    releaseWriteOwnership(registry, "task-a");
    expect(registry.activeWriteByCheckout.size).toBe(0);
  });
});
