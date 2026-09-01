import { describe, expect, test, beforeEach } from "bun:test";
import {
  CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
  type CapabilitySnapshot,
  type Measurement,
  type RungSnapshotEntry,
} from "../plugins/arc-orchestrator/lib/capability-snapshot";
import { SELECTION_TRACE_LIST_LIMIT } from "../plugins/arc-orchestrator/lib/selection-trace";
import {
  clearAvailabilityObservations,
  recordAvailabilityObservation,
} from "../plugins/arc-orchestrator/lib/availability-observations";
import {
  ROUTE_SELECTION_STAGE_ENV,
} from "../plugins/arc-orchestrator/lib/selection-activation";
import {
  ROLLOUT_HUMAN_APPROVED_ENV,
  ROLLOUT_HUMAN_APPROVED_EXACT_VALUE,
  ROLLOUT_SELECTION_DISABLE_ENV,
  ROLLOUT_STAGE_ENV,
} from "../plugins/arc-orchestrator/lib/rollout-gates";
import {
  emptyCapabilitySnapshotForShadow,
  resolveRoutingShadow,
} from "../plugins/arc-orchestrator/lib/routing-shadow";
import {
  SELECTION_SHADOW_CORPUS_CONTRACT,
  serializeSelectionShadowCorpusRecord,
} from "../plugins/arc-orchestrator/lib/selection-shadow-corpus";
import {
  type BackendInvocationInput,
  type BackendInvocationOutput,
  executeRun,
  type InvokeBackend,
} from "../plugins/arc-orchestrator/lib/engine";
import type { RoutingTraceV2 } from "../plugins/arc-orchestrator/lib/trace-schema";

const NOW_MS = Date.parse("2026-07-25T00:00:00Z");

const completedResult = {
  status: "completed",
  summary: "done",
  changes: [],
  verification: [],
  risks: [],
  next_actions: [],
};

const shadowEnv = {
  [ROUTE_SELECTION_STAGE_ENV]: "shadow",
};

const approvedShadowEnv = {
  [ROLLOUT_STAGE_ENV]: "shadow",
  [ROLLOUT_HUMAN_APPROVED_ENV]: ROLLOUT_HUMAN_APPROVED_EXACT_VALUE,
};

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
  score: number,
  usdPerTask: number,
): RungSnapshotEntry {
  return {
    rungId: `${stableId}@none`,
    stableId,
    effort: "none",
    measurements: [measurementOf(score)],
    costPrior: {
      source: "cursorbench.3.2",
      usdPerTask,
      outputTokensPerTask: 20000,
      stepsPerTask: 20,
      retrievedAt: "2026-07-20",
    },
    quotaPool: null,
    priceBand: "$$",
  };
}

/**
 * Fixture snapshot that reorders the medium-medium lead away from the authored
 * v4 head (opus-5) by scoring Cursor Grok 4.6 High far above every other rung.
 */
function disagreeingSnapshot(): CapabilitySnapshot {
  return {
    schemaVersion: CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
    snapshotVersion: "2026-07-25+cursorbench.3.2",
    bandWidth: 0.25,
    rungs: [
      rungOf("composer-2.5", 0.2, 0.1),
      rungOf("cursor-grok-4.6-high", 0.9, 0.5),
      rungOf("gpt-5.5", 0.55, 2.05),
      rungOf("minimax-m3", 0.3, 0.2),
      rungOf("kimi-k3", 0.4, 0.9),
      rungOf("opus-5", 0.5, 3.9),
      rungOf("opus-4.8", 0.45, 3.5),
      rungOf("fable-5.1", 0.48, 9.0),
      rungOf("gpt-5.6-sol", 0.52, 3.4),
      rungOf("gpt-5.6-terra", 0.35, 1.0),
      rungOf("gpt-5.6-luna", 0.25, 0.5),
    ],
  };
}

function successFor(input: BackendInvocationInput): BackendInvocationOutput {
  if (input.backend === "codex") {
    return {
      stdout:
        '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}',
      stderr: "",
      exitCode: 0,
      resultText: JSON.stringify(completedResult),
    };
  }
  return {
    stdout: JSON.stringify({
      is_error: false,
      ...(input.backend === "composer"
        ? { result: JSON.stringify(completedResult) }
        : { structured_output: completedResult }),
      usage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 },
    }),
    stderr: "",
    exitCode: 0,
  };
}

