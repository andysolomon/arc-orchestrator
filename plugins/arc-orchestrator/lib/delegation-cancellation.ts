// Root cancellation propagation for parent-scheduled delegation. Library-only.

export const ROOT_CANCELLED_REASON = "root-cancelled";
export const ROOT_WALL_TIME_EXHAUSTED_REASON = "budget-wall-time-exhausted-cancelled";

export type RootCancellationRecord = {
  cancelled: boolean;
  reason: string;
};

export type CancellationRegistry = Map<string, RootCancellationRecord>;

export function createCancellationRegistry(): CancellationRegistry {
  return new Map();
}

export function isRootCancelled(
  registry: CancellationRegistry,
  rootIdentity: string,
): boolean {
  return registry.get(rootIdentity)?.cancelled === true;
}

export function cancellationReason(
  registry: CancellationRegistry,
  rootIdentity: string,
): string | null {
  const record = registry.get(rootIdentity);
  return record?.cancelled ? record.reason : null;
}

export function markRootCancelled(
  registry: CancellationRegistry,
  rootIdentity: string,
  reason = ROOT_CANCELLED_REASON,
): void {
  registry.set(rootIdentity, { cancelled: true, reason });
}

export type ActiveDispatch = {
  taskIdentity: string;
  status: "active";
};

export type CancelPropagationResult = {
  cancelledTaskIdentities: string[];
  reconciledTaskIdentities: string[];
};

export function propagateRootCancellation(
  registry: CancellationRegistry,
  rootIdentity: string,
  activeDispatches: readonly ActiveDispatch[],
  reason = ROOT_CANCELLED_REASON,
): CancelPropagationResult {
  markRootCancelled(registry, rootIdentity, reason);
  return {
    cancelledTaskIdentities: activeDispatches.map(
      (dispatch) => dispatch.taskIdentity,
    ),
    reconciledTaskIdentities: [],
  };
}

export function rejectAdmissionReason(
  registry: CancellationRegistry,
  rootIdentity: string,
): string | null {
  return cancellationReason(registry, rootIdentity);
}
