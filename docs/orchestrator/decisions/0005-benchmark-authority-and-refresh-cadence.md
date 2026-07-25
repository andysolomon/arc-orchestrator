# Decision 0005: Benchmark Authority, Axis Binding, and Refresh Cadence

**Story:** TBD
**Parent contract:** `docs/adr/0010-capability-rung-selection.md` — the companion decision its "snapshot staleness is a hard failure" consequence asks for, and the resolution of its open gap on inter-suite conflict
**Policy version:** `benchmark-policy/v1`
**Status:** Proposed — pending human approval. Approval is recorded when the repository owner squash-merges the PR carrying this document; the merge actor is the approver of record.
**Approver:** Andrew Solomon (routing/capability), recorded at PR merge.

This decision is the analogue of `0001-numeric-pricing-authority.md` for benchmark measurements. Decision 0001 fixes the authority and refresh policy for provider *price lists*; `capability-snapshot.json` needs the same governance for *capability scores*, and ADR 0010 deliberately left it out of scope.

It is a data-governance decision only: it does **not** register a model, activate a route, change selection, enable a fallback path, or reorder any candidate stack. Nothing in it takes effect until phase 13.3 populates a snapshot and phase 13.4 consumes one.

## Authoritative suites, and the axis each one owns

| `BenchmarkId` | Suite and version | Authoritative for axis | Canonical source |
| --- | --- | --- | --- |
| `deepswe.v1.1` | DeepSWE v1.1 (113 tasks) | `swe` — end-to-end SWE task completion | *to be recorded at approval* |
| `cursorbench.3.2` | CursorBench 3.2 | `agentic-edit` — in-IDE multi-file edit | *to be recorded at approval* |

**The binding is one-to-one and exclusive.** A suite is authoritative for exactly one axis and carries no authority on any other. `swe` and `agentic-edit` are different questions, and a suite that answers one does not answer the other.

Two axes therefore have **no** benchmark authority at all:

- `taste` — neither suite measures it, as `routing-policy.ts` already states in prose.
- `long-context` — no suite currently covers it either.

Measurements on an axis with no authoritative suite must be `editorial`, with a named approver and an expiry. This is not a separate rule; it falls out of the table above, and `capability-snapshot.ts` derives it from the same map rather than restating it.

### The canonical sources are not yet recorded, and that blocks 13.3

Every benchmark figure currently in this repository arrived as a comment block in `plugins/orchestrator-core/routing-policy.ts` carrying a capture date (2026-07-25) and no source link. This policy does not accept a benchmark measurement without one: `Measurement.sourceUrl` is nullable in the schema so that `editorial` rows can omit it, and validation now requires it to be non-null whenever `source` is a `BenchmarkId`.

Recording the two URLs above is therefore a precondition for phase 13.3, not a documentation nicety. Until they are recorded, no benchmark-sourced measurement can pass validation.

## Non-authoritative sources

Never accepted as a benchmark measurement:

- Leaderboard aggregations, blog summaries, model cards, or third-party reproductions.
- Screenshots, or a remembered figure from a prior capture.
- Another suite's figure for the "same" capability. A model measured by two suites has two scores on two axes; neither substitutes for the other, and they are never averaged.
- **A figure captured at an effort tier other than the rung's** — see below.

## The effort tier is part of a measurement's identity

A benchmark row is a measurement of `(model, effort)`, not of a model. Publishing a single "best" column per model is the normal shape of a leaderboard, and that column almost always reports `max` or `xhigh` — tiers this runner never dispatches. `routing-policy.ts:42` already says so: *"Best-effort leaderboard columns are NOT usable: they report max/xhigh for nearly every row and describe ceilings we never reach."*

A measurement filed against a rung must have been captured at that rung's effort. A `max` figure may never be used to characterize a rung dispatched at `high` or below, in the snapshot or in prose derived from it.

> **This rule found three live violations, since fixed in phase 13.9a.** All three
> sat in `routing-policy.ts`, written from the `max` column the same file declares
> unusable at line 42, and all three survived PR #235's recalibration of the table
> beside them:
>
> - `GPT56_PLACEMENTS` claimed `gpt-5.6-terra` "matches GPT-5.5 on score (70%
>   versus 67%, within error)" and that `gpt-5.6-luna` "outscores GPT-5.5 on both
>   DeepSWE v1.1 (67% versus 67%, tied)". At high, the same file's table has Terra
>   ten points below GPT-5.5 and Luna twenty below.
> - `HOW_TO_APPLY_RANKINGS` told the reader Luna "scores within error of `gpt-5.5`
>   on DeepSWE v1.1" and to "escalate on task shape, not on a presumed capability
>   gap" — an instruction not to escalate on a gap that is real and large. Luna's
>   `effortFloor` is `high`, so there is no tier at which the claim holds.
> - The same array claimed Terra "matches `gpt-5.5` on intelligence" while
>   `MODEL_RANKINGS`, forty lines above it, scores them 5 and 8.
>
> Scope, stated precisely because the first draft of this section overstated it:
> both constants are exported from `orchestrator-core` and imported nowhere, and
> the rendered surfaces already carried the corrected high-effort framing —
> `CLAUDE.md` calls Luna "the weakest benchmarked model at high" and tells the
> reader to escalate. So no user was reading the false text. What it was is a
> source-of-truth contradiction: three constants disagreeing with both the table
> above them and the surface below them, available to any future consumer. Phase
> 13.7 should delete these restatements rather than re-derive them.

