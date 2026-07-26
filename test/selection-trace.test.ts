import { describe, expect, test } from "bun:test";
import {
  select,
  SELECTION_POLICY_VERSION,
  type AvailabilityView,
  type SelectionDecision,
  type SelectionInputs,
  type SelectionRequest,
} from "../plugins/arc-orchestrator/lib/capability-selection";
import {
  SELECTION_TRACE_LIST_LIMIT,
  selectionTraceFrom,
} from "../plugins/arc-orchestrator/lib/selection-trace";
import {
  CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
  type CapabilitySnapshot,
  type Measurement,
  type RungSnapshotEntry,
} from "../plugins/arc-orchestrator/lib/capability-snapshot";
import {
  MODEL_REGISTRY,
  parseRungId,
  rungsFor,
  type ModelRegistryEntry,
} from "../plugins/arc-orchestrator/lib/model-registry";
import type { RootBudgetLedger } from "../plugins/arc-orchestrator/lib/delegation-budget";
import {
  boundedLabel,
  buildRoutingTraceV2,
  type TraceRecord,
} from "../plugins/arc-orchestrator/lib/trace-schema";

const NOW_MS = Date.parse("2026-07-25T00:00:00Z");

function entriesFor(...stableIds: string[]): ModelRegistryEntry[] {
  return stableIds.map((stableId) => {
    const entry = MODEL_REGISTRY.find((row) => row.stableId === stableId);
    if (!entry) {
      throw new Error(`Missing fixture entry: ${stableId}`);
    }
    return entry;
  });
}

function measurementOf(score: number): Measurement {
  return {
    axis: "agentic-edit",
    source: "cursorbench.3.2",
    score,
    errorMargin: 0.03,
    sampleSize: 113,
    sourceUrl: "https://example.invalid/cursorbench",
    retrievedAt: "2026-07-20",
    expiresAt: "2026-10-20",
    approver: null,
  };
}

function rungOf(
  stableId: string,
  options: { effort?: string; score?: number | null; usdPerTask?: number | null } = {},
): RungSnapshotEntry {
  const effort = options.effort ?? "none";
  return {
    rungId: `${stableId}@${effort}`,
    stableId,
    effort: effort as RungSnapshotEntry["effort"],
    measurements: options.score == null ? [] : [measurementOf(options.score)],
    costPrior:
      options.usdPerTask == null
        ? null
        : {
            source: "cursorbench.3.2",
            usdPerTask: options.usdPerTask,
            outputTokensPerTask: 20000,
            stepsPerTask: 20,
            retrievedAt: "2026-07-20",
          },
    quotaPool: null,
    priceBand: "$$",
  };
}

function snapshotOf(
  rungs: RungSnapshotEntry[],
  snapshotVersion = "2026-07-25+cursorbench.3.2",
): CapabilitySnapshot {
  return {
    schemaVersion: CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
    snapshotVersion,
    bandWidth: 0.25,
    rungs,
  };
}

