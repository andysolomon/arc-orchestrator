# 0010 — Capability-rung selection (snapshot + `select()`)

- Status: Proposed
- Date: 2026-07-24
- Work item: TBD
- Amends: `docs/orchestrator/decisions/0004-runner-routing-v2.md` (replaces its
  authored `workload_class` stacks with derived stacks; leaves the `task_class` /
  `workload_class` separation, the shared read-only chain, and the
  `--routing-policy runner-routing-v2` marker intact)
- Builds on: `decisions/0001-numeric-pricing-authority.md`,
  `decisions/0003-root-budgets-and-concurrency-limits.md`

## Context

Routing today decides among **models**. Three problems follow.

**1. Reasoning effort is invisible to routing.** `Effort` exists
(`trace-schema.ts:17`) but is a Codex-only spawn flag: `cli.ts:1457` rejects
`--effort` on every other backend, `spawn-adapter.ts:212` forwards it as
`model_reasoning_effort`, and it appears nowhere in `model-registry.ts`,
`capability-routes.ts`, or `routing-shadow.ts`. Public benchmark data shows this
discards most of the available cost/quality frontier:

| Model | Effort | DeepSWE v1.1 pass@1 | Avg cost/task |
| --- | --- | ---: | ---: |
| `gpt-5.6-sol` | medium | 61% ±2% | $1.86 |
| `gpt-5.6-sol` | max | 73% ±3% | $8.39 |
| `claude-fable-5` | low | 60% ±3% | $3.76 |
| `claude-fable-5` | max | 70% ±4% | $21.63 |
| `claude-opus-4.8` | xhigh | 54% ±4% | $8.01 |
| `claude-opus-4.8` | max | 59% ±2% | $13.22 |

A 12-point, 4.5×-cost spread inside one `stableId` is not expressible in a
`candidates: string[]` stack.

**2. Hard eligibility and soft ranking are conflated.** `routeEligibility`
(`model-registry.ts:71`) is a safety filter; `CandidateStack.candidates`
(`model-registry.ts:587-622`) is an editorial ordering. Both are hand-authored
`string[]`, so a ranking change and a safety change are the same kind of edit and
carry the same review burden.

**3. The ordering is asserted, not measured, and asserted three times.**
`MODEL_RANKINGS` (`routing-policy.ts:40`) scores `intelligence` and `taste` 1–10
by hand, and the same table is restated in `CLAUDE.md` and `README.md`. It has no
effort dimension, so it cannot distinguish `opus-4.8@xhigh` from `opus-4.8@max`.
Where public data exists it partly disagrees with the table: CursorBench 3.2 puts
`grok-4.5@high` at 66.7% / $1.51 against `opus-5@high` at 66.7% / $3.91, and
`grok-4.5@low` (63.5% / $1.22) above `fable-5@low` (62.1% / $4.46) — orderings the
tiering in `docs/diagrams/model-delegation-examples.excalidraw` does not predict.

Budget has the mirrored problem: `delegation-budget.ts` can only admit or reject a
dispatch (`tryReserveDispatch`, line 162). It cannot influence *which* candidate is
chosen, so a budget-poor root picks the same expensive candidate and fails
admission rather than picking a cheaper one that would have succeeded.

## Decision

### 1. The unit of selection is a **rung**: `(stableId, effort)`

`RungId` is `` `${stableId}@${Effort}` ``. Backends with no effort control
(`composer`, `opencode`) declare a single rung at `@none`. Effort becomes a
first-class registry field with per-backend supported levels, and `--effort`'s
backend restriction in `cli.ts:1457` is replaced by registry-driven validation.

### 2. The registry owns hard eligibility; the snapshot owns soft evidence

This split is the load-bearing part of the decision.

| | Registry (`model-registry.ts`) | Snapshot (`capability-snapshot.json`) |
| --- | --- | --- |
| Content | sandbox, output contract, route eligibility, context window, cancellation, auth scope, maturity, role restriction | benchmark scores, cost priors, quota pool, price band |
| Kind | deterministic filter | score used for ordering |
| Failure mode | unsafe dispatch | suboptimal-but-safe dispatch |
| Change process | contract review, full evidence gate | data refresh + validation |

Ranking can never widen authority. A snapshot with every score zeroed still
produces only dispatches that satisfy the canonical capability contract.

