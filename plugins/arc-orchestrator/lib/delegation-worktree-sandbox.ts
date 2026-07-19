// worktree-sandbox/v1 permission narrowing and checkout write ownership for
// parent-scheduled delegation. Library-only; no filesystem or git worktrees.

import { normalizeCheckoutId } from "./trace-schema";
import type { TraceSandbox } from "./trace-schema";

export const WORKTREE_SANDBOX_POLICY_VERSION = "worktree-sandbox/v1";

export const CHECKOUT_WRITE_CONFLICT_REASON = "checkout-write-conflict";
export const PERMISSION_ENVELOPE_BROADER_THAN_PARENT_REASON =
  "permission-envelope-broader-than-parent";
export const MISSING_CHECKOUT_IDENTITY_REASON = "missing-checkout-identity";
export const INVALID_WRITE_SCOPE_FOR_READ_ONLY_REASON =
  "invalid-write-scope-for-read-only";
export const INCONSISTENT_READ_ONLY_WRITE_PERMISSIONS_REASON =
  "inconsistent-read-only-write-permissions";
export const PERMISSION_NOT_IN_ROUTE_MAXIMUM_REASON =
  "permission-not-in-route-maximum";

export type DelegationPermission = "read" | "write";

export const DELEGATION_PERMISSIONS: readonly DelegationPermission[] = [
  "read",
  "write",
];

export const ROUTE_DEFAULT_PERMISSIONS: Record<
  TraceSandbox,
  readonly DelegationPermission[]
> = {
  "read-only": ["read"],
  "workspace-write": ["read", "write"],
};

const SANDBOX_STRICTNESS: Record<TraceSandbox, number> = {
  "read-only": 2,
  "workspace-write": 1,
};

export type PermissionEnvelope = {
  sandbox: TraceSandbox;
  permissions: readonly DelegationPermission[];
};

export type WorktreeDispatchContext = {
  checkoutId: string;
  writeScopeId: string | null;
  envelope: PermissionEnvelope;
};

export type CheckoutWriteState = {
  checkoutId: string;
  writeScopeId: string | null;
  holder: string;
};

export type WorktreeOwnershipRegistry = {
  activeWriteByCheckout: Map<string, CheckoutWriteState>;
  activeWriteByTask: Map<string, { checkoutId: string }>;
};

export function createWorktreeOwnershipRegistry(): WorktreeOwnershipRegistry {
  return {
    activeWriteByCheckout: new Map(),
    activeWriteByTask: new Map(),
  };
}

export function normalizeWriteScopeId(rawScope: string): string {
  const trimmed = rawScope.trim();
  if (trimmed === "") {
    return "scope-empty";
  }
  return normalizeCheckoutId(trimmed);
}

export function normalizePermissions(
  permissions: readonly DelegationPermission[],
): readonly DelegationPermission[] {
  const unique = new Set<DelegationPermission>();
  for (const permission of permissions) {
    unique.add(permission);
  }
  return DELEGATION_PERMISSIONS.filter((permission) => unique.has(permission));
}

export function envelopeFromSandbox(sandbox: TraceSandbox): PermissionEnvelope {
  return {
    sandbox,
    permissions: ROUTE_DEFAULT_PERMISSIONS[sandbox],
  };
}

export function effectiveSandboxFromPermissions(
  permissions: readonly DelegationPermission[],
): TraceSandbox {
  return permissions.includes("write") ? "workspace-write" : "read-only";
}

export function envelopeRequiresWriteOwnership(
  envelope: PermissionEnvelope,
): boolean {
  return envelope.permissions.includes("write");
}

function isPermissionSubset(
  child: readonly DelegationPermission[],
  parent: readonly DelegationPermission[],
): boolean {
  return child.every((permission) => parent.includes(permission));
}

export function isEnvelopeEqualOrNarrower(
  child: PermissionEnvelope,
  parent: PermissionEnvelope,
): boolean {
  return (
    SANDBOX_STRICTNESS[child.sandbox] >= SANDBOX_STRICTNESS[parent.sandbox] &&
    isPermissionSubset(child.permissions, parent.permissions)
  );
}

export function validateSandboxPermissionConsistency(
  envelope: PermissionEnvelope,
): { ok: true } | { ok: false; reason: string } {
  if (
    envelope.sandbox === "read-only" &&
    envelope.permissions.includes("write")
  ) {
    return {
      ok: false,
      reason: INCONSISTENT_READ_ONLY_WRITE_PERMISSIONS_REASON,
    };
  }
  return { ok: true };
}

export function validatePermissionsAgainstRouteMaximum(
  permissions: readonly DelegationPermission[],
  routeSandbox: TraceSandbox,
): { ok: true } | { ok: false; reason: string } {
  const routeMaximum = ROUTE_DEFAULT_PERMISSIONS[routeSandbox];
  if (!isPermissionSubset(permissions, routeMaximum)) {
    return { ok: false, reason: PERMISSION_NOT_IN_ROUTE_MAXIMUM_REASON };
  }
  return { ok: true };
}

