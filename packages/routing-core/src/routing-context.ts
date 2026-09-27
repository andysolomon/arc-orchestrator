// The serializable input to a routing evaluation: what the runtime observed
// (or a simulator posits) about the task, the world, and the budget. Every
// time-dependent value is injected; nothing here is read from a clock.

import type { AvailabilityState } from "./availability";
import type { BudgetState } from "./budget";
import type { RungId } from "./model-schema";
import type { WorkloadEvidence } from "./workload-profile";
import type { Effort, TaskPhase, WorkloadClass } from "./vocabulary";

export const ROUTING_CONTEXT_VERSION = "routing-context/v1" as const;

export type RoutingOverride = {
  // A stable id or any registry label; resolved against the registry.
  model: string;
  effort?: Effort | null;
};

export type RoutingContext = {
  phase: TaskPhase;
  // Explicit class, as `--workload-class` supplies it. Wins over a profile.
  workloadClass?: WorkloadClass | null;
  // Structured evidence, profiled when the class is absent (and reported as a
  // disagreement when both are present).
  evidence?: WorkloadEvidence | null;
  // Explicit public route pin (`--route`), e.g. "sol-implement".
  requestedAlias?: string | null;
  override?: RoutingOverride | null;
  availability?: AvailabilityState | null;
  budget?: BudgetState | null;
  // Verification independence: the rung / model that produced the work.
  excludedRung?: RungId | null;
  excludedStableId?: string | null;
  nowMs: number;
  taskIdentity?: string | null;
};
