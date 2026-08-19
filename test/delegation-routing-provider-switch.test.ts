import { describe, expect, test } from "bun:test";
import {
  capabilityRouteFor,
  type CanonicalCapabilityRouteId,
} from "../plugins/arc-orchestrator/lib/capability-routes";
import {
  deriveLeadPolicy,
  select,
  SELECTION_POLICY_VERSION,
  type SelectionInputs,
} from "../plugins/arc-orchestrator/lib/capability-selection";
import {
  CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
  type CapabilitySnapshot,
  type Measurement,
  type RungSnapshotEntry,
} from "../plugins/arc-orchestrator/lib/capability-snapshot";
import { resolveCapabilityFloor } from "../plugins/arc-orchestrator/lib/capability-floor";
import {
  evaluateCandidateEligibility,
  GPT_55_STABLE_ID,
  GPT_56_SOL_STABLE_ID,
  resolveDelegationRouting,
  resolveCanonicalRoute,
  type FixedRouteContract,
} from "../plugins/arc-orchestrator/lib/delegation-routing";
import {
  candidateStackForRoute,
  MODEL_REGISTRY,
  rungsFor,
  type CandidateStack,
} from "../plugins/arc-orchestrator/lib/model-registry";
import type { RootBudgetLedger } from "../plugins/arc-orchestrator/lib/delegation-budget";
import { selectionDecisionToCandidateStack } from "./selection-stack-adapter";

const NOW_MS = Date.parse("2026-07-25T00:00:00Z");
const IMPLEMENT = "implement.workspace-write.v1" as const;

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

function rungsWithScore(stableId: string, score: number): RungSnapshotEntry[] {
  const entry = MODEL_REGISTRY.find((row) => row.stableId === stableId);
  if (!entry) {
    throw new Error(`Missing fixture entry: ${stableId}`);
  }
  const rungIds = rungsFor(entry);
  const preferred =
    rungIds.find((id) => id.endsWith("@high")) ??
    rungIds.find((id) => id.endsWith("@none")) ??
    rungIds[0]!;
  const effort = preferred.slice(preferred.lastIndexOf("@") + 1);
  return [
    {
      rungId: preferred,
      stableId,
      effort: effort as RungSnapshotEntry["effort"],
      measurements: [measurementOf(score)],
      costPrior: {
        source: "cursorbench.3.2",
        usdPerTask: 1,
        outputTokensPerTask: 20000,
        stepsPerTask: 20,
        retrievedAt: "2026-07-20",
      },
      quotaPool: null,
      priceBand: "$$",
    } satisfies RungSnapshotEntry,
  ];
}

function ladderSnapshot(): CapabilitySnapshot {
  const scores: Record<string, number> = {
    "composer-2.5": 0.56,
    "cursor-grok-4.6-high": 0.667,
    "gpt-5.5": 0.584,
    "opus-5": 0.667,
    "opus-4.8": 0.6,
    "fable-5": 0.69,
    "gpt-5.6-sol": 0.69,
    "gpt-5.6-luna": 0.57,
    "cursor-kimi-k3": 0.52,
    "minimax-m3": 0.3,
  };
  return {
    schemaVersion: CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
    snapshotVersion: "2026-07-25+cursorbench.3.2",
    bandWidth: 0.25,
    rungs: Object.entries(scores).flatMap(([stableId, score]) =>
      rungsWithScore(stableId, score),
    ),
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
    clock: () => NOW_MS,
  };
}

function transportBackendOf(stableId: string): string {
  const entry = MODEL_REGISTRY.find((row) => row.stableId === stableId);
  if (!entry?.transportBackend) {
    throw new Error(`missing transport for ${stableId}`);
  }
  return entry.transportBackend;
}

function isProviderSwitch(
  firstStackEligible: string | null,
  selected: string,
): boolean {
  if (firstStackEligible == null || firstStackEligible === selected) {
    return false;
  }
  return transportBackendOf(firstStackEligible) !== transportBackendOf(selected);
}

