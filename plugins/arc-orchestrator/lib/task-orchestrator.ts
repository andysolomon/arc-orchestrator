// Phase 14.8: effect-driving driver above DelegationScheduler (library-only; not CLI-wired).

import type { Outcome } from "./annotation";
import {
  select,
  type SelectionDecision,
  type SelectionInputs,
  type SelectionRequest,
  type SelectedRung,
} from "./capability-selection";
import {
  BUDGET_LIMITS_V1,
  type BudgetActuals,
  type RootBudgetLedger,
} from "./delegation-budget";
import {
  DelegationScheduler,
  normalizeTaskIdentity,
  type DispatchAdmissionRequest,
  type ParentSchedulerAuthority,
} from "./delegation-scheduler";
import type { DelegationRoutingInput } from "./delegation-routing";
import {
  appendTaskEventsRecord,
  DEFAULT_TASK_EVENTS_LIMIT,
  readTaskEventsJsonl,
  replayTaskEvents,
  taskEventsPath,
  TASK_EVENTS_CONTRACT,
  TASK_EVENTS_SCHEMA_VERSION,
  type TaskEventsReplayResult,
  type TaskEventsSeedRecord,
} from "./task-events";
import {
  step,
  TASK_MACHINE_SCHEMA_VERSION,
  type EscalationAuthorization,
  type TaskEffect,
  type TaskEvent,
  type TaskPolicy,
  type TaskState,
  type TaskTransition,
  type TransitionRejection,
} from "./task-machine";
import type { FailureDisposition } from "./failure-classification";
import type { CapabilityBand } from "./capability-snapshot";

export type TaskAnnotationSink = (
  runId: string,
  outcome: Outcome,
) => void | Promise<void>;

export type TaskDispatchExecutionInput = {
  taskIdentity: string;
  runId: string;
  stack: SelectedRung[];
  state: TaskState;
  escalationOf?: string;
};

export type TaskDispatchExecutionResult = {
  runId: string;
  disposition: FailureDisposition | null;
  actuals?: BudgetActuals;
};

export type TaskDispatchExecutor = (
  input: TaskDispatchExecutionInput,
) => Promise<TaskDispatchExecutionResult>;

export type AuthorizationRequest = {
  taskIdentity: string;
  toBand: CapabilityBand;
  via: EscalationAuthorization;
};

export type TaskOrchestratorDeps = {
  scheduler: DelegationScheduler;
  authority?: ParentSchedulerAuthority;
  taskEventsDirectory: string;
  buildSelectionInputs: (
    request: SelectionRequest,
    session: TaskSession,
  ) => SelectionInputs;
  selectFn?: (inputs: SelectionInputs) => SelectionDecision;
  routingForStack: (
    stack: SelectedRung[],
    state: TaskState,
  ) => DelegationRoutingInput;
  executeDispatch: TaskDispatchExecutor;
  annotate?: TaskAnnotationSink;
  onAuthorizationRequired?: (
    request: AuthorizationRequest,
  ) => void | Promise<void>;
  checkoutRaw?: string;
  taskEventsLimit?: number;
  nowMs?: () => number;
};

export type StartTaskInput = {
  taskKey: string;
  parentTaskKey?: string | null;
  state: TaskState;
  policy: TaskPolicy;
  checkoutRaw?: string;
};

export type TaskSession = {
  taskKey: string;
  taskIdentity: string;
  parentTaskKey: string | null;
  state: TaskState;
  policy: TaskPolicy;
  sequence: number;
  checkoutRaw?: string;
  pendingRunId?: string;
  pendingStack?: SelectedRung[];
  pendingEscalationOf?: string;
};

export type ApplyEventResult =
  | {
      ok: true;
      transition: TaskTransition & { ok: true };
      admissionDenied?: string;
    }
  | {
      ok: false;
      reason: TransitionRejection | "admission-denied";
      detail?: string;
    };

export type TaskOrchestrator = {
  startTask(input: StartTaskInput): TaskSession;
  applyEvent(session: TaskSession, event: TaskEvent): Promise<ApplyEventResult>;
  cancelRoot(
    rootTaskKey: string,
    reason?: string,
  ): Promise<
    | { ok: true; cancelledTaskIdentities: string[] }
    | { ok: false; reason: string }
  >;
  replay(taskIdentity?: string): TaskEventsReplayResult;
  getSession(taskIdentity: string): TaskSession | undefined;
};

