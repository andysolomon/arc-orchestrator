// budget-limits/v1 vectors shared by the ledger (runtime) and the simulator
// (control plane). `select()` reads exactly one field of a budget state —
// `remaining.cost` — so the runtime's `RootBudgetLedger` (which adds
// reservations and a clock) satisfies this type structurally.

import { DISPATCH_COST_RESERVATION_V1 } from "./trace-schema";

export const BUDGET_POLICY_VERSION = "budget-limits/v1" as const;

export type BudgetDimension =
  | "token"
  | "wallTimeMs"
  | "call"
  | "cost"
  | "concurrency";

export type BudgetVector = Record<BudgetDimension, number>;

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
} as const satisfies { root: BudgetVector; dispatch: BudgetVector };

export type BudgetState = {
  limits: BudgetVector;
  consumed: BudgetVector;
  remaining: BudgetVector;
};

export function zeroBudgetVector(): BudgetVector {
  return { token: 0, wallTimeMs: 0, call: 0, cost: 0, concurrency: 0 };
}

/** A fresh root budget at the v1 ceilings, with an optional override of what remains. */
export function budgetStateFor(
  overrides: Partial<{ remaining: Partial<BudgetVector>; consumed: Partial<BudgetVector> }> = {},
): BudgetState {
  const limits: BudgetVector = { ...BUDGET_LIMITS_V1.root };
  const consumed: BudgetVector = { ...zeroBudgetVector(), ...overrides.consumed };
  const remaining: BudgetVector = {
    token: limits.token - consumed.token,
    wallTimeMs: limits.wallTimeMs - consumed.wallTimeMs,
    call: limits.call - consumed.call,
    cost: limits.cost - consumed.cost,
    concurrency: limits.concurrency - consumed.concurrency,
    ...overrides.remaining,
  };
  return { limits, consumed, remaining };
}
