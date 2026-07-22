import { describe, expect, test } from "bun:test";
import {
  createLabelRetryBudget,
  retryPolicyMode,
  RETRY_BUDGET_DEFAULT_MAX_ATTEMPTS,
  RETRY_BUDGET_DEFAULT_WINDOW_MS,
} from "../plugins/arc-orchestrator/lib/retry-budget";

describe("retry-budget: retryPolicyMode", () => {
  test("unset env defaults to shadow (W-000225)", () => {
    expect(retryPolicyMode({})).toBe("shadow");
    expect(retryPolicyMode({ ARC_ORCHESTRATOR_RETRY_POLICY: undefined })).toBe("shadow");
  });

  describe("explicit off", () => {
    test("off is honored, and empty or garbage set values re-anchor to off", () => {
      expect(retryPolicyMode({ ARC_ORCHESTRATOR_RETRY_POLICY: "off" })).toBe("off");
      expect(retryPolicyMode({ ARC_ORCHESTRATOR_RETRY_POLICY: " OFF " })).toBe("off");
      expect(retryPolicyMode({ ARC_ORCHESTRATOR_RETRY_POLICY: "" })).toBe("off");
      expect(retryPolicyMode({ ARC_ORCHESTRATOR_RETRY_POLICY: "garbage" })).toBe("off");
    });
  });

  test("shadow and active are recognized case-insensitively", () => {
    expect(retryPolicyMode({ ARC_ORCHESTRATOR_RETRY_POLICY: "shadow" })).toBe("shadow");
    expect(retryPolicyMode({ ARC_ORCHESTRATOR_RETRY_POLICY: " ACTIVE " })).toBe("active");
  });
});

describe("retry-budget: createLabelRetryBudget defaults", () => {
  test("mode derives from env; window and cap take documented defaults", () => {
    const budget = createLabelRetryBudget({ ARC_ORCHESTRATOR_RETRY_POLICY: "active" });
    expect(budget.mode).toBe("active");
    expect(budget.windowMs).toBe(RETRY_BUDGET_DEFAULT_WINDOW_MS);
    expect(budget.maxAttemptsPerWindow).toBe(RETRY_BUDGET_DEFAULT_MAX_ATTEMPTS);
    expect(RETRY_BUDGET_DEFAULT_WINDOW_MS).toBe(60_000);
    expect(RETRY_BUDGET_DEFAULT_MAX_ATTEMPTS).toBe(2);
  });

  test("overrides win over env-derived mode", () => {
    const budget = createLabelRetryBudget(
      { ARC_ORCHESTRATOR_RETRY_POLICY: "off" },
      { mode: "shadow" },
    );
    expect(budget.mode).toBe("shadow");
  });
});

describe("retry-budget: 60s two-attempt-per-label cap", () => {
  test("third attempt of the same label inside the window is not allowed", () => {
    let clock = 1_000_000;
    const budget = createLabelRetryBudget(
      {},
      { mode: "active", windowMs: 60_000, maxAttemptsPerWindow: 2, now: () => clock },
    );

    const first = budget.charge({ label: "job" });
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(1);

    clock += 10_000;
    const second = budget.charge({ label: "job" });
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);

    clock += 10_000;
    const third = budget.charge({ label: "job" });
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });

  test("attempts older than the window slide out and free capacity", () => {
    let clock = 0;
    const budget = createLabelRetryBudget(
      {},
      { mode: "active", windowMs: 60_000, maxAttemptsPerWindow: 2, now: () => clock },
    );

    budget.charge({ label: "job" });
    clock = 30_000;
    budget.charge({ label: "job" });
    expect(budget.remaining("job")).toBe(0);

    // Advance past the window relative to the first two attempts.
    clock = 60_001;
    // The first attempt (t=0) has aged out; only t=30_000 remains in window.
    expect(budget.remaining("job")).toBe(1);
    const next = budget.charge({ label: "job" });
    expect(next.allowed).toBe(true);
  });

  test("distinct labels keep independent windows", () => {
    let clock = 5_000;
    const budget = createLabelRetryBudget(
      {},
      { mode: "active", windowMs: 60_000, maxAttemptsPerWindow: 2, now: () => clock },
    );

    budget.charge({ label: "a" });
    budget.charge({ label: "a" });
    expect(budget.charge({ label: "a" }).allowed).toBe(false);
    // A different label is unaffected.
    expect(budget.charge({ label: "b" }).allowed).toBe(true);
    expect(budget.remaining("b")).toBe(1);
  });
});

describe("retry-budget: never cross a price band twice without a downgrade", () => {
  test("active enforcement records a downgrade before the second crossing", () => {
    const budget = createLabelRetryBudget(
      {},
      { mode: "active", maxAttemptsPerWindow: 10 },
    );

    // First attempt: no boundary crossing yet.
    const a = budget.charge({ label: "job", crossesPriceBand: false, enforceDowngrade: true });
    expect(a.downgradeRequired).toBe(false);
    expect(a.downgradeAttempted).toBe(false);

    // First crossing arms the guard but requires nothing.
    const b = budget.charge({ label: "job", crossesPriceBand: true, enforceDowngrade: true });
    expect(b.downgradeRequired).toBe(false);
    expect(b.downgradeAttempted).toBe(false);

    // Second consecutive crossing requires — and, under enforcement, records — a downgrade.
    const c = budget.charge({ label: "job", crossesPriceBand: true, enforceDowngrade: true });
    expect(c.downgradeRequired).toBe(true);
    expect(c.downgradeAttempted).toBe(true);

    // The enforced downgrade cleared the guard; the next crossing is a fresh first crossing.
    const d = budget.charge({ label: "job", crossesPriceBand: true, enforceDowngrade: true });
    expect(d.downgradeRequired).toBe(false);
    expect(d.downgradeAttempted).toBe(false);
  });

  test("shadow reports the requirement without recording a downgrade", () => {
    const budget = createLabelRetryBudget(
      {},
      { mode: "shadow", maxAttemptsPerWindow: 10 },
    );

    budget.charge({ label: "job", crossesPriceBand: true, enforceDowngrade: false });
    const second = budget.charge({ label: "job", crossesPriceBand: true, enforceDowngrade: false });
    expect(second.downgradeRequired).toBe(true);
    expect(second.downgradeAttempted).toBe(false);

    // Guard stays pending because no downgrade was performed.
    const third = budget.charge({ label: "job", crossesPriceBand: true, enforceDowngrade: false });
    expect(third.downgradeRequired).toBe(true);
    expect(third.downgradeAttempted).toBe(false);
  });

  test("a same-band attempt clears the pending crossing guard", () => {
    const budget = createLabelRetryBudget(
      {},
      { mode: "active", maxAttemptsPerWindow: 10 },
    );

    budget.charge({ label: "job", crossesPriceBand: true, enforceDowngrade: true });
    // Non-crossing attempt resets the guard.
    budget.charge({ label: "job", crossesPriceBand: false, enforceDowngrade: true });
    // Next crossing is therefore treated as a first crossing again.
    const after = budget.charge({ label: "job", crossesPriceBand: true, enforceDowngrade: true });
    expect(after.downgradeRequired).toBe(false);
    expect(after.downgradeAttempted).toBe(false);
  });
});
