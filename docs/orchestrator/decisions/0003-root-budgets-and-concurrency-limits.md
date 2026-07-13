# Decision 0003: Initial Root Budgets and Concurrency Limits

**Story:** W-000068 (issue #118)
**Parent contract:** `docs/orchestrator/model-tier-routing-plan.md` — genuinely unresolved decision 3
**Policy version:** `budget-limits/v1`
**Status:** Proposed — pending human approval. Approval is recorded when the repository owner squash-merges the PR carrying this document; the merge actor is the approver of record.
**Approver:** Andrew Solomon (operational/cost), recorded at PR merge.

This decision fixes the initial numeric limits for the depth-two delegation contract. It is versioned and independently reversible, and activates nothing by itself: enforcement arrives only with the parent contract's phase-5 delegation PR.

## Limits (`budget-limits/v1`)

All limits are hard ceilings enforced by the parent scheduler. Root scope covers a root run (depth 0) and all its descendants combined; dispatch scope covers one worker dispatch, including every fallback attempt in its single traversal.

| Dimension | Root limit (per root run) | Dispatch limit (per dispatch) | Units |
| --- | --- | --- | --- |
| Tokens | 2,000,000 | 400,000 | input + output tokens, summed |
| Wall time | 60 | 15 | elapsed clock minutes (root: from root-run start; dispatch: from dispatch start — not summed worker-minutes) |
| Calls | 25 | 1 traversal (≤ 1 attempt per candidate) | worker dispatches |
| Cost | 10.00 | 2.50 | USD, priced per `pricing-policy/v1` |
| Fan-out | — | 5 | direct children per task |
| Depth | 2 (root = 0) | — | delegation levels (parent contract) |
| Global concurrency | 6 across all root runs | — | simultaneously running workers |
| Root concurrency | 3 per root run | — | simultaneously running workers |

Write-capable workers additionally remain serialized per checkout; concurrent writers require isolated worktrees (parent contract, unchanged by this decision).

## Reservation and reconciliation

- **Reserve:** before dispatch, the scheduler atomically reserves `min(dispatch ceiling, root remaining)` for every dimension (ceilings: 400k tokens, 15 min, 1 call, $2.50, 1 concurrency slot) from the root's **remaining** budget — this reservation *is* the descendant's envelope, so it can only shrink as the root is consumed. If any dimension's remaining balance is zero (or the call or concurrency dimension cannot supply its whole slot), the dispatch is rejected before any candidate is attempted, with a recorded exhaustion reason.
- **Reconcile:** on completion (success, terminal failure, or cancellation) the scheduler reconciles the reservation to measured actuals and returns the unused remainder to the root pool. Reconciliation never refunds below measured consumption, and consumed amounts never reset on fallback or delegation — all attempts in a traversal accrue to the same dispatch total.
- **Unknown cost:** when a measured cost is unavailable (cost-unknown pricing per `pricing-policy/v1`, or a provider that reports no usage), the cost dimension reconciles at the **full reservation** ($2.50), never at zero, and the trace records `cost: unknown` with the conservative charge. Unknown token counts reconcile the same way at the token reservation.

## Inheritance invariant (remaining, not original)

Every descendant's envelope is `min(dispatch limit, parent's remaining budget)` per dimension, and a child's sandbox/permission envelope is never broader than its parent's. Budgets only shrink down the tree; no descendant can reset, extend, or re-originate any dimension.

- **Depth-1 example:** a root has consumed 1,700,000 tokens; 300,000 remain. A new depth-1 dispatch reserves `min(400,000, 300,000) = 300,000` tokens. It cannot claim the dispatch ceiling, because inheritance draws on remaining, not original, budget.
- **Depth-2 example:** that depth-1 worker returns a structured delegation recommendation; only the parent scheduler may act on it. The depth-2 dispatch reserves from the root's remaining pool *at that moment* — after the depth-1 reconciliation — again as `min(dispatch limit, remaining)`. If the root's call, cost, or token remainder is exhausted, the recommendation is rejected; the child could not have granted itself anything.

## Exhaustion, cancellation, and rollback

- **Exhaustion:** the moment any root dimension reaches zero remaining, **no new dispatch is admitted** (including dispatches arising from parent-approved delegation recommendations). Fallback advances inside an already-running traversal are not new dispatches: they continue within that dispatch's existing reservation and never take a fresh one. Token, call, and cost exhaustion allow already-running dispatches to finish inside their existing reservations. Wall-time exhaustion additionally triggers cancellation of all queued and running descendants.
- **Cancellation:** root cancellation propagates to every queued and running descendant; after root cancellation no new dispatch is admitted. Cancelled dispatches reconcile at consumed-so-far (or full reservation where consumption is unmeasurable), so cancellation can never mint budget back above what was actually spent.
- **Worked examples required at review:** success (reserve → run → reconcile down), fallback (two attempts, one dispatch total), cancellation (mid-run, consumed-so-far charge), exhaustion (26th dispatch rejected on the call dimension), and unknown-cost (reconcile at full reservation) — each traceable against the allocated/consumed/remaining fields the parent contract's trace schema requires.
- **Rollback:** limits live in one versioned policy object (`budget-limits/v1`) recorded in every trace. Changing any number requires a new version; reverting restores v1 semantics for subsequent dispatches without rewriting historical traces. This decision is reversible independently of the registry, selector, and trace-migration decisions.

## Rationale for the initial numbers

Initial values are deliberately conservative for a single-operator subscription environment: the $10 root cost ceiling binds before the 25-call ceiling in the worst case (root concurrency 3 allows at most three $2.50 reservations outstanding at once, and because unknown-cost dispatches reconcile at full reservation, four sequential full-price dispatches exhaust cost — pathological runs stop early rather than run long); 6 global / 3 per-root concurrency stays inside observed provider rate limits with two concurrent root runs; 15-minute dispatch wall time exceeds the longest observed worker run while keeping a hung backend's cost bounded. Telemetry from the staged rollout (parent contract, phase 6) is the input for any v2 retuning.
