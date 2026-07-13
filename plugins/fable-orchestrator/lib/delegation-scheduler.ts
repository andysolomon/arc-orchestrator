// Phase-5 parent delegation scheduler: graph state, admission gates, and child
// recommendation intake. Library-only; CLI execution is not activated here.

import {
  createRootBudgetLedger,
  getActiveReservation,
  reconcileDispatch,
  refreshRootWallTime,
  tryReserveDispatch,
  toRoutingTraceV2BudgetContext,
  type BudgetActuals,
  type BudgetClock,
  type CreateRootBudgetLedgerOptions,
  type RootBudgetLedger,
} from "./delegation-budget";
import {
  createCancellationRegistry,
  isRootCancelled,
  propagateRootCancellation,
  rejectAdmissionReason,
  ROOT_WALL_TIME_EXHAUSTED_REASON,
  type CancellationRegistry,
} from "./delegation-cancellation";
import {
  createWorktreeOwnershipRegistry,
  releaseWriteOwnership,
  resolveDispatchWorktreeContext,
  tryAcquireWriteOwnership,
  validateQueuedWorktreePolicy,
  WORKTREE_SANDBOX_POLICY_VERSION,
  type DelegationPermission,
  type WorktreeDispatchContext,
  type WorktreeOwnershipRegistry,
} from "./delegation-worktree-sandbox";
import {
  resolveDelegationRouting,
  type DelegationRoutingInput,
  type DelegationRoutingResult,
  MAX_PREFERRED_CANDIDATE_STABLE_IDS,
} from "./delegation-routing";
import type { RoutingTraceV2Context } from "./engine";

export const DELEGATION_SCHEDULER_POLICY_VERSION = "budget-limits/v1";
export const MAX_DELEGATION_DEPTH = 2;
export const MAX_DIRECT_FAN_OUT = 5;
export const MAX_GLOBAL_ACTIVE_CONCURRENCY = 6;
export const MAX_ROOT_ACTIVE_CONCURRENCY = 3;

export const TASK_IDENTITY_HASH_LENGTH = 12;

export type DelegationIntent = "continue" | "delegate";

export type DelegationRecommendation = {
  delegation: boolean;
  intent?: DelegationIntent;
  requestedRoute?: string;
  preferredCandidateStableIds?: readonly string[];
  failureTrigger?: string | null;
  toughTask?: boolean;
};

export type SchedulerNodeStatus =
  | "queued"
  | "active"
  | "completed"
  | "cancelled";

export type SchedulerNode = {
  taskIdentity: string;
  depth: number;
  parentIdentity: string | null;
  rootIdentity: string;
  runId: string;
  status: SchedulerNodeStatus;
  validatedRouting?: Extract<DelegationRoutingResult, { ok: true }>;
  worktree?: WorktreeDispatchContext;
};

export type ParentSchedulerAuthority = {
  readonly schedulerId: string;
  readonly token: symbol;
};

export type DispatchAdmissionRequest = {
  taskKey: string;
  parentTaskKey: string | null;
  runId: string;
  routing: DelegationRoutingInput;
  recommendation?: DelegationRecommendation;
  checkoutRaw?: string | null;
  writeScopeRaw?: string | null;
  requestedPermissions?: readonly DelegationPermission[] | null;
};

export type DispatchAdmissionSuccess = {
  admitted: true;
  taskIdentity: string;
  depth: number;
  rootIdentity: string;
  routing: Extract<DelegationRoutingResult, { ok: true }>;
};

export type DispatchAdmissionFailure = {
  admitted: false;
  reason: string;
  taskIdentity?: string;
};

export type DispatchAdmissionResult =
  | DispatchAdmissionSuccess
  | DispatchAdmissionFailure;

export type DispatchQueueSuccess = {
  queued: true;
  taskIdentity: string;
  depth: number;
  rootIdentity: string;
  routing: Extract<DelegationRoutingResult, { ok: true }>;
};

export type DispatchQueueResult = DispatchQueueSuccess | DispatchAdmissionFailure;

