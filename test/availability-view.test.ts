import { describe, expect, test } from "bun:test";
import {
  AVAILABILITY_OBSERVATION_WINDOW_MS,
  backendStateFor,
  buildAvailabilityView,
  type BackendObservation,
  type QuotaObservation,
} from "../plugins/arc-orchestrator/lib/availability-view";
import {
  RETRYABLE_FAILURE_CLASSES,
  TERMINAL_FAILURE_CLASSES,
} from "../plugins/arc-orchestrator/lib/failure-classification";
import {
  select,
  SELECTION_POLICY_VERSION,
  type SelectionInputs,
  type SelectionRequest,
} from "../plugins/arc-orchestrator/lib/capability-selection";
import {
  CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
  type CapabilitySnapshot,
  type RungSnapshotEntry,
} from "../plugins/arc-orchestrator/lib/capability-snapshot";
import {
  MODEL_REGISTRY,
  type ModelRegistryEntry,
} from "../plugins/arc-orchestrator/lib/model-registry";
import {
  BUDGET_LIMITS_V1,
  type RootBudgetLedger,
} from "../plugins/arc-orchestrator/lib/delegation-budget";

const NOW_MS = Date.parse("2026-07-25T12:00:00Z");
const WINDOW = AVAILABILITY_OBSERVATION_WINDOW_MS;

function observation(
  overrides: Partial<BackendObservation> = {},
): BackendObservation {
  return {
    backend: "composer",
    classification: "provider_outage",
    observedAtMs: NOW_MS - 1_000,
    ...overrides,
  };
}

function quota(overrides: Partial<QuotaObservation> = {}): QuotaObservation {
  return {
    pool: "cursor",
    remainingFraction: 0.5,
    resetsAtMs: null,
    observedAtMs: NOW_MS - 1_000,
    ...overrides,
  };
}

describe("backendStateFor: which failures describe a backend", () => {
  test("a transport that could not carry the call is unavailable", () => {
    expect(backendStateFor("provider_outage")).toBe("unavailable");
    expect(backendStateFor("rate_limit")).toBe("unavailable");
    expect(backendStateFor("quota_exhausted")).toBe("unavailable");
    expect(backendStateFor("missing_binary")).toBe("unavailable");
  });

  test("a call that reached the backend and did not finish is degraded", () => {
    expect(backendStateFor("timeout")).toBe("degraded");
    expect(backendStateFor("transient_network_or_adapter")).toBe("degraded");
  });

  test("every terminal class says nothing about the backend", () => {
    // The fail-safe that matters most here. A terminal class describes the
    // request — a denied policy, an incompatible sandbox, a malformed config.
    // Mapping any of them onto backend health would let one bad request take a
    // provider out of rotation for every task on the machine, which is worse than
    // the failure being reported. Asserted over the whole list, so a class added
    // later has to be classified deliberately.
    for (const classification of TERMINAL_FAILURE_CLASSES) {
      expect(backendStateFor(classification)).toBeNull();
    }
  });

  test("every retryable class is classified", () => {
    for (const classification of RETRYABLE_FAILURE_CLASSES) {
      expect(backendStateFor(classification)).not.toBeNull();
    }
  });
});

