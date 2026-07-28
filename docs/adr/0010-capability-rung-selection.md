# 0010 — Capability-rung selection (snapshot + `select()`)

- Status: Accepted
- Date: 2026-07-24
- Accepted: 2026-07-26
- Approver: Andrew Solomon (routing/capability)
- Work item: Phase 13 (13.1–13.12, closed 2026-07-26)
- Amends: `docs/orchestrator/decisions/0004-runner-routing-v2.md` (replaces its
  authored `workload_class` stacks with derived stacks; leaves the `task_class` /
  `workload_class` separation, the shared read-only chain, and the
  `--routing-policy runner-routing-v2` marker intact)
- Builds on: `decisions/0001-numeric-pricing-authority.md`,
  `decisions/0003-root-budgets-and-concurrency-limits.md`
- Companion: `decisions/0005-benchmark-authority-and-refresh-cadence.md`
  (`benchmark-policy/v1`, Accepted with this ADR)
- Implemented by: `capability-selection.ts`, `capability-snapshot.ts`,
  `capability-floor.ts`, `availability-view.ts`, `availability-observations.ts`,
  `selection-trace.ts`, `selection-shadow-corpus.ts`, and
  `plugins/orchestrator-core/capability-snapshot.json`

Phase 13 implementation corrections through 13.12 are folded into the Decision and
Consequences sections below; Accept records that code and contract now agree. The
decision was drafted before PRs #231–#237 landed and was reconciled against them on
2026-07-25: Opus 5 promoted to first-tier Claude worker (#231); eco worker pins
derived from the registry (#234); rankings recalibrated on high-effort benchmark
data and `effortFloor` added to `MODEL_RANKINGS` (#235); `medium-hard-work` lead
corrected (#236); `grok-4.5` ranked from CursorBench and promoted out of the
availability tier (#237).

`select()` is implemented, tested, and running observationally under
`routing-shadow.ts`. It does **not** yet drive dispatch: the authored
`CANDIDATE_STACKS` remain the executing policy, `versions.policy` still reports
`candidate-stacks/v1`, and promotion past shadow is a separate decision gated on
the disagreement corpus.

## Context

*This section describes the runner as it stood on 2026-07-24, when the decision was
drafted. Every problem named here has since been addressed by the decision itself;
it is retained as the record of what motivated it.*

Routing decided among **models**. Three problems followed.

**1. The effort ladder was unreachable, then addressable but unranked.** `Effort`
existed in `trace-schema.ts` but was a Codex-only spawn flag: `cli.ts` rejected
`--effort` on every other backend, and effort appeared nowhere in
`model-registry.ts`, `capability-routes.ts`, or `routing-shadow.ts`. Phases 13.1
and 13.1b discharged that half — `BACKEND_SUPPORTED_EFFORTS` declares support per
transport, `cli.ts` validates against that declaration rather than a hardcoded
backend check, and the claude adapter forwards the level as
`CLAUDE_CODE_EFFORT_LEVEL` — so every rung below is now dispatchable.

What remained is what this decision is actually about: **nothing ranked those
rungs.** `candidates: string[]` cannot name one, and no data source was consulted
when choosing among them. The ladder was addressable and unmeasured, which is the
narrower and sharper form of the problem.

| Rung | CursorBench 3.2 | Avg cost/task |
| --- | ---: | ---: |
| `opus-5@low` | 62.8% | $2.55 |
| `opus-5@medium` | 64.3% | $3.29 |
| `opus-5@high` | 66.7% | $3.91 |
| `opus-5@xhigh` | 69.3% | $7.35 |
| `opus-5@max` | 70.0% | $8.23 |

A five-rung, 7.2-point, 3.2×-cost ladder inside one `stableId`. DeepSWE v1.1 shows
the same shape elsewhere — `gpt-5.6-sol` runs 61% ±2% at $1.86 (medium) to 73% ±3%
at $8.39 (max), and `claude-fable-5` 60% ±3% at $3.76 (low) to 70% ±4% at $21.63
(max), a 5.7× cost spread for ten points.

PR #235 (`cd4fb51`) added an `effortFloor` scalar to `MODEL_RANKINGS`, whose doc
comment stated the case independently: *"We weigh low, medium, and high — not high
alone — and degradation is model-specific, not a uniform discount."* That was
convergent evidence for this decision, but it was one editorial scalar per model —
not a curve, carrying no cost, living only in a prose-rendering table. It is
subsumed here (see Consequences).

The measured ladder partly **validated** and partly **failed to support** those
editorial floors, which is the provenance argument in miniature. `opus-5` was
assigned `effortFloor: "low"`, and CursorBench corroborates it: `opus-5@low` at
62.8% beats `fable-5@low` at 62.1% and sits 1.5 points under `opus-5@medium`.
`opus-4.8` was assigned `effortFloor: "medium"`, but published data covered only
its `xhigh` (54% ±4%, $8.01) and `max` (59% ±2%, $13.22) rungs — so that floor was
unfalsifiable from any source the registry named.

**2. Hard eligibility and soft ranking were conflated.** `routeEligibility` is a
safety filter; `CandidateStack.candidates` is an editorial ordering. Both were
hand-authored `string[]`, so a ranking change and a safety change were the same
kind of edit and carried the same review burden.

**3. The ordering was asserted, not measured, asserted three times, and volatile.**
`MODEL_RANKINGS` scored `intelligence` and `taste` 1–10 by hand, and the same table
was restated in `CLAUDE.md` and `README.md`. Even with `effortFloor` it held one
score per model, so it could not distinguish `opus-5@low` from `opus-5@max` — five
rungs spanning 7.2 points collapsed to a single `intelligence: 9`.

Where public data existed it disagreed with the table, and the table was corrected
by hand, one PR at a time. #235 recalibrated the rankings on high-effort benchmark
data; #237 then ranked `grok-4.5` from CursorBench and promoted it out of the
availability tier, on the evidence that CursorBench has it level with or ahead of
`opus-5` across the usable band — 63.5% / $1.22 versus 62.8% / $2.55 at low, 65.4%
/ $1.54 versus 64.3% / $3.29 at medium, tied at 66.7% at high against $3.91.

That is this decision's thesis being executed manually. Each correction cost a
sweep across `MODEL_RANKINGS`, the candidate stacks, `CLAUDE.md`, `README.md`, and
the per-surface templates. The point is not that the judgments were wrong — #237's
reasoning is careful and its conclusion well argued — but that the system had no
place to put the reasoning, so it survived only in git history.

The scores also moved sharply. #235 alone shifted `gpt-5.6-terra` from 8 to 5 and
`gpt-5.6-luna` from 6 to 4 — three- and two-point swings on a ten-point scale —
while `opus-4.8` went 7 to 6, `opus-5` 8 to 9, and `kimi-k3` entered at 8; #237
then entered `grok-4.5` at 9. That PR did state its basis, in a forty-line comment
block carrying both suites' per-effort figures, their capture date, and three named
unresolved conflicts — so the evidence was not missing. It was prose beside the
data rather than a field within it: nothing joined a score to the measurement that
produced it, nothing expired, and a re-measurement stayed indistinguishable from a
re-estimate.

Budget had the mirrored problem: `delegation-budget.ts` could only admit or reject
a dispatch. It could not influence *which* candidate was chosen, so a budget-poor
root picked the same expensive candidate and failed admission rather than picking a
cheaper one that would have succeeded.

## Decision

### 1. The unit of selection is a **rung**: `(stableId, effort)`

`RungId` is `` `${stableId}@${Effort}` ``. Backends with no effort control
(`composer`, `opencode`) declare a single rung at `@none`. Effort is a first-class
registry field with per-backend supported levels, and `--effort`'s backend
restriction is replaced by registry-driven validation.

`BACKEND_SUPPORTED_EFFORTS` declares only what `spawn-adapter` actually forwards.
The claude backend uses the `CLAUDE_CODE_EFFORT_LEVEL` env var rather than the
CLI's `--effort` flag: an unrecognised flag value warns and silently runs at the
default, which would make the trace attest to an effort never spent, whereas the
env var hard-fails (verified against Claude CLI 2.1.220, 2026-07-25). Trace
recording asks the registry which transports forward effort instead of testing
`backend === "codex"`. `minimax` is deliberately left unclaimed — same binary,
unverified endpoint.

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
`defaultCodexRouteDefaults()` derives prose from the same resolver execution uses.

### 3. Scores are quantized into bands, and dominated rungs are pruned

DeepSWE and CursorBench report ~113 tasks with ±2–6% error margins. Two rungs a few
points apart are statistically indistinguishable, so raw score ordering is noise
amplification.

- **Banding.** `band = floor(score / bandWidth)`. Ordering is by band; cost breaks
  ties *within* a band.
- **Pruning.** Rung `A` dominates `B` on an axis when
  `band(A) >= band(B) && usdPerTask(A) <= usdPerTask(B)`, with at least one strict.
  Dominated rungs stay in the snapshot for audit, are excluded from candidate
  generation, and record `dominatedBy`.

`bandWidth` has **two** validated bounds, not one. The noise floor —
`bandWidth >= 2 × errorMargin` — was in the original decision. Implementing the
validator turned up the ceiling it omitted: `CapabilityBand` is a closed
`0 | 1 | 2 | 3 | 4` and scores normalize to `0..1`, so `floor(score / bandWidth)`
also requires `bandWidth > 0.2` or a perfect score lands in a band the type cannot
hold. The ceiling is the constraint that binds in practice: at ±2–6% margins the
noise floor asks only for `0.12`, which every width satisfying the range rule
already clears, so at today's margins the noise floor can never reject a snapshot
the range rule accepts. Both are validated (`BAND_WIDTH_BELOW_NOISE_FLOOR`,
`BAND_WIDTH_EXCEEDS_BAND_RANGE`); the noise floor is kept because it is the one
that scales with the data — a suite reporting ±15% would lift it to `0.3` and start
rejecting widths the range rule permits. The feasible window is roughly
`(0.2, 0.25]` if all five bands are to be usable.

Banding is what reconstructs the three tiers of the budget diagram — derived from
measurement rather than asserted, and therefore able to place `grok-4.5@high`
beside `opus-5@high` where the data puts it.

### 4. USD and subscription quota are separate currencies

They deplete against different clocks and are not fungible; the hand-authored
`usageHeadroom` column tracked something real that the benchmarks' cost axis does
not.

Quota is nevertheless **ordering input, not an admission gate**. Subscription
remainders are frequently unobservable, so gating on them would fail closed on
missing data. It therefore does not belong in the ledger at all: `BudgetDimension`
is not expanded, the reserve/reconcile math in `delegation-budget.ts` is untouched,
every `RoutingTraceV2` budget field is unchanged, and `budget-limits/v1` (decision
0003) remains the sole authority for admission with its five numeric dimensions
intact.

Quota lives instead as observed state on `AvailabilityView.quotaPools`, alongside
backend health, where a `null` remainder degrades to "no preference" rather than to
"refuse". Each rung declares its `quotaPool` in the snapshot, and step 5 of the
evaluation order sorts scarcer pools last.

### 5. The capability floor comes from the task state machine

`workload_class` is the caller's freehand guess at difficulty. Its typed successor
is `capabilityFloor: CapabilityBand`, set by the state that is dispatching. This is
the seam through which the task lifecycle (ADR 0011) drives selection.

`select()` never silently lowers the floor. The request carries `minimumFloor`; if
the requested floor is unaffordable, selection may degrade toward `minimumFloor`
and **must** set `floorLowered: true` in the explanation. When
`minimumFloor === capabilityFloor`, it refuses with `floor-unreachable-in-budget`.

`capability-floor.ts` (`capability-floor/v1`) supplies the `workload_class` →
`capabilityFloor` mapping ADR 0011 left open — but not as the table both ADRs
assumed. Four facts about the class vocabulary, none visible from the names:

1. **The floors are derivable, so they are derived.** A class's floor is the band
   its authored lead already occupies, read through the same
   `candidateStackForRoute` the live router uses. "Do not go below what this class
   leads with today" is the migration guarantee stated exactly, and it is a fact
   about the stack rather than a judgment about the name. An authored column would
   be a hand-maintained scalar beside the data it summarizes, free to drift. It is
   read off the *lowest* ranked rung of the lead, because a `stableId` spans
   several rungs and today's dispatcher may run any of them — the highest would set
   a floor stricter than the thing being migrated, and a migration that starts
   refusing work it used to do is not one.
2. **The ladder is not monotone, and was not meant to be.**
   `medium-light-work`/`medium-work` and `hard-light-work`/`hard-work` hold
   identical candidate sets with the first two swapped; `-light-` marks usage
   headroom, not difficulty. Where the two leads sit in different bands the
   *lighter* class gets the higher floor — the cost trade
   `test/workload-ladder.test.ts` already excuses. Meanwhile `medium-hard-work` and
   `hard-work` both lead with `fable-5`, so no snapshot can ever separate them.
   Seven names, five leads, one sanctioned inversion: an authored column would have
   had to fabricate the missing distinctions or drop the real one.
3. **Degradation latitude is already authored — as `automaticFallback`.** A stack
   with automatic fallback runs its tail down to the weakest member
   (`composer-2.5` on every automatic implement stack), so `minimumFloor: 0` is the
   faithful translation; a pinned stack has nowhere to fall, which is
   `minimumFloor === capabilityFloor`. Migration grants no latitude the stacks did
   not already have. ADR 0011's `TaskBudgetPolicy` may widen or narrow it later,
   deliberately, which is where that decision belongs.
4. **Two classes state a ceiling, not a floor.** `default` pins `composer-2.5` and
   `light-work` pins `grok-4.5` — cheap, no fallback. Carrying only a floor inverts
   them: floor 0 admits everything and `select()` orders by band descending, so the
   cost-pinned classes would lead with the *most* capable rung available. They
   therefore also carry `bandCeiling`, the vocabulary this decision already has for
   eco mode. This is a correctness requirement, not a refinement, and a test shows
   the uncapped selection picking the dearest rung.

Two consequences worth stating rather than discovering. **Deriving the floor is
what keeps the rollback real:** rollback is "delete the snapshot", and absence
stays a supported state, but `select()` rejects an unranked rung against any floor
above 0 — so a guessed non-zero floor would turn deletion into a refusal of every
medium-and-up dispatch. With no snapshot every derived floor is 0 and the mapping
declines to make a claim, including the cost pins, which lose their ceiling too.
That is what rollback costs, and it is the honest price. **And a derived floor can
never be unreachable**, because it is always a band some rung occupies. An authored
table could not promise that: bands quantize a 0..1 score and the validator holds
`bandWidth > 0.2`, so band 4 needs a score above 0.8 that no published suite result
approaches — a table assigning `hard-work` a floor of 4 would refuse every dispatch
while looking like a considered policy.

Dual acceptance during migration: an explicit floor wins, because it comes from the
state that is dispatching. The derived floor is returned beside it either way — the
interesting number is not which floor ran but whether the two agree, and the shadow
corpus cannot measure that if the loser is dropped at the seam. An explicit floor
does *not* inherit the class's ceiling: a caller stating a floor has stated its
whole request.

The demotion of `workload_class` to observability metadata is **enforced, not
asserted**: `capability-selection.ts` contains no reference to it, and a test fails
if one appears. `bandForSnapshotEntry` is exported from `capability-selection.ts`
rather than restating decision 0005's precedence rule, which is the drift this
decision exists to prevent.

### 6. `select()` is pure and returns an ordered stack

```ts
export function select(inputs: SelectionInputs): SelectionDecision;
```

It returns the **whole ordered stack**, not one rung, because the existing one-pass
traversal in `fallback-engine.ts` consumes a stack. That is the integration seam:
`select()` replaces the authored `CandidateStack.candidates`, and the traversal
semantics of ADR 0008 (one attempt per candidate, one traversal, no restart) are
unchanged.

`select()` performs no I/O, reads no environment, and calls no clock. Every
time-dependent value arrives through `inputs`. Determinism for a fixed
`(request, registry, snapshot, ledger, availability, policyVersion)` is a test
invariant, satisfying `model-tier-routing-plan.md:104`. Purity is tested rather
than asserted: the ledger fixture installs a throwing clock, since
`RootBudgetLedger` carries one and calling it would break determinism silently.

#### Snapshot schema

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
  bandWidth: number;            // >= 2 x max errorMargin, and > 0.2 (validated)
  rungs: RungSnapshotEntry[];
};
```

Validation rejects: unknown `stableId`; an `effort` the registry says the backend
does not support; duplicate `rungId`; `bandWidth` outside the window above;
`editorial` measurements without `approver`; any measurement past `expiresAt`
(which fails selection with `snapshot-expired` rather than degrading silently); a
`rungId` that disagrees with its own `stableId`/`effort`; a benchmark source on the
`taste` axis (no suite scores it); a benchmark measurement with a null `sampleSize`
(`null` is the editorial case); and an `expiresAt` at or before its own
`retrievedAt`.

Two properties of the validator are decisions rather than mechanics. Its argument
is `unknown`, not `CapabilitySnapshot`: unlike `validateModelRegistry`, whose input
is a TypeScript literal the compiler has already shaped, this input is a parsed
JSON file that a human edits, so structure is checked before meaning and a string
where a number belongs produces a named error rather than a crash. And `nowMs` is
injected: expiry is the only rule whose verdict depends on something other than the
file, and a validator that read a clock would make the same bytes valid and invalid
on different runs — the determinism `select()` is held to has to start here, since
expiry is the input `select()` turns into `snapshot-expired`.

Validation does **not** reject a rung whose registry entry is `planned`,
`disabled`, or route-ineligible. Maturity is a legitimate state for a measured
model to be in, and step 2 of the evaluation order already filters on it; rejecting
it here would make the snapshot a second eligibility authority, which is precisely
the split this decision exists to prevent. An unknown `stableId` is different in
kind — a dangling reference that can never join anything.

#### `select()` types

```ts
export type SelectionRequest = {
  capabilityRoute: CanonicalCapabilityRouteId;
  axis: CapabilityAxis;
  capabilityFloor: CapabilityBand;
  minimumFloor: CapabilityBand;   // === capabilityFloor means "do not degrade"
  bandCeiling: CapabilityBand | null;   // eco mode; null = uncapped
  override: { stableId: string; effort: Effort | null } | null;
  leadPolicy?: LeadPolicy;        // optional; absent means step 7 did not run
  taskIdentity: string;
  depth: number;
};

export type QuotaScope = {
  pool: string;                       // "codex" | "cursor" | "anthropic" | ...
  remainingFraction: number | null;   // null = unobservable -> no preference
  resetsAtMs: number | null;
};

export type AvailabilityView = {
  backends: Partial<Record<Backend, {
    state: "available" | "degraded" | "unavailable";
    classification: NormalizedFailureClass | null;
    observedAtMs: number;
  }>>;
  quotaPools: Record<string, QuotaScope>;
};

export type SelectionInputs = {
  request: SelectionRequest;
  registry: readonly ModelRegistryEntry[];
  snapshot: CapabilitySnapshot;
  ledger: RootBudgetLedger;       // read-only; reservation stays in the scheduler
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
  unranked: RungId[];
  budgetConstrained: RungId[];
  leadBackend?: Backend | null;
  leadRepair?: LeadRepair | null;
  leadDisplaced?: boolean;                 // true only on a band improvement
  leadDisplacedByAvailability?: boolean;   // incumbent backend had no eligible rung
};

export type SelectionDecision =
  | { outcome: "selected"; stack: SelectedRung[]; explanation: SelectionExplanation }
  | { outcome: "refused"; reason: SelectionRefusal; explanation: SelectionExplanation };
```

`AvailabilityView` is built by `availability-view.ts` from timestamped
observations, and two of its rules run against instinct.

**Observations must expire, and quickly.** `select()` treats `unavailable` as a
hard rejection, so an unavailable verdict prevents the very dispatch that would
observe a recovery. Held too long, the state is self-reinforcing: a backend that
came back is never tried, so nothing ever notices. Expiring too early costs one
failed dispatch, which reclassifies immediately and self-corrects; expiring too
late costs capacity and does not. The window is 60s, matching
`RETRY_BUDGET_DEFAULT_WINDOW_MS`, overridable per call rather than per class — a
decay curve nobody has data for would be invention.

**Not every failure class describes a backend**, and the important half of the
mapping is which classes map to *nothing*. Every terminal class — `policy_denial`,
`sandbox_incompatible`, `invalid_configuration`, `deterministic_validation_error` —
describes the request, not the transport. Letting any of them mark a backend
unhealthy would allow one malformed request to take a provider out of rotation for
every task on the machine, a far worse failure than the one being reported. The
retryable classes split: `rate_limit`, `quota_exhausted`, `provider_outage`, and
`missing_binary` mean the transport could not carry the call and are `unavailable`;
`timeout` and `transient_network_or_adapter` reached it and are `degraded`.

**Quota decays toward unobservable, never toward zero.** Zero is the single value
that rejects (`quota-pool-exhausted`), so a stale zero would refuse dispatches
against quota that reset minutes ago. A stale or already-reset reading becomes
`remainingFraction: null` — the pool exists, its level is unknown — which is the
"no preference" state section 4 asks for. `resetsAtMs` is a second expiry condition
beside staleness, and this is where it earns its place in the type.

`backends` is `Partial<Record<Backend, …>>`: an unobserved backend is absent,
because recording it as `available` would claim an observation nobody made, and
`select()` reads absence as "nothing known". Ties break toward the more severe
state and the scarcer reading, so the view never depends on the order observations
were collected in.

#### Trace emission

`SelectionExplanation` is emitted on both outcomes, so a refusal is as auditable as
a selection. It lands as an optional `selection` block on
`orchestrator-routing-trace/v2` (`selection-trace.ts`), satisfying the trace
requirements of `model-tier-routing-plan.md:143-156`. The block is all primitives
and its mapping lives in its own module, because `capability-selection.ts` imports
`Backend` and `Effort` from `trace-schema.ts` and the reverse import would be a
cycle.

Three properties are load-bearing.

**A trace must say whether the selection happened.** Under shadow mode `select()`
runs beside the authored stack and the two may disagree, so the block can describe
a decision that no dispatch followed — and every other field looks identical either
way. `executed` is required with no default: guessing `true` would make the record
claim a dispatch it did not cause, guessing `false` would erase a real one. For the
same reason `versions.policy` stays `candidate-stacks/v1` while shadow-running: the
policy that *executed* is still the authored stack, even when a
`capability-rung/v1` selection sits beside it in the same record.

**Bounded cardinality covered label values, not list length.** `rungId` is safe as
a label value — `stableId` and `effort` are both closed sets — but nothing bounded
length, and measuring showed the gap is live rather than theoretical: the registry
generates 61 rungs, and against an empty snapshot `taste-review.read-only.v1`
rejects 55 while `implement.workspace-write.v1` leaves 41 unranked. Lists clip at
`SELECTION_TRACE_LIST_LIMIT` (32) with the dropped count recorded in `truncated`,
so a record is complete exactly when every count is zero. `eligible` is among the
clipped lists and is the decision itself rather than diagnostic detail, so **the
shadow corpus carries the unclipped explanation**; the per-dispatch trace is not
the place to reconstruct a full evaluation.

**Absent, null, and present are three states.** A missing `selection` key means the
record predates a writer that had a selector; `null` means the selector did not run
for this dispatch; a block means it did. That follows the `orchestrator_identity`
precedent already in the contract. Inside the block, step 7's three fields stay
omitted rather than defaulting to `false`, and that survives serialization because
`undefined` disappears in JSON where an explicit `false` would not.

### 7. Evaluation order

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
7. Validate and repair **stack-level** constraints on the final ordered list. This
   runs last, after budget filtering, because budget can itself remove the lead.

Steps 1–3 preserve the precedence contract of `model-tier-routing-plan.md:96-104`
exactly. Steps 4–6 replace hand-authored ordering. Step 7 enforces invariants that
no per-rung predicate can express.

### 8. Step 7: lead-backend coherence is a stack-level constraint

Steps 2 and 4 filter rungs individually. One real constraint cannot be expressed
that way, because it is a property of the assembled stack rather than of any rung
in it.

`isProviderSwitch` compares the `transportBackend` of the **first eligible stack
candidate** against the selected candidate. When a caller expresses a model
preference, it is rejected with `provider-switch-not-authorized-without-rate-limit`
unless it shares a backend with the stack lead, the dispatch is a rate-limit
fallback, or it is an explicitly authorized `gpt-5.5` / `gpt-5.6-sol` case.

So **the lead's backend determines which caller preferences are satisfiable at all
in that class.** Reordering the lead is not a local improvement; it silently
invalidates every preference for the outgoing backend. #237 documents the live
case: CursorBench says `grok-4.5` should lead `medium-work`, beating `gpt-5.5` by
8.3 points at equal headroom, but leading would make the class Cursor-led and every
Codex-model preference in it would hard-fail. The lead was deliberately left with
`gpt-5.5` — *"a usage regression, not a test to update."*

**Displacement requires a band improvement.** Within-band cost ordering may reorder
followers freely but may **never** displace the lead; only a strictly higher band
can. This encodes #237's stated rule — displace an incumbent only on a clear
margin, never a tie — using machinery this decision already has, and it reproduces
#237's own outcome: `grok-4.5` and `opus-5` tie at 66.7% at high, land in the same
band, and grok cannot take the lead on its 3× cost advantage alone. Band width is
what makes the rule sound rather than lucky: because `bandWidth >= 2 × errorMargin`,
a band improvement is by construction a difference the benchmark can resolve. A
narrower band would let an 8.3-point gap — well inside DeepSWE's ±2–6% margins when
compounded — count as a "clear margin" and reintroduce exactly the regression #237
declined to ship.

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

`incumbentLeadBackend` is **derived from the existing stacks at migration**, not
newly authored — `deriveLeadPolicy` reads `CANDIDATE_STACKS`, so a stack reorder
moves the incumbent instead of leaving a hand-copied backend behind. An
unresolvable lead throws rather than returning `null`, because `null` means "no
incumbent" and a typo must not silently become that.

Four properties of step 7 were established by implementing it, each correcting the
specification above.

**Step 4 removes the incumbent before step 7 can see it.** The design enumerated
steps 2 and 6 as the ways an incumbent-backend rung can vanish. It omitted step 4,
and step 4 is the one that actually fires: dominance pruning drops a same-band
costlier rung, and an incumbent lead being out-priced by a challenger is precisely
that shape. Both worked examples land there — `gpt-5.5` at $2.05 against
`grok-4.5` at $1.51 in `medium-work`, and `opus-5` at $3.91 against the same $1.51
in `medium-light-work`, all three in band 2 — so as originally written the repair
could never fire in either case it was designed for, and the lead would change while
the trace reported an availability displacement that had not happened. Step 7
therefore also receives the dominance-pruned set and may **reinstate** from it.
Dominance rests on "same band and cheaper is strictly better", and leading is the
one property that premise does not price; step 7 is the stage that knows this,
which is the same argument this section makes for why coherence cannot live in a
per-rung filter. Only dominance-pruned rungs are reinstatable — never one rejected
for eligibility, floor, ceiling, or budget — so every hard constraint is untouched
and step 7 cannot become a route around `budget-limits/v1`. A reinstated rung
appears in both `pruned` and `eligible`; both records are true, and `leadRepair` is
what joins them.

**`leadPolicy` is optional, not required.** `incumbentLeadBackend: null` already
means "this route has no incumbent". "The caller has not derived one yet" is a
different statement, and collapsing the two would let an unmigrated caller run with
no coherence protection while its trace recorded a check that passed. Absent
`leadPolicy` means step 7 did not run, and its three fields stay omitted rather
than defaulting to `false`.

**Step 7 does not run on the override path.** An override names a `stableId`, and
every rung of one registry entry shares its `transportBackend`, so the stack is
single-backend and no promotion is possible; the stage could only ever answer "no
repair", and recording that would attest to a check with no way to fail. An
override *can* still move the lead off the incumbent backend, with the same
consequence for caller preferences — it is the operator's explicit instruction, the
way an override already bypasses budget, and `overrideApplied` beside `leadBackend`
is what records it. There is no term in step 7's vocabulary for "displaced by
override".

**Prose restating a routing fact drifts from it.** `WORKER_DESCRIPTIONS` claimed
`grok-4.5` "now leads the automatic medium-work stack" — written in #237, the same
commit whose message says the lead stays with `gpt-5.5` and whose diff put grok
second. Grok leads `light-work` and sits second in `medium-work`,
`medium-light-work`, and both read-only chains. Corrected, and the claim is now
checked against `CANDIDATE_STACKS` rather than against a phrase, so a future
reorder fails a test instead of leaving the description behind.

## Consequences

- **Eco mode stops being a hardcoded list.** `--orchestrator eco` pinned
  `opus-explore → composer-implement → opus-check` by name. It becomes
  `bandCeiling` plus a quota-pool preference, which preserves the
  no-silent-upgrade invariant structurally rather than by prose, and stops the eco
  stack from going stale as models change.
- **`effortFloor` is subsumed, not discarded.** #235's per-model editorial scalar
  became a derived property of the snapshot: the lowest-effort rung of a
  `stableId` that survives eligibility and clears the requested `capabilityFloor`,
  via `derivedEffortFloorForStableId`. Each migration-era floor is asserted in a
  golden map so a contradicting measured ladder fails a test rather than silently
  reordering — `opus-4.8` is the live case, where the measured floor of `high`
  supersedes the migration value of `medium`.
- **The three prose copies of the ranking table collapsed to one data file.**
  `MODEL_RANKINGS`, `GPT56_PLACEMENTS`, and `HOW_TO_APPLY_RANKINGS` are removed;
  `routing-policy.ts` renders the section from `capability-snapshot.json` plus
  `MODEL_REGISTRY` and shares `measurementForSnapshotEntry` with the `select()` and
  floor consumers, so benchmark-axis precedence lives in one helper. `CLAUDE.md`
  and `README.md` carry only the rendered output plus routing-default guidance.
  Adding a model or refreshing a benchmark is now a snapshot edit plus validation
  instead of a sweep across five surfaces.
- **Coverage is uneven across the two benchmarks, and holes are recorded rather
  than estimated across.** The snapshot carries 26 rungs from DeepSWE v1.1 and
  CursorBench 3.2 (2026-07-25 capture). `composer-2.5` has `agentic-edit` only;
  `grok-4.5` has no DeepSWE row and its `@none` `agentic-edit` entry is editorial
  with a null `costPrior` (adjudication register A-0001). Per decision 0005, a hole
  is capability-unknown and is never interpolated.
- **Refusal becomes a real outcome.** `select()` can decline before a dispatch is
  attempted. Callers must handle `refused` — previously an unaffordable dispatch
  surfaced later as a `tryReserveDispatch` rejection with a `budget-*-exhausted`
  reason and no explanation of what was considered.
- **Snapshot staleness is a hard failure.** An expired measurement refuses rather
  than degrading, so a neglected snapshot is loud. Governance is decision 0005:
  90-day refresh cadence, 180-day expiry, both looser than 0001's 30/45 because a
  published result does not drift — what decays is relevance, so event triggers
  carry more weight than the interval. `snapshotVersion` pins the benchmark
  versions the data actually draws on, not just the retrieval date, because a
  benchmark's task set changes between versions.
- **The returned stack is a Pareto frontier, not a ranking.** Within a band the
  cheapest priced rung dominates every costlier one, so at most one priced rung per
  band survives. The stack is therefore short, and "cost breaks ties within a band"
  is almost never observable in the ordering — it shows up in `pruned` instead.
  That is the rule working, not failing, but it has a real consequence for ADR
  0008: the fallback chain has no same-band alternate to fall through to.
  Availability is handled at step 2, so the frontier is computed over rungs
  believed reachable; what it does not provide is a second candidate at equal
  capability when the leader fails for a reason availability did not predict. Worth
  revisiting if traversal exhaustion turns out to be common in shadow mode.
- **`unranked` is a distinct state from "ranked last".** Decision 0005 makes a rung
  with no measurement on the requested axis unrankable rather than ineligible, so
  it stays in the stack and sorts behind every ranked rung. Without the field a
  reader cannot tell the two apart. Such a rung also cannot satisfy a
  `capabilityFloor` above 0 — "unknown" must not read as "meets".
- **`effort-unsupported` is unreachable inside `select()`.** Candidates are
  generated by `rungsFor` from `supportedEffortsFor`, so an effort the transport
  cannot forward never becomes a candidate. The rejection stays in the published
  vocabulary because snapshot validation genuinely produces it — there the effort
  is typed by hand — but `select()` deliberately carries no branch for it: a guard
  that cannot fire is the appearance of safety without the fact of it.
- **Benchmark scores are aggregates, not per-task priors.** Banding is what makes
  them safe to use; sorting on raw score reintroduces the noise the band width
  exists to absorb. The `2 × errorMargin` validation is the guard and must not be
  relaxed to fit more bands.
- **`taste` has no public benchmark.** It stays `editorial` with a required
  approver and expiry. Taste-sensitive routing is therefore the least
  evidence-backed axis, and `taste-review.read-only.v1` keeps its existing
  single-candidate treatment until that changes.
- **Inter-suite conflict is resolved by axis binding, not precedence.** Each suite
  is authoritative for exactly one axis — DeepSWE for `swe`, CursorBench for
  `agentic-edit` — so `grok-4.5`'s 54% and 66.7% answer different questions and
  never compete inside `select()`, since `SelectionRequest` already names the axis.
  **No suite precedence order is defined, because none is needed**; a global
  cross-suite ranking is the same collapse the rung model exists to prevent. Two
  narrower cases remain: two captures of the *same* scope key disagreeing, which
  fails safe to capability-unknown on decision 0001's precedent; and a row
  suspected anomalous, excluded through an adjudication register kept in the policy
  document. The register is deliberately not a `Measurement` field — the snapshot
  is refreshed mechanically, so a flag stored there would be dropped on the next
  refresh and the rejected row silently re-imported.
- **The filter/rank split was incomplete, and step 7 is the correction.** The
  original decision assumed every hard constraint is a per-rung predicate belonging
  in the eligibility filter. Lead-backend coherence is not: it is a property of the
  assembled stack, invisible to any test applied to a rung in isolation. Selection
  therefore has three stages, not two — filter, rank, then validate-and-repair the
  result. Any future invariant of the same shape belongs in step 7, and the
  existence of one such invariant is reason to expect others.
- **Ranking can change behavior without changing eligibility.** Before step 7, the
  claim that a zeroed snapshot is safe rested on ranking being unable to affect
  anything but order. Lead-backend coherence shows order itself is load-bearing — a
  reorder invalidates caller preferences. The zeroed-snapshot property still holds
  (every dispatch still satisfies the capability contract), but the stronger
  intuition that "ranking is only a preference" does not, and step 7 is what keeps
  the weaker guarantee honest.
- **Rollout uses machinery that already exists.** `select()` runs under
  `routing-shadow.ts` against the authored stacks with no execution change, when
  the stage is `shadow` and a snapshot is explicitly configured. It emits an
  unclipped `selection-shadow-corpus/v1` record with `executed: false`. The
  disagreement set is the test corpus and the evidence for promotion through the
  `rollout-gates.ts` stages. Rollback is deleting the snapshot file and reverting
  to the authored stacks; absence of a snapshot is a supported state, which is why
  the schema and validator shipped before any snapshot did, and why every derived
  floor is 0 without one.
- **ADR 0008 is preserved.** Retry budget, price-band crossing guard, and one-pass
  traversal semantics operate unchanged on the derived stack. `BoundaryCrossing`
  keys on `priceBand`, which the snapshot still carries per rung. Parity is tested
  through `test/selection-stack-adapter.ts`, which throws on a multi-effort same
  `stableId` stack rather than silently collapsing it.
- **Not decided here.** The task-lifecycle state machine
  (`INTAKE → … → VERIFY → {ACCEPT | ESCALATE | REPLAN}`) that supplies
  `capabilityFloor`, and the separation of lateral availability fallback from
  vertical quality escalation, are ADR 0011. This decision deliberately stops at
  the selector so it could land behind existing gates.

## Implementation status

Phase 13 closed 2026-07-26 (13.1–13.12). `select()` is complete and tested,
including mutation testing on the step 7 stage, the availability view, the trace
mapping, and the floor mapping. `workload_class` is demoted to observability
metadata and its absence from `capability-selection.ts` is enforced by test.

It is **not** wired to dispatch. `CANDIDATE_STACKS` remains the executing policy
and `versions.policy` still reports `candidate-stacks/v1`. Promotion past shadow is
a separate decision, gated on the `selection-shadow-corpus/v1` disagreement set.
