import { describe, expect, test } from "bun:test";
import * as taskMachine from "../plugins/arc-orchestrator/lib/task-machine";
import {
  DEFAULT_TASK_BUDGET_POLICY,
  TASK_MACHINE_SCHEMA_VERSION,
  TASK_TRANSITION_TABLE,
  TERMINAL_STATE_NAMES,
  TRANSITION_REJECTIONS,
  step,
  validateVerificationEvidence,
  type TaskEvent,
  type TaskPolicy,
  type TaskState,
  type TaskTransition,
  type TransitionTableRow,
  type VerificationEvidence,
} from "../plugins/arc-orchestrator/lib/task-machine";
import type { RootBudgetLedger } from "../plugins/arc-orchestrator/lib/delegation-budget";

const EXPECTED_REJECTIONS = [
  "illegal-transition",
  "escalation-limit-reached",
  "escalation-budget-exhausted",
  "escalation-above-floor-ceiling",
  "escalation-unauthorized",
  "replan-limit-reached",
  "depth-limit-reached",
  "root-cancelled",
  "invalid-verification-evidence",
] as const;

function rowKey(row: TransitionTableRow): string {
  const when =
    row.when === null
      ? ""
      : "disposition" in row.when
        ? row.when.disposition
        : row.when.verdict;
  return `${row.from}|${row.eventKind}|${when}|${row.to ?? "null"}`;
}

describe("task-machine vocabulary (ADR 0011)", () => {
  test("schema version is 1", () => {
    expect(TASK_MACHINE_SCHEMA_VERSION).toBe(1);
  });

  test("DEFAULT_TASK_BUDGET_POLICY matches accepted 2026-07-26 defaults", () => {
    expect(DEFAULT_TASK_BUDGET_POLICY).toEqual({
      maxEscalations: 1,
      maxReplans: 1,
      escalationCostFraction: 0.35,
      floorCeiling: 4,
    });
  });

  test("terminal state names are exactly the five ADR terminals", () => {
    expect([...TERMINAL_STATE_NAMES].sort()).toEqual(
      [
        "accepted",
        "rejected",
        "blocked",
        "verification-failed",
        "cancelled",
      ].sort(),
    );
  });

  test("TransitionRejection union members are listed exactly", () => {
    expect([...TRANSITION_REJECTIONS]).toEqual([...EXPECTED_REJECTIONS]);
  });

  test("TASK_TRANSITION_TABLE has 17 ADR rows in order", () => {
    expect(TASK_TRANSITION_TABLE).toHaveLength(17);
    const keys = TASK_TRANSITION_TABLE.map(rowKey);
    expect(keys).toEqual([
      "intake|classified||plan",
      "plan|planned||decompose",
      "plan|planned||dispatch",
      "decompose|decomposed||dispatch",
      "dispatch|dispatch-completed|retryable|null",
      "dispatch|dispatch-completed|terminal|rejected",
      "dispatch|dispatch-completed|null|verify",
      "verify|verified|pass|accepted",
      "verify|verified|fail-quality|escalate",
      "verify|verified|fail-quality|verification-failed",
      "verify|verified|fail-approach|replan",
      "verify|verified|fail-blocked|blocked",
      "escalate|escalation-authorized||dispatch",
      "escalate|escalation-denied||verification-failed",
      "replan|planned||dispatch",
      "accepted|ship-authorized||ship",
      "*|cancelled||cancelled",
    ]);
  });

  test("intake classified row uses classify via then plan (parent-only classify v1)", () => {
    const row = TASK_TRANSITION_TABLE[0];
    expect(row.from).toBe("intake");
    expect(row.to).toBe("plan");
    expect(row.via).toEqual(["classify"]);
  });

  // Lateral (FailureDisposition / dispatch-completed) vs vertical (VerificationVerdict / verified):
  // retryable dispatch stays in dispatch with no task transition; fail-quality verified moves vertically.
  test("lateral vs vertical separation in transition table data", () => {
    const retryable = TASK_TRANSITION_TABLE.find(
      (r) =>
        r.eventKind === "dispatch-completed" &&
        r.when !== null &&
        "disposition" in r.when &&
        r.when.disposition === "retryable",
    );
    expect(retryable?.producesTaskTransition).toBe(false);
    expect(retryable?.to).toBeNull();

    const failQualityRows = TASK_TRANSITION_TABLE.filter(
      (r) =>
        r.eventKind === "verified" &&
        r.when !== null &&
        "verdict" in r.when &&
        r.when.verdict === "fail-quality",
    );
    expect(failQualityRows).toHaveLength(2);
    expect(failQualityRows.map((r) => r.to).sort()).toEqual(
      ["escalate", "verification-failed"].sort(),
    );
    for (const row of failQualityRows) {
      expect(row.producesTaskTransition).toBe(true);
    }
  });

  test("step is exported for Phase 14.3", () => {
    expect(taskMachine.step).toBe(step);
  });

  test("sample TaskState and TaskEvent typecheck at runtime", () => {
    const state: TaskState = {
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
    };
    const event: TaskEvent = {
      kind: "classified",
      axis: "swe",
      capabilityRoute: "implement.workspace-write.v1",
      floor: 2,
    };
    expect(state.name).toBe("intake");
    expect(event.kind).toBe("classified");
  });
});