export type RecommendationSubmissionResult =
  | { accepted: true; taskIdentity: string }
  | { accepted: false; reason: string; taskIdentity?: string };

export type DispatchCompletionResult =
  | { ok: true }
  | { ok: false; reason: string };

export type RootCancellationResult =
  | { ok: true; cancelledTaskIdentities: string[] }
  | { ok: false; reason: string };

export type DelegationSchedulerOptions = {
  clock?: BudgetClock;
};

const CHILD_DISPATCH_FORBIDDEN =
  "delegation-scheduler: child dispatch forbidden; only parent authority may admit";

const NORMALIZED_TASK_IDENTITY_PATTERN = /^[a-f0-9]{12}$/;

type ValidatedDispatch = {
  taskIdentity: string;
  depth: number;
  parentIdentity: string | null;
  rootIdentity: string;
  runId: string;
  routing: Extract<DelegationRoutingResult, { ok: true }>;
  worktree: WorktreeDispatchContext;
};

export function normalizeTaskIdentity(rawKey: string): string {
  if (NORMALIZED_TASK_IDENTITY_PATTERN.test(rawKey)) {
    return rawKey;
  }
  const trimmed = rawKey.trim();
  if (trimmed === "") {
    return "task-empty";
  }
  return new Bun.CryptoHasher("sha256")
    .update(trimmed)
    .digest("hex")
    .slice(0, TASK_IDENTITY_HASH_LENGTH);
}

function normalizeRunId(runId: string): string | null {
  const trimmed = runId.trim();
  return trimmed === "" ? null : trimmed;
}

function validateRecommendation(
  recommendation: DelegationRecommendation,
): string | null {
  if (recommendation.requestedRoute != null) {
    const route = recommendation.requestedRoute.trim();
    if (route === "") {
      return "malformed-route-path";
    }
  }
  if (recommendation.preferredCandidateStableIds != null) {
    if (
      recommendation.preferredCandidateStableIds.length >
      MAX_PREFERRED_CANDIDATE_STABLE_IDS
    ) {
      return "preferred-candidates-overflow";
    }
    for (const candidate of recommendation.preferredCandidateStableIds) {
      if (candidate.trim() === "") {
        return "malformed-preferred-candidate";
      }
    }
  }
  return null;
}

export class DelegationScheduler {
  private readonly authority: ParentSchedulerAuthority;
  private readonly nodes = new Map<string, SchedulerNode>();
  private readonly childrenByParent = new Map<string, Set<string>>();
  private readonly pendingRecommendations = new Map<
    string,
    DelegationRecommendation
  >();
  private globalActiveCount = 0;
  private readonly activeByRoot = new Map<string, number>();
  private readonly rootLedgers = new Map<string, RootBudgetLedger>();
  private readonly cancellationRegistry: CancellationRegistry =
    createCancellationRegistry();
  private readonly clock: BudgetClock;
  private readonly wallTimeCancellingRoots = new Set<string>();
  private readonly worktreeOwnershipRegistry: WorktreeOwnershipRegistry =
    createWorktreeOwnershipRegistry();

  constructor(
    schedulerId = "scheduler-local",
    options: DelegationSchedulerOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
    this.authority = {
      schedulerId: schedulerId.trim() || "scheduler-local",
      token: Symbol("parent-scheduler-authority"),
    };
  }

  getSchedulerId(): string {
    return this.authority.schedulerId;
  }

  issueParentAuthority(): ParentSchedulerAuthority {
    return this.authority;
  }

  getNode(taskIdentity: string): SchedulerNode | undefined {
    return this.nodes.get(taskIdentity);
  }

  getWorktreeContext(taskIdentity: string): WorktreeDispatchContext | undefined {
    return this.nodes.get(taskIdentity)?.worktree;
  }

  getWorktreeSandboxPolicyVersion(): string {
    return WORKTREE_SANDBOX_POLICY_VERSION;
  }

  isCheckoutWriteOwned(checkoutId: string): boolean {
    return this.worktreeOwnershipRegistry.activeWriteByCheckout.has(checkoutId);
  }