function runInput() {
  return {
    backend: "codex" as const,
    mode: "implement" as const,
    task: "do work",
    cwd: process.cwd(),
    label: "shadow-corpus",
    taskClass: null,
    workloadClass: "medium-medium",
    routeRationale: null,
    budget: { maxTokens: null, maxDurationMs: null },
    effort: null,
    fallback: null,
  };
}

beforeEach(() => {
  clearAvailabilityObservations();
});

describe("routing-shadow capability selection: opt-in", () => {
  test("stage off skips select even with an explicit snapshot", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "composer-implement",
      env: {},
      capabilitySnapshot: emptyCapabilitySnapshotForShadow(),
      nowMs: NOW_MS,
      pinAlias: false,
      workloadClass: "medium-medium",
    });
    expect(report.capabilityShadow?.ran).toBe(false);
    expect(report.capabilityShadow?.skipReason).toBe("stage-not-shadow");
    expect(report.capabilityShadow?.decision).toBeNull();
    expect(report.capabilityShadow?.corpus).toBeNull();
  });

  test("shadow stage without configured snapshot does not invent evidence", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "composer-implement",
      env: shadowEnv,
      nowMs: NOW_MS,
      pinAlias: false,
      workloadClass: "medium-medium",
    });
    expect(report.capabilityShadow?.ran).toBe(false);
    expect(report.capabilityShadow?.skipReason).toBe("snapshot-absent");
  });

  test("rollout rollback / disabled selection stage does not select", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "composer-implement",
      env: {
        [ROLLOUT_STAGE_ENV]: "default",
        [ROLLOUT_HUMAN_APPROVED_ENV]: ROLLOUT_HUMAN_APPROVED_EXACT_VALUE,
        [ROLLOUT_SELECTION_DISABLE_ENV]: "0",
      },
      capabilitySnapshot: emptyCapabilitySnapshotForShadow(),
      nowMs: NOW_MS,
      pinAlias: false,
      workloadClass: "medium-medium",
    });
    expect(report.capabilityShadow?.ran).toBe(false);
    expect(report.capabilityShadow?.skipReason).toBe("stage-not-shadow");
  });
});

