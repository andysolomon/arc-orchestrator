# Decision 0002: Canonical Route Candidate Stacks and Fallback Ordering

**Story:** W-000067 (issue #117)
**Parent contract:** `docs/orchestrator/model-tier-routing-plan.md` — genuinely unresolved decision 2
**Policy version:** `candidate-stacks/v1`
**Status:** Superseded by [`0004-runner-routing-v2.md`](0004-runner-routing-v2.md). The `candidate-stacks/v1` ordering and the parent-only Fable / Sol-never-automatic worker guardrails below are historical; active stacks and worker roles live in ADR 0004.
**Approver:** Andrew Solomon (routing policy), recorded at PR merge.

This decision fixes the ordered automatic-fallback candidates for each of the four canonical capability routes, and separates that availability mechanism from parent-selected quality escalation. It authorizes **no runtime change**: stacks activate only through the parent contract's sequenced implementation PRs, and every candidate below is conditional on the registry evidence gate.

## Evidence gate (applies to every candidate)

A candidate occupies its stack position only while its registry entry has verified, account-scoped evidence for **all** of: provider/account availability (`servingProvider`, `providerModelId`, `authAccountScope`), adapter (`adapterId`/`adapterVersion`), the route's sandbox/permission envelope, the route's validated output contract, cancellation behavior, and normalized-error classification. A candidate missing any of these is **non-runnable**: the selector skips it with a recorded classification (per selection precedence step 4); it is never attempted. Screenshot presence, tier, or price band contributes nothing to eligibility.

Per the parent contract's fallback rules, automatic fallback advances only on the exact retryable classifications, one traversal per dispatch, one attempt per candidate. A completed-but-low-quality result is never a fallback condition. Cross-provider/backend transitions in these stacks are permitted because every candidate must independently satisfy the identical (or stricter) sandbox envelope and the same validated output contract; any candidate that cannot is non-runnable.

## Ordered candidate stacks (`candidate-stacks/v1`)

| # | `implement.workspace-write.v1` | Backend | Evidence status at approval |
| --- | --- | --- | --- |
| 1 | `composer-2.5` | Cursor | Verified in current runner; **normal implementation default** |
| 2 | `gpt-5.5` | Codex | Conditional — activates only after its workspace-write adapter passes the full contract gate (parent contract, PR phase 3) |
| 3 | `opus-4.8` | Claude | Conditional — same gate; today's parent-driven Opus fallback is the compatibility behavior this position migrates deliberately |

| # | `explore.read-only.v1` | Backend | Evidence status at approval |
| --- | --- | --- | --- |
| 1 | `gpt-5.6-luna` | Codex | Verified in current runner (`codex-explore` default) |
| 2 | `opus-4.8` | Claude | Conditional — read-only adapter evidence required |

| # | `check.read-only.v1` | Backend | Evidence status at approval |
| --- | --- | --- | --- |
| 1 | `gpt-5.5` | Codex | Conditional on evidence gate; replaces Terra as the correctness-review head per the parent contract's target policy |
| 2 | `opus-4.8` | Claude | Conditional — read-only adapter evidence required |

| # | `taste-review.read-only.v1` | Backend | Evidence status at approval |
| --- | --- | --- | --- |
| 1 | `opus-4.8` | Claude | Verified taste-review surface (`opus-review`) |
| — | *No automatic fallback.* | | This route is **explicitly left without automatic fallback**: the only models meeting the taste bar behind Opus 4.8 are Sol (explicit parent authorization only) and Fable (parent-only, never a worker), so no automatic successor may exist. On an unavailable candidate 1, the dispatch terminates with a recorded classification and the parent decides. |

Ordering rationale: within each route, order is (a) current verified behavior first, so activation changes nothing until later candidates earn evidence; (b) intelligence before usage headroom for anything that ships, per repository policy; (c) Claude-backend Opus last as the cross-provider availability recovery that today exists as the `opus-*` fallback workers.

## Availability fallback vs. parent-selected quality escalation

These are distinct mechanisms and never convert into each other:

- **Automatic availability fallback** is the bounded one-pass traversal of the stacks above, triggered only by retryable availability/failure classifications.
- **Parent-selected quality escalation** is a *new* dispatch the parent explicitly schedules (initial selection of `gpt-5.5` for tough bounded work, or a rerun on a stronger route after judging output), subject to policy and remaining root budgets. Workers must not classify their own task as tough, escalate themselves, or reinterpret a fallback transition as permission to upgrade quality.

## Guardrail assertions (all five preserved)

1. **Composer 2.5** is the normal implementation default — candidate 1 of `implement.workspace-write.v1`, and the only implementation candidate active before later candidates pass the evidence gate.
2. **Fable** is parent/orchestrator only. It appears in no stack, is not a valid override target for any worker route, and no alias, environment override, or board input may select it as a worker.
3. **GPT-5.5** for tough bounded work is **parent-selected initial routing only**. Its stack positions above are availability recovery, not self-escalation; workers cannot route themselves to it.
4. **Sol** (`gpt-5.6-sol`) has **no automatic path**: it appears in no stack and is dispatchable only with explicit per-task parent authorization for an extremely difficult bounded task, which the trace must record. No override may bypass this.
5. **GLM** is absent from every stack, and no GLM registry entry, probe, adapter, or fallback path is authorized.

Targeted assertions for all five guardrails belong in the verification matrix's role-and-override and normal-implementation test groups when the selector activates (parent contract, PR phase 3).

## Reversibility

This policy is versioned as `candidate-stacks/v1`. Reordering, adding, or removing a candidate requires a new policy version referencing the evidence that justifies the change; traces record the policy version used for every dispatch, so rollback to v1 is a config-version revert with no trace rewrite.