  getRootBudgetLedger(rootIdentity: string): RootBudgetLedger | undefined {
    return this.rootLedgers.get(rootIdentity);
  }

  isRootCancelled(rootIdentity: string): boolean {
    return isRootCancelled(this.cancellationRegistry, rootIdentity);
  }

  buildRoutingTraceV2Context(taskIdentity: string): RoutingTraceV2Context | null {
    const node = this.nodes.get(taskIdentity);
    if (!node) {
      return null;
    }
    const ledger = this.rootLedgers.get(node.rootIdentity);
    if (!ledger) {
      return null;
    }
    const rootNode = this.nodes.get(node.rootIdentity);
    if (!rootNode) {
      return null;
    }
    const parentRunId = node.parentIdentity
      ? (this.nodes.get(node.parentIdentity)?.runId ?? null)
      : null;
    const reservation = getActiveReservation(ledger, taskIdentity);
    const budgets = toRoutingTraceV2BudgetContext(ledger, reservation);
    return {
      rootRunId: rootNode.runId,
      parentRunId,
      taskId: taskIdentity,
      depth: node.depth,
      schedulerId: this.authority.schedulerId,
      rootBudget: budgets.rootBudget,
      dispatchBudget: budgets.dispatchBudget,
    };
  }

  submitRecommendation(
    submitterTaskKey: string,
    recommendation: DelegationRecommendation,
  ): RecommendationSubmissionResult {
    const taskIdentity = normalizeTaskIdentity(submitterTaskKey);
    const node = this.nodes.get(taskIdentity);
    if (!node || node.status !== "active") {
      return { accepted: false, reason: "submitter-not-active", taskIdentity };
    }

    const recommendationError = validateRecommendation(recommendation);
    if (recommendationError) {
      return {
        accepted: false,
        reason: recommendationError,
        taskIdentity,
      };
    }

    if (!recommendation.delegation) {
      return { accepted: false, reason: "delegation-not-requested", taskIdentity };
    }

    this.pendingRecommendations.set(taskIdentity, {
      ...recommendation,
      preferredCandidateStableIds: recommendation.preferredCandidateStableIds
        ? [...recommendation.preferredCandidateStableIds]
        : undefined,
    });

    return { accepted: true, taskIdentity };
  }

  peekRecommendation(
    submitterTaskIdentity: string,
  ): DelegationRecommendation | undefined {
    return this.pendingRecommendations.get(submitterTaskIdentity);
  }

  queueDispatch(
    authority: ParentSchedulerAuthority,
    request: DispatchAdmissionRequest,
  ): DispatchQueueResult {
    const validated = this.validateDispatchAdmission(authority, request);
    if (!validated.ok) {
      return validated.failure;
    }

    const node: SchedulerNode = {
      taskIdentity: validated.value.taskIdentity,
      depth: validated.value.depth,
      parentIdentity: validated.value.parentIdentity,
      rootIdentity: validated.value.rootIdentity,
      runId: validated.value.runId,
      status: "queued",
      validatedRouting: validated.value.routing,
      worktree: validated.value.worktree,
    };
    this.nodes.set(validated.value.taskIdentity, node);

    if (validated.value.parentIdentity) {
      const children =
        this.childrenByParent.get(validated.value.parentIdentity) ??
        new Set<string>();
      children.add(validated.value.taskIdentity);
      this.childrenByParent.set(validated.value.parentIdentity, children);
    }

    return {
      queued: true,
      taskIdentity: validated.value.taskIdentity,
      depth: validated.value.depth,
      rootIdentity: validated.value.rootIdentity,
      routing: validated.value.routing,
    };
  }

