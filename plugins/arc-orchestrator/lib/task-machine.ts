// ADR 0011 task lifecycle vocabulary, declarative transition table, and pure reducer.

import type { Outcome } from "./annotation";
import type {
  SelectionDecision,
  SelectionRequest,
  SelectedRung,
} from "./capability-selection";
import type { CanonicalCapabilityRouteId } from "./capability-routes";
import type { CapabilityAxis, CapabilityBand } from "./capability-snapshot";
import {
  BUDGET_LIMITS_V1,
  type RootBudgetLedger,
} from "./delegation-budget";
import {
  MAX_DELEGATION_DEPTH,
  MAX_DIRECT_FAN_OUT,
} from "./delegation-scheduler";
import type { FailureDisposition } from "./failure-classification";
import { parseRungId, type RungId } from "./model-registry";
import {
  boundedStructuredString,
  sanitizeFailureDetail,
} from "./trace-schema";

export const TASK_MACHINE_SCHEMA_VERSION = 2;

export const TASK_STATE_NAMES = [
  "intake",
  "classify",
  "plan",
  "decompose",
  "dispatch",
  "verify",
  "code-review",
  "escalate",
  "replan",
  "accepted",
  "rejected",
  "blocked",
  "verification-failed",
  "cancelled",
  "ship",
] as const;

export type TaskStateName = (typeof TASK_STATE_NAMES)[number];

export const TERMINAL_STATE_NAMES = [
  "accepted",
  "rejected",
  "blocked",
  "verification-failed",
  "cancelled",
] as const;

export type TerminalStateName = (typeof TERMINAL_STATE_NAMES)[number];

export type VerificationMode = "parent" | "dispatch" | "skip";

export type VerificationEvidence = {
  mode: VerificationMode;
  rungId: RungId | null;
  criteriaChecked: string[];
  commandsRun: string[];
};

export type VerificationVerdict =
  | { kind: "pass"; evidence: VerificationEvidence }
  | { kind: "fail-quality"; unmetCriteria: string[]; evidence: VerificationEvidence }
  | { kind: "fail-approach"; reason: string; evidence: VerificationEvidence }
  | { kind: "fail-blocked"; reason: string };

export type TaskBudgetPolicy = {
  maxEscalations: number;
  maxReplans: number;
  escalationCostFraction: number;
  floorCeiling: CapabilityBand;
};

export const DEFAULT_TASK_BUDGET_POLICY: TaskBudgetPolicy = {
  maxEscalations: 1,
  maxReplans: 1,
  escalationCostFraction: 0.35,
  floorCeiling: 4,
};

export type EscalationAuthorization =
  | { kind: "policy"; maxBand: CapabilityBand }
  | { kind: "parent" }
  | { kind: "user" };

export type TaskPolicy = {
  budget: TaskBudgetPolicy;
  authorization: EscalationAuthorization;
  verification: VerificationMode;
  // Optional independent review after Verify passes. Omitted/skip preserves
  // the v1 lifecycle; dispatch can only be entered from a successful Verify.
  codeReview?: "dispatch" | "skip";
};

export type TaskState = {
  schemaVersion: typeof TASK_MACHINE_SCHEMA_VERSION;
  taskIdentity: string;
  rootIdentity: string;
  depth: number;
  name: TaskStateName;
  axis: CapabilityAxis;
  capabilityRoute: CanonicalCapabilityRouteId;
  capabilityFloor: CapabilityBand;
  originalFloor: CapabilityBand;
  acceptanceCriteria: string[];
  escalationsUsed: number;
  replansUsed: number;
  runIds: string[];
  // The lead rung of the most recent work selection — the rung whose output is
  // under review. Recorded so a dispatched verification can exclude it: the
  // implementer may not verify its own work. Null until the first selection.
  selectedRung: RungId | null;
};

export type TaskEvent =
  | {
      kind: "classified";
      axis: CapabilityAxis;
      capabilityRoute: CanonicalCapabilityRouteId;
      floor: CapabilityBand;
    }
  | { kind: "planned"; acceptanceCriteria: string[] }
  | { kind: "decomposed"; childTaskKeys: string[] }
  | { kind: "dispatch-selected"; decision: SelectionDecision }
  | {
      kind: "dispatch-completed";
      runId: string;
      disposition: FailureDisposition | null;
    }
  | { kind: "verified"; verdict: VerificationVerdict }
  | { kind: "escalation-authorized"; toBand: CapabilityBand }
  | { kind: "escalation-denied"; reason: string }
  | { kind: "cancelled"; reason: string }
  | { kind: "ship-authorized" };