export function createTaskOrchestrator(
  deps: TaskOrchestratorDeps,
): TaskOrchestrator {
  const authority =
    deps.authority ?? deps.scheduler.issueParentAuthority();
  const selectFn = deps.selectFn ?? select;
  const limit = deps.taskEventsLimit ?? DEFAULT_TASK_EVENTS_LIMIT;
  const eventsPath = () => taskEventsPath(deps.taskEventsDirectory);
  const now = () => deps.nowMs?.() ?? Date.now();

  const sessions = new Map<string, TaskSession>();

  function ledgerFor(session: TaskSession): RootBudgetLedger {
    const ledger = deps.scheduler.getRootBudgetLedger(session.state.rootIdentity);
    if (ledger) {
      return ledger;
    }
    return {
      rootIdentity: session.state.rootIdentity,
      limits: { ...BUDGET_LIMITS_V1.root },
      consumed: {
        token: 0,
        wallTimeMs: 0,
        call: 0,
        cost: 0,
        concurrency: 0,
      },
      remaining: { ...BUDGET_LIMITS_V1.root },
      reservations: new Map(),
      createdAtMs: now(),
      clock: () => {
        throw new Error("task orchestrator must not read ledger.clock in step()");
      },
    };
  }

  function remainingBudgetCost(session: TaskSession): number {
    return ledgerFor(session).remaining.cost;
  }

  function persistSeed(session: TaskSession): void {
    const record: TaskEventsSeedRecord = {
      contract: TASK_EVENTS_CONTRACT,
      schema: TASK_EVENTS_SCHEMA_VERSION,
      kind: "seed",
      taskIdentity: session.taskIdentity,
      sequence: 0,
      state: structuredClone(session.state),
    };
    appendTaskEventsRecord(eventsPath(), record, limit);
    session.sequence = 1;
  }

  function persistStepEvent(session: TaskSession, event: TaskEvent): void {
    appendTaskEventsRecord(
      eventsPath(),
      {
        contract: TASK_EVENTS_CONTRACT,
        schema: TASK_EVENTS_SCHEMA_VERSION,
        kind: "event",
        taskIdentity: session.taskIdentity,
        sequence: session.sequence,
        event: structuredClone(event),
        policy: structuredClone(session.policy),
        remainingBudgetCost: remainingBudgetCost(session),
        nowMs: now(),
      },
      limit,
    );
    session.sequence += 1;
  }

  async function processEffects(
    session: TaskSession,
    effects: readonly TaskEffect[],
    triggeringEvent: TaskEvent,
    stateBeforeStep: TaskState,
    sequenceBeforeStep: number,
  ): Promise<{ admissionDenied?: string; rolledBack?: boolean }> {
    const deferEmitUntilReserveSucceeds = effects.some(
      (effect) => effect.kind === "reserve" || effect.kind === "dispatch",
    );
    const emitEffects = effects.filter(
      (effect): effect is Extract<TaskEffect, { kind: "emit-task-event" }> =>
        effect.kind === "emit-task-event",
    );
    const otherEffects = effects.filter(
      (
        effect,
      ): effect is Exclude<TaskEffect, { kind: "emit-task-event" }> =>
        effect.kind !== "emit-task-event",
    );
    let emitPersisted = false;

    function persistEmitEffects(): void {
      if (emitPersisted) {
        return;
      }
      for (const effect of emitEffects) {
        persistStepEvent(session, triggeringEvent);
        void effect;
      }
      emitPersisted = true;
    }

    if (!deferEmitUntilReserveSucceeds) {
      persistEmitEffects();
    }

    for (const effect of otherEffects) {
      switch (effect.kind) {
        case "select": {
          const inputs = deps.buildSelectionInputs(effect.request, session);
          const decision = selectFn(inputs);
          const nested = await applyEvent(session, {
            kind: "dispatch-selected",
            decision,
          });
          if (!nested.ok) {
            return {};
          }
          if (nested.admissionDenied) {
            return { admissionDenied: nested.admissionDenied, rolledBack: true };
          }
          break;
        }

        case "reserve": {
          const runId = crypto.randomUUID();
          session.pendingRunId = runId;
          const stack = session.pendingStack;
          if (!stack || stack.length === 0) {
            throw new Error("reserve effect requires pending dispatch stack");
          }
          const request: DispatchAdmissionRequest = {
            taskKey: session.taskKey,
            parentTaskKey: session.parentTaskKey,
            runId,
            routing: deps.routingForStack(stack, session.state),
            ...(session.parentTaskKey == null
              ? {
                  checkoutRaw:
                    session.checkoutRaw ?? deps.checkoutRaw ?? "/tmp/arc-orchestrator-checkout",
                }
              : {}),
          };
          const admission = deps.scheduler.admitDispatch(authority, request);
          if (!admission.admitted) {
            session.state = structuredClone(stateBeforeStep);
            session.sequence = sequenceBeforeStep;
            session.pendingRunId = undefined;
            session.pendingStack = undefined;
            return { admissionDenied: admission.reason, rolledBack: true };
          }
          session.taskIdentity = admission.taskIdentity;
          sessions.set(session.taskIdentity, session);
          break;
        }

        case "dispatch": {
          persistEmitEffects();
          session.pendingStack = [...effect.stack];
          const runId = session.pendingRunId;
          if (!runId) {
            throw new Error("dispatch effect requires a reserved runId");
          }
          const escalationOf = session.pendingEscalationOf;
          session.pendingEscalationOf = undefined;

          const execution = await deps.executeDispatch({
            taskIdentity: session.taskIdentity,
            runId,
            stack: effect.stack,
            state: session.state,
            ...(escalationOf ? { escalationOf } : {}),
          });

          session.pendingRunId = undefined;
          session.pendingStack = undefined;

          const actuals: BudgetActuals = execution.actuals ?? {
            token: 0,
            wallTimeMs: 0,
            call: 1,
            cost: 0,
            concurrency: 1,
          };

          if (session.state.name === "cancelled") {
            deps.scheduler.cancelDispatch(
              authority,
              session.taskIdentity,
              actuals,
            );
            break;
          }

          if (
            execution.disposition === null ||
            execution.disposition.kind === "terminal" ||
            execution.disposition.kind === "retryable"
          ) {
            // A retryable disposition closes this admitted scheduler attempt;
            // any later retry is a fresh dispatch attempt.
            deps.scheduler.completeDispatch(
              authority,
              session.taskIdentity,
              actuals,
            );
          }

          const completed = await applyEvent(session, {
            kind: "dispatch-completed",
            runId: execution.runId,
            disposition: execution.disposition,
          });
          if (!completed.ok) {
            return {};
          }
          if (completed.admissionDenied) {
            return {
              admissionDenied: completed.admissionDenied,
              rolledBack: true,
            };
          }
          break;
        }

        case "annotate":
          await deps.annotate?.(effect.runId, effect.outcome);
          if (effect.outcome === "escalated") {
            session.pendingEscalationOf = effect.runId;
          }
          break;

        case "request-authorization":
          await deps.onAuthorizationRequired?.({
            taskIdentity: session.taskIdentity,
            toBand: effect.toBand,
            via: effect.via,
          });
          break;

        default: {
          const _exhaustive: never = effect;
          throw new Error(`unsupported effect: ${JSON.stringify(_exhaustive)}`);
        }
      }
    }

    persistEmitEffects();

    return {};
  }

  async function applyEvent(
    session: TaskSession,
    event: TaskEvent,
  ): Promise<ApplyEventResult> {
    const stateBeforeStep = structuredClone(session.state);
    const sequenceBeforeStep = session.sequence;

    const transition = step({
      state: session.state,
      event,
      policy: session.policy,
      ledger: ledgerFor(session),
      nowMs: now(),
    });

    if (!transition.ok) {
      return { ok: false, reason: transition.reason };
    }

    session.state = transition.next;

    const emitsEvent = transition.effects.some(
      (effect) => effect.kind === "emit-task-event",
    );
    if (!emitsEvent) {
      persistStepEvent(session, event);
    }

    if (event.kind === "dispatch-selected" && event.decision.outcome === "selected") {
      session.pendingStack = [...event.decision.stack];
    }

    const effectResult = await processEffects(
      session,
      transition.effects,
      event,
      stateBeforeStep,
      sequenceBeforeStep,
    );

    if (effectResult.rolledBack) {
      return {
        ok: true,
        transition,
        admissionDenied: effectResult.admissionDenied,
      };
    }

    return {
      ok: true,
      transition,
      ...(effectResult.admissionDenied
        ? { admissionDenied: effectResult.admissionDenied }
        : {}),
    };
  }

  function startTask(input: StartTaskInput): TaskSession {
    const taskIdentity = normalizeTaskIdentity(input.taskKey);
    const session: TaskSession = {
      taskKey: input.taskKey,
      taskIdentity,
      parentTaskKey: input.parentTaskKey ?? null,
      state: {
        ...input.state,
        schemaVersion: TASK_MACHINE_SCHEMA_VERSION,
        taskIdentity,
      },
      policy: structuredClone(input.policy),
      sequence: 0,
      ...(input.checkoutRaw ? { checkoutRaw: input.checkoutRaw } : {}),
    };
    sessions.set(taskIdentity, session);
    persistSeed(session);
    return session;
  }

  async function cancelRoot(
    rootTaskKey: string,
    reason = "root cancelled",
  ): Promise<
    | { ok: true; cancelledTaskIdentities: string[] }
    | { ok: false; reason: string }
  > {
    const result = deps.scheduler.cancelRoot(authority, rootTaskKey, {}, reason);
    if (!result.ok) {
      return result;
    }

    for (const taskIdentity of result.cancelledTaskIdentities) {
      const session = sessions.get(taskIdentity);
      if (!session || session.state.name === "cancelled") {
        continue;
      }
      await applyEvent(session, { kind: "cancelled", reason });
    }

    return result;
  }

  function replay(taskIdentity?: string): TaskEventsReplayResult {
    const parsed = readTaskEventsJsonl(eventsPath());
    return replayTaskEvents(parsed.records, taskIdentity);
  }

  function getSession(taskIdentity: string): TaskSession | undefined {
    return sessions.get(taskIdentity);
  }

  return {
    startTask,
    applyEvent,
    cancelRoot,
    replay,
    getSession,
  };
}