  startQueuedDispatch(
    authority: ParentSchedulerAuthority,
    taskIdentity: string,
  ): DispatchAdmissionResult {
    if (
      authority.token !== this.authority.token ||
      authority.schedulerId !== this.authority.schedulerId
    ) {
      return { admitted: false, reason: "invalid-parent-authority", taskIdentity };
    }

    const node = this.nodes.get(taskIdentity);
    if (!node) {
      return { admitted: false, reason: "missing-queued-dispatch", taskIdentity };
    }
    if (node.status === "cancelled") {
      return { admitted: false, reason: "dispatch-cancelled", taskIdentity };
    }
    if (node.status !== "queued") {
      return { admitted: false, reason: "dispatch-not-queued", taskIdentity };
    }

    const admissionBlock = rejectAdmissionReason(
      this.cancellationRegistry,
      node.rootIdentity,
    );
    if (admissionBlock) {
      return { admitted: false, reason: admissionBlock, taskIdentity };
    }

    if (this.globalActiveCount >= MAX_GLOBAL_ACTIVE_CONCURRENCY) {
      return {
        admitted: false,
        reason: "global-concurrency-overflow",
        taskIdentity,
      };
    }

    const rootActive = this.activeByRoot.get(node.rootIdentity) ?? 0;
    if (rootActive >= MAX_ROOT_ACTIVE_CONCURRENCY) {
      return {
        admitted: false,
        reason: "root-concurrency-overflow",
        taskIdentity,
      };
    }

    const worktree = node.worktree;
    if (!worktree) {
      return { admitted: false, reason: "missing-worktree-context", taskIdentity };
    }

    const ownership = tryAcquireWriteOwnership(
      this.worktreeOwnershipRegistry,
      taskIdentity,
      worktree,
    );
    if (!ownership.ok) {
      return { admitted: false, reason: ownership.reason, taskIdentity };
    }

    const ledger = this.ensureRootLedger(node.rootIdentity);
    const budgetReserve = tryReserveDispatch(ledger, taskIdentity, node.depth);
    if (!budgetReserve.ok) {
      releaseWriteOwnership(this.worktreeOwnershipRegistry, taskIdentity);
      return { admitted: false, reason: budgetReserve.reason, taskIdentity };
    }

    node.status = "active";
    this.globalActiveCount += 1;
    this.activeByRoot.set(node.rootIdentity, rootActive + 1);

    return {
      admitted: true,
      taskIdentity,
      depth: node.depth,
      rootIdentity: node.rootIdentity,
      routing: node.validatedRouting!,
    };
  }

  admitDispatch(
    authority: ParentSchedulerAuthority,
    request: DispatchAdmissionRequest,
  ): DispatchAdmissionResult {
    const queued = this.queueDispatch(authority, request);
    if (!queued.queued) {
      return queued;
    }
    const started = this.startQueuedDispatch(authority, queued.taskIdentity);
    if (!started.admitted) {
      this.removeQueuedDispatchNode(queued.taskIdentity);
      return started;
    }
    return started;
  }

  completeDispatch(
    authority: ParentSchedulerAuthority,
    taskIdentity: string,
    actuals: BudgetActuals = {},
  ): DispatchCompletionResult {
    return this.finishDispatch(authority, taskIdentity, actuals, "success", "completed");
  }

  cancelDispatch(
    authority: ParentSchedulerAuthority,
    taskIdentity: string,
    actuals: BudgetActuals = {},
  ): DispatchCompletionResult {
    return this.finishDispatch(authority, taskIdentity, actuals, "cancelled", "cancelled");
  }

