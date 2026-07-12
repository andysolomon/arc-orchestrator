// Phase-5 parent delegation scheduler: graph state, admission gates, and child
// recommendation intake. Library-only; CLI execution is not activated here.

import {
  resolveDelegationRouting,
  type DelegationRoutingInput,
  type DelegationRoutingResult,
  MAX_PREFERRED_CANDIDATE_STABLE_IDS,
} from "./delegation-routing";

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

export type SchedulerNodeStatus = "active" | "completed" | "cancelled";

export type SchedulerNode = {
  taskIdentity: string;
  depth: number;
  parentIdentity: string | null;
  rootIdentity: string;
  runId: string;
  status: SchedulerNodeStatus;
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

export type RecommendationSubmissionResult =
  | { accepted: true; taskIdentity: string }
  | { accepted: false; reason: string; taskIdentity?: string };

const CHILD_DISPATCH_FORBIDDEN =
  "delegation-scheduler: child dispatch forbidden; only parent authority may admit";

const NORMALIZED_TASK_IDENTITY_PATTERN = /^[a-f0-9]{12}$/;

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

  constructor(schedulerId = "scheduler-local") {
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

  admitDispatch(
    authority: ParentSchedulerAuthority,
    request: DispatchAdmissionRequest,
  ): DispatchAdmissionResult {
    const taskIdentity = normalizeTaskIdentity(request.taskKey);

    if (
      authority.token !== this.authority.token ||
      authority.schedulerId !== this.authority.schedulerId
    ) {
      return { admitted: false, reason: "invalid-parent-authority", taskIdentity };
    }
    const runId = normalizeRunId(request.runId);
    if (!runId) {
      return { admitted: false, reason: "missing-run-id", taskIdentity };
    }

    let depth = 0;
    let parentIdentity: string | null = null;
    let rootIdentity = taskIdentity;

    if (request.parentTaskKey != null) {
      parentIdentity = normalizeTaskIdentity(request.parentTaskKey);
      const parent = this.nodes.get(parentIdentity);
      if (!parent) {
        return { admitted: false, reason: "missing-parent", taskIdentity };
      }
      if (parent.status !== "active" && parent.status !== "completed") {
        return { admitted: false, reason: "parent-not-admissible", taskIdentity };
      }

      depth = parent.depth + 1;
      rootIdentity = parent.rootIdentity;

      if (depth > MAX_DELEGATION_DEPTH) {
        return { admitted: false, reason: "depth-overflow", taskIdentity };
      }

      if (this.hasAncestorIdentity(parentIdentity, taskIdentity)) {
        return {
          admitted: false,
          reason: "ancestor-identity-repeat",
          taskIdentity,
        };
      }

      const childCount = this.childrenByParent.get(parentIdentity)?.size ?? 0;
      if (childCount >= MAX_DIRECT_FAN_OUT) {
        return { admitted: false, reason: "fan-out-overflow", taskIdentity };
      }
    }

    if (this.isTaskActive(taskIdentity)) {
      return {
        admitted: false,
        reason: "duplicate-active-task-identity",
        taskIdentity,
      };
    }

    if (this.globalActiveCount >= MAX_GLOBAL_ACTIVE_CONCURRENCY) {
      return {
        admitted: false,
        reason: "global-concurrency-overflow",
        taskIdentity,
      };
    }

    const rootActive = this.activeByRoot.get(rootIdentity) ?? 0;
    if (rootActive >= MAX_ROOT_ACTIVE_CONCURRENCY) {
      return {
        admitted: false,
        reason: "root-concurrency-overflow",
        taskIdentity,
      };
    }

    const routingInput = this.mergeRoutingInput(request);
    const routing = resolveDelegationRouting(routingInput);
    if (!routing.ok) {
      return {
        admitted: false,
        reason: routing.reasons[0] ?? "routing-rejected",
        taskIdentity,
      };
    }

    const node: SchedulerNode = {
      taskIdentity,
      depth,
      parentIdentity,
      rootIdentity,
      runId,
      status: "active",
    };
    this.nodes.set(taskIdentity, node);

    if (parentIdentity) {
      const children =
        this.childrenByParent.get(parentIdentity) ?? new Set<string>();
      children.add(taskIdentity);
      this.childrenByParent.set(parentIdentity, children);
    }

    this.globalActiveCount += 1;
    this.activeByRoot.set(rootIdentity, rootActive + 1);

    return {
      admitted: true,
      taskIdentity,
      depth,
      rootIdentity,
      routing,
    };
  }

  completeDispatch(
    authority: ParentSchedulerAuthority,
    taskIdentity: string,
  ): { ok: true } | { ok: false; reason: string } {
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

    node.status = "completed";
    this.globalActiveCount = Math.max(0, this.globalActiveCount - 1);
    const rootActive = this.activeByRoot.get(node.rootIdentity) ?? 1;
    this.activeByRoot.set(node.rootIdentity, Math.max(0, rootActive - 1));
    this.pendingRecommendations.delete(taskIdentity);

    return { ok: true };
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

  private isTaskActive(taskIdentity: string): boolean {
    const node = this.nodes.get(taskIdentity);
    return node?.status === "active";
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