function ledgerWith(remainingCost: number): RootBudgetLedger {
  const vector = {
    token: 1_000_000,
    wallTimeMs: 1_000_000,
    call: 100,
    cost: remainingCost,
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

function availabilityOf(): AvailabilityView {
  return { backends: {}, quotaPools: {} };
}

function requestOf(overrides: Partial<SelectionRequest> = {}): SelectionRequest {
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

function inputsOf(overrides: Partial<SelectionInputs> = {}): SelectionInputs {
  return {
    request: requestOf(),
    registry: entriesFor("composer-2.5", "grok-4.5", "minimax-m3"),
    snapshot: snapshotOf([
      rungOf("composer-2.5", { score: 0.56, usdPerTask: 0.44 }),
      rungOf("grok-4.5", { score: 0.667, usdPerTask: 1.51 }),
      rungOf("minimax-m3", { score: 0.3, usdPerTask: 0.2 }),
    ]),
    ledger: ledgerWith(100),
    availability: availabilityOf(),
    policyVersion: SELECTION_POLICY_VERSION,
    nowMs: NOW_MS,
    ...overrides,
  };
}

function baselineLegacy(): TraceRecord {
  return {
    schema: 4,
    run_id: "run-test",
    timestamp: "2026-07-25T00:00:00.000Z",
    backend: "composer",
    orchestrator_identity: null,
    mode: "implement",
    model: "composer-2.5",
    sandbox: "workspace-write",
    project: "abc123def456",
    label: "W-000074",
    task_class: "feature",
    route_rationale: "test",
    duration_ms: 1000,
    status: "completed",
    exit_code: 0,
    changed_files: 1,
    tokens: {
      input_tokens: 10,
      cached_input_tokens: null,
      output_tokens: 20,
      total_tokens: 30,
    },
    budget: null,
    error: null,
  };
}

function traceInputOf(
  selection: SelectionDecision | null | undefined,
  executed = false,
) {
  const legacy = baselineLegacy();
  return {
    legacy,
    route: {},
    models: {},
    serving: {},
    traversal: {},
    lineage: { rootRunId: "run-root", depth: 0 },
    ...(selection === undefined
      ? {}
      : {
          selection:
            selection === null
              ? null
              : selectionTraceFrom(selection, { executed }),
        }),
  };
}

describe("selectionTraceFrom: both outcomes are recorded", () => {
  test("a selection carries the ordered stack and its lead", () => {
    const block = selectionTraceFrom(select(inputsOf()), { executed: false });
    expect(block.outcome).toBe("selected");
    expect(block.refusal_reason).toBeNull();
    expect(block.eligible).toEqual(["composer-2.5@none", "minimax-m3@none"]);
    expect(block.lead_backend).toBe("composer");
    expect(block.pruned).toEqual([
      { rung_id: "grok-4.5@none", dominated_by: "composer-2.5@none" },
    ]);
    expect(block.policy_version).toBe(SELECTION_POLICY_VERSION);
    expect(block.registry_version).toBeGreaterThan(0);
  });

  test("a refusal is as auditable as a selection", () => {
    const decision = select(inputsOf({ ledger: ledgerWith(0) }));
    expect(decision.outcome).toBe("refused");
    const block = selectionTraceFrom(decision, { executed: false });
    expect(block.outcome).toBe("refused");
    expect(block.refusal_reason).toBe("budget-exhausted");
    // The identifying context survives even though nothing was selected: which
    // axis, which floor, which snapshot. A refusal a reader cannot attribute is
    // the state ADR 0010 was written to remove.
    expect(block.eligible).toEqual([]);
    expect(block.axis).toBe("agentic-edit");
    expect(block.snapshot_version).toBe("2026-07-25+cursorbench.3.2");
    expect(block.requested_floor).toBe(0);
  });

  test("`executed` is carried from the caller, not inferred", () => {
    const decision = select(inputsOf());
    expect(selectionTraceFrom(decision, { executed: false }).executed).toBe(false);
    expect(selectionTraceFrom(decision, { executed: true }).executed).toBe(true);
  });
});

describe("selectionTraceFrom: step 7 fields keep their absence", () => {
  test("a run without a leadPolicy claims no coherence check", () => {
    const block = selectionTraceFrom(select(inputsOf()), { executed: false });
    expect("lead_repair" in block).toBe(false);
    expect("lead_displaced" in block).toBe(false);
    expect("lead_displaced_by_availability" in block).toBe(false);
    // Still reports which backend leads — that is an observation, not a verdict.
    expect(block.lead_backend).toBe("composer");
  });

  test("a repaired lead records all three fields", () => {
    const decision = select(
      inputsOf({
        registry: entriesFor("gpt-5.5", "grok-4.5"),
        snapshot: snapshotOf([
          rungOf("grok-4.5", { score: 0.667, usdPerTask: 1.51 }),
          rungOf("gpt-5.5", { effort: "high", score: 0.584, usdPerTask: 2.05 }),
        ]),
        request: requestOf({
          leadPolicy: {
            incumbentLeadBackend: "codex",
            displacementRule: "band-improvement-only",
          },
        }),
      }),
    );
    const block = selectionTraceFrom(decision, { executed: true });
    expect(block.lead_repair).toEqual({
      from: "grok-4.5@none",
      to: "gpt-5.5@high",
      reason: "lead-backend-coherence",
    });
    expect(block.lead_displaced).toBe(false);
    expect(block.lead_displaced_by_availability).toBe(false);
  });

  test("absence survives a JSON round trip", () => {
    // `undefined` disappears in serialization, so an omitted field stays omitted
    // rather than arriving as an explicit null a reader would read as "checked".
    const block = selectionTraceFrom(select(inputsOf()), { executed: false });
    const round = JSON.parse(JSON.stringify(block));
    expect("lead_displaced" in round).toBe(false);
    expect(round.lead_backend).toBe("composer");
  });
});

describe("selectionTraceFrom: bounded lists", () => {
  test("a small decision reports no truncation at all", () => {
    const block = selectionTraceFrom(select(inputsOf()), { executed: false });
    expect(block.truncated).toEqual({
      eligible: 0,
      rejected: 0,
      pruned: 0,
      budget_constrained: 0,
      unranked: 0,
    });
  });

  test("the full registry clips `rejected` and counts what it dropped", () => {
    // taste-review is the route where this bites hardest: almost every rung in
    // the registry is ineligible for it, so `rejected` runs to 55 of the 61 rungs
    // the registry can generate.
    const decision = select(
      inputsOf({
        registry: [...MODEL_REGISTRY],
        snapshot: snapshotOf([]),
        request: requestOf({ capabilityRoute: "taste-review.read-only.v1" }),
      }),
    );
    const rejectedCount = decision.explanation.rejected.length;
    expect(rejectedCount).toBeGreaterThan(SELECTION_TRACE_LIST_LIMIT);

    const block = selectionTraceFrom(decision, { executed: false });
    expect(block.rejected).toHaveLength(SELECTION_TRACE_LIST_LIMIT);
    expect(block.truncated.rejected).toBe(
      rejectedCount - SELECTION_TRACE_LIST_LIMIT,
    );
    // Kept and dropped account for every entry, so the record never implies it
    // saw fewer rungs than it did.
    expect(block.rejected.length + block.truncated.rejected).toBe(rejectedCount);
    // The retained slice is the head of the evaluation order, not a sample.
    expect(block.rejected[0]?.rung_id).toBe(
      decision.explanation.rejected[0]!.rungId,
    );
  });

  test("clipping is deterministic for a fixed decision", () => {
    const decision = select(
      inputsOf({ registry: [...MODEL_REGISTRY], snapshot: snapshotOf([]) }),
    );
    expect(selectionTraceFrom(decision, { executed: false })).toEqual(
      selectionTraceFrom(decision, { executed: false }),
    );
  });

  test("an unmeasured registry clips the stack itself, not only the rejections", () => {
    // Every rung is unranked with no snapshot, and an unranked rung is never
    // pruned, so `eligible` — the returned stack — is the list that overflows on
    // an implement route. Worth pinning: this is the one clipped list that is not
    // diagnostic detail but the decision itself.
    const decision = select(
      inputsOf({ registry: [...MODEL_REGISTRY], snapshot: snapshotOf([]) }),
    );
    expect(decision.explanation.eligible.length).toBeGreaterThan(
      SELECTION_TRACE_LIST_LIMIT,
    );
    const block = selectionTraceFrom(decision, { executed: false });
    expect(block.eligible).toHaveLength(SELECTION_TRACE_LIST_LIMIT);
    expect(block.truncated.eligible).toBe(
      decision.explanation.eligible.length - SELECTION_TRACE_LIST_LIMIT,
    );
    // The lead is never the entry that gets dropped.
    expect(block.eligible[0]).toBe(decision.explanation.eligible[0]);
    expect(block.truncated.unranked).toBeGreaterThan(0);
  });
});

describe("selectionTraceFrom: labels are bounded-cardinality", () => {
  test("every rung the registry can generate survives the label boundary", () => {
    // The ADR claims `rungId` is safe as a metric label. This checks the claim
    // against the whole registry rather than a fixture, so a future stableId that
    // trips a redaction pattern fails here instead of quietly landing in traces
    // as `<path>`.
    for (const entry of MODEL_REGISTRY) {
      for (const rungId of rungsFor(entry)) {
        expect(boundedLabel(rungId)).toBe(rungId);
        expect(parseRungId(rungId)).not.toBeNull();
      }
    }
  });
});

describe("buildRoutingTraceV2: the selection block", () => {
  test("emits the block when a selection is supplied", () => {
    const record = buildRoutingTraceV2(traceInputOf(select(inputsOf()), true));
    expect(record.selection?.outcome).toBe("selected");
    expect(record.selection?.executed).toBe(true);
    expect(record.selection?.eligible).toContain("composer-2.5@none");
  });

  test("null says the selector did not run; absent says the writer cannot", () => {
    expect(buildRoutingTraceV2(traceInputOf(null)).selection).toBeNull();
    const withoutSelector = buildRoutingTraceV2(traceInputOf(undefined));
    expect("selection" in withoutSelector).toBe(false);
  });

  test("the block passes the v2 redaction boundary", () => {
    // `snapshotVersion` is hand-edited JSON, which makes it the realistic place
    // for something to arrive that should never reach a trace.
    const decision = select(
      inputsOf({
        snapshot: snapshotOf(
          [rungOf("composer-2.5", { score: 0.56, usdPerTask: 0.44 })],
          "/Users/someone/secrets/snapshot.json Bearer abc123def456ghi",
        ),
      }),
    );
    const record = buildRoutingTraceV2(traceInputOf(decision));
    expect(record.selection?.snapshot_version).not.toContain("/Users/");
    expect(record.selection?.snapshot_version).not.toContain("Bearer abc123");
    expect(record.selection?.snapshot_version).toContain("<redacted>");
  });

  test("the builder does not resurrect an omitted step-7 field", () => {
    const record = buildRoutingTraceV2(traceInputOf(select(inputsOf())));
    expect("lead_displaced" in record.selection!).toBe(false);
    expect("lead_repair" in record.selection!).toBe(false);
  });

  test("a record carrying a selection is still recognized as v2", () => {
    const record = buildRoutingTraceV2(traceInputOf(select(inputsOf())));
    expect(record.contract).toBe("orchestrator-routing-trace/v2");
    expect(record.legacy.run_id).toBe("run-test");
    expect(record.versions.policy).toBe("candidate-stacks/v1");
  });
});
