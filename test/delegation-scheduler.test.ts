import { describe, expect, test } from "bun:test";
import {
  DelegationScheduler,
  MAX_DELEGATION_DEPTH,
  MAX_DIRECT_FAN_OUT,
  MAX_GLOBAL_ACTIVE_CONCURRENCY,
  MAX_ROOT_ACTIVE_CONCURRENCY,
  normalizeTaskIdentity,
  rejectChildDispatch,
} from "../plugins/fable-orchestrator/lib/delegation-scheduler";

function createScheduler() {
  const scheduler = new DelegationScheduler("sched-test");
  const authority = scheduler.issueParentAuthority();
  return { scheduler, authority };
}

function rootRouting(alias = "composer-implement") {
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
  });
}

describe("delegation-scheduler: task identity normalization", () => {
  test("hashes sensitive task keys to bounded non-sensitive identities", () => {
    const sensitive = "Implement user password reset with secret token abc123";
    const identity = normalizeTaskIdentity(sensitive);
    expect(identity).toHaveLength(12);
    expect(identity).toMatch(/^[a-f0-9]{12}$/);
    expect(identity).not.toContain("password");
    expect(normalizeTaskIdentity(sensitive)).toBe(identity);
  });

  test("does not leak semantic run-* task keys", () => {
    const sensitive = "run-customer-password-reset-secret";
    const identity = normalizeTaskIdentity(sensitive);
    expect(identity).toHaveLength(12);
    expect(identity).toMatch(/^[a-f0-9]{12}$/);
    expect(identity).not.toContain("password");
    expect(identity).not.toContain("customer");
    expect(identity).not.toContain("run-");
    expect(normalizeTaskIdentity(sensitive)).toBe(identity);
  });

  test("hashes arbitrary semantic task keys including run-* and trav-*", () => {
    const semanticKeys = ["run-depth-1-child", "trav-explore-branch-2"];
    for (const key of semanticKeys) {
      const identity = normalizeTaskIdentity(key);
      expect(identity).toHaveLength(12);
      expect(identity).toMatch(/^[a-f0-9]{12}$/);
      expect(identity).not.toBe(key);
    }
  });

  test("passes through already-normalized 12-hex identities for idempotence", () => {
    const normalized = "a1b2c3d4e5f6";
    expect(normalizeTaskIdentity(normalized)).toBe(normalized);
    expect(normalizeTaskIdentity(`  ${normalized}  `)).not.toBe(normalized);
  });
});

describe("delegation-scheduler: depth and parent-only dispatch", () => {
  test("root depth is 0 and maximum depth is 2", () => {
    const { scheduler, authority } = createScheduler();

    const root = admit(scheduler, authority, "root-task", null, "run-root");
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }
    expect(root.depth).toBe(0);

    const depth1 = admit(
      scheduler,
      authority,
      "child-1",
      "root-task",
      "run-child-1",
    );
    expect(depth1.admitted).toBe(true);
    if (!depth1.admitted) {
      return;
    }
    expect(depth1.depth).toBe(1);

    const depth2 = admit(
      scheduler,
      authority,
      "child-2",
      "child-1",
      "run-child-2",
    );
    expect(depth2.admitted).toBe(true);
    if (!depth2.admitted) {
      return;
    }
    expect(depth2.depth).toBe(2);

    const depth3 = admit(
      scheduler,
      authority,
      "child-3",
      "child-2",
      "run-child-3",
    );
    expect(depth3).toEqual({
      admitted: false,
      reason: "depth-overflow",
      taskIdentity: normalizeTaskIdentity("child-3"),
    });
    expect(MAX_DELEGATION_DEPTH).toBe(2);
  });

  test("children can recommend but cannot directly spawn descendants", () => {
    const { scheduler, authority } = createScheduler();
    const root = admit(scheduler, authority, "root-task", null, "run-root");
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    const recommendation = scheduler.submitRecommendation("root-task", {
      delegation: true,
      intent: "delegate",
      requestedRoute: "codex-check",
      preferredCandidateStableIds: ["gpt-5.5"],
    });
    expect(recommendation).toEqual({
      accepted: true,
      taskIdentity: normalizeTaskIdentity("root-task"),
    });

    expect(rejectChildDispatch()).toEqual({
      admitted: false,
      reason:
        "delegation-scheduler: child dispatch forbidden; only parent authority may admit",
    });

    const childAttempt = scheduler.admitDispatch(
      { schedulerId: "child", token: Symbol("child") },
      {
        taskKey: "grandchild",
        parentTaskKey: "root-task",
        runId: "run-bad",
        routing: { requestedRoute: "codex-check" },
      },
    );
    expect(childAttempt).toEqual({
      admitted: false,
      reason: "invalid-parent-authority",
      taskIdentity: normalizeTaskIdentity("grandchild"),
    });
  });
});