Candidate stacks stop being authored. `CandidateStack.candidates` becomes a
**derived artifact**: `rank(filter(rungs, contract), snapshot, ledger)`. This
extends the pattern already used for documentation, where
`defaultCodexRouteDefaults()` (`routing-policy.ts:228`) derives prose from the same
resolver execution uses.

### 3. Scores are quantized into bands, and dominated rungs are pruned

DeepSWE and CursorBench report ~113 tasks with ±2–6% error margins. Two rungs a
few points apart are statistically indistinguishable, so raw score ordering is
noise amplification.

- **Banding.** `band = floor(score / bandWidth)`. Validation **rejects** a
  snapshot whose `bandWidth` is less than `2 ×` the largest `errorMargin` among
  the measurements it quantizes. Ordering is by band; cost breaks ties *within* a
  band.
- **Pruning.** Rung `A` dominates `B` on an axis when
  `band(A) >= band(B) && usdPerTask(A) <= usdPerTask(B)`, with at least one strict.
  Dominated rungs stay in the snapshot for audit and are excluded from candidate
  generation, with `dominatedBy` recorded.

Banding is what reconstructs the three tiers of the budget diagram — derived from
measurement rather than asserted, and therefore able to place `grok-4.5@high`
beside `opus-5@high` where the data puts it.

### 4. USD and subscription quota are separate currencies

They deplete against different clocks and are not fungible; the hand-authored
`usageHeadroom` column tracks something real that the benchmarks' cost axis does
not.

Quota is nevertheless **ordering input, not an admission gate**. Subscription
remainders are frequently unobservable, so gating on them would fail closed on
missing data. It therefore does not belong in the ledger at all: `BudgetDimension`
is not expanded, the reserve/reconcile math in `delegation-budget.ts` is untouched,
every `RoutingTraceV2` budget field is unchanged, and `budget-limits/v1`
(decision 0003) remains the sole authority for admission with its numeric limits
intact.

Quota lives instead as observed state on `AvailabilityView.quotaPools` (below),
alongside backend health, where a `null` remainder degrades to "no preference"
rather than to "refuse". Each rung declares its `quotaPool` in the snapshot, and
step 5 of the evaluation order sorts scarcer pools last.

### 5. The capability floor comes from the task state machine

`workload_class` is the caller's freehand guess at difficulty. Its typed successor
is `capabilityFloor: CapabilityBand`, set by the state that is dispatching. This is
the seam through which the task lifecycle (a separate ADR) drives selection.

`select()` never silently lowers the floor. The request carries `minimumFloor`; if
the requested floor is unaffordable, selection may degrade toward `minimumFloor`
and **must** set `floorLowered: true` in the explanation. When
`minimumFloor === capabilityFloor`, it refuses with
`floor-unreachable-in-budget`.

### 6. `select()` is pure and returns an ordered stack

```ts
export function select(inputs: SelectionInputs): SelectionDecision;
```

It returns the **whole ordered stack**, not one rung, because the existing
one-pass traversal in `fallback-engine.ts` consumes a stack. That is the
integration seam: `select()` replaces the authored `CandidateStack.candidates` and
the traversal semantics of ADR 0008 (one attempt per candidate, one traversal, no
restart) are unchanged.

`select()` performs no I/O, reads no environment, and calls no clock. Every
time-dependent value arrives through `inputs`. Determinism for a fixed
`(request, registry, snapshot, ledger, availability, policyVersion)` is a test
invariant, satisfying the determinism requirement of
`model-tier-routing-plan.md:104`.

### Snapshot schema