describe("buildAvailabilityView: backends", () => {
  test("an unobserved backend is absent, not asserted healthy", () => {
    const view = buildAvailabilityView({ nowMs: NOW_MS });
    expect(view.backends).toEqual({});
    expect(view.quotaPools).toEqual({});
  });

  test("records the observed state, class, and time", () => {
    const view = buildAvailabilityView({
      backends: [observation({ backend: "codex", classification: "timeout" })],
      nowMs: NOW_MS,
    });
    expect(view.backends.codex).toEqual({
      state: "degraded",
      classification: "timeout",
      observedAtMs: NOW_MS - 1_000,
    });
  });

  test("a terminal failure leaves an earlier outage standing", () => {
    // A policy denial is not evidence of recovery, so it neither clears the
    // outage nor replaces it.
    const view = buildAvailabilityView({
      backends: [
        observation({
          classification: "provider_outage",
          observedAtMs: NOW_MS - 5_000,
        }),
        observation({
          classification: "policy_denial",
          observedAtMs: NOW_MS - 1_000,
        }),
      ],
      nowMs: NOW_MS,
    });
    expect(view.backends.composer?.state).toBe("unavailable");
    expect(view.backends.composer?.classification).toBe("provider_outage");
  });

  test("a terminal failure on its own leaves the backend unobserved", () => {
    const view = buildAvailabilityView({
      backends: [observation({ classification: "sandbox_incompatible" })],
      nowMs: NOW_MS,
    });
    expect(view.backends).toEqual({});
  });

  test("newest evidence wins, because the view describes now", () => {
    const view = buildAvailabilityView({
      backends: [
        observation({
          classification: "provider_outage",
          observedAtMs: NOW_MS - 5_000,
        }),
        observation({
          classification: "timeout",
          observedAtMs: NOW_MS - 1_000,
        }),
      ],
      nowMs: NOW_MS,
    });
    expect(view.backends.composer?.state).toBe("degraded");
  });

  test("an identical timestamp breaks toward the more severe state", () => {
    const at = NOW_MS - 1_000;
    const severeFirst = buildAvailabilityView({
      backends: [
        observation({ classification: "provider_outage", observedAtMs: at }),
        observation({ classification: "timeout", observedAtMs: at }),
      ],
      nowMs: NOW_MS,
    });
    const severeLast = buildAvailabilityView({
      backends: [
        observation({ classification: "timeout", observedAtMs: at }),
        observation({ classification: "provider_outage", observedAtMs: at }),
      ],
      nowMs: NOW_MS,
    });
    expect(severeFirst.backends.composer?.state).toBe("unavailable");
    expect(severeLast).toEqual(severeFirst);
  });

  test("the view does not depend on the order observations arrived in", () => {
    const observations = [
      observation({
        backend: "codex",
        classification: "rate_limit",
        observedAtMs: NOW_MS - 3_000,
      }),
      observation({
        backend: "composer",
        classification: "timeout",
        observedAtMs: NOW_MS - 2_000,
      }),
      observation({
        backend: "codex",
        classification: "timeout",
        observedAtMs: NOW_MS - 1_000,
      }),
    ];
    const forward = buildAvailabilityView({
      backends: observations,
      nowMs: NOW_MS,
    });
    const reversed = buildAvailabilityView({
      backends: [...observations].reverse(),
      nowMs: NOW_MS,
    });
    expect(reversed).toEqual(forward);
  });
});

describe("buildAvailabilityView: observations expire", () => {
  test("an observation older than the window is not evidence about now", () => {
    const view = buildAvailabilityView({
      backends: [observation({ observedAtMs: NOW_MS - WINDOW - 1 })],
      nowMs: NOW_MS,
    });
    expect(view.backends).toEqual({});
  });

  test("the boundary is closed: exactly one window old has already expired", () => {
    expect(
      buildAvailabilityView({
        backends: [observation({ observedAtMs: NOW_MS - WINDOW })],
        nowMs: NOW_MS,
      }).backends,
    ).toEqual({});
    expect(
      buildAvailabilityView({
        backends: [observation({ observedAtMs: NOW_MS - WINDOW + 1 })],
        nowMs: NOW_MS,
      }).backends.composer?.state,
    ).toBe("unavailable");
  });

  test("the window is overridable without changing the rule", () => {
    const old = observation({ observedAtMs: NOW_MS - 5 * 60_000 });
    expect(
      buildAvailabilityView({ backends: [old], nowMs: NOW_MS }).backends,
    ).toEqual({});
    expect(
      buildAvailabilityView({
        backends: [old],
        nowMs: NOW_MS,
        windowMs: 10 * 60_000,
      }).backends.composer?.state,
    ).toBe("unavailable");
  });
});