describe("delegation-scheduler: fan-out and concurrency", () => {
  test("rejects fan-out overflow per parent", () => {
    const { scheduler, authority } = createScheduler();
    admit(scheduler, authority, "root-task", null, "run-root");
    scheduler.completeDispatch(authority, normalizeTaskIdentity("root-task"));

    for (let index = 0; index < MAX_DIRECT_FAN_OUT; index += 1) {
      const key = `child-${index}`;
      const result = admit(
        scheduler,
        authority,
        key,
        "root-task",
        `run-child-${index}`,
      );
      expect(result.admitted).toBe(true);
      scheduler.completeDispatch(authority, normalizeTaskIdentity(key));
    }

    const overflow = admit(
      scheduler,
      authority,
      "child-overflow",
      "root-task",
      "run-overflow",
    );
    expect(overflow).toEqual({
      admitted: false,
      reason: "fan-out-overflow",
      taskIdentity: normalizeTaskIdentity("child-overflow"),
    });
  });

  test("rejects global and root concurrency overflow", () => {
    const { scheduler, authority } = createScheduler();

    for (let index = 0; index < MAX_GLOBAL_ACTIVE_CONCURRENCY; index += 1) {
      const result = admit(scheduler, authority, `root-${index}`, null, `run-${index}`);
      expect(result.admitted).toBe(true);
    }

    const globalOverflow = admit(
      scheduler,
      authority,
      "root-overflow",
      null,
      "run-overflow",
    );
    expect(globalOverflow).toEqual({
      admitted: false,
      reason: "global-concurrency-overflow",
      taskIdentity: normalizeTaskIdentity("root-overflow"),
    });

    for (let index = 0; index < MAX_GLOBAL_ACTIVE_CONCURRENCY; index += 1) {
      scheduler.completeDispatch(authority, normalizeTaskIdentity(`root-${index}`));
    }

    const root = admit(scheduler, authority, "root-fresh", null, "run-fresh");
    expect(root.admitted).toBe(true);
    if (!root.admitted) {
      return;
    }

    for (let index = 0; index < MAX_ROOT_ACTIVE_CONCURRENCY - 1; index += 1) {
      const child = admit(
        scheduler,
        authority,
        `fresh-child-${index}`,
        "root-fresh",
        `run-fresh-child-${index}`,
      );
      expect(child.admitted).toBe(true);
    }

    const rootConcurrencyOverflow = admit(
      scheduler,
      authority,
      "fresh-child-overflow",
      "root-fresh",
      "run-fresh-overflow",
    );
    expect(rootConcurrencyOverflow).toEqual({
      admitted: false,
      reason: "root-concurrency-overflow",
      taskIdentity: normalizeTaskIdentity("fresh-child-overflow"),
    });
    expect(MAX_ROOT_ACTIVE_CONCURRENCY).toBe(3);
  });
});

describe("delegation-scheduler: graph integrity", () => {
  test("rejects missing parent and duplicate active task identity", () => {
    const { scheduler, authority } = createScheduler();

    const missingParent = admit(
      scheduler,
      authority,
      "orphan",
      "missing-parent",
      "run-orphan",
    );
    expect(missingParent).toEqual({
      admitted: false,
      reason: "missing-parent",
      taskIdentity: normalizeTaskIdentity("orphan"),
    });

    admit(scheduler, authority, "root-task", null, "run-root");
    admit(scheduler, authority, "active-child", "root-task", "run-active");

    const duplicate = admit(
      scheduler,
      authority,
      "active-child",
      "root-task",
      "run-dup",
    );
    expect(duplicate).toEqual({
      admitted: false,
      reason: "duplicate-active-task-identity",
      taskIdentity: normalizeTaskIdentity("active-child"),
    });
  });

  test("rejects direct and indirect ancestor identity repeats", () => {
    const { scheduler, authority } = createScheduler();
    const rootKey = "a1b2c3d4e5f6";
    admit(scheduler, authority, rootKey, null, "run-root");

    const child = admit(scheduler, authority, "child-a", rootKey, "run-child");
    expect(child.admitted).toBe(true);
    if (!child.admitted) {
      return;
    }

    const directCycle = admit(
      scheduler,
      authority,
      "child-a",
      "child-a",
      "run-cycle-direct",
    );
    expect(directCycle).toEqual({
      admitted: false,
      reason: "ancestor-identity-repeat",
      taskIdentity: normalizeTaskIdentity("child-a"),
    });

    scheduler.completeDispatch(authority, normalizeTaskIdentity(rootKey));

    const indirectCycle = admit(
      scheduler,
      authority,
      rootKey,
      "child-a",
      "run-cycle-indirect",
    );
    expect(indirectCycle).toEqual({
      admitted: false,
      reason: "ancestor-identity-repeat",
      taskIdentity: normalizeTaskIdentity(rootKey),
    });
  });

  test("rejects malformed route paths at admission", () => {
    const { scheduler, authority } = createScheduler();
    const rejected = admit(
      scheduler,
      authority,
      "root-task",
      null,
      "run-root",
      { requestedRoute: "not-a-real-route" },
    );
    expect(rejected).toEqual({
      admitted: false,
      reason: "malformed-route-path",
      taskIdentity: normalizeTaskIdentity("root-task"),
    });
  });
});