```ts
export const CAPABILITY_SNAPSHOT_SCHEMA_VERSION = 1;

export type RungId = string;               // `${stableId}@${Effort}`
export type CapabilityBand = 0 | 1 | 2 | 3 | 4;

export type BenchmarkId = "deepswe.v1.1" | "cursorbench.3.2";
export type MeasurementSource = BenchmarkId | "editorial";

export type CapabilityAxis =
  | "swe"           // end-to-end SWE task completion (DeepSWE)
  | "agentic-edit"  // in-IDE multi-file edit (CursorBench)
  | "taste"         // UI/UX, API design, copy — editorial only
  | "long-context";

export type Measurement = {
  axis: CapabilityAxis;
  source: MeasurementSource;
  score: number;          // normalized 0..1
  errorMargin: number;    // absolute, same units as score
  sampleSize: number | null;    // null only for `editorial`
  sourceUrl: string | null;
  retrievedAt: string;    // ISO 8601 date
  expiresAt: string;      // ISO 8601 date
  approver: string | null;      // required when source is `editorial`
};

// Distinct from ModelRegistryEntry.numericPricing. Per decision 0001, the
// provider's published price list is the sole authority for *unit rates*
// (USD/MTok). A CostPrior is an *observed consumption* prior — how many units a
// rung tends to burn on a task of this shape — and its authority is the named
// benchmark run. Neither substitutes for the other: unit rate x consumption is
// what makes `estimatedUsd` meaningful, and a rung with numericPricing but no
// CostPrior is orderable by band but not by cost.
export type CostPrior = {
  source: BenchmarkId;
  usdPerTask: number;
  outputTokensPerTask: number;
  stepsPerTask: number;
  retrievedAt: string;
};

export type RungSnapshotEntry = {
  rungId: RungId;
  stableId: string;             // joins ModelRegistryEntry.stableId
  effort: Effort;
  measurements: Measurement[];
  costPrior: CostPrior | null;
  quotaPool: string | null;     // null for pay-per-token billing
  priceBand: PriceBand;
};

export type CapabilitySnapshot = {
  schemaVersion: typeof CAPABILITY_SNAPSHOT_SCHEMA_VERSION;
  snapshotVersion: string;      // opaque, monotonic; recorded in every trace
  bandWidth: number;            // >= 2 x max errorMargin (validated)
  rungs: RungSnapshotEntry[];
};
```

Validation rejects: unknown `stableId`; an `effort` the registry says the backend
does not support; duplicate `rungId`; `bandWidth` below the noise floor;
`editorial` measurements without `approver`; and any measurement past `expiresAt`
(which fails selection with `snapshot-expired` rather than degrading silently).

### `select()` types

```ts
export type SelectionRequest = {
  capabilityRoute: CanonicalCapabilityRouteId;
  axis: CapabilityAxis;
  capabilityFloor: CapabilityBand;
  minimumFloor: CapabilityBand;   // === capabilityFloor means "do not degrade"
  bandCeiling: CapabilityBand | null;   // eco mode; null = uncapped
  override: { stableId: string; effort: Effort | null } | null;
  taskIdentity: string;
  depth: number;
};

export type QuotaScope = {
  pool: string;                       // "codex" | "cursor" | "anthropic" | ...
  remainingFraction: number | null;   // null = unobservable -> no preference
  resetsAtMs: number | null;
};

export type AvailabilityView = {
  backends: Record<Backend, {
    state: "available" | "degraded" | "unavailable";
    classification: NormalizedFailureClass | null;
    observedAtMs: number;
  }>;
  quotaPools: Record<string, QuotaScope>;
};

export type SelectionInputs = {
  request: SelectionRequest;
  registry: readonly ModelRegistryEntry[];
  snapshot: CapabilitySnapshot;
  ledger: RootBudgetLedger;       // read-only; reservation still happens in the scheduler
  availability: AvailabilityView;
  policyVersion: string;
  nowMs: number;                  // injected, never read from a clock
};

export type SelectedRung = {
  rungId: RungId;
  stableId: string;
  effort: Effort;
  backend: Backend;
  band: CapabilityBand;
  estimatedUsd: number | null;
  quotaPool: string | null;
};

export type EligibilityRejection =
  | "route-ineligible"
  | "sandbox-unsupported"
  | "output-contract-unsupported"
  | "effort-unsupported"
  | "maturity-not-runnable"
  | "role-restricted"
  | "backend-unavailable"
  | "quota-pool-exhausted"
  | "below-capability-floor"
  | "above-band-ceiling";

export type SelectionRefusal =
  | "no-eligible-rung"
  | "floor-unreachable-in-budget"
  | "budget-exhausted"
  | "override-ineligible"
  | "snapshot-expired";

export type SelectionExplanation = {
  policyVersion: string;
  snapshotVersion: string;
  registryVersion: number;
  axis: CapabilityAxis;
  requestedFloor: CapabilityBand;
  effectiveFloor: CapabilityBand;
  floorLowered: boolean;
  overrideApplied: boolean;
  eligible: RungId[];
  rejected: Array<{ rungId: RungId; reason: EligibilityRejection }>;
  pruned: Array<{ rungId: RungId; dominatedBy: RungId }>;
  budgetConstrained: RungId[];
};

export type SelectionDecision =
  | { outcome: "selected"; stack: SelectedRung[]; explanation: SelectionExplanation }
  | { outcome: "refused"; reason: SelectionRefusal; explanation: SelectionExplanation };
```

