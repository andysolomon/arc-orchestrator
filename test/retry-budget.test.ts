import { describe, expect, test } from "bun:test";
import {
  createLabelRetryBudget,
  retryPolicyMode,
} from "../plugins/arc-orchestrator/lib/retry-budget";

describe("retry-budget: retryPolicyMode", () => {
  test("unset env defaults to shadow (W-000225)", () => {
    expect(retryPolicyMode({})).toBe("shadow");
    expect(retryPolicyMode({ ARC_ORCHESTRATOR_RETRY_POLICY: undefined })).toBe("shadow");
  });

  test("shadow and active are recognized case-insensitively", () => {
    expect(retryPolicyMode({ ARC_ORCHESTRATOR_RETRY_POLICY: "shadow" })).toBe("shadow");
    expect(retryPolicyMode({ ARC_ORCHESTRATOR_RETRY_POLICY: " ACTIVE " })).toBe("active");
  });
});

describe("retry-budget: 60s two-attempt-per-label cap", () => {
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
});
