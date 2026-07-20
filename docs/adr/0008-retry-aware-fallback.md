# 0008 — Retry-aware fallback (per-label retry budget)

- Status: Accepted
- Date: 2026-07-20
- Work item: W-000223

## Context

The bounded fallback traversal (`runFallbackTraversal`) walks a candidate stack
once, advancing only on normalized availability failures. It has no memory of how
many times a single unit of work has already been retried, and it does not
distinguish a fallback that stays within a price band from one that keeps hopping
to more expensive bands. Two failure modes follow:

1. **Retry storms** — a flaky provider can drive a dispatch through its entire
   deep `workload_class` chain within seconds, and repeated dispatches of the same
   work item can each do so again, with no shared ceiling.
2. **Price-band ratcheting** — successive availability failures can push a
   traversal across price bands repeatedly without ever stepping back down.

We want an opt-in guard that bounds retries per unit of work and discourages
crossing a price band twice in a row without an intervening downgrade, while
leaving every existing caller untouched by default.

## Decision

Introduce a per-label retry budget selected by the `ARC_ORCHESTRATOR_RETRY_POLICY`
environment variable with three modes:

- **`off`** (default) — the engine constructs and threads no budget. The
  traversal is byte-for-byte unchanged; `TraversalStep.attempted` records carry no
  new keys.
- **`shadow`** — the budget is computed and its evidence recorded on attempted
  steps, but it never blocks a traversal and never enforces a downgrade. It is
  purely observational, so its rollout can be measured before enforcement.
- **`active`** — the budget enforces its guards.

`LabelRetryBudget` (in `plugins/arc-orchestrator/lib/retry-budget.ts`, built by
`createLabelRetryBudget`) holds two guards, both keyed on the dispatch label:

1. **Sliding-window attempt cap** — at most `maxAttemptsPerWindow` attempts for a
   label within `windowMs` (defaults: 2 attempts per 60_000 ms). Every candidate
   in one traversal shares the dispatch label, so the cap bounds the whole
   fallback chain. Under `active`, the over-cap attempt is not made and the
   traversal returns `budget-exhausted`.
2. **Price-band crossing guard** — a label may not cross a price band on two
   consecutive attempts without an intervening downgrade. Under `active`
   (`downgradeBeforeBoundary` enforced), the traversal records a downgrade before
   the second consecutive crossing and clears the guard; under `shadow` the
   requirement is reported but no downgrade is recorded.

`runFallbackTraversal` gains optional `retryBudget`, `budgetLabel`, and
`downgradeBeforeBoundary` inputs, plus additive `TraversalStep.attempted` fields
`downgrade_attempted: boolean` and `retryBudgetRemaining: number`. The fields are
optional and appear only when a budget is threaded, preserving the `off` path. The
`engine.ts` dispatch site (`executeCanonicalSelection`) constructs one budget per
dispatch and threads the dispatch label through.

The `RoutingTraceV2` schema and `trace-schema.ts` are unchanged; the new evidence
lives only on the internal `TraversalStep`.

## Consequences

- Default behavior is unchanged: with `ARC_ORCHESTRATOR_RETRY_POLICY` unset, no
  caller sees any difference and traces are identical to before.
- `active` deliberately trades chain depth for a retry ceiling: a single dispatch
  is capped at `maxAttemptsPerWindow` attempts per window, so operators enabling it
  accept that a deep `workload_class` chain will not be fully traversed within one
  window. This is the intended bound on retry storms.
- The price-band guard uses the boolean `BoundaryCrossing.crossedPriceBand`
  signal, so it reacts to any band change rather than to the direction of the
  change; a same-band attempt clears the guard.
- `shadow` lets the budget's evidence be observed in traces before `active`
  enforcement is turned on.
