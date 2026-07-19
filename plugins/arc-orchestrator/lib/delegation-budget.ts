// budget-limits/v1 root-owned reservation and reconciliation for parent-scheduled
// delegation. Library-only; CLI activation is out of scope.

import type { RoutingTraceV2BudgetScopeInput } from "./trace-schema";
import { DISPATCH_COST_RESERVATION_V1 } from "./trace-schema";

export const BUDGET_LIMITS_V1 = {
  root: {
    token: 2_000_000,
    wallTimeMs: 60 * 60 * 1000,
    call: 25,
    cost: 10,
    concurrency: 3,
  },
  dispatch: {
    token: 400_000,
    wallTimeMs: 15 * 60 * 1000,
    call: 1,
    cost: DISPATCH_COST_RESERVATION_V1,
    concurrency: 1,
  },
} as const;

export type BudgetDimension =
  | "token"
  | "wallTimeMs"
  | "call"
  | "cost"
  | "concurrency";

export type BudgetVector = Record<BudgetDimension, number>;

export type BudgetMeasurement = "known" | "unknown";

export type BudgetActuals = {
  token?: number | null;
  wallTimeMs?: number | null;
  call?: number | null;
  cost?: number | null;
  concurrency?: number | null;
  tokenMeasurement?: BudgetMeasurement;
  costMeasurement?: BudgetMeasurement;
};

export type DispatchReservation = {
  taskIdentity: string;
  rootIdentity: string;
  depth: number;
  reserved: BudgetVector;
  status: "active" | "reconciled";
};

export type BudgetClock = () => number;

export type RootBudgetLedger = {
  rootIdentity: string;
  limits: BudgetVector;
  consumed: BudgetVector;
  remaining: BudgetVector;
  reservations: Map<string, DispatchReservation>;
  createdAtMs: number;
  clock: BudgetClock;
};

export const BUDGET_EXHAUSTION_REASONS: Record<BudgetDimension, string> = {
  token: "budget-token-exhausted",
  wallTimeMs: "budget-wall-time-exhausted",
  call: "budget-call-exhausted",
  cost: "budget-cost-exhausted",
  concurrency: "budget-concurrency-exhausted",
};

const CONTINUOUS_DIMENSIONS: readonly BudgetDimension[] = [
  "token",
  "wallTimeMs",
  "cost",
];
const SLOT_DIMENSIONS: readonly BudgetDimension[] = ["call", "concurrency"];

function zeroVector(): BudgetVector {
  return { token: 0, wallTimeMs: 0, call: 0, cost: 0, concurrency: 0 };
}

function copyVector(vector: BudgetVector): BudgetVector {
  return { ...vector };
}

function dispatchCeiling(): BudgetVector {
  return copyVector(BUDGET_LIMITS_V1.dispatch);
}

function rootLimits(): BudgetVector {
  return copyVector(BUDGET_LIMITS_V1.root);
}

function reserveAmount(
  dimension: BudgetDimension,
  remaining: number,
): number {
  const ceiling = BUDGET_LIMITS_V1.dispatch[dimension];
  if (SLOT_DIMENSIONS.includes(dimension)) {
    return remaining >= ceiling ? ceiling : 0;
  }
  return Math.min(ceiling, remaining);
}

function firstExhaustedDimension(reservation: BudgetVector): BudgetDimension | null {
  for (const dimension of [
    ...CONTINUOUS_DIMENSIONS,
    ...SLOT_DIMENSIONS,
  ] as BudgetDimension[]) {
    if (reservation[dimension] <= 0) {
      return dimension;
    }
  }
  return null;
}

function activeReservedWallTimeMs(ledger: RootBudgetLedger): number {
  let reserved = 0;
  for (const reservation of ledger.reservations.values()) {
    if (reservation.status === "active") {
      reserved += reservation.reserved.wallTimeMs;
    }
  }
  return reserved;
}

// Root wall-time consumed is elapsed clock from root creation, not summed
// worker-minutes. Remaining subtracts outstanding wall-time reservations so
// concurrent workers cannot over-commit the root pool.
export function refreshRootWallTime(ledger: RootBudgetLedger): void {
  const elapsed = Math.max(0, ledger.clock() - ledger.createdAtMs);
  ledger.consumed.wallTimeMs = elapsed;
  ledger.remaining.wallTimeMs =
    ledger.limits.wallTimeMs - elapsed - activeReservedWallTimeMs(ledger);
}

export type CreateRootBudgetLedgerOptions = {
  clock?: BudgetClock;
  createdAtMs?: number;
};

export function createRootBudgetLedger(
  rootIdentity: string,
  options: CreateRootBudgetLedgerOptions = {},
): RootBudgetLedger {
  const clock = options.clock ?? Date.now;
  const createdAtMs = options.createdAtMs ?? clock();
  const limits = rootLimits();
  return {
    rootIdentity,
    limits,
    consumed: zeroVector(),
    remaining: copyVector(limits),
    reservations: new Map(),
    createdAtMs,
    clock,
  };
}