export function validateEnvelopeNarrowing(
  child: PermissionEnvelope,
  parent: PermissionEnvelope | null,
): { ok: true } | { ok: false; reason: string } {
  const consistency = validateSandboxPermissionConsistency(child);
  if (!consistency.ok) {
    return consistency;
  }

  if (parent == null) {
    return { ok: true };
  }

  const parentConsistency = validateSandboxPermissionConsistency(parent);
  if (!parentConsistency.ok) {
    return parentConsistency;
  }

  if (!isEnvelopeEqualOrNarrower(child, parent)) {
    return { ok: false, reason: PERMISSION_ENVELOPE_BROADER_THAN_PARENT_REASON };
  }
  return { ok: true };
}

export type ResolveDispatchWorktreeInput = {
  parentContext: WorktreeDispatchContext | null;
  routeSandbox: TraceSandbox;
  checkoutRaw?: string | null;
  writeScopeRaw?: string | null;
  requestedPermissions?: readonly DelegationPermission[] | null;
};

export function resolveDispatchWorktreeContext(
  input: ResolveDispatchWorktreeInput,
): { ok: true; context: WorktreeDispatchContext } | { ok: false; reason: string } {
  const routeEnvelope = envelopeFromSandbox(input.routeSandbox);
  const routeMaximumCheck = validatePermissionsAgainstRouteMaximum(
    input.requestedPermissions ?? routeEnvelope.permissions,
    input.routeSandbox,
  );
  if (!routeMaximumCheck.ok) {
    return routeMaximumCheck;
  }

  const permissions = normalizePermissions(
    input.requestedPermissions ?? routeEnvelope.permissions,
  );
  const effectiveSandbox = effectiveSandboxFromPermissions(permissions);
  const envelope: PermissionEnvelope = {
    sandbox: effectiveSandbox,
    permissions,
  };

  const narrowing = validateEnvelopeNarrowing(
    envelope,
    input.parentContext?.envelope ?? null,
  );
  if (!narrowing.ok) {
    return narrowing;
  }

  let checkoutId: string | null = null;
  if (input.checkoutRaw != null && input.checkoutRaw.trim() !== "") {
    checkoutId = normalizeCheckoutId(input.checkoutRaw);
  } else if (input.parentContext) {
    checkoutId = input.parentContext.checkoutId;
  }

  if (!checkoutId) {
    return { ok: false, reason: MISSING_CHECKOUT_IDENTITY_REASON };
  }

  let writeScopeId: string | null = null;
  if (envelopeRequiresWriteOwnership(envelope)) {
    if (input.writeScopeRaw != null && input.writeScopeRaw.trim() !== "") {
      writeScopeId = normalizeWriteScopeId(input.writeScopeRaw);
    } else {
      writeScopeId = normalizeWriteScopeId(`checkout:${checkoutId}`);
    }
  } else if (input.writeScopeRaw != null && input.writeScopeRaw.trim() !== "") {
    return { ok: false, reason: INVALID_WRITE_SCOPE_FOR_READ_ONLY_REASON };
  }

  return {
    ok: true,
    context: {
      checkoutId,
      writeScopeId,
      envelope,
    },
  };
}

export function validateQueuedWorktreePolicy(
  context: WorktreeDispatchContext,
): { ok: true } | { ok: false; reason: string } {
  const consistency = validateSandboxPermissionConsistency(context.envelope);
  if (!consistency.ok) {
    return consistency;
  }

  if (
    !envelopeRequiresWriteOwnership(context.envelope) &&
    context.writeScopeId != null
  ) {
    return { ok: false, reason: INVALID_WRITE_SCOPE_FOR_READ_ONLY_REASON };
  }
  return { ok: true };
}

export function tryAcquireWriteOwnership(
  registry: WorktreeOwnershipRegistry,
  taskIdentity: string,
  context: WorktreeDispatchContext,
): { ok: true } | { ok: false; reason: string } {
  if (!envelopeRequiresWriteOwnership(context.envelope)) {
    return { ok: true };
  }

  const existing = registry.activeWriteByCheckout.get(context.checkoutId);
  if (existing) {
    if (existing.holder !== taskIdentity) {
      return { ok: false, reason: CHECKOUT_WRITE_CONFLICT_REASON };
    }
    return { ok: true };
  }

  const state: CheckoutWriteState = {
    checkoutId: context.checkoutId,
    writeScopeId: context.writeScopeId,
    holder: taskIdentity,
  };
  registry.activeWriteByCheckout.set(context.checkoutId, state);
  registry.activeWriteByTask.set(taskIdentity, { checkoutId: context.checkoutId });
  return { ok: true };
}

export function releaseWriteOwnership(
  registry: WorktreeOwnershipRegistry,
  taskIdentity: string,
): void {
  const holder = registry.activeWriteByTask.get(taskIdentity);
  if (!holder) {
    return;
  }

  const state = registry.activeWriteByCheckout.get(holder.checkoutId);
  if (state && state.holder === taskIdentity) {
    registry.activeWriteByCheckout.delete(holder.checkoutId);
  }
  registry.activeWriteByTask.delete(taskIdentity);
}

export function isCheckoutWriteOwned(
  registry: WorktreeOwnershipRegistry,
  checkoutId: string,
): boolean {
  return registry.activeWriteByCheckout.has(checkoutId);
}

export function getActiveWriteOwner(
  registry: WorktreeOwnershipRegistry,
  checkoutId: string,
): CheckoutWriteState | undefined {
  return registry.activeWriteByCheckout.get(checkoutId);
}
