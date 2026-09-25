import { describe, expect, test } from "bun:test";
import {
  createSessionTokenTracker,
  resolveSessionTokenPolicy,
  SESSION_TOKEN_DEFAULT_MAX_SESSION_TOKENS,
  SESSION_TOKEN_DEFAULT_WINDOW_MS,
  SESSION_TOKEN_POLICY_ENV,
  shouldRotate,
  type SessionTokenSnapshot,
} from "../lib/session-token-policy";

const exceededSnapshot: SessionTokenSnapshot = {
  sessionLabel: "job",
  knownLowerBound: SESSION_TOKEN_DEFAULT_MAX_SESSION_TOKENS + 1,
  completeness: "complete",
};

describe("session-token-policy: resolveSessionTokenPolicy", () => {
  test("unset, empty, and garbage values default to off", () => {
    expect(resolveSessionTokenPolicy({}).mode).toBe("off");
    expect(
      resolveSessionTokenPolicy({ [SESSION_TOKEN_POLICY_ENV]: "" }).mode,
    ).toBe("off");
    expect(
      resolveSessionTokenPolicy({ [SESSION_TOKEN_POLICY_ENV]: "garbage" }).mode,
    ).toBe("off");
  });
});

describe("session-token-policy: shadow evidence", () => {
  test("shadow records session_token_exceeded evidence but never rotates", () => {
    const policy = resolveSessionTokenPolicy({
      [SESSION_TOKEN_POLICY_ENV]: "shadow",
    });
    const decision = shouldRotate(exceededSnapshot, policy);
    expect(decision.exceeded).toBe(true);
    expect(decision.rotate).toBe(false);
    expect(decision.evidence).toEqual({
      kind: "session_token_exceeded",
      schemaVersion: 1,
      mode: "shadow",
      sessionLabel: "job",
      knownLowerBound: SESSION_TOKEN_DEFAULT_MAX_SESSION_TOKENS + 1,
      completeness: "complete",
      maxSessionTokens: SESSION_TOKEN_DEFAULT_MAX_SESSION_TOKENS,
      windowMs: SESSION_TOKEN_DEFAULT_WINDOW_MS,
      rotate: false,
    });
  });
});

describe("session-token-policy: sliding window (retry-budget comparable)", () => {
  test("charges outside windowMs are pruned like the retry-budget window", () => {
    let clock = 1_000_000;
    const tracker = createSessionTokenTracker({
      windowMs: 60_000,
      now: () => clock,
    });

    tracker.charge({ sessionLabel: "job", tokens: 300 });
    clock += 30_000;
    expect(
      tracker.charge({ sessionLabel: "job", tokens: 100 }).knownLowerBound,
    ).toBe(400);

    // 61s after the first charge it leaves the window; the second remains.
    clock += 31_000;
    expect(tracker.snapshot("job").knownLowerBound).toBe(100);

    // After the whole window drains the label is back to an empty snapshot.
    clock += 60_001;
    expect(tracker.snapshot("job")).toEqual({
      sessionLabel: "job",
      knownLowerBound: 0,
      completeness: "unknown",
    });
  });

  test("unknown-usage charges downgrade completeness to lower-bound", () => {
    const tracker = createSessionTokenTracker({ now: () => 1_000_000 });
    tracker.charge({ sessionLabel: "job", tokens: 42 });
    const snapshot = tracker.charge({ sessionLabel: "job", tokens: null });
    expect(snapshot).toEqual({
      sessionLabel: "job",
      knownLowerBound: 42,
      completeness: "lower-bound",
    });
  });
});

describe("session-token-policy: threshold boundary edges", () => {
  const active = resolveSessionTokenPolicy({
    [SESSION_TOKEN_POLICY_ENV]: "active",
  });
  const thresholds = { maxSessionTokens: 1_000, windowMs: 60_000 };

  test("exactly at the threshold is not exceeded", () => {
    const decision = shouldRotate(
      { sessionLabel: "job", knownLowerBound: 1_000, completeness: "complete" },
      active,
      thresholds,
    );
    expect(decision).toEqual({ rotate: false, exceeded: false, evidence: null });
  });

  test("one token past the threshold rotates under active", () => {
    const decision = shouldRotate(
      { sessionLabel: "job", knownLowerBound: 1_001, completeness: "complete" },
      active,
      thresholds,
    );
    expect(decision.rotate).toBe(true);
    expect(decision.exceeded).toBe(true);
    expect(decision.evidence?.knownLowerBound).toBe(1_001);
  });
});
