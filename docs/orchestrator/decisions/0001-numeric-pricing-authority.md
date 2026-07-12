# Decision 0001: Numeric Model Pricing Authority and Refresh Policy

**Story:** W-000066 (issue #116)
**Parent contract:** `docs/orchestrator/model-tier-routing-plan.md` — genuinely unresolved decision 1
**Policy version:** `pricing-policy/v1`
**Status:** Proposed — pending human approval. Approval is recorded when the repository owner squash-merges the PR carrying this document; the merge actor is the approver of record.
**Approver:** Andrew Solomon (product/financial), recorded at PR merge.

This decision resolves the planning contract's `numericPricing`, `pricingFreshness`, and pricing-related `provenance` semantics. It is a data-governance decision only: it does **not** register a model, activate a route, change selection, enable a fallback path, or make any planned inventory runnable.

## Authoritative source

The only authority for a numeric price is the **serving provider's official published price list** for the exact `providerModelId`, captured from the provider's public pricing page or pricing API:

| `servingProvider` | Authoritative source |
| --- | --- |
| Anthropic (Claude API) | <https://docs.claude.com/en/docs/about-claude/pricing> |
| OpenAI (Codex / API) | <https://platform.openai.com/docs/pricing> |
| Cursor | <https://cursor.com/pricing> and the Cursor model-pricing documentation |

Each captured price records `provenance`: source URL, source document version or page snapshot date, retrieval timestamp (UTC), the capturing actor, the verification result, and the approver. The approver for routine captures from the approved sources above is this policy (`pricing-policy/v1`, approved as described in the header); a capture from any source not listed above requires a fresh, individually recorded human approval.

Non-authoritative sources are never accepted as numeric prices: screenshots, blog posts, third-party aggregators, model-card summaries, memory of prior prices, or values inferred from another provider's list for the "same" model family. A model served by two providers has two independent prices; neither substitutes for the other.

### Subscription-metered backends

Where a backend is consumed through a subscription whose marginal token price is not published (for example plan-metered Cursor or Claude Code usage), `numericPricing` is recorded as **`not-applicable (subscription)`** with the plan identifier in provenance. Usage headroom remains a local categorical heuristic and is never converted into a numeric price. `not-applicable` is a valid, non-stale state and is distinct from *missing*.

## Units and scope

- **Units:** USD per million input tokens and USD per million output tokens, recorded separately. Cache-read, cache-write, or batch discounts, when published, are recorded as additional explicit unit fields — never folded into a blended number.
- **Scope key:** a price is valid only for the tuple (`servingProvider`, `providerModelId`, `authAccountScope`, `endpoint`/`region` where applicable). A price captured for one account tier or region does not apply to another.

## Refresh cadence and expiry

- **Cadence:** re-verify every captured price at least every **30 days**, and immediately upon a known provider pricing announcement or a new `providerModelId` version.
- **Expiry threshold:** a price older than **45 days** since retrieval is **expired/stale**. `pricingFreshness` records retrieval time, expiry time, and source version so staleness is computable without interpretation.

## Fail-safe behavior (missing, expired, conflicting, unavailable)

All four cases resolve to the same safe terminal state — **cost-unknown** — with one deliberate difference in timing: an *unavailable* source does not invalidate a still-unexpired verified price; the other three cases are cost-unknown immediately.

| Case | Handling |
| --- | --- |
| Missing — no captured price | Cost-unknown. |
| Expired — past the 45-day threshold | Cost-unknown until re-verified; the stale value is retained in provenance history but not used. |
| Conflicting — two authoritative captures disagree for the same scope key | Cost-unknown until a fresh capture resolves the conflict; both values and sources are recorded. |
| Unavailable — source unreachable at refresh time | Existing price remains valid until its expiry, then cost-unknown; the failed refresh attempt is recorded. |

Cost-unknown is fail-safe by construction:

- Cost-unknown **never changes route eligibility in either direction**. Eligibility and maturity are decided solely by the parent contract's evidence gates (adapter, account-scoped availability, route, sandbox, output, cancellation, error-normalization). In particular, a captured price can never promote `planned` inventory to runnable, and a missing price never disables an otherwise-eligible entry.
- Any price-aware policy must treat cost-unknown conservatively: it may not assume zero cost, may not estimate a number, and must surface `cost: unknown` in traces and budget accounting per the parent contract's unknown-cost rules.

## Screenshot price bands stay categorical

The screenshot-derived `priceBand` (blue / `$$$` / `$$` / `$` / very cheap, captured 2026-07-11) remains a separate categorical evidence field. A band is never converted to, interpolated into, or displayed as a numeric price, and a numeric price never overwrites the band. This document intentionally contains no screenshot-derived numeric values.

## Reversibility

This policy is versioned as `pricing-policy/v1`. Superseding it requires a new versioned decision document; reverting is a document-only change with no runtime effect, because no runtime behavior is activated by this decision.