describe("buildAvailabilityView: quota is ordering input", () => {
  test("a usable reading is carried through with its reset time", () => {
    const view = buildAvailabilityView({
      quotaPools: [
        quota({ remainingFraction: 0.1, resetsAtMs: NOW_MS + 60_000 }),
      ],
      nowMs: NOW_MS,
    });
    expect(view.quotaPools.cursor).toEqual({
      pool: "cursor",
      remainingFraction: 0.1,
      resetsAtMs: NOW_MS + 60_000,
    });
  });

  test("a stale reading decays to unobservable, not to its last value", () => {
    const view = buildAvailabilityView({
      quotaPools: [
        quota({ remainingFraction: 0, observedAtMs: NOW_MS - WINDOW - 1 }),
      ],
      nowMs: NOW_MS,
    });
    // The pool still exists; its level is no longer known. Keeping the zero would
    // refuse dispatches against quota that may have reset minutes ago.
    expect(view.quotaPools.cursor).toEqual({
      pool: "cursor",
      remainingFraction: null,
      resetsAtMs: null,
    });
  });

  test("a reading whose reset time has passed decays the same way", () => {
    const view = buildAvailabilityView({
      quotaPools: [
        quota({
          remainingFraction: 0,
          resetsAtMs: NOW_MS - 1,
          observedAtMs: NOW_MS - 1_000,
        }),
      ],
      nowMs: NOW_MS,
    });
    expect(view.quotaPools.cursor?.remainingFraction).toBeNull();
  });

  test("a usable reading is not overwritten by a stale one", () => {
    const view = buildAvailabilityView({
      quotaPools: [
        quota({ remainingFraction: 0.4, observedAtMs: NOW_MS - 1_000 }),
        quota({ remainingFraction: 0.9, observedAtMs: NOW_MS - WINDOW - 1 }),
      ],
      nowMs: NOW_MS,
    });
    expect(view.quotaPools.cursor?.remainingFraction).toBe(0.4);
  });

  test("newest wins, and an equal timestamp breaks toward the scarcer reading", () => {
    const at = NOW_MS - 1_000;
    const view = buildAvailabilityView({
      quotaPools: [
        quota({ remainingFraction: 0.8, observedAtMs: at }),
        quota({ remainingFraction: 0.2, observedAtMs: at }),
      ],
      nowMs: NOW_MS,
    });
    expect(view.quotaPools.cursor?.remainingFraction).toBe(0.2);

    const ordered = buildAvailabilityView({
      quotaPools: [
        quota({ remainingFraction: 0.2, observedAtMs: at }),
        quota({ remainingFraction: 0.8, observedAtMs: at }),
      ],
      nowMs: NOW_MS,
    });
    expect(ordered).toEqual(view);
  });

  test("an unobservable reading never displaces a numeric one at the same instant", () => {
    const at = NOW_MS - 1_000;
    const view = buildAvailabilityView({
      quotaPools: [
        quota({ remainingFraction: 0.3, observedAtMs: at }),
        quota({ remainingFraction: null, observedAtMs: at }),
      ],
      nowMs: NOW_MS,
    });
    expect(view.quotaPools.cursor?.remainingFraction).toBe(0.3);
  });

  test("quota never reaches the ledger", () => {
    // Section 4 of ADR 0010, asserted rather than described. USD and subscription
    // quota deplete against different clocks; budget-limits/v1 stays the sole
    // admission authority and gains no quota dimension.
    expect(Object.keys(BUDGET_LIMITS_V1.root).sort()).toEqual([
      "call",
      "concurrency",
      "cost",
      "token",
      "wallTimeMs",
    ]);
    expect(Object.keys(BUDGET_LIMITS_V1.dispatch).sort()).toEqual(
      Object.keys(BUDGET_LIMITS_V1.root).sort(),
    );
    expect(JSON.stringify(BUDGET_LIMITS_V1)).not.toContain("quota");
  });
});

// Integration: the view is only worth what select() does with it.

function entriesFor(...stableIds: string[]): ModelRegistryEntry[] {
  return stableIds.map((stableId) => {
    const entry = MODEL_REGISTRY.find((row) => row.stableId === stableId);
    if (!entry) {
      throw new Error(`Missing fixture entry: ${stableId}`);
    }
    return entry;
  });
}

function rungOf(stableId: string, quotaPool: string | null): RungSnapshotEntry {
  return {
    rungId: `${stableId}@none`,
    stableId,
    effort: "none",
    measurements: [
      {
        axis: "agentic-edit",
        source: "cursorbench.3.2",
        score: 0.6,
        errorMargin: 0.03,
        sampleSize: 113,
        sourceUrl: "https://example.invalid/cursorbench",
        retrievedAt: "2026-07-20",
        expiresAt: "2026-10-20",
        approver: null,
      },
    ],
    costPrior: null,
    quotaPool,
    priceBand: "$$",
  };
}