`SelectionExplanation` is emitted on both outcomes, so a refusal is as auditable as
a selection. It satisfies the trace requirements of
`model-tier-routing-plan.md:143-156`; `rungId` is bounded-cardinality and safe as a
metric label.

### Evaluation order

1. Resolve the capability route; fix mode, sandbox, permissions, output contract.
2. Hard filter over all rungs — registry facts and `AvailabilityView` only.
   Snapshot scores are not consulted. `quota-pool-exhausted` fires only on an
   *observed* `remainingFraction === 0`, which is an availability fact; a `null`
   remainder never rejects.
3. Apply a validated override. It may bypass ordering, banding, and price policy;
   it may never bypass step 1 or role restrictions. An ineligible override refuses
   with `override-ineligible`.
4. Band, apply `bandCeiling`, drop rungs below `capabilityFloor`, prune dominated
   rungs.
5. Order by band descending, then `usdPerTask` ascending, then `quotaPool`
   preference (scarcer pools last), then `rungId` for total determinism.
6. Drop rungs whose `estimatedUsd` exceeds `ledger.remaining.cost`. If the set
   empties, degrade the floor one band at a time toward `minimumFloor`, recording
   `floorLowered`. If still empty, refuse.

Steps 1–3 preserve the precedence contract of `model-tier-routing-plan.md:96-104`
exactly. Steps 4–6 replace hand-authored ordering.

## Consequences

- **Eco mode stops being a hardcoded list.** `--orchestrator eco` currently pins
  `opus-explore → composer-implement → opus-check` by name
  (`routing-policy.ts:85`). It becomes `bandCeiling` plus a quota-pool preference,
  which preserves the no-silent-upgrade invariant structurally rather than by
  prose, and stops the eco stack from going stale as models change.
- **The three prose copies of `MODEL_RANKINGS` collapse to one data file.** Adding
  a model or refreshing a benchmark becomes a snapshot edit plus validation
  instead of a sweep across `routing-policy.ts`, `CLAUDE.md`, `README.md`, and the
  per-surface templates in `surface-templates.ts`.
- **`workload_class` gets a deprecation path.** The seven existing classes map onto
  `capabilityFloor` values. Both are accepted during migration; `workload_class`
  is recorded as observability metadata, consistent with how `task_class` is
  already treated.
- **Refusal becomes a real outcome.** `select()` can now decline before a
  dispatch is attempted. Callers must handle `refused` — today an unaffordable
  dispatch surfaces later as a `tryReserveDispatch` rejection with a
  `budget-*-exhausted` reason and no explanation of what was considered.
- **Snapshot staleness is a hard failure.** An expired measurement refuses rather
  than degrading, so a neglected snapshot is loud. This will fire in practice.
  Decision 0001 already fixes an authority and refresh policy for provider *price
  lists*; benchmark measurements have no equivalent and need one — a companion
  decision naming the authoritative benchmark versions, the refresh cadence, and
  the owner. Unlike a price list, a benchmark's task set changes between versions,
  so `snapshotVersion` must pin the benchmark version, not just the retrieval
  date.
- **Benchmark scores are aggregates, not per-task priors.** Banding is what makes
  them safe to use; anyone tempted to sort on raw score reintroduces the noise the
  band width exists to absorb. The `2 × errorMargin` validation is the guard, and
  it must not be relaxed to fit more bands.
- **`taste` has no public benchmark.** It stays `editorial` with a required
  approver and expiry. Taste-sensitive routing therefore remains the least
  evidence-backed axis, and `taste-review.read-only.v1` keeps its existing
  single-candidate treatment until that changes.
- **Rollout uses machinery that already exists.** `select()` runs under
  `routing-shadow.ts` against the authored stacks with no execution change; the
  disagreement set is the test corpus and the evidence for promotion through the
  `rollout-gates.ts` stages. Rollback is deleting the snapshot file and reverting
  to the authored stacks.
- **ADR 0008 is preserved.** Retry budget, price-band crossing guard, and one-pass
  traversal semantics operate unchanged on the derived stack. `BoundaryCrossing`
  keys on `priceBand`, which the snapshot still carries per rung.
- **Not decided here.** The task-lifecycle state machine
  (`INTAKE → … → VERIFY → {ACCEPT | ESCALATE | REPLAN}`) that supplies
  `capabilityFloor`, and the separation of lateral availability fallback from
  vertical quality escalation, are a follow-on ADR. This one deliberately stops at
  the selector so it can land behind existing gates.