export function tryReserveDispatch(
  ledger: RootBudgetLedger,
  taskIdentity: string,
  depth: number,
): { ok: true; reservation: DispatchReservation } | { ok: false; reason: string } {
  refreshRootWallTime(ledger);

  if (ledger.reservations.has(taskIdentity)) {
    return { ok: false, reason: "duplicate-budget-reservation" };
  }

  const reserved = dispatchCeiling();
  for (const dimension of CONTINUOUS_DIMENSIONS) {
    reserved[dimension] = reserveAmount(dimension, ledger.remaining[dimension]);
  }
  for (const dimension of SLOT_DIMENSIONS) {
    reserved[dimension] = reserveAmount(dimension, ledger.remaining[dimension]);
  }

  const exhausted = firstExhaustedDimension(reserved);
  if (exhausted) {
    return { ok: false, reason: BUDGET_EXHAUSTION_REASONS[exhausted] };
  }

  for (const dimension of Object.keys(reserved) as BudgetDimension[]) {
    ledger.remaining[dimension] -= reserved[dimension];
  }

  const reservation: DispatchReservation = {
    taskIdentity,
    rootIdentity: ledger.rootIdentity,
    depth,
    reserved,
    status: "active",
  };
  ledger.reservations.set(taskIdentity, reservation);
  refreshRootWallTime(ledger);
  return { ok: true, reservation };
}

function reconcileDimensionActual(
  dimension: BudgetDimension,
  reserved: number,
  actuals: BudgetActuals,
  outcome: "success" | "failure" | "cancelled",
): number {
  if (dimension === "token") {
    if (actuals.tokenMeasurement === "unknown" || actuals.token == null) {
      return reserved;
    }
    return Math.max(0, actuals.token);
  }
  if (dimension === "cost") {
    if (actuals.costMeasurement === "unknown" || actuals.cost == null) {
      return reserved;
    }
    return Math.max(0, actuals.cost);
  }
  if (dimension === "wallTimeMs") {
    if (actuals.wallTimeMs == null) {
      return reserved;
    }
    return Math.max(0, actuals.wallTimeMs);
  }
  if (dimension === "call") {
    if (actuals.call == null) {
      return reserved;
    }
    return Math.min(reserved, Math.max(0, actuals.call));
  }
  if (dimension === "concurrency") {
    return 0;
  }
  return reserved;
}

export function reconcileDispatch(
  ledger: RootBudgetLedger,
  taskIdentity: string,
  actuals: BudgetActuals,
  outcome: "success" | "failure" | "cancelled",
): { ok: true; charged: BudgetVector } | { ok: false; reason: string } {
  refreshRootWallTime(ledger);

  const reservation = ledger.reservations.get(taskIdentity);
  if (!reservation || reservation.status !== "active") {
    return { ok: false, reason: "missing-active-reservation" };
  }

  const charged = zeroVector();
  for (const dimension of Object.keys(charged) as BudgetDimension[]) {
    charged[dimension] = reconcileDimensionActual(
      dimension,
      reservation.reserved[dimension],
      actuals,
      outcome,
    );
    const unused = reservation.reserved[dimension] - charged[dimension];
    ledger.remaining[dimension] += unused;
    if (dimension !== "wallTimeMs") {
      ledger.consumed[dimension] += charged[dimension];
    }
  }

  reservation.status = "reconciled";
  ledger.reservations.delete(taskIdentity);
  refreshRootWallTime(ledger);
  return { ok: true, charged };
}

export function getActiveReservation(
  ledger: RootBudgetLedger,
  taskIdentity: string,
): DispatchReservation | undefined {
  const reservation = ledger.reservations.get(taskIdentity);
  return reservation?.status === "active" ? reservation : undefined;
}

export function toRoutingTraceV2BudgetContext(
  ledger: RootBudgetLedger,
  reservation?: DispatchReservation,
): {
  rootBudget: RoutingTraceV2BudgetScopeInput;
  dispatchBudget: RoutingTraceV2BudgetScopeInput;
} {
  refreshRootWallTime(ledger);

  const rootBudget: RoutingTraceV2BudgetScopeInput = {
    token: {
      allocated: ledger.limits.token,
      consumed: ledger.consumed.token,
      remaining: ledger.remaining.token,
    },
    wallTimeMs: {
      allocated: ledger.limits.wallTimeMs,
      consumed: ledger.consumed.wallTimeMs,
      remaining: ledger.remaining.wallTimeMs,
    },
    call: {
      allocated: ledger.limits.call,
      consumed: ledger.consumed.call,
      remaining: ledger.remaining.call,
    },
    cost: {
      allocated: ledger.limits.cost,
      consumed: ledger.consumed.cost,
      remaining: ledger.remaining.cost,
    },
    concurrency: {
      allocated: ledger.limits.concurrency,
      consumed: ledger.limits.concurrency - ledger.remaining.concurrency,
      remaining: ledger.remaining.concurrency,
    },
  };

  const dispatchReserved = reservation?.reserved ?? dispatchCeiling();
  const dispatchBudget: RoutingTraceV2BudgetScopeInput = {
    token: { allocated: dispatchReserved.token },
    wallTimeMs: { allocated: dispatchReserved.wallTimeMs },
    call: { allocated: dispatchReserved.call },
    cost: { allocated: dispatchReserved.cost },
    concurrency: { allocated: dispatchReserved.concurrency },
  };

  return { rootBudget, dispatchBudget };
}

export function isRootBudgetExhausted(ledger: RootBudgetLedger): boolean {
  refreshRootWallTime(ledger);
  return Object.values(ledger.remaining).some((value) => value <= 0);
}