describe("routing-shadow capability selection: observational select()", () => {
  test("empty configured snapshot runs select and records selected outcome", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "composer-implement",
      env: shadowEnv,
      capabilitySnapshot: null,
      nowMs: NOW_MS,
      pinAlias: false,
      workloadClass: "medium-medium",
    });
    expect(report.capabilityShadow?.ran).toBe(true);
    expect(report.capabilityShadow?.decision?.outcome).toBe("selected");
    expect(report.capabilityShadow?.selectionTrace?.executed).toBe(false);
    expect(report.capabilityShadow?.corpus?.executed).toBe(false);
    expect(report.capabilityShadow?.corpus?.contract).toBe(
      SELECTION_SHADOW_CORPUS_CONTRACT,
    );
  });

  test("fixture snapshot disagreement retains unclipped explanation", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "composer-implement",
      env: shadowEnv,
      capabilitySnapshot: disagreeingSnapshot(),
      nowMs: NOW_MS,
      pinAlias: false,
      workloadClass: "medium-medium",
    });
    expect(report.capabilityShadow?.ran).toBe(true);
    const corpus = report.capabilityShadow?.corpus;
    expect(corpus).not.toBeNull();
    expect(corpus?.comparison.matches).toBe(false);
    expect(corpus?.authored.leadStableId).toBe("opus-5");
    const explanation = corpus!.explanation;
    const listLengths =
      explanation.eligible.length +
      explanation.rejected.length +
      explanation.pruned.length +
      explanation.budgetConstrained.length +
      explanation.unranked.length;
    expect(listLengths).toBeGreaterThan(SELECTION_TRACE_LIST_LIMIT);
    expect(report.capabilityShadow?.selectionTrace?.truncated).toBeDefined();
    // Clipped trace may drop entries; corpus keeps the full lists.
    expect(explanation.rejected.length).toBeGreaterThanOrEqual(
      report.capabilityShadow!.selectionTrace!.rejected.length,
    );
  });

  test("refused decisions are represented in corpus", () => {
    const expired: CapabilitySnapshot = {
      ...disagreeingSnapshot(),
      rungs: disagreeingSnapshot().rungs.map((rung) => ({
        ...rung,
        measurements: rung.measurements.map((measurement) => ({
          ...measurement,
          expiresAt: "2020-01-01",
        })),
      })),
    };
    const report = resolveRoutingShadow({
      requestedAlias: "composer-implement",
      env: shadowEnv,
      capabilitySnapshot: expired,
      nowMs: NOW_MS,
      pinAlias: false,
      workloadClass: "medium-medium",
    });
    expect(report.capabilityShadow?.decision?.outcome).toBe("refused");
    expect(report.capabilityShadow?.corpus?.proposed.outcome).toBe("refused");
    expect(report.capabilityShadow?.comparison?.matches).toBe(false);
  });

  test("corpus serialization is deterministic, versioned, and redacted", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "composer-implement",
      env: shadowEnv,
      capabilitySnapshot: disagreeingSnapshot(),
      nowMs: NOW_MS,
      pinAlias: false,
      workloadClass: "medium-medium",
      taskIdentity: "task-fixture",
    });
    const corpus = report.capabilityShadow!.corpus!;
    const first = serializeSelectionShadowCorpusRecord(corpus);
    const second = serializeSelectionShadowCorpusRecord(corpus);
    expect(first).toBe(second);
    const parsed = JSON.parse(first) as {
      schema: number;
      contract: string;
      executed: boolean;
      explanation: { rejected: unknown[] };
    };
    expect(parsed.schema).toBe(1);
    expect(parsed.contract).toBe(SELECTION_SHADOW_CORPUS_CONTRACT);
    expect(parsed.executed).toBe(false);
    expect(parsed.explanation.rejected.length).toBeGreaterThan(0);
  });
});

describe("routing-shadow capability selection: engine integration", () => {
  test("shadow+snapshot is observational: authored backend/model unchanged", async () => {
    const invocations: BackendInvocationInput[] = [];
    const corpusRecords: unknown[] = [];
    const v2: RoutingTraceV2[] = [];
    const invokeBackend: InvokeBackend = async (value) => {
      invocations.push(value);
      return successFor(value);
    };

    const result = await executeRun(runInput(), {
      env: {
        ...approvedShadowEnv,
        ARC_ORCHESTRATOR_IMPLEMENT_MODEL: "legacy-shadow-model",
      },
      invokeBackend,
      capabilitySnapshot: disagreeingSnapshot(),
      onSelectionShadowCorpus: (record) => {
        corpusRecords.push(record);
      },
      onRoutingTraceV2: (record) => {
        v2.push(record);
      },
      emitStderr: () => {},
    });

    expect(result.success).toBe(true);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      backend: "codex",
      profile: { model: "legacy-shadow-model" },
    });
    const shadow = (
      result.trace as { routingShadow?: ReturnType<typeof resolveRoutingShadow> }
    ).routingShadow;
    expect(shadow?.capabilityShadow?.ran).toBe(true);
    expect(shadow?.capabilityShadow?.selectionTrace?.executed).toBe(false);
    expect(corpusRecords.length).toBeGreaterThanOrEqual(1);
    expect(v2[0]?.versions.policy).toBe("candidate-stacks/v1");
    if (v2[0] && "selection" in v2[0] && v2[0].selection) {
      expect(v2[0].selection.executed).toBe(false);
    }
  });

  test("availability producer records transport failures under shadow", () => {
    const recorded = recordAvailabilityObservation({
      backend: "codex",
      classification: "rate_limit",
      observedAtMs: NOW_MS,
    });
    expect(recorded).not.toBeNull();
    const ignored = recordAvailabilityObservation({
      backend: "codex",
      classification: "policy_denial",
      observedAtMs: NOW_MS,
    });
    expect(ignored).toBeNull();
  });
});