const EVIDENCE: VerificationEvidence = {
  mode: "parent",
  rungId: null,
  criteriaChecked: ["focused tests pass"],
  commandsRun: ["bun test test/task-machine.test.ts"],
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
      throw new Error("step() must not read ledger.clock");
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

function successful(result: TaskTransition) {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result;
}

function rejected(result: TaskTransition, reason: string) {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`expected ${reason}, got ${result.next.name}`);
  }
  expect(result.reason).toBe(reason);
  expect(result.explanation.rejection).toBe(reason);
  return result;
}

describe("step() pure reducer (ADR 0011 Phase 14.3)", () => {
  test("rejects illegal transitions and keeps classify parent-only", () => {
    rejected(
      run(stateOf({ name: "intake" }), {
        kind: "planned",
        acceptanceCriteria: ["x"],
      }),
      "illegal-transition",
    );

    const classified = successful(
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
    expect(classified.effects).toEqual([{ kind: "emit-task-event" }]);
    expect(classified.explanation.notes).toContain(
      "classify is parent-executed in v1",
    );
  });

  test("planned selects decomposition for implement and dispatch for other routes", () => {
    const implement = successful(
      run(stateOf({ name: "plan" }), {
        kind: "planned",
        acceptanceCriteria: ["works"],
      }),
    );
    expect(implement.next.name).toBe("decompose");
    expect(implement.effects).toEqual([{ kind: "emit-task-event" }]);

    const check = successful(
      run(
        stateOf({
          name: "plan",
          capabilityRoute: "check.read-only.v1",
        }),
        { kind: "planned", acceptanceCriteria: [] },
      ),
    );
    expect(check.next.name).toBe("dispatch");
    expect(check.effects[0]).toEqual({
      kind: "select",
      request: {
        capabilityRoute: "check.read-only.v1",
        axis: "swe",
        capabilityFloor: 2,
        minimumFloor: 2,
        bandCeiling: null,
        override: null,
        taskIdentity: "task-1",
        depth: 0,
      },
    });

    rejected(
      run(stateOf({ name: "plan" }), {
        kind: "planned",
        acceptanceCriteria: [],
      }),
      "illegal-transition",
    );
  });

  test("decomposition enforces depth and fan-out before entering dispatch", () => {
    expect(
      successful(
        run(stateOf({ name: "decompose", depth: 1 }), {
          kind: "decomposed",
          childTaskKeys: ["a", "b"],
        }),
      ).next.name,
    ).toBe("dispatch");
    rejected(
      run(stateOf({ name: "decompose", depth: 2 }), {
        kind: "decomposed",
        childTaskKeys: [],
      }),
      "depth-limit-reached",
    );
    rejected(
      run(stateOf({ name: "decompose" }), {
        kind: "decomposed",
        childTaskKeys: ["1", "2", "3", "4", "5", "6"],
      }),
      "depth-limit-reached",
    );
  });

  test("dispatch-selected records the rung under review and emits typed reserve and dispatch effects", () => {
    const stack = [
      {
        rungId: "composer-2.5@none" as const,
        stableId: "composer-2.5",
        effort: "none" as const,
        backend: "cursor" as const,
        band: 2 as const,
        estimatedUsd: 1,
        quotaPool: null,
      },
    ];
    const decision = {
      outcome: "selected" as const,
      stack,
      explanation: {
        policyVersion: "capability-rung/v1",
        snapshotVersion: "test",
        registryVersion: 1,
        axis: "swe" as const,
        requestedFloor: 2 as const,
        effectiveFloor: 2 as const,
        floorLowered: false,
        overrideApplied: false,
        eligible: ["composer-2.5@none" as const],
        rejected: [],
        pruned: [],
        budgetConstrained: [],
        unranked: [],
        leadBackend: "cursor" as const,
      },
    };
    const before = stateOf({ name: "dispatch" });
    const result = successful(
      run(before, { kind: "dispatch-selected", decision }),
    );
    expect(result.next).toEqual({
      ...before,
      selectedRung: "composer-2.5@none",
    });
    expect(result.effects).toEqual([
      { kind: "reserve", taskIdentity: "task-1" },
      { kind: "dispatch", stack },
      { kind: "emit-task-event" },
    ]);
    expect(result.explanation.to).toBeNull();

    // A verification selection (dispatch-selected while in verify) must not
    // overwrite the rung under review with the checker's rung.
    const verifying = stateOf({
      name: "verify",
      selectedRung: "gpt-5.5@high",
    });
    const checkerSelected = successful(
      run(
        verifying,
        { kind: "dispatch-selected", decision },
        policyOf({ verification: "dispatch" }),
      ),
    );
    expect(checkerSelected.next.selectedRung).toBe("gpt-5.5@high");
  });

  test("dispatch-completed maps retryable, terminal variants, and null explicitly", () => {
    const retryable = successful(
      run(stateOf({ name: "dispatch" }), {
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
      runIds: ["run-retry"],
    });
    expect(retryable.effects).toEqual([]);
    expect(retryable.explanation.to).toBeNull();

    const terminalKinds = [
      {
        kind: "terminal" as const,
        classification: "policy_denial" as const,
        detail: null,
      },
      { kind: "terminal-unclassified" as const, detail: "unknown" },
      { kind: "terminal-completed-low-quality" as const },
    ];
    for (const disposition of terminalKinds) {
      const terminal = successful(
        run(stateOf({ name: "dispatch" }), {
          kind: "dispatch-completed",
          runId: `run-${disposition.kind}`,
          disposition,
        }),
      );
      expect(terminal.next.name).toBe("rejected");
      expect(terminal.effects[0]).toEqual({
        kind: "annotate",
        runId: `run-${disposition.kind}`,
        outcome: "rejected",
      });
    }

    const completed = successful(
      run(stateOf({ name: "dispatch" }), {
        kind: "dispatch-completed",
        runId: "run-ok",
        disposition: null,
      }),
    );
    expect(completed.next).toMatchObject({
      name: "verify",
      runIds: ["run-ok"],
    });
  });

  test("dispatch verification requests an independent check route excluding the rung under review", () => {
    const result = successful(
      run(
        stateOf({ name: "dispatch", selectedRung: "composer-2.5@none" }),
        { kind: "dispatch-completed", runId: "run-ok", disposition: null },
        policyOf({ verification: "dispatch" }),
      ),
    );
    expect(result.effects[0]).toMatchObject({
      kind: "select",
      request: {
        capabilityRoute: "check.read-only.v1",
        capabilityFloor: 2,
        excludedRung: "composer-2.5@none",
      },
    });

    // Ordinary work selection carries no exclusion at all: absent, not null.
    const planned = successful(
      run(
        stateOf({ name: "plan", capabilityRoute: "check.read-only.v1" }),
        { kind: "planned", acceptanceCriteria: [] },
      ),
    );
    const select = planned.effects[0];
    if (select?.kind !== "select") {
      throw new Error("expected a select effect");
    }
    expect("excludedRung" in select.request).toBe(false);
  });

  test("verification 'skip' accepts a completed dispatch without a verify dispatch", () => {
    const result = successful(
      run(
        stateOf({ name: "dispatch", selectedRung: "composer-2.5@none" }),
        { kind: "dispatch-completed", runId: "run-ok", disposition: null },
        policyOf({ verification: "skip" }),
      ),
    );
    expect(result.next).toMatchObject({
      name: "accepted",
      runIds: ["run-ok"],
    });
    expect(result.effects).toEqual([
      { kind: "annotate", runId: "run-ok", outcome: "accepted" },
      { kind: "emit-task-event" },
    ]);
    expect(result.effects.some((effect) => effect.kind === "select")).toBe(
      false,
    );
  });

  test("verification pass, approach failure, and blocked failure choose distinct paths", () => {
    const verify = stateOf({ name: "verify", runIds: ["run-1"] });
    const pass = successful(
      run(verify, {
        kind: "verified",
        verdict: { kind: "pass", evidence: EVIDENCE },
      }),
    );
    expect(pass.next.name).toBe("accepted");
    expect(pass.effects[0]).toEqual({
      kind: "annotate",
      runId: "run-1",
      outcome: "accepted",
    });

    const approach = successful(
      run(verify, {
        kind: "verified",
        verdict: {
          kind: "fail-approach",
          reason: "wrong plan",
          evidence: EVIDENCE,
        },
      }),
    );
    expect(approach.next).toMatchObject({ name: "replan", replansUsed: 1 });

    const blocked = successful(
      run(verify, {
        kind: "verified",
        verdict: { kind: "fail-blocked", reason: "credential missing" },
      }),
    );
    expect(blocked.next.name).toBe("blocked");
    expect(blocked.effects[0]).toMatchObject({
      kind: "annotate",
      outcome: "blocked",
    });
  });

  test("validateVerificationEvidence enforces parent, dispatch, and policy alignment", () => {
    const verify = stateOf({
      name: "verify",
      selectedRung: "composer-2.5@none",
    });
    const parentPolicy = policyOf({ verification: "parent" });
    const dispatchPolicy = policyOf({ verification: "dispatch" });

    expect(
      validateVerificationEvidence(verify, parentPolicy, EVIDENCE),
    ).toBeNull();

    rejected(
      run(verify, {
        kind: "verified",
        verdict: {
          kind: "pass",
          evidence: { ...EVIDENCE, rungId: "gpt-5.5@high" },
        },
      }),
      "invalid-verification-evidence",
    );

    const dispatchEvidence: VerificationEvidence = {
      mode: "dispatch",
      rungId: "gpt-5.5@high",
      criteriaChecked: ["tests pass"],
      commandsRun: ["bun test"],
    };
    expect(
      validateVerificationEvidence(verify, dispatchPolicy, dispatchEvidence),
    ).toBeNull();
    expect(
      successful(
        run(
          verify,
          {
            kind: "verified",
            verdict: { kind: "pass", evidence: dispatchEvidence },
          },
          dispatchPolicy,
        ),
      ).next.name,
    ).toBe("accepted");

    rejected(
      run(
        verify,
        {
          kind: "verified",
          verdict: {
            kind: "pass",
            evidence: { ...dispatchEvidence, rungId: null },
          },
        },
        dispatchPolicy,
      ),
      "invalid-verification-evidence",
    );

    rejected(
      run(
        verify,
        {
          kind: "verified",
          verdict: {
            kind: "pass",
            evidence: {
              ...dispatchEvidence,
              rungId: "composer-2.5@none",
            },
          },
        },
        dispatchPolicy,
      ),
      "invalid-verification-evidence",
    );

    rejected(
      run(
        verify,
        {
          kind: "verified",
          verdict: {
            kind: "pass",
            evidence: { ...EVIDENCE, mode: "dispatch" },
          },
        },
        parentPolicy,
      ),
      "invalid-verification-evidence",
    );
  });

  test("validateVerificationEvidence rejects bounded criteriaChecked and commandsRun violations", () => {
    const verify = stateOf({ name: "verify" });

    rejected(
      run(verify, {
        kind: "verified",
        verdict: {
          kind: "pass",
          evidence: { ...EVIDENCE, criteriaChecked: ["  "] },
        },
      }),
      "invalid-verification-evidence",
    );

    rejected(
      run(verify, {
        kind: "verified",
        verdict: {
          kind: "pass",
          evidence: {
            ...EVIDENCE,
            commandsRun: ["/Users/secret/project/foo.ts"],
          },
        },
      }),
      "invalid-verification-evidence",
    );

    rejected(
      run(verify, {
        kind: "verified",
        verdict: {
          kind: "pass",
          evidence: {
            ...EVIDENCE,
            commandsRun: ["x".repeat(241)],
          },
        },
      }),
      "invalid-verification-evidence",
    );
  });

  test("fail-blocked verified skips evidence validation", () => {
    const result = successful(
      run(stateOf({ name: "verify", runIds: ["run-1"] }), {
        kind: "verified",
        verdict: { kind: "fail-blocked", reason: "credential missing" },
      }),
    );
    expect(result.next.name).toBe("blocked");
  });

  test("quality failure requests authorization when all escalation guards pass", () => {
    const result = successful(
      run(stateOf({ name: "verify", runIds: ["run-1"] }), {
        kind: "verified",
        verdict: {
          kind: "fail-quality",
          unmetCriteria: ["focused test"],
          evidence: EVIDENCE,
        },
      }),
    );
    expect(result.next.name).toBe("escalate");
    expect(result.effects).toEqual([
      {
        kind: "request-authorization",
        toBand: 3,
        via: { kind: "parent" },
      },
      { kind: "emit-task-event" },
    ]);
  });

  test.each([
    [
      "escalation-limit-reached",
      stateOf({
        name: "verify",
        escalationsUsed: 1,
        runIds: ["run-1"],
      }),
      policyOf(),
      ledgerOf(),
    ],
    [
      "depth-limit-reached",
      stateOf({ name: "verify", depth: 1, runIds: ["run-1"] }),
      policyOf(),
      ledgerOf(),
    ],
    [
      "escalation-above-floor-ceiling",
      stateOf({
        name: "verify",
        capabilityFloor: 4,
        runIds: ["run-1"],
      }),
      policyOf(),
      ledgerOf(),
    ],
    [
      "escalation-unauthorized",
      stateOf({ name: "verify", runIds: ["run-1"] }),
      policyOf({
        authorization: { kind: "policy", maxBand: 2 },
      }),
      ledgerOf(),
    ],
    [
      "escalation-budget-exhausted",
      stateOf({ name: "verify", runIds: ["run-1"] }),
      policyOf(),
      ledgerOf(7),
    ],
  ] as const)(
    "quality guard maps %s to verification-failed",
    (reason, state, policy, ledger) => {
      const result = successful(
        run(
          state,
          {
            kind: "verified",
            verdict: {
              kind: "fail-quality",
              unmetCriteria: ["quality"],
              evidence: EVIDENCE,
            },
          },
          policy,
          ledger,
        ),
      );
      expect(result.next.name).toBe("verification-failed");
      expect(result.explanation.rejection).toBe(reason);
      expect(result.effects[0]).toMatchObject({
        kind: "annotate",
        outcome: "verification-failed",
      });
    },
  );

  test("escalation cost fraction passes at the exact reservation boundary", () => {
    const result = successful(
      run(
        stateOf({ name: "verify" }),
        {
          kind: "verified",
          verdict: {
            kind: "fail-quality",
            unmetCriteria: ["quality"],
            evidence: EVIDENCE,
          },
        },
        policyOf({
          budget: {
            ...DEFAULT_TASK_BUDGET_POLICY,
            escalationCostFraction: 0.25,
          },
        }),
        ledgerOf(10),
      ),
    );
    expect(result.next.name).toBe("escalate");
  });

  test("authorized escalation raises one band; denial terminates honestly", () => {
    const escalating = stateOf({
      name: "escalate",
      runIds: ["run-1"],
    });
    const authorized = successful(
      run(escalating, { kind: "escalation-authorized", toBand: 3 }),
    );
    expect(authorized.next).toMatchObject({
      name: "dispatch",
      capabilityFloor: 3,
      escalationsUsed: 1,
    });
    expect(authorized.effects[0]).toEqual({
      kind: "annotate",
      runId: "run-1",
      outcome: "escalated",
    });
    expect(authorized.effects[1]).toMatchObject({ kind: "select" });

    const denied = successful(
      run(escalating, {
        kind: "escalation-denied",
        reason: "parent declined",
      }),
    );
    expect(denied.next.name).toBe("verification-failed");
    expect(denied.effects[0]).toMatchObject({
      kind: "annotate",
      outcome: "verification-failed",
    });

    rejected(
      run(escalating, { kind: "escalation-authorized", toBand: 4 }),
      "escalation-above-floor-ceiling",
    );
  });

  test("escalation-authorized rechecks the escalation budget against the live ledger", () => {
    const escalating = stateOf({ name: "escalate", runIds: ["run-1"] });
    // 2.5 reservation > 7 * 0.35 = 2.45: the fraction guard fails even though
    // the fail-quality guard may have passed against an earlier, fuller ledger.
    rejected(
      run(
        escalating,
        { kind: "escalation-authorized", toBand: 3 },
        policyOf(),
        ledgerOf(7),
      ),
      "escalation-budget-exhausted",
    );
    // 2.5 > 2 remaining outright, independent of the fraction.
    rejected(
      run(
        escalating,
        { kind: "escalation-authorized", toBand: 3 },
        policyOf({
          budget: { ...DEFAULT_TASK_BUDGET_POLICY, escalationCostFraction: 1 },
        }),
        ledgerOf(2),
      ),
      "escalation-budget-exhausted",
    );
  });

  test("replan limit rejects a second approach failure and replanned work dispatches", () => {
    rejected(
      run(
        stateOf({ name: "verify", replansUsed: 1 }),
        {
          kind: "verified",
          verdict: {
            kind: "fail-approach",
            reason: "still wrong",
            evidence: EVIDENCE,
          },
        },
      ),
      "replan-limit-reached",
    );

    const replanned = successful(
      run(stateOf({ name: "replan" }), {
        kind: "planned",
        acceptanceCriteria: ["revised"],
      }),
    );
    expect(replanned.next).toMatchObject({
      name: "dispatch",
      acceptanceCriteria: ["revised"],
    });
    expect(replanned.effects[0]).toMatchObject({ kind: "select" });
  });

  test("cancellation is wildcard except an already root-cancelled task rejects", () => {
    for (const name of ["intake", "dispatch", "accepted", "ship"] as const) {
      const result = successful(
        run(stateOf({ name }), { kind: "cancelled", reason: "root stopped" }),
      );
      expect(result.next.name).toBe("cancelled");
    }
    rejected(
      run(stateOf({ name: "cancelled" }), {
        kind: "cancelled",
        reason: "again",
      }),
      "root-cancelled",
    );
    rejected(
      run(stateOf({ name: "cancelled" }), {
        kind: "planned",
        acceptanceCriteria: ["x"],
      }),
      "root-cancelled",
    );
  });

  test("does not mutate state, event, policy, ledger, nested arrays, or call clock", () => {
    const state = stateOf({
      name: "verify",
      acceptanceCriteria: ["criterion"],
      runIds: ["run-1"],
    });
    const event: TaskEvent = {
      kind: "verified",
      verdict: {
        kind: "fail-quality",
        unmetCriteria: ["quality"],
        evidence: {
          ...EVIDENCE,
          criteriaChecked: [...EVIDENCE.criteriaChecked],
          commandsRun: [...EVIDENCE.commandsRun],
        },
      },
    };
    const policy = policyOf();
    const ledger = ledgerOf();
    ledger.reservations.set("existing", {
      taskIdentity: "existing",
      rootIdentity: "root-1",
      depth: 0,
      reserved: {
        token: 1,
        wallTimeMs: 1,
        call: 1,
        cost: 1,
        concurrency: 1,
      },
      status: "active",
    });
    const stateBefore = structuredClone(state);
    const eventBefore = structuredClone(event);
    const policyBefore = structuredClone(policy);
    const ledgerBefore = {
      limits: { ...ledger.limits },
      consumed: { ...ledger.consumed },
      remaining: { ...ledger.remaining },
      reservations: [...ledger.reservations.entries()].map(([key, value]) => [
        key,
        structuredClone(value),
      ]),
    };

    const result = successful(
      step({ state, event, policy, ledger, nowMs: 2_000 }),
    );
    expect(result.next).not.toBe(state);
    expect(result.next.runIds).not.toBe(state.runIds);
    expect(result.next.acceptanceCriteria).not.toBe(state.acceptanceCriteria);
    expect(state).toEqual(stateBefore);
    expect(event).toEqual(eventBefore);
    expect(policy).toEqual(policyBefore);
    expect({
      limits: ledger.limits,
      consumed: ledger.consumed,
      remaining: ledger.remaining,
      reservations: [...ledger.reservations.entries()],
    }).toEqual(ledgerBefore);
  });
});

// Phase 14.5 closes the escalate state: every TaskBudgetPolicy and
// EscalationAuthorization guard is evaluated on both edges into and out of
// `escalate`, and neither edge may spend budget it has not re-checked.
describe("escalate state contract (ADR 0011 Phase 14.5)", () => {
  const FAIL_QUALITY: TaskEvent = {
    kind: "verified",
    verdict: {
      kind: "fail-quality",
      unmetCriteria: ["focused test"],
      evidence: EVIDENCE,
    },
  };

  test("authorization kind decides the band cap: only 'policy' caps", () => {
    // floor 3 -> band 4 is the top of floorCeiling: parent and user carry no
    // band of their own, so the request is raised for an in-loop decision.
    for (const authorization of [
      { kind: "parent" } as const,
      { kind: "user" } as const,
    ]) {
      const result = successful(
        run(
          stateOf({ name: "verify", capabilityFloor: 3, runIds: ["run-1"] }),
          FAIL_QUALITY,
          policyOf({ authorization }),
        ),
      );
      expect(result.next.name).toBe("escalate");
      expect(result.effects).toEqual([
        { kind: "request-authorization", toBand: 4, via: authorization },
        { kind: "emit-task-event" },
      ]);
    }

    // A policy authorization admits exactly up to its own maxBand.
    const atMaxBand = successful(
      run(
        stateOf({ name: "verify", runIds: ["run-1"] }),
        FAIL_QUALITY,
        policyOf({ authorization: { kind: "policy", maxBand: 3 } }),
      ),
    );
    expect(atMaxBand.next.name).toBe("escalate");
    expect(atMaxBand.effects[0]).toEqual({
      kind: "request-authorization",
      toBand: 3,
      via: { kind: "policy", maxBand: 3 },
    });

    const overMaxBand = successful(
      run(
        stateOf({ name: "verify", capabilityFloor: 3, runIds: ["run-1"] }),
        FAIL_QUALITY,
        policyOf({ authorization: { kind: "policy", maxBand: 3 } }),
      ),
    );
    expect(overMaxBand.next.name).toBe("verification-failed");
    expect(overMaxBand.explanation.rejection).toBe("escalation-unauthorized");
  });

  test("a guard failure lands on the verification-failed terminal with no authorization request", () => {
    const before = stateOf({
      name: "verify",
      escalationsUsed: 1,
      capabilityFloor: 2,
      runIds: ["run-1"],
    });
    const result = successful(run(before, FAIL_QUALITY));

    expect(result.next.name).toBe("verification-failed");
    expect(TERMINAL_STATE_NAMES).toContain(result.next.name);
    // The floor is not raised and no escalation is spent on a refused attempt.
    expect(result.next.capabilityFloor).toBe(before.capabilityFloor);
    expect(result.next.escalationsUsed).toBe(before.escalationsUsed);
    expect(result.effects).toEqual([
      { kind: "annotate", runId: "run-1", outcome: "verification-failed" },
      { kind: "emit-task-event" },
    ]);
    expect(
      result.effects.some((e) => e.kind === "request-authorization"),
    ).toBe(false);
  });

  test("fail-quality refuses one cent short of the fraction and admits the exact boundary", () => {
    // Reservation is 2.5. At fraction 0.25 the boundary remaining cost is 10.
    const budget = {
      ...DEFAULT_TASK_BUDGET_POLICY,
      escalationCostFraction: 0.25,
    };
    const short = successful(
      run(
        stateOf({ name: "verify", runIds: ["run-1"] }),
        FAIL_QUALITY,
        policyOf({ budget }),
        ledgerOf(9.99),
      ),
    );
    expect(short.next.name).toBe("verification-failed");
    expect(short.explanation.rejection).toBe("escalation-budget-exhausted");

    const exact = successful(
      run(
        stateOf({ name: "verify", runIds: ["run-1"] }),
        FAIL_QUALITY,
        policyOf({ budget }),
        ledgerOf(10),
      ),
    );
    expect(exact.next.name).toBe("escalate");
  });

  test("escalation-authorized revalidates every guard before dispatching", () => {
    const authorize: TaskEvent = { kind: "escalation-authorized", toBand: 3 };

    // Depth 1: a child task may not escalate — escalation raises a floor and
    // spends root budget, which stays a parent decision.
    rejected(
      run(stateOf({ name: "escalate", depth: 1, runIds: ["run-1"] }), authorize),
      "depth-limit-reached",
    );

    rejected(
      run(
        stateOf({ name: "escalate", escalationsUsed: 1, runIds: ["run-1"] }),
        authorize,
      ),
      "escalation-limit-reached",
    );

    rejected(
      run(
        stateOf({ name: "escalate", runIds: ["run-1"] }),
        authorize,
        policyOf({ authorization: { kind: "policy", maxBand: 2 } }),
      ),
      "escalation-unauthorized",
    );

    // An authorization for a band other than floor + 1 is not a licence to skip
    // a band, even when the requested band is under the ceiling.
    rejected(
      run(stateOf({ name: "escalate", capabilityFloor: 1, runIds: ["run-1"] }), {
        kind: "escalation-authorized",
        toBand: 3,
      }),
      "escalation-above-floor-ceiling",
    );

    rejected(
      run(
        stateOf({ name: "escalate", capabilityFloor: 3, runIds: ["run-1"] }),
        { kind: "escalation-authorized", toBand: 4 },
        policyOf({
          budget: { ...DEFAULT_TASK_BUDGET_POLICY, floorCeiling: 3 },
        }),
      ),
      "escalation-above-floor-ceiling",
    );
  });

  test("escalation-authorized admits the exact affordability boundary", () => {
    const result = successful(
      run(
        stateOf({ name: "escalate", runIds: ["run-1"] }),
        { kind: "escalation-authorized", toBand: 3 },
        policyOf({
          budget: {
            ...DEFAULT_TASK_BUDGET_POLICY,
            escalationCostFraction: 0.25,
          },
        }),
        ledgerOf(10),
      ),
    );
    expect(result.next).toMatchObject({
      name: "dispatch",
      capabilityFloor: 3,
      escalationsUsed: 1,
    });
  });

  test("a successful escalation emits exactly one escalated annotation and re-selects at the new floor", () => {
    const before = stateOf({
      name: "escalate",
      capabilityFloor: 3,
      originalFloor: 2,
      runIds: ["run-1", "run-2"],
    });
    const result = successful(
      run(before, { kind: "escalation-authorized", toBand: 4 }),
    );

    // `escalated` stays run-level and names only the superseded dispatch: the
    // most recent run, once, never the whole run history.
    const annotations = result.effects.filter((e) => e.kind === "annotate");
    expect(annotations).toEqual([
      { kind: "annotate", runId: "run-2", outcome: "escalated" },
    ]);
    expect(result.effects).toEqual([
      { kind: "annotate", runId: "run-2", outcome: "escalated" },
      {
        kind: "select",
        request: {
          capabilityRoute: "implement.workspace-write.v1",
          axis: "swe",
          capabilityFloor: 4,
          minimumFloor: 4,
          bandCeiling: null,
          override: null,
          taskIdentity: "task-1",
          depth: 0,
        },
      },
      { kind: "emit-task-event" },
    ]);
    // originalFloor is history and must survive the raise.
    expect(result.next.originalFloor).toBe(2);
    expect(before.capabilityFloor).toBe(3);
    expect(before.escalationsUsed).toBe(0);
  });

  test("a rejected escalation produces no next state, so no floor or count moves", () => {
    const result = run(
      stateOf({ name: "escalate", escalationsUsed: 1, runIds: ["run-1"] }),
      { kind: "escalation-authorized", toBand: 3 },
    );
    expect(result.ok).toBe(false);
    expect("next" in result).toBe(false);
    expect("effects" in result).toBe(false);
    expect(result.explanation).toMatchObject({
      from: "escalate",
      eventKind: "escalation-authorized",
      to: null,
      rejection: "escalation-limit-reached",
    });
  });
});