function firstEligibleFromStack(
  routeId: CanonicalCapabilityRouteId,
  contract: FixedRouteContract,
  stack: { candidates: readonly string[] },
  preferred: readonly string[],
): string | null {
  for (const preferredId of preferred) {
    if (evaluateCandidateEligibility(preferredId, routeId, contract).eligible) {
      return preferredId;
    }
  }
  for (const stableId of stack.candidates) {
    if (evaluateCandidateEligibility(stableId, routeId, contract).eligible) {
      return stableId;
    }
  }
  return null;
}

function resolvePreferredOnStack(input: {
  routeId: CanonicalCapabilityRouteId;
  contract: FixedRouteContract;
  stack: { candidates: readonly string[] };
  preferred: readonly string[];
}): { ok: true; stableId: string } | { ok: false; reasons: string[] } {
  const firstStack = firstEligibleFromStack(
    input.routeId,
    input.contract,
    input.stack,
    [],
  );
  const preferredSelection = firstEligibleFromStack(
    input.routeId,
    input.contract,
    input.stack,
    input.preferred,
  );
  if (!preferredSelection) {
    return { ok: false, reasons: ["no-eligible-preferred-candidate"] };
  }
  if (isProviderSwitch(firstStack, preferredSelection)) {
    return {
      ok: false,
      reasons: ["provider-switch-not-authorized-without-rate-limit"],
    };
  }
  return { ok: true, stableId: preferredSelection };
}

type ResolvableCase = {
  label: string;
  requestedRoute: string;
  workloadClass?: string;
  preferred?: string;
};

const RESOLVABLE: ResolvableCase[] = [
  { label: "default", requestedRoute: "composer-implement" },
  {
    label: "easy-light",
    requestedRoute: "implement.workspace-write.v1",
    workloadClass: "easy-light",
  },
  {
    label: "medium-light",
    requestedRoute: "implement.workspace-write.v1",
    workloadClass: "medium-light",
    preferred: "gpt-5.6-luna",
  },
  {
    label: "medium-medium",
    requestedRoute: "implement.workspace-write.v1",
    workloadClass: "medium-medium",
    preferred: "gpt-5.6-luna",
  },
  {
    label: "medium-heavy",
    requestedRoute: "implement.workspace-write.v1",
    workloadClass: "medium-heavy",
    preferred: GPT_56_SOL_STABLE_ID,
  },
  {
    label: "hard-light",
    requestedRoute: "implement.workspace-write.v1",
    workloadClass: "hard-light",
    preferred: GPT_56_SOL_STABLE_ID,
  },
  {
    label: "hard-heavy",
    requestedRoute: "implement.workspace-write.v1",
    workloadClass: "hard-heavy",
    preferred: "fable-5",
  },
  { label: "explore", requestedRoute: "fable-explore", preferred: "fable-5" },
  { label: "check", requestedRoute: "fable-check", preferred: "fable-5" },
  { label: "taste-review", requestedRoute: "opus-review", preferred: "opus-5" },
];

function registryForImplementStack(
  workloadClass: string,
): ModelRegistryEntry[] {
  const authored = candidateStackForRoute(IMPLEMENT, null, workloadClass)!;
  return MODEL_REGISTRY.filter((entry) => authored.candidates.includes(entry.stableId)).map(
    (entry) => ({
      ...entry,
      supportedEfforts: entry.transportBackend === "composer" ? [] : (["high"] as const),
    }),
  );
}

function selectionInputsForImplement(
  workloadClass: string,
  leadPolicy?: ReturnType<typeof deriveLeadPolicy>,
): SelectionInputs {
  const authored = candidateStackForRoute(IMPLEMENT, null, workloadClass)!;
  const registry = registryForImplementStack(workloadClass);
  const resolved = resolveCapabilityFloor({
    workloadClass,
    inputs: {
      capabilityRoute: IMPLEMENT,
      axis: "agentic-edit",
      snapshot: ladderSnapshot(),
    },
  });
  return {
    request: {
      capabilityRoute: IMPLEMENT,
      axis: "agentic-edit",
      capabilityFloor: resolved.capabilityFloor,
      minimumFloor: resolved.minimumFloor,
      bandCeiling: resolved.bandCeiling,
      override: null,
      taskIdentity: `provider-switch-${workloadClass}`,
      depth: 1,
      ...(leadPolicy ? { leadPolicy } : {}),
    },
    registry,
    snapshot: ladderSnapshot(),
    ledger: ledgerWith(100),
    availability: { backends: {}, quotaPools: {} },
    policyVersion: SELECTION_POLICY_VERSION,
    nowMs: NOW_MS,
  };
}