  cancelRoot(
    authority: ParentSchedulerAuthority,
    rootTaskIdentity: string,
    actualsByTask: Readonly<Record<string, BudgetActuals>> = {},
    reason?: string,
  ): RootCancellationResult {
    if (
      authority.token !== this.authority.token ||
      authority.schedulerId !== this.authority.schedulerId
    ) {
      return { ok: false, reason: "invalid-parent-authority" };
    }

    const rootIdentity = normalizeTaskIdentity(rootTaskIdentity);
    const ledger = this.rootLedgers.get(rootIdentity);

    const cancellableDispatches = [...this.nodes.values()]
      .filter(
        (node) =>
          node.rootIdentity === rootIdentity &&
          (node.status === "active" || node.status === "queued"),
      )
      .map((node) => ({
        taskIdentity: node.taskIdentity,
        status: node.status as "active" | "queued",
      }));

    if (!ledger && cancellableDispatches.length === 0) {
      return { ok: false, reason: "missing-root-ledger" };
    }

    const propagation = propagateRootCancellation(
      this.cancellationRegistry,
      rootIdentity,
      cancellableDispatches.filter((dispatch) => dispatch.status === "active"),
      reason,
    );

    const cancelledTaskIdentities = [...propagation.cancelledTaskIdentities];

    for (const dispatch of cancellableDispatches) {
      const node = this.nodes.get(dispatch.taskIdentity);
      if (!node || node.status === "cancelled" || node.status === "completed") {
        continue;
      }

      if (node.status === "queued") {
        node.status = "cancelled";
        this.pendingRecommendations.delete(dispatch.taskIdentity);
        if (!cancelledTaskIdentities.includes(dispatch.taskIdentity)) {
          cancelledTaskIdentities.push(dispatch.taskIdentity);
        }
        continue;
      }

      if (!ledger || !getActiveReservation(ledger, dispatch.taskIdentity)) {
        releaseWriteOwnership(this.worktreeOwnershipRegistry, dispatch.taskIdentity);
        continue;
      }

      const actuals = actualsByTask[dispatch.taskIdentity] ?? {
        tokenMeasurement: "unknown",
        costMeasurement: "unknown",
        call: 1,
        concurrency: 0,
      };
      reconcileDispatch(ledger, dispatch.taskIdentity, actuals, "cancelled");
      releaseWriteOwnership(this.worktreeOwnershipRegistry, dispatch.taskIdentity);
      node.status = "cancelled";
      this.globalActiveCount = Math.max(0, this.globalActiveCount - 1);
      const rootActive = this.activeByRoot.get(node.rootIdentity) ?? 1;
      this.activeByRoot.set(node.rootIdentity, Math.max(0, rootActive - 1));
      this.pendingRecommendations.delete(dispatch.taskIdentity);
      if (!cancelledTaskIdentities.includes(dispatch.taskIdentity)) {
        cancelledTaskIdentities.push(dispatch.taskIdentity);
      }
    }

    const rootNode = this.nodes.get(rootIdentity);
    if (rootNode && rootNode.status === "active") {
      if (ledger && getActiveReservation(ledger, rootIdentity)) {
        const rootActuals = actualsByTask[rootIdentity] ?? {
          tokenMeasurement: "unknown",
          costMeasurement: "unknown",
          call: 1,
          concurrency: 0,
        };
        reconcileDispatch(ledger, rootIdentity, rootActuals, "cancelled");
      }
      releaseWriteOwnership(this.worktreeOwnershipRegistry, rootIdentity);
      rootNode.status = "cancelled";
      this.globalActiveCount = Math.max(0, this.globalActiveCount - 1);
      this.activeByRoot.set(rootIdentity, 0);
      this.pendingRecommendations.delete(rootIdentity);
      if (!cancelledTaskIdentities.includes(rootIdentity)) {
        cancelledTaskIdentities.push(rootIdentity);
      }
    } else if (rootNode && rootNode.status === "queued") {
      rootNode.status = "cancelled";
      this.pendingRecommendations.delete(rootIdentity);
      if (!cancelledTaskIdentities.includes(rootIdentity)) {
        cancelledTaskIdentities.push(rootIdentity);
      }
    }

    return { ok: true, cancelledTaskIdentities };
  }