## Scope key

A benchmark score is valid only for the tuple (`BenchmarkId` **including its version**, `stableId`, `effort`, `axis`).

A suite version bump is not a refresh — it is a new scope. `deepswe.v1.2` would be a new `BenchmarkId`, and no score carries over from `v1.1`, because the task set changed. This is the substantive difference from decision 0001: a price list republishes the same quantity, whereas a benchmark version republishes a different question.

## Suites report tiers the runner cannot always request

A suite may publish a per-effort curve for a model whose transport exposes no effort control at all. `grok-4.5` is the live case: CursorBench 3.2 reports it at low, medium, and high (63.5 → 65.4 → 66.7), but `grok-4.5` rides the `composer` transport, `buildComposerCommand` has no effort flag, and the registry therefore gives it exactly one rung, `grok-4.5@none`. Which of the three published numbers that rung earns is not established by the suite, because the tier `cursor-agent` runs Grok at is unverified.

Filing the high-tier figure against `grok-4.5@none` is a **judgment**, not a measurement, and this policy requires it to be recorded as one: as an `editorial` measurement with a named approver and a rationale citing the benchmark row, never as a `cursorbench.3.2`-sourced row. It then expires like any other editorial claim, so the judgment is revisited rather than inherited.

This preserves the substance of #237's promotion of `grok-4.5` while making the step from "CursorBench measured this" to "our `@none` rung scores this" visible and accountable. It is the same principle phase 13.1b applied to `minimax`: sharing a transport with something verified is not itself verification.

## Inter-suite disagreement — ADR 0010's open gap

ADR 0010 records an unresolved gap: the schema stores a `Measurement[]` per rung and says nothing about what to do when two suites disagree about the same rung, citing `grok-4.5@high` at 54% on DeepSWE against 66.7% on CursorBench. That gap resolves into three cases, only two of which are conflicts.

### Case 1 — different axes. Not a conflict.

The cited example is this case. Under the axis binding above, DeepSWE's 54% is a `swe` score and CursorBench's 66.7% is an `agentic-edit` score. They are answers to different questions, and `SelectionRequest` already carries the `axis` being asked about, so the two figures never compete inside `select()`.

**No suite precedence order is defined, because none is needed.** A global ranking across suites is exactly the collapse the rung model exists to prevent — the same mistake as reducing a five-rung ladder to one `intelligence` score. Cross-axis figures are never averaged, never reconciled, and never used to rank each other.

### Case 2 — same scope key, two captures disagree.

Two retrievals of the same suite version, for the same rung and axis, reporting different numbers. This is a genuine conflict and resolves the way decision 0001 resolves a conflicting price: **capability-unknown** for that `(rung, axis)` until a fresh capture settles it, with both values and sources retained in provenance history and neither used.

### Case 3 — a measurement is suspected anomalous.

Not a disagreement between suites but a doubt about one row's validity. #237 is the live instance: DeepSWE v1.1 published a single effort tier for `grok-4.5` while giving every other model five, which points to a limited or anomalous run, and CursorBench's per-effort curve for the same model is internally consistent.

A suspect row is **excluded**, not down-weighted, and the exclusion is recorded in the adjudication register at the end of this document.

The register lives here rather than as a field on `Measurement`, which is where ADR 0010 assumed it would go. Two reasons. A per-measurement flag would sit inside a data file that phase 13.3 refreshes mechanically, so the next refresh would silently drop the judgment and re-import the row it rejected. And an exclusion is an editorial act about provenance, which decision 0001 already establishes belongs in a versioned, approved policy document rather than in the data. Keeping the register out of the snapshot also keeps the snapshot purely positive: it records what is believed, not what was considered and rejected.

An exclusion is never a licence to substitute a number. A rung whose only row on an axis is excluded is uncovered on that axis, and falls to the rule below.

## Missing coverage is capability-unknown, and never changes eligibility

Coverage is uneven and will stay uneven. `sonnet-5` and `composer-2.5` have no DeepSWE row at all; `kimi-k3` has no high-effort coverage on either suite.

Missing, expired, conflicting, and excluded coverage all resolve to one state — **capability-unknown** for that `(rung, axis)` — with the same fail-safe properties decision 0001 gives cost-unknown:

- It **never changes route eligibility in either direction.** Eligibility is decided solely by the registry's contract gates. A high score can never promote `planned` inventory to runnable, and missing coverage never disables an otherwise-eligible entry.
- It may not be estimated. No zero, no interpolation between adjacent tiers, no substitution of another axis's score, and no carry-over from another suite version.
- A rung that is capability-unknown on the requested axis is **unrankable, not ineligible**: it is ordered after every ranked rung and recorded as such in `SelectionExplanation`. Dropping it instead would let ranking narrow authority, which ADR 0010's registry/snapshot split exists to prevent.