function selectDerivedStack(
  routeId: CanonicalCapabilityRouteId,
  authored: CandidateStack,
  requestedAlias: string | null,
): CandidateStack {
  const registry = MODEL_REGISTRY.filter((entry) =>
    authored.candidates.includes(entry.stableId),
  ).map((entry) => ({
    ...entry,
    supportedEfforts:
      entry.transportBackend === "composer"
        ? []
        : entry.stableId === "opus-5"
          ? (["high"] as const)
          : (["high"] as const),
  }));
  const leadPolicy = deriveLeadPolicy(authored, MODEL_REGISTRY);
  const floor =
    routeId === IMPLEMENT
      ? resolveCapabilityFloor({
          workloadClass: authored.workloadClass ?? "default",
          inputs: {
            capabilityRoute: IMPLEMENT,
            axis: "agentic-edit",
            snapshot: ladderSnapshot(),
          },
        })
      : {
          capabilityFloor: 0 as const,
          minimumFloor: 0 as const,
          bandCeiling: null,
        };
  const decision = select({
    request: {
      capabilityRoute: routeId,
      axis: "agentic-edit",
      capabilityFloor: floor.capabilityFloor,
      minimumFloor: floor.minimumFloor,
      bandCeiling: floor.bandCeiling,
      override: null,
      taskIdentity: `derived-${routeId}-${requestedAlias ?? "auto"}`,
      depth: 1,
      leadPolicy,
    },
    registry,
    snapshot: ladderSnapshot(),
    ledger: ledgerWith(100),
    availability: { backends: {}, quotaPools: {} },
    policyVersion: SELECTION_POLICY_VERSION,
    nowMs: NOW_MS,
  });
  if (decision.outcome !== "selected") {
    return authored;
  }
  return selectionDecisionToCandidateStack(decision, authored);
}