  private finishDispatch(
    authority: ParentSchedulerAuthority,
    taskIdentity: string,
    actuals: BudgetActuals,
    outcome: "success" | "cancelled",
    terminalStatus: Extract<SchedulerNodeStatus, "completed" | "cancelled">,
  ): DispatchCompletionResult {
    if (
      authority.token !== this.authority.token ||
      authority.schedulerId !== this.authority.schedulerId
    ) {
      return { ok: false, reason: "invalid-parent-authority" };
    }

    const node = this.nodes.get(taskIdentity);
    if (!node || node.status !== "active") {
      return { ok: false, reason: "task-not-active" };
    }

    const ledger = this.rootLedgers.get(node.rootIdentity);
    if (ledger) {
      const reconciled = reconcileDispatch(ledger, taskIdentity, actuals, outcome);
      if (!reconciled.ok) {
        return { ok: false, reason: reconciled.reason };
      }
    }

    node.status = terminalStatus;
    releaseWriteOwnership(this.worktreeOwnershipRegistry, taskIdentity);
    this.globalActiveCount = Math.max(0, this.globalActiveCount - 1);
    const rootActive = this.activeByRoot.get(node.rootIdentity) ?? 1;
    this.activeByRoot.set(node.rootIdentity, Math.max(0, rootActive - 1));
    this.pendingRecommendations.delete(taskIdentity);

    if (ledger) {
      refreshRootWallTime(ledger);
      if (
        ledger.remaining.wallTimeMs <= 0 &&
        !this.wallTimeCancellingRoots.has(node.rootIdentity)
      ) {
        this.wallTimeCancellingRoots.add(node.rootIdentity);
        this.cancelRoot(
          authority,
          node.rootIdentity,
          {},
          ROOT_WALL_TIME_EXHAUSTED_REASON,
        );
        this.wallTimeCancellingRoots.delete(node.rootIdentity);
      }
    }

    return { ok: true };
  }

  private validateDispatchAdmission(
    authority: ParentSchedulerAuthority,
    request: DispatchAdmissionRequest,
  ):
    | { ok: true; value: ValidatedDispatch }
    | { ok: false; failure: DispatchAdmissionFailure } {
    const taskIdentity = normalizeTaskIdentity(request.taskKey);

    if (
      authority.token !== this.authority.token ||
      authority.schedulerId !== this.authority.schedulerId
    ) {
      return {
        ok: false,
        failure: { admitted: false, reason: "invalid-parent-authority", taskIdentity },
      };
    }
    const runId = normalizeRunId(request.runId);
    if (!runId) {
      return {
        ok: false,
        failure: { admitted: false, reason: "missing-run-id", taskIdentity },
      };
    }

    let depth = 0;
    let parentIdentity: string | null = null;
    let rootIdentity = taskIdentity;

    if (request.parentTaskKey != null) {
      parentIdentity = normalizeTaskIdentity(request.parentTaskKey);
      const parent = this.nodes.get(parentIdentity);
      if (!parent) {
        return {
          ok: false,
          failure: { admitted: false, reason: "missing-parent", taskIdentity },
        };
      }

      rootIdentity = parent.rootIdentity;
      const admissionBlock = rejectAdmissionReason(
        this.cancellationRegistry,
        rootIdentity,
      );
      if (admissionBlock) {
        return {
          ok: false,
          failure: { admitted: false, reason: admissionBlock, taskIdentity },
        };
      }

      if (parent.status !== "active" && parent.status !== "completed") {
        return {
          ok: false,
          failure: { admitted: false, reason: "parent-not-admissible", taskIdentity },
        };
      }

      depth = parent.depth + 1;

      if (depth > MAX_DELEGATION_DEPTH) {
        return {
          ok: false,
          failure: { admitted: false, reason: "depth-overflow", taskIdentity },
        };
      }

      if (this.hasAncestorIdentity(parentIdentity, taskIdentity)) {
        return {
          ok: false,
          failure: {
            admitted: false,
            reason: "ancestor-identity-repeat",
            taskIdentity,
          },
        };
      }

      const childCount = this.childrenByParent.get(parentIdentity)?.size ?? 0;
      if (childCount >= MAX_DIRECT_FAN_OUT) {
        return {
          ok: false,
          failure: { admitted: false, reason: "fan-out-overflow", taskIdentity },
        };
      }
    } else {
      const admissionBlock = rejectAdmissionReason(
        this.cancellationRegistry,
        rootIdentity,
      );
      if (admissionBlock) {
        return {
          ok: false,
          failure: { admitted: false, reason: admissionBlock, taskIdentity },
        };
      }
    }

    if (this.isTaskTracked(taskIdentity)) {
      return {
        ok: false,
        failure: {
          admitted: false,
          reason: "duplicate-active-task-identity",
          taskIdentity,
        },
      };
    }

    const routingInput = this.mergeRoutingInput(request);
    const routing = resolveDelegationRouting(routingInput);
    if (!routing.ok) {
      return {
        ok: false,
        failure: {
          admitted: false,
          reason: routing.reasons[0] ?? "routing-rejected",
          taskIdentity,
        },
      };
    }

    const parentNode = parentIdentity ? this.nodes.get(parentIdentity) : null;
    const worktreeResolved = resolveDispatchWorktreeContext({
      parentContext: parentNode?.worktree ?? null,
      routeSandbox: routing.fixedContract.sandbox,
      checkoutRaw: request.checkoutRaw,
      writeScopeRaw: request.writeScopeRaw,
      requestedPermissions: request.requestedPermissions,
    });
    if (!worktreeResolved.ok) {
      return {
        ok: false,
        failure: {
          admitted: false,
          reason: worktreeResolved.reason,
          taskIdentity,
        },
      };
    }

    const queuePolicy = validateQueuedWorktreePolicy(worktreeResolved.context);
    if (!queuePolicy.ok) {
      return {
        ok: false,
        failure: {
          admitted: false,
          reason: queuePolicy.reason,
          taskIdentity,
        },
      };
    }

    return {
      ok: true,
      value: {
        taskIdentity,
        depth,
        parentIdentity,
        rootIdentity,
        runId,
        routing,
        worktree: worktreeResolved.context,
      },
    };
  }