function snapshotOf(rungs: RungSnapshotEntry[]): CapabilitySnapshot {
  return {
    schemaVersion: CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
    snapshotVersion: "2026-07-25+cursorbench.3.2",
    bandWidth: 0.25,
    rungs,
  };
}

function ledger(): RootBudgetLedger {
  const vector = {
    token: 1_000_000,
    wallTimeMs: 1_000_000,
    call: 100,
    cost: 100,
    concurrency: 4,
  };
  return {
    rootIdentity: "root-fixture",
    limits: { ...vector },
    consumed: { token: 0, wallTimeMs: 0, call: 0, cost: 0, concurrency: 0 },
    remaining: { ...vector },
    reservations: new Map(),
    createdAtMs: NOW_MS,
    clock: () => {
      throw new Error("select() must not read a clock");
    },
  };
}

function requestOf(
  overrides: Partial<SelectionRequest> = {},
): SelectionRequest {
  return {
    capabilityRoute: "implement.workspace-write.v1",
    axis: "agentic-edit",
    capabilityFloor: 0,
    minimumFloor: 0,
    bandCeiling: null,
    override: null,
    taskIdentity: "task-fixture",
    depth: 1,
    ...overrides,
  };
}

function selectWith(view: SelectionInputs["availability"]) {
  return select({
    request: requestOf(),
    registry: entriesFor("composer-2.5", "minimax-m3"),
    snapshot: snapshotOf([
      rungOf("composer-2.5", "cursor"),
      rungOf("minimax-m3", null),
    ]),
    ledger: ledger(),
    availability: view,
    policyVersion: SELECTION_POLICY_VERSION,
    nowMs: NOW_MS,
  });
}

describe("buildAvailabilityView with select()", () => {
  test("a fresh outage removes the backend; the same outage aged out restores it", () => {
    const outage = observation({
      backend: "composer",
      classification: "provider_outage",
      observedAtMs: NOW_MS - 1_000,
    });
    const fresh = selectWith(
      buildAvailabilityView({ backends: [outage], nowMs: NOW_MS }),
    );
    expect(fresh.explanation.eligible).not.toContain("composer-2.5@none");
    expect(fresh.explanation.rejected).toContainEqual({
      rungId: "composer-2.5@none",
      reason: "backend-unavailable",
    });

    // Self-healing is the point of the window: an unavailable verdict blocks the
    // dispatch that would observe recovery, so it has to expire on its own.
    const aged = selectWith(
      buildAvailabilityView({ backends: [outage], nowMs: NOW_MS + WINDOW }),
    );
    expect(aged.explanation.eligible).toContain("composer-2.5@none");
  });

  test("a degraded backend keeps routing", () => {
    const view = buildAvailabilityView({
      backends: [
        observation({ backend: "composer", classification: "timeout" }),
      ],
      nowMs: NOW_MS,
    });
    expect(selectWith(view).explanation.eligible).toContain(
      "composer-2.5@none",
    );
  });

  test("an observed-zero pool rejects; the same reading gone stale does not", () => {
    const empty = quota({ pool: "cursor", remainingFraction: 0 });
    const fresh = selectWith(
      buildAvailabilityView({ quotaPools: [empty], nowMs: NOW_MS }),
    );
    expect(fresh.explanation.rejected).toContainEqual({
      rungId: "composer-2.5@none",
      reason: "quota-pool-exhausted",
    });

    const stale = selectWith(
      buildAvailabilityView({ quotaPools: [empty], nowMs: NOW_MS + WINDOW }),
    );
    expect(stale.explanation.eligible).toContain("composer-2.5@none");
  });

  test("a scarce pool orders later without being refused", () => {
    const view = buildAvailabilityView({
      quotaPools: [quota({ pool: "cursor", remainingFraction: 0.05 })],
      nowMs: NOW_MS,
    });
    const decision = selectWith(view);
    // Both rungs sit in the same band with no cost prior, so nothing is pruned
    // and quota is the only thing separating them. Ordering input, not a gate.
    expect(decision.explanation.eligible).toEqual([
      "composer-2.5@none",
      "minimax-m3@high",
      "minimax-m3@low",
      "minimax-m3@max",
    ]);
  });
});