describe("delegation-routing: no new provider-switch failures under select() order", () => {
  test.each(RESOLVABLE.map((row) => [row.label, row] as const))(
    "%s resolves via resolveDelegationRouting today",
    (_label, row) => {
      const result = resolveDelegationRouting({
        requestedRoute: row.requestedRoute,
        workloadClass: row.workloadClass ?? null,
        preferredCandidateStableIds: row.preferred ? [row.preferred] : undefined,
        toughTask: false,
      });
      expect(result.ok).toBe(true);
      if (result.ok && row.preferred) {
        expect(result.candidateStableId).toBe(row.preferred);
      }
    },
  );

  test("medium-medium preferred gpt-5.5 would provider-switch on unrepaired select() order", () => {
    const unrepaired = select({
      request: {
        capabilityRoute: IMPLEMENT,
        axis: "agentic-edit",
        capabilityFloor: 0,
        minimumFloor: 0,
        bandCeiling: null,
        override: null,
        taskIdentity: "provider-switch-medium-unrepaired",
        depth: 1,
      },
      registry: MODEL_REGISTRY.filter((entry) =>
        ["gpt-5.5", "cursor-grok-4.6-high"].includes(entry.stableId),
      ).map((entry) => ({
        ...entry,
        supportedEfforts: entry.stableId === "gpt-5.5" ? (["high"] as const) : [],
      })),
      snapshot: {
        schemaVersion: CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
        snapshotVersion: "2026-07-25+cursorbench.3.2",
        bandWidth: 0.25,
        rungs: [
          {
            rungId: "cursor-grok-4.6-high@high",
            stableId: "cursor-grok-4.6-high",
            effort: "high",
            measurements: [measurementOf(0.667)],
            costPrior: {
              source: "cursorbench.3.2",
              usdPerTask: 1.51,
              outputTokensPerTask: 20000,
              stepsPerTask: 20,
              retrievedAt: "2026-07-20",
            },
            quotaPool: null,
            priceBand: "$$",
          },
          {
            rungId: "gpt-5.5@high",
            stableId: "gpt-5.5",
            effort: "high",
            measurements: [measurementOf(0.584)],
            costPrior: {
              source: "cursorbench.3.2",
              usdPerTask: 2.05,
              outputTokensPerTask: 20000,
              stepsPerTask: 20,
              retrievedAt: "2026-07-20",
            },
            quotaPool: null,
            priceBand: "$$",
          },
        ],
      },
      ledger: ledgerWith(100),
      availability: { backends: {}, quotaPools: {} },
      policyVersion: SELECTION_POLICY_VERSION,
      nowMs: NOW_MS,
    });
    expect(unrepaired.outcome).toBe("selected");
    if (unrepaired.outcome !== "selected") {
      return;
    }
    const authored = candidateStackForRoute(IMPLEMENT, null, "medium-medium")!;
    const unrepairedStack = selectionDecisionToCandidateStack(unrepaired, authored);
    expect(unrepairedStack.candidates[0]).toBe("cursor-grok-4.6-high");

    const contract = capabilityRouteFor(IMPLEMENT);
    const fixed: FixedRouteContract = {
      mode: contract.mode,
      sandbox: contract.sandbox,
      outputContract: contract.outputContract,
    };
    const broken = resolvePreferredOnStack({
      routeId: IMPLEMENT,
      contract: fixed,
      stack: unrepairedStack,
      preferred: [GPT_55_STABLE_ID],
    });
    expect(broken).toEqual({
      ok: false,
      reasons: ["provider-switch-not-authorized-without-rate-limit"],
    });
  });

  test.each(
    ["medium-medium", "medium-light"].map((workloadClass) => [workloadClass] as const),
  )(
    "%s still resolves preferred candidate on step-7-repaired select() stack",
    (workloadClass) => {
      const authored = candidateStackForRoute(IMPLEMENT, null, workloadClass)!;
      const leadPolicy = deriveLeadPolicy(authored, MODEL_REGISTRY);
      const repaired = select(
        selectionInputsForImplement(workloadClass, leadPolicy),
      );
      expect(repaired.outcome).toBe("selected");
      if (repaired.outcome !== "selected") {
        return;
      }
      const repairedStack = selectionDecisionToCandidateStack(repaired, authored);
      const preferred = "gpt-5.6-luna";
      // Step 7 preserves the v4 incumbent Codex lead for both medium classes.
      expect(transportBackendOf(repairedStack.candidates[0]!)).toBe(
        leadPolicy.incumbentLeadBackend,
      );

      const contract = capabilityRouteFor(IMPLEMENT);
      const fixed: FixedRouteContract = {
        mode: contract.mode,
        sandbox: contract.sandbox,
        outputContract: contract.outputContract,
      };
      expect(
        resolvePreferredOnStack({
          routeId: IMPLEMENT,
          contract: fixed,
          stack: repairedStack,
          preferred: [preferred],
        }),
      ).toEqual({ ok: true, stableId: preferred });
    },
  );

  test.each(
    RESOLVABLE.filter((row) => row.preferred).map((row) => [row.label, row] as const),
  )(
    "%s preferred candidate still resolves on select()-derived stack order",
    (_label, row) => {
      const routeResolution = resolveCanonicalRoute(row.requestedRoute);
      expect(routeResolution.ok).toBe(true);
      if (!routeResolution.ok) {
        return;
      }
      const authored = candidateStackForRoute(
        routeResolution.canonicalRouteId,
        routeResolution.requestedAlias,
        row.workloadClass ?? null,
      )!;
      const derived = selectDerivedStack(
        routeResolution.canonicalRouteId,
        authored,
        routeResolution.requestedAlias,
      );
      const live = resolveDelegationRouting({
        requestedRoute: row.requestedRoute,
        workloadClass: row.workloadClass ?? null,
        preferredCandidateStableIds: [row.preferred!],
        toughTask: false,
      });
      expect(live.ok).toBe(true);
      if (!live.ok) {
        return;
      }
      expect(
        resolvePreferredOnStack({
          routeId: routeResolution.canonicalRouteId,
          contract: live.fixedContract,
          stack: derived,
          preferred: [row.preferred!],
        }),
      ).toEqual({ ok: true, stableId: row.preferred });
    },
  );
});