  private ensureRootLedger(rootIdentity: string): RootBudgetLedger {
    const existing = this.rootLedgers.get(rootIdentity);
    if (existing) {
      return existing;
    }
    const options: CreateRootBudgetLedgerOptions = { clock: this.clock };
    const ledger = createRootBudgetLedger(rootIdentity, options);
    this.rootLedgers.set(rootIdentity, ledger);
    return ledger;
  }

  private mergeRoutingInput(
    request: DispatchAdmissionRequest,
  ): DelegationRoutingInput {
    const recommendation = request.recommendation;
    return {
      requestedRoute:
        request.routing.requestedRoute ??
        recommendation?.requestedRoute ??
        "",
      preferredCandidateStableIds:
        request.routing.preferredCandidateStableIds ??
        recommendation?.preferredCandidateStableIds,
      failureTrigger:
        request.routing.failureTrigger ?? recommendation?.failureTrigger ?? null,
      exhaustedCandidateStableId:
        request.routing.exhaustedCandidateStableId ?? null,
      explicitParentAuthorization:
        request.routing.explicitParentAuthorization ?? false,
      toughTask: request.routing.toughTask ?? recommendation?.toughTask ?? false,
    };
  }

  private isTaskTracked(taskIdentity: string): boolean {
    const node = this.nodes.get(taskIdentity);
    return node?.status === "active" || node?.status === "queued";
  }

  private removeQueuedDispatchNode(taskIdentity: string): void {
    const node = this.nodes.get(taskIdentity);
    if (!node || node.status !== "queued") {
      return;
    }

    this.nodes.delete(taskIdentity);

    if (node.parentIdentity) {
      const children = this.childrenByParent.get(node.parentIdentity);
      children?.delete(taskIdentity);
      if (children && children.size === 0) {
        this.childrenByParent.delete(node.parentIdentity);
      }
    }
  }

  private hasAncestorIdentity(
    parentIdentity: string,
    candidateIdentity: string,
  ): boolean {
    let current: string | null = parentIdentity;
    while (current != null) {
      if (current === candidateIdentity) {
        return true;
      }
      current = this.nodes.get(current)?.parentIdentity ?? null;
    }
    return false;
  }

}

export function rejectChildDispatch(): DispatchAdmissionFailure {
  return { admitted: false, reason: CHILD_DISPATCH_FORBIDDEN };
}