| Case | Handling |
| --- | --- |
| Missing — no row for this `(rung, axis)` | Capability-unknown. Recorded, never estimated. |
| Expired — past the 180-day threshold | Capability-unknown until re-verified; the stale value is retained in provenance history but not used. Selection refuses with `snapshot-expired`. |
| Conflicting — two captures of the same scope key disagree | Capability-unknown until a fresh capture resolves it; both values and sources recorded. |
| Excluded — adjudicated anomalous | Capability-unknown; the exclusion and its rationale are recorded in the register below. |
| Unavailable — source unreachable at refresh time | The existing measurement remains valid until its own `expiresAt`; the failed refresh attempt is recorded. |

### Correction: `opus-5` is not the coverage hole ADR 0010 describes

ADR 0010's consequences state that "the DeepSWE v1.1 rows do not include `opus-5` at all," making it orderable on `agentic-edit` and not on `swe`. That was true when the ADR was drafted on 2026-07-24 and stopped being true the next day: PR #235 (`cd4fb51`, 2026-07-25) added a full DeepSWE ladder for `opus-5` — 58 → 69 → 73 across low, medium, and high, at ±2 — which the ADR's 2026-07-25 reconciliation pass did not catch. Phase 13.3's instruction to "record the swe-axis hole" for `opus-5` is stale for the same reason. The uncovered entries on `swe` are `sonnet-5` and `composer-2.5`.

## Refresh cadence and expiry

- **Cadence:** re-verify every captured measurement at least every **90 days**, and immediately upon any of: a new version of a covered suite; a new `providerModelId` version for a covered model; or a model entering or leaving a stack lead.
- **Expiry threshold:** a measurement older than **180 days** since retrieval is expired. `Measurement.expiresAt` records this explicitly rather than leaving it to be computed, so staleness needs no interpretation.

These are deliberately looser than decision 0001's 30/45 days, and for a structural reason rather than convenience. A published price silently changes underneath a captured value, so a pricing capture decays continuously and the cadence is a bound on drift. A published benchmark result does not change: `deepswe.v1.1` will report the same numbers next year. What decays is *relevance* — new models appear, and a new suite version replaces the question. So the cadence here is a bound on **coverage gaps**, and the event triggers above do more work than the interval does.

The interval is not decorative, though. Expiry is a hard refusal (`snapshot-expired`), so a neglected snapshot fails loudly in normal operation rather than degrading. That is intentional, and it is the reason this policy names an owner.

## `snapshotVersion` must pin the benchmark versions

ADR 0010 requires `snapshotVersion` to pin the benchmark version and not only a retrieval date, because a benchmark's task set changes between versions. This policy fixes the machine-checkable form of that requirement:

- `snapshotVersion` must contain an ISO `YYYY-MM-DD` retrieval date.
- It must name every `BenchmarkId` the snapshot actually draws on — checked against the sources present in the data, not against a hand-maintained list.

Example: `2026-07-25+deepswe.v1.1+cursorbench.3.2`.

Both rules are enforced by `validateCapabilitySnapshot`, so a snapshot that refreshes onto a new suite version without saying so fails validation instead of shipping a version string that quietly means something else.

## Owner

Andrew Solomon, as for decision 0001. The owner is responsible for the refresh cadence above, for recording the canonical source URLs, and for approving each entry in the adjudication register.

## Reversibility

This policy is versioned as `benchmark-policy/v1`. Superseding it requires a new versioned decision document. Reverting is a document change plus removal of the axis-binding and `snapshotVersion` checks from `capability-snapshot.ts`; no runtime behavior is activated by this decision, and ADR 0010's rollback — delete the snapshot, revert to authored stacks — remains available independently.

## Appendix: adjudication register

Every exclusion of an otherwise-authoritative measurement is recorded here with its date, rationale, and approver. An entry is not a score and never becomes one.

### A-0001 — `grok-4.5`, DeepSWE v1.1, all tiers — excluded

- **Date:** 2026-07-25
- **Origin:** PR #237
- **Approver:** Andrew Solomon
- **Excluded:** the DeepSWE v1.1 row for `grok-4.5` (54% ±2 at high).
- **Rationale:** DeepSWE v1.1 publishes a single effort tier for `grok-4.5` while publishing five for every other covered model, which indicates a limited or anomalous run rather than a comparable measurement. CursorBench 3.2's per-effort curve for the same model is internally consistent across three tiers (63.5 → 65.4 → 66.7).
- **Effect:** `grok-4.5` is uncovered on the `swe` axis and therefore capability-unknown there. It is **not** thereby ranked from CursorBench on that axis — the axis binding forbids the substitution, and the exclusion does not license one. Its `agentic-edit` coverage is unaffected.
- **Review:** revisit on the next DeepSWE version, or sooner if DeepSWE republishes `grok-4.5` with a full ladder.