export type TaskStepInput = {
  state: TaskState;
  event: TaskEvent;
  policy: TaskPolicy;
  ledger: RootBudgetLedger;
  nowMs: number;
};

export type TransitionExplanation = {
  from: TaskStateName;
  eventKind: TaskEvent["kind"];
  to: TaskStateName | null;
  rejection: TransitionRejection | null;
  notes: string[];
};

export type TaskTransition =
  | {
      ok: true;
      next: TaskState;
      effects: TaskEffect[];
      explanation: TransitionExplanation;
    }
  | {
      ok: false;
      reason: TransitionRejection;
      explanation: TransitionExplanation;
    };

export type TaskEffect =
  | { kind: "select"; request: SelectionRequest }
  | { kind: "reserve"; taskIdentity: string }
  | { kind: "dispatch"; stack: SelectedRung[] }
  | {
      kind: "request-authorization";
      toBand: CapabilityBand;
      via: EscalationAuthorization;
    }
  | { kind: "annotate"; runId: string; outcome: Outcome }
  | { kind: "emit-task-event" };

export const TRANSITION_REJECTIONS = [
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

/** Max criteria attested on a single verification verdict. */
export const MAX_VERIFICATION_CRITERIA_COUNT = 32;
/** Max characters per acceptance-criterion label in verification evidence. */
export const MAX_VERIFICATION_CRITERION_LENGTH = 256;
/** Max redacted command lines recorded in verification evidence. */
export const MAX_VERIFICATION_COMMANDS_COUNT = 16;
/** Max characters per commandsRun entry (matches trace failure-detail bound). */
export const MAX_VERIFICATION_COMMAND_LENGTH = 240;

const VERIFICATION_PATH_PATTERN =
  /(?:file:\/\/)?\/(?:[\w.@+~-]+\/)+[\w.@+~-]+/;

/**
 * Pure attestation check for verification evidence on `verified` events.
 *
 * The driver must redact `commandsRun` (via trace redaction) before emitting
 * `verified`; this reducer validates bounds and policy/independence alignment
 * without mutating evidence.
 */
export function validateVerificationEvidence(
  state: TaskState,
  policy: TaskPolicy,
  evidence: VerificationEvidence,
): TransitionRejection | null {
  if (
    policy.verification !== "parent" &&
    policy.verification !== "dispatch"
  ) {
    return "invalid-verification-evidence";
  }
  if (evidence.mode !== policy.verification) {
    return "invalid-verification-evidence";
  }
  if (evidence.mode === "skip") {
    return "invalid-verification-evidence";
  }
  if (evidence.mode === "parent") {
    if (evidence.rungId !== null) {
      return "invalid-verification-evidence";
    }
  } else if (evidence.mode === "dispatch") {
    if (evidence.rungId === null || evidence.rungId.trim() === "") {
      return "invalid-verification-evidence";
    }
    if (evidence.rungId === state.selectedRung) {
      return "invalid-verification-evidence";
    }
  }

  if (evidence.criteriaChecked.length > MAX_VERIFICATION_CRITERIA_COUNT) {
    return "invalid-verification-evidence";
  }
  for (const criterion of evidence.criteriaChecked) {
    if (typeof criterion !== "string" || criterion.trim() === "") {
      return "invalid-verification-evidence";
    }
    if (criterion.length > MAX_VERIFICATION_CRITERION_LENGTH) {
      return "invalid-verification-evidence";
    }
  }

  if (evidence.commandsRun.length > MAX_VERIFICATION_COMMANDS_COUNT) {
    return "invalid-verification-evidence";
  }
  for (const command of evidence.commandsRun) {
    if (typeof command !== "string") {
      return "invalid-verification-evidence";
    }
    if (command.length > MAX_VERIFICATION_COMMAND_LENGTH) {
      return "invalid-verification-evidence";
    }
    if (VERIFICATION_PATH_PATTERN.test(command)) {
      return "invalid-verification-evidence";
    }
    const redacted =
      boundedStructuredString(command, MAX_VERIFICATION_COMMAND_LENGTH) ??
      sanitizeFailureDetail(command, MAX_VERIFICATION_COMMAND_LENGTH);
    if (redacted !== null && VERIFICATION_PATH_PATTERN.test(redacted)) {
      return "invalid-verification-evidence";
    }
  }

  return null;
}

export type TransitionRejection = (typeof TRANSITION_REJECTIONS)[number];

export type TransitionTableRow = {
  from: TaskStateName | "*";
  eventKind: TaskEvent["kind"];
  when:
    | null
    | { disposition: "retryable" | "terminal" | "null" }
    | {
        verdict: "pass" | "fail-quality" | "fail-approach" | "fail-blocked";
      };
  to: TaskStateName | null;
  via: readonly TaskStateName[];
  guard: string | null;
  producesTaskTransition: boolean;
};

export const TASK_TRANSITION_TABLE: readonly TransitionTableRow[] = [
  {
    from: "intake",
    eventKind: "classified",
    when: null,
    to: "plan",
    via: ["classify"],
    guard: null,
    producesTaskTransition: true,
  },
  {
    from: "plan",
    eventKind: "planned",
    when: null,
    to: "decompose",
    via: [],
    guard: "acceptanceCriteria non-empty for implement routes",
    producesTaskTransition: true,
  },
  {
    from: "plan",
    eventKind: "planned",
    when: null,
    to: "dispatch",
    via: [],
    guard: "acceptanceCriteria non-empty for implement routes",
    producesTaskTransition: true,
  },
  {
    from: "decompose",
    eventKind: "decomposed",
    when: null,
    to: "dispatch",
    via: [],
    guard: "depth < MAX_DELEGATION_DEPTH, fan-out ≤ MAX_DIRECT_FAN_OUT",
    producesTaskTransition: true,
  },
  {
    from: "dispatch",
    eventKind: "dispatch-completed",
    when: { disposition: "retryable" },
    to: null,
    via: [],
    guard: "handled inside traversal; no task transition",
    producesTaskTransition: false,
  },
  {
    from: "dispatch",
    eventKind: "dispatch-completed",
    when: { disposition: "terminal" },
    to: "rejected",
    via: [],
    guard: null,
    producesTaskTransition: true,
  },
  {
    from: "dispatch",
    eventKind: "dispatch-completed",
    when: { disposition: "null" },
    to: "verify",
    via: [],
    guard: null,
    producesTaskTransition: true,
  },
  {
    from: "verify",
    eventKind: "verified",
    when: { verdict: "pass" },
    to: "accepted",
    via: [],
    guard: "codeReview is absent or skip",
    producesTaskTransition: true,
  },
  {
    from: "verify",
    eventKind: "verified",
    when: { verdict: "pass" },
    to: "code-review",
    via: [],
    guard: "codeReview is dispatch",
    producesTaskTransition: true,
  },
  {
    from: "code-review",
    eventKind: "dispatch-completed",
    when: { disposition: "retryable" },
    to: null,
    via: [],
    guard: "handled inside traversal; no task transition",
    producesTaskTransition: false,
  },
  {
    from: "code-review",
    eventKind: "dispatch-completed",
    when: { disposition: "terminal" },
    to: "rejected",
    via: [],
    guard: null,
    producesTaskTransition: true,
  },
  {
    from: "code-review",
    eventKind: "dispatch-completed",
    when: { disposition: "null" },
    to: "accepted",
    via: [],
    guard: null,
    producesTaskTransition: true,
  },
  {
    from: "verify",
    eventKind: "verified",
    when: { verdict: "fail-quality" },
    to: "escalate",
    via: [],
    guard: "all four escalation guards pass",
    producesTaskTransition: true,
  },
  {
    from: "verify",
    eventKind: "verified",
    when: { verdict: "fail-quality" },
    to: "verification-failed",
    via: [],
    guard: "any escalation guard fails",
    producesTaskTransition: true,
  },
  {
    from: "verify",
    eventKind: "verified",
    when: { verdict: "fail-approach" },
    to: "replan",
    via: [],
    guard: "replansUsed < maxReplans",
    producesTaskTransition: true,
  },
  {
    from: "verify",
    eventKind: "verified",
    when: { verdict: "fail-blocked" },
    to: "blocked",
    via: [],
    guard: null,
    producesTaskTransition: true,
  },
  {
    from: "escalate",
    eventKind: "escalation-authorized",
    when: null,
    to: "dispatch",
    via: [],
    guard: "floor + 1 ≤ floorCeiling",
    producesTaskTransition: true,
  },
  {
    from: "escalate",
    eventKind: "escalation-denied",
    when: null,
    to: "verification-failed",
    via: [],
    guard: null,
    producesTaskTransition: true,
  },
  {
    from: "replan",
    eventKind: "planned",
    when: null,
    to: "dispatch",
    via: [],
    guard: null,
    producesTaskTransition: true,
  },
  {
    from: "accepted",
    eventKind: "ship-authorized",
    when: null,
    to: "ship",
    via: [],
    guard: "explicit user authorization; parent-executed",
    producesTaskTransition: true,
  },
  {
    from: "*",
    eventKind: "cancelled",
    when: null,
    to: "cancelled",
    via: [],
    guard: "root cancellation propagation",
    producesTaskTransition: true,
  },
] as const;

const IMPLEMENT_ROUTE: CanonicalCapabilityRouteId =
  "implement.workspace-write.v1";
const VERIFICATION_ROUTE: CanonicalCapabilityRouteId = "check.read-only.v1";

function copyState(state: TaskState): TaskState {
  return {
    ...state,
    acceptanceCriteria: [...state.acceptanceCriteria],
    runIds: [...state.runIds],
  };
}

function explanation(
  state: TaskState,
  event: TaskEvent,
  to: TaskStateName | null,
  rejection: TransitionRejection | null,
  notes: string[] = [],
): TransitionExplanation {
  return {
    from: state.name,
    eventKind: event.kind,
    to,
    rejection,
    notes,
  };
}

function reject(
  state: TaskState,
  event: TaskEvent,
  reason: TransitionRejection,
  notes: string[] = [],
): TaskTransition {
  return {
    ok: false,
    reason,
    explanation: explanation(state, event, null, reason, notes),
  };
}

function accept(
  state: TaskState,
  event: TaskEvent,
  next: TaskState,
  effects: TaskEffect[],
  options: {
    rejection?: TransitionRejection | null;
    notes?: string[];
    explanationTo?: TaskStateName | null;
  } = {},
): TaskTransition {
  return {
    ok: true,
    next,
    effects,
    explanation: explanation(
      state,
      event,
      options.explanationTo === undefined
        ? next.name
        : options.explanationTo,
      options.rejection ?? null,
      options.notes ?? [],
    ),
  };
}

function selectionRequest(
  state: TaskState,
  capabilityRoute = state.capabilityRoute,
  excludedStableId: string | null = null,
): SelectionRequest {
  const request: SelectionRequest = {
    capabilityRoute,
    axis: state.axis,
    capabilityFloor: state.capabilityFloor,
    minimumFloor: state.capabilityFloor,
    // Deliberately not `policy.budget.floorCeiling`: that value caps how far a
    // quality escalation may raise the floor and is enforced only by the
    // escalation guards. `bandCeiling` is the eco selector ceiling, and ordinary
    // task selection runs uncapped.
    bandCeiling: null,
    override: null,
    taskIdentity: state.taskIdentity,
    depth: state.depth,
  };
  if (excludedStableId != null) {
    request.excludedStableId = excludedStableId;
  }
  return request;
}

function dispatchEntryEffects(state: TaskState): TaskEffect[] {
  return [
    { kind: "select", request: selectionRequest(state) },
    { kind: "emit-task-event" },
  ];
}

function annotationEffect(
  runId: string | undefined,
  outcome: Outcome,
): TaskEffect[] {
  return runId === undefined ? [] : [{ kind: "annotate", runId, outcome }];
}

function lastRunId(state: TaskState): string | undefined {
  return state.runIds[state.runIds.length - 1];
}

function terminalEffects(
  state: TaskState,
  outcome: Outcome,
): TaskEffect[] {
  return [
    ...annotationEffect(lastRunId(state), outcome),
    { kind: "emit-task-event" },
  ];
}

function nextEscalationBand(state: TaskState): CapabilityBand | null {
  const next = state.capabilityFloor + 1;
  return next <= 4 ? (next as CapabilityBand) : null;
}

function escalationGuardFailure(
  input: TaskStepInput,
  toBand: CapabilityBand | null,
): TransitionRejection | null {
  const { state, policy, ledger } = input;
  if (state.depth > 0) {
    return "depth-limit-reached";
  }
  if (state.escalationsUsed >= policy.budget.maxEscalations) {
    return "escalation-limit-reached";
  }
  if (toBand === null || toBand > policy.budget.floorCeiling) {
    return "escalation-above-floor-ceiling";
  }
  if (
    policy.authorization.kind === "policy" &&
    toBand > policy.authorization.maxBand
  ) {
    return "escalation-unauthorized";
  }

  const reservationCost = BUDGET_LIMITS_V1.dispatch.cost;
  const allowedCost =
    ledger.remaining.cost * policy.budget.escalationCostFraction;
  if (
    reservationCost > ledger.remaining.cost ||
    reservationCost > allowedCost
  ) {
    return "escalation-budget-exhausted";
  }
  return null;
}

function failQuality(
  input: TaskStepInput,
  event: Extract<TaskEvent, { kind: "verified" }>,
): TaskTransition {
  const toBand = nextEscalationBand(input.state);
  const guardFailure = escalationGuardFailure(input, toBand);
  if (guardFailure !== null) {
    const next = { ...copyState(input.state), name: "verification-failed" as const };
    return accept(
      input.state,
      event,
      next,
      terminalEffects(next, "verification-failed"),
      {
        rejection: guardFailure,
        notes: ["quality escalation guard failed"],
      },
    );
  }

  const next = { ...copyState(input.state), name: "escalate" as const };
  return accept(
    input.state,
    event,
    next,
    [
      {
        kind: "request-authorization",
        toBand: toBand!,
        via: { ...input.policy.authorization },
      },
      { kind: "emit-task-event" },
    ],
    { notes: ["quality escalation requested"] },
  );
}

function dispatchCompletedDisposition(
  disposition: FailureDisposition | null,
): "retryable" | "terminal" | "null" {
  if (disposition === null) {
    return "null";
  }
  return disposition.kind === "retryable" ? "retryable" : "terminal";
}

/**
 * Fold one typed task event over an immutable task state.
 *
 * `ledger` and `nowMs` are inputs for replay parity with selection. The reducer
 * reads only `ledger.remaining.cost`; in particular it never invokes
 * `ledger.clock` or reserves/dispatches work itself.
 */
export function step(input: TaskStepInput): TaskTransition {
  const { state, event, policy } = input;

  if (state.name === "cancelled") {
    return reject(state, event, "root-cancelled");
  }

  if (event.kind === "cancelled") {
    const next = { ...copyState(state), name: "cancelled" as const };
    return accept(state, event, next, [{ kind: "emit-task-event" }]);
  }

  if (state.name === "intake" && event.kind === "classified") {
    const next: TaskState = {
      ...copyState(state),
      name: "plan",
      axis: event.axis,
      capabilityRoute: event.capabilityRoute,
      capabilityFloor: event.floor,
      originalFloor: event.floor,
    };
    return accept(state, event, next, [{ kind: "emit-task-event" }], {
      notes: ["classify is parent-executed in v1"],
    });
  }

  if (state.name === "plan" && event.kind === "planned") {
    if (
      state.capabilityRoute === IMPLEMENT_ROUTE &&
      event.acceptanceCriteria.length === 0
    ) {
      return reject(state, event, "illegal-transition", [
        "implement routes require non-empty acceptance criteria",
      ]);
    }
    const next: TaskState = {
      ...copyState(state),
      name:
        state.capabilityRoute === IMPLEMENT_ROUTE ? "decompose" : "dispatch",
      acceptanceCriteria: [...event.acceptanceCriteria],
    };
    const effects =
      next.name === "dispatch"
        ? dispatchEntryEffects(next)
        : [{ kind: "emit-task-event" } satisfies TaskEffect];
    return accept(state, event, next, effects, {
      notes: [
        next.name === "decompose"
          ? "implement route selected decomposition branch"
          : "non-implement route selected dispatch branch",
      ],
    });
  }

  if (state.name === "decompose" && event.kind === "decomposed") {
    if (
      state.depth >= MAX_DELEGATION_DEPTH ||
      event.childTaskKeys.length > MAX_DIRECT_FAN_OUT
    ) {
      return reject(state, event, "depth-limit-reached", [
        "decomposition exceeds depth or direct fan-out limit",
      ]);
    }
    const next = { ...copyState(state), name: "dispatch" as const };
    return accept(state, event, next, dispatchEntryEffects(next));
  }

  if (
    (state.name === "dispatch" ||
      (state.name === "verify" && policy.verification === "dispatch") ||
      state.name === "code-review") &&
    event.kind === "dispatch-selected"
  ) {
    if (event.decision.outcome === "refused") {
      return reject(state, event, "illegal-transition", [
        `selection refused: ${event.decision.reason}`,
      ]);
    }
    // A work selection records its lead rung so a later dispatched verification
    // can exclude it. A verification selection (from `verify`) does not: the
    // rung under review must keep naming the implementer, not the checker.
    const next: TaskState =
      state.name === "dispatch"
        ? {
            ...copyState(state),
            selectedRung: event.decision.stack[0]?.rungId ?? null,
          }
        : copyState(state);
    return accept(
      state,
      event,
      next,
      [
        { kind: "reserve", taskIdentity: state.taskIdentity },
        { kind: "dispatch", stack: [...event.decision.stack] },
        { kind: "emit-task-event" },
      ],
      { explanationTo: null, notes: ["selection is an internal dispatch step"] },
    );
  }

  if (state.name === "dispatch" && event.kind === "dispatch-completed") {
    const branch = dispatchCompletedDisposition(event.disposition);
    const withRun: TaskState = {
      ...copyState(state),
      runIds: [...state.runIds, event.runId],
    };
    if (branch === "retryable") {
      return accept(state, event, withRun, [], {
        explanationTo: null,
        notes: ["retryable failure remains inside lateral traversal"],
      });
    }
    if (branch === "terminal") {
      const next = { ...withRun, name: "rejected" as const };
      return accept(
        state,
        event,
        next,
        [
          { kind: "annotate", runId: event.runId, outcome: "rejected" },
          { kind: "emit-task-event" },
        ],
        { notes: [`terminal disposition: ${event.disposition!.kind}`] },
      );
    }

    // `skip` is a real policy, not a synonym for parent verification: the task
    // accepts on the completed dispatch itself, with no verify dispatch and no
    // parent verdict to wait for. It stays a policy choice recorded in the
    // explanation, never a default.
    if (policy.verification === "skip") {
      const next = { ...withRun, name: "accepted" as const };
      return accept(state, event, next, terminalEffects(next, "accepted"), {
        notes: ["verification skipped by policy; accepted without a verify dispatch"],
      });
    }

    const next = { ...withRun, name: "verify" as const };
    const effects: TaskEffect[] = [{ kind: "emit-task-event" }];
    if (policy.verification === "dispatch") {
      const implementerStableId = next.selectedRung
        ? parseRungId(next.selectedRung)?.stableId ?? null
        : null;
      effects.unshift({
        kind: "select",
        request: selectionRequest(next, VERIFICATION_ROUTE, implementerStableId),
      });
    }
    return accept(state, event, next, effects);
  }

  if (state.name === "verify" && event.kind === "verified") {
    if (event.verdict.kind !== "fail-blocked") {
      const evidenceFailure = validateVerificationEvidence(
        state,
        policy,
        event.verdict.evidence,
      );
      if (evidenceFailure !== null) {
        return reject(state, event, evidenceFailure);
      }
    }
    if (event.verdict.kind === "pass") {
      if (policy.codeReview === "dispatch") {
        const implementerStableId = state.selectedRung
          ? parseRungId(state.selectedRung)?.stableId ?? null
          : null;
        const next = { ...copyState(state), name: "code-review" as const };
        return accept(state, event, next, [
          {
            kind: "select",
            request: selectionRequest(
              next,
              VERIFICATION_ROUTE,
              implementerStableId,
            ),
          },
          { kind: "emit-task-event" },
        ]);
      }
      const next = { ...copyState(state), name: "accepted" as const };
      return accept(state, event, next, terminalEffects(next, "accepted"));
    }
    if (event.verdict.kind === "fail-quality") {
      return failQuality(input, event);
    }
    if (event.verdict.kind === "fail-approach") {
      if (state.replansUsed >= policy.budget.maxReplans) {
        return reject(state, event, "replan-limit-reached");
      }
      const next = {
        ...copyState(state),
        name: "replan" as const,
        replansUsed: state.replansUsed + 1,
      };
      return accept(state, event, next, [{ kind: "emit-task-event" }]);
    }
    const next = { ...copyState(state), name: "blocked" as const };
    return accept(state, event, next, terminalEffects(next, "blocked"));
  }

  if (state.name === "code-review" && event.kind === "dispatch-completed") {
    const branch = dispatchCompletedDisposition(event.disposition);
    const withRun: TaskState = {
      ...copyState(state),
      runIds: [...state.runIds, event.runId],
    };
    if (branch === "retryable") {
      return accept(state, event, withRun, [], {
        explanationTo: null,
        notes: ["retryable Code Review failure remains inside lateral traversal"],
      });
    }
    if (branch === "terminal") {
      const next = { ...withRun, name: "rejected" as const };
      return accept(state, event, next, [
        { kind: "annotate", runId: event.runId, outcome: "rejected" },
        { kind: "emit-task-event" },
      ]);
    }
    const next = { ...withRun, name: "accepted" as const };
    return accept(state, event, next, terminalEffects(next, "accepted"));
  }

  if (
    state.name === "escalate" &&
    event.kind === "escalation-authorized"
  ) {
    const expectedBand = nextEscalationBand(state);
    if (
      expectedBand === null ||
      event.toBand !== expectedBand ||
      event.toBand > policy.budget.floorCeiling
    ) {
      return reject(state, event, "escalation-above-floor-ceiling");
    }
    if (
      policy.authorization.kind === "policy" &&
      event.toBand > policy.authorization.maxBand
    ) {
      return reject(state, event, "escalation-unauthorized");
    }
    if (state.depth > 0) {
      return reject(state, event, "depth-limit-reached");
    }
    if (state.escalationsUsed >= policy.budget.maxEscalations) {
      return reject(state, event, "escalation-limit-reached");
    }
    // Rechecked here, not just at fail-quality: authorization can arrive after
    // the ledger the fail-quality guard saw has been drained by sibling work,
    // and an authorization is permission to spend, not a reservation.
    const reservationCost = BUDGET_LIMITS_V1.dispatch.cost;
    const allowedCost =
      input.ledger.remaining.cost * policy.budget.escalationCostFraction;
    if (
      reservationCost > input.ledger.remaining.cost ||
      reservationCost > allowedCost
    ) {
      return reject(state, event, "escalation-budget-exhausted");
    }
    const next = {
      ...copyState(state),
      name: "dispatch" as const,
      capabilityFloor: event.toBand,
      escalationsUsed: state.escalationsUsed + 1,
    };
    return accept(
      state,
      event,
      next,
      [
        ...annotationEffect(lastRunId(state), "escalated"),
        ...dispatchEntryEffects(next),
      ],
    );
  }

  if (state.name === "escalate" && event.kind === "escalation-denied") {
    const next = {
      ...copyState(state),
      name: "verification-failed" as const,
    };
    return accept(
      state,
      event,
      next,
      terminalEffects(next, "verification-failed"),
      { notes: [event.reason] },
    );
  }

  if (state.name === "replan" && event.kind === "planned") {
    if (
      state.capabilityRoute === IMPLEMENT_ROUTE &&
      event.acceptanceCriteria.length === 0
    ) {
      return reject(state, event, "illegal-transition", [
        "implement routes require non-empty acceptance criteria",
      ]);
    }
    const next = {
      ...copyState(state),
      name: "dispatch" as const,
      acceptanceCriteria: [...event.acceptanceCriteria],
    };
    return accept(state, event, next, dispatchEntryEffects(next));
  }

  if (state.name === "accepted" && event.kind === "ship-authorized") {
    const next = { ...copyState(state), name: "ship" as const };
    return accept(state, event, next, [{ kind: "emit-task-event" }]);
  }

  return reject(state, event, "illegal-transition");
}
