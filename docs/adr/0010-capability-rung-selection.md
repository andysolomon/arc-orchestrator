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
- Reconciled 2026-07-25 against PRs #231–#237, which all landed after drafting:
  Opus 5 promoted to first-tier Claude worker and `effortFloor` added to
  `MODEL_RANKINGS` (#231); eco worker pins derived from the registry (#234);
  rankings recalibrated on high-effort benchmark data (#235); `medium-hard-work`
  lead corrected (#236); `grok-4.5` ranked from CursorBench and promoted out of
  the availability tier (#237). See Context §1 and §3, the `effortFloor`
  consequence, the step 7 stack-constraint stage that resolves the provider-switch
  gap #237 surfaced, and the one gap left open (inter-suite conflict resolution).

## Context

Routing today decides among **models**. Three problems follow.

**1. Effort is acknowledged but not selectable.** PR #231 (`32184f4`, merged
2026-07-24, after this ADR was drafted) added an `effortFloor` field to
`MODEL_RANKINGS` whose doc comment states the case independently: *"We weigh low,
medium, and high — not high alone — and degradation is model-specific, not a
uniform discount."* That is convergent evidence for this decision, and it means
the original framing of this problem — that effort was invisible — is no longer
accurate.

What `effortFloor` does not do is make effort **selectable**. It is one editorial
scalar per model, recording how far the dial can be turned down before a model
stops being useful; it is not a curve, it carries no cost, and it lives only in the
prose-rendering table. `Effort` itself (`trace-schema.ts:17`) is still a Codex-only
spawn flag — `cli.ts:1458` rejects `--effort` on every other backend,
`spawn-adapter.ts:212` forwards it as `model_reasoning_effort` — and it still
appears nowhere in `model-registry.ts`, `capability-routes.ts`, or
`routing-shadow.ts`. Selection cannot name a rung, so the frontier inside a model
remains unreachable:

| Rung | CursorBench 3.2 | Avg cost/task |
| --- | ---: | ---: |
| `opus-5@low` | 62.8% | $2.55 |
| `opus-5@medium` | 64.3% | $3.29 |
| `opus-5@high` | 66.7% | $3.91 |
| `opus-5@xhigh` | 69.3% | $7.35 |
| `opus-5@max` | 70.0% | $8.23 |

A five-rung, 7.2-point, 3.2×-cost ladder inside the model #231 just promoted to
first-tier Claude worker, none of which a `candidates: string[]` stack can express.

> **Updated 2026-07-25 (phase 13.1b).** Two of the three claims above have since
> been discharged. `Effort` is no longer Codex-only: it appears in
> `model-registry.ts` as `BACKEND_SUPPORTED_EFFORTS`, `cli.ts` validates against
> that declaration instead of a hardcoded backend check, and the claude adapter
> forwards the level as `CLAUDE_CODE_EFFORT_LEVEL`, so every rung in the table
> above is now reachable. What remains unfixed is the part this ADR actually
> decides: nothing *ranks* those rungs. `candidates: string[]` still cannot name
> one, and no data source is consulted when choosing among them. The ladder is
> addressable and unmeasured — which is the narrower, sharper form of the problem.
DeepSWE v1.1 shows the same shape elsewhere — `gpt-5.6-sol` runs 61% ±2% at $1.86
(medium) to 73% ±3% at $8.39 (max), and `claude-fable-5` 60% ±3% at $3.76 (low) to
70% ±4% at $21.63 (max), a 5.7× cost spread for ten points.

The measured ladder also partly **validates** and partly **fails to support**
#231's editorial floors, which is the provenance argument in miniature. `opus-5` is
assigned `effortFloor: "low"`, and CursorBench corroborates it: `opus-5@low` at
62.8% beats `fable-5@low` at 62.1% and sits 1.5 points under `opus-5@medium`.
`opus-4.8` is assigned `effortFloor: "medium"`, but published data covers only its
`xhigh` (54% ±4%, $8.01) and `max` (59% ±2%, $13.22) rungs — so that floor is
currently unfalsifiable from any source the registry names.

**2. Hard eligibility and soft ranking are conflated.** `routeEligibility`
(`model-registry.ts:71`) is a safety filter; `CandidateStack.candidates`
(`model-registry.ts:632-650`) is an editorial ordering. Both are hand-authored
`string[]`, so a ranking change and a safety change are the same kind of edit and
carry the same review burden.

**3. The ordering is asserted, not measured, asserted three times, and volatile.**
`MODEL_RANKINGS` (`routing-policy.ts:106`) scores `intelligence` and `taste` 1–10
by hand, and the same table is restated in `CLAUDE.md` and `README.md`. Even with
`effortFloor` added it holds one score per model, so it still cannot distinguish
`opus-5@low` from `opus-5@max` — five rungs spanning 7.2 points collapse to a
single `intelligence: 9`.

Where public data exists it has disagreed with the table, and the table is now
being corrected by hand, one PR at a time. #235 recalibrated the rankings on
high-effort benchmark data; #237 then ranked `grok-4.5` from CursorBench and
promoted it out of the availability tier on the evidence that CursorBench has it
level with or ahead of `opus-5` across the usable band — 63.5% / $1.22 versus 62.8%
/ $2.55 at low, 65.4% / $1.54 versus 64.3% / $3.29 at medium, tied at 66.7% at high
against $3.91 — top-tier capability at roughly a third the cost.

That is this ADR's thesis being executed manually. Each such correction currently
costs a sweep across `MODEL_RANKINGS`, the candidate stacks, `CLAUDE.md`,
`README.md`, and the per-surface templates, with the evidence recorded only in the
commit message and no field in which the next reader can find it. The point is not
that these judgments are wrong — #237's reasoning is careful and its conclusion is
well argued — but that the system has no place to put the reasoning, so it survives
only in git history.

The scores also move sharply without recorded evidence. #231 alone shifted
`gpt-5.6-terra` from 8 to 5 and `gpt-5.6-luna` from 6 to 4 — three- and two-point
swings on a ten-point scale, in a PR whose stated subject was adding Opus 5 — while
`opus-4.8` went 7 to 6 and `grok-4.5` and `kimi-k3` entered at 9 and 8. Those may
each be correct judgments, but the table has no field in which to say why, when, or
on what basis, and no way to distinguish a re-measurement from a re-estimate.

Budget has the mirrored problem: `delegation-budget.ts` can only admit or reject a
dispatch (`tryReserveDispatch`, line 162). It cannot influence *which* candidate is
chosen, so a budget-poor root picks the same expensive candidate and fails
admission rather than picking a cheaper one that would have succeeded.

## Decision

### 1. The unit of selection is a **rung**: `(stableId, effort)`

`RungId` is `` `${stableId}@${Effort}` ``. Backends with no effort control
(`composer`, `opencode`) declare a single rung at `@none`. Effort becomes a
first-class registry field with per-backend supported levels, and `--effort`'s
backend restriction in `cli.ts:1458` is replaced by registry-driven validation.

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
`defaultCodexRouteDefaults()` (`routing-policy.ts:327`) derives prose from the same
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
7. Validate and repair **stack-level** constraints on the final ordered list — see
   below. This runs last, after budget filtering, because budget can itself remove
   the lead.

Steps 1–3 preserve the precedence contract of `model-tier-routing-plan.md:96-104`
exactly. Steps 4–6 replace hand-authored ordering. Step 7 enforces invariants that
no per-rung predicate can express.

### Step 7: lead-backend coherence is a stack-level constraint

Steps 2 and 4 filter rungs individually. One real constraint cannot be expressed
that way, because it is a property of the assembled stack rather than of any rung
in it.

`isProviderSwitch` (`delegation-routing.ts:338`) compares the `transportBackend` of
the **first eligible stack candidate** against the selected candidate. When a caller
expresses a model preference, that preference is rejected with
`provider-switch-not-authorized-without-rate-limit` (`delegation-routing.ts:442`,
`:469`) unless it shares a backend with the stack lead, or the dispatch is a
rate-limit fallback, or an explicitly authorized `gpt-5.5` / `gpt-5.6-sol` case.

So **the lead's backend determines which caller preferences are satisfiable at all
in that class.** Reordering the lead is not a local improvement; it silently
invalidates every preference for the outgoing backend. #237 documents the live
case: CursorBench says `grok-4.5` should lead `medium-work`, beating `gpt-5.5` by
8.3 points at equal headroom, but leading would make the class Cursor-led and every
Codex-model preference in it would hard-fail. The lead was deliberately left with
`gpt-5.5` — *"a usage regression, not a test to update."*

The fix has two parts.

**Displacement requires a band improvement.** Within-band cost ordering may reorder
followers freely but may **never** displace the lead. Only a strictly higher band
can. This encodes #237's stated rule — displace an incumbent only on a clear
margin, never a tie — using machinery the ADR already has, and it reproduces #237's
own decisions: `grok-4.5` and `opus-5` tie at 66.7% at high, so they land in the
same band and grok cannot take the lead on its 3× cost advantage alone.

Band width is what makes this rule sound rather than lucky. Because `bandWidth` is
validated at `>= 2 x` the largest error margin, a band improvement is by
construction a difference the benchmark can actually resolve. A narrower band would
let an 8.3-point gap — well inside DeepSWE's ±2–6% margins when compounded — count
as a "clear margin" and displace `gpt-5.5` in `medium-work`, reintroducing exactly
the regression #237 declined to ship.

**Coherence is repaired, not refused.** When the top-ranked rung would change the
lead backend without a band improvement, promote the highest-ranked rung whose
backend matches the incumbent lead and record the repair. Refusing would be wrong:
the stack is still perfectly serviceable, just ordered differently than raw score
suggests.

```ts
export type LeadPolicy = {
  incumbentLeadBackend: Backend | null;   // null for a route with no incumbent
  displacementRule: "band-improvement-only";
};

export type LeadRepair = {
  from: RungId;
  to: RungId;
  reason: "lead-backend-coherence";
};
```

`SelectionRequest` gains `leadPolicy: LeadPolicy`, and `SelectionExplanation` gains:

```ts
  leadBackend: Backend | null;
  leadRepair: LeadRepair | null;
  leadDisplaced: boolean;                    // true only on a band improvement
  leadDisplacedByAvailability: boolean;      // incumbent backend had no eligible rung
```

`incumbentLeadBackend` is **derived from the existing stacks at migration**, not
newly authored — it is a record of what the lead is today, so the constraint
preserves current behavior by default rather than introducing a fresh hand-tuned
knob. Thereafter it changes only through a recorded decision.

When no rung of the incumbent backend survives step 2 or step 6, the lead backend
must change; that is an outage or a budget exhaustion, not a ranking choice, and it
sets `leadDisplacedByAvailability` so the two causes stay distinguishable in the
trace.

## Consequences

- **Eco mode stops being a hardcoded list.** `--orchestrator eco` currently pins
  `opus-explore → composer-implement → opus-check` by name
  (`routing-policy.ts:183`). It becomes `bandCeiling` plus a quota-pool preference,
  which preserves the no-silent-upgrade invariant structurally rather than by
  prose, and stops the eco stack from going stale as models change.
- **`effortFloor` is subsumed, not discarded.** #231's per-model floor becomes a
  derived property of the snapshot: the lowest-effort rung of a `stableId` that
  survives eligibility and clears the requested `capabilityFloor`. It stops being a
  separately maintained editorial scalar that can drift from the scores beside it.
  Migration should preserve each current floor as an explicit assertion, so any
  case where the measured ladder contradicts the authored floor surfaces as a test
  failure rather than a silent reordering — `opus-4.8@medium`, whose floor no
  published source currently covers, is the one to watch.
- **Coverage is uneven across the two benchmarks, and `opus-5` is the live case.**
  CursorBench 3.2 publishes a full five-rung `opus-5` ladder; the DeepSWE v1.1 rows
  do not include `opus-5` at all. So the model #231 just made first-tier Claude
  worker, taste-review owner, and eco-stack primary gets `agentic-edit`
  measurements and no `swe` measurement — orderable on one axis, not the other.
  This is the coverage rule working as designed rather than a defect, but it means
  the first populated snapshot ships with a visible hole in exactly its most
  important entry, and Phase 13.3 must record that rather than estimate across it.
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
- **Open gap — inter-suite conflict resolution.** The schema stores a
  `Measurement[]` per rung with a `source`, but says nothing about what to do when
  two suites disagree about the same rung. #237 shows this is live and consequential:
  `grok-4.5@high` read 54% on DeepSWE against 66.7% on CursorBench, a 12.7-point
  conflict, adjudicated in CursorBench's favour on reasoning the current schema
  cannot express — DeepSWE published a single effort tier for grok while giving
  every other model five, which suggests a limited or anomalous run, and
  CursorBench's per-effort curve is internally consistent. A `Measurement` needs
  somewhere to record suite precedence, a suspected-anomaly flag, or an explicit
  adjudication with its rationale. Averaging conflicting suites would have produced
  a materially wrong answer here.
- **The filter/rank split was incomplete, and step 7 is the correction.** The
  original decision assumed every hard constraint is a per-rung predicate that
  belongs in the eligibility filter. Lead-backend coherence is not: it is a
  property of the assembled stack, invisible to any test applied to a rung in
  isolation. Selection therefore has three stages, not two — filter, rank, then
  validate-and-repair the result. Any future invariant of the same shape (a
  property of the stack rather than of its members) belongs in step 7, and the
  existence of one such invariant is reason to expect others.
- **Ranking can now change behavior without changing eligibility.** Before step 7,
  the claim that a zeroed snapshot is safe rested on ranking being unable to affect
  anything but order. Lead-backend coherence shows order itself is load-bearing —
  a reorder invalidates caller preferences. The zeroed-snapshot property still
  holds (every dispatch still satisfies the capability contract), but the stronger
  intuition that "ranking is only a preference" does not, and step 7 is what keeps
  the weaker guarantee honest.
- **Not decided here.** The task-lifecycle state machine
  (`INTAKE → … → VERIFY → {ACCEPT | ESCALATE | REPLAN}`) that supplies
  `capabilityFloor`, and the separation of lateral availability fallback from
  vertical quality escalation, are a follow-on ADR. This one deliberately stops at
  the selector so it can land behind existing gates.
