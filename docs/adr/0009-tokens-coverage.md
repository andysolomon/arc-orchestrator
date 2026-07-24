# ADR 0009: Orchestrator Tokens Coverage

Date: 2026-07-24

## Status

Accepted

## Context

The ARC Pi companion can fail fast when a runner trace omits token usage. The
orchestrator previously initialized schema-4 traces with `tokens: null`, so
availability failures, validation failures, timeout catches, and fail-closed
selection rejections could emit null token usage even though callers already
treat unknown usage as a lower-bound accounting event.

## Decision

Every engine-produced `RunExecutionResult` trace and every embedded
`orchestrator-routing-trace/v2` legacy trace carries a non-null `TokenUsage`.
When the backend returns usage, the engine preserves it. When usage is absent
or no backend ran, the engine records lower-bound-zero using the existing
`TokenUsage` shape:

```json
{
  "input_tokens": 0,
  "cached_input_tokens": null,
  "output_tokens": 0,
  "total_tokens": 0
}
```

For session-token policy charging, lower-bound-zero fallback usage remains an
unknown-usage charge, so the session aggregate keeps lower-bound semantics.

## Audit

| Exit path | Status | Source site | Backend invoked | Previous tokens | New tokens source | Coverage |
| --- | --- | --- | --- | --- | --- | --- |
| Success with measured usage | `completed` | `executeRunAttempt` parse success | Yes | backend usage | parsed backend `TokenUsage` | existing parser coverage |
| Success with missing usage | `completed` | `executeRunAttempt` parse success | Yes | `null` | lower-bound-zero fallback | `engine-tokens-coverage.test.ts` |
| Quality-blocked result | `blocked` | `executeRunAttempt` parse success | Yes | `null` when parser found none | lower-bound-zero fallback | `engine-tokens-coverage.test.ts` |
| Availability failure | `error` | `executeRunAttempt` catch / outage classifier | Yes | trace initializer `null` | lower-bound-zero initializer | `engine-tokens-coverage.test.ts` |
| Terminal validation failure | `error` | `executeRunAttempt` catch | Yes | trace initializer `null` | lower-bound-zero initializer | `engine-tokens-coverage.test.ts` |
| Timeout / duration budget failure | `error` | `executeRunAttempt` catch | Maybe stopped by adapter | trace initializer `null` | lower-bound-zero initializer | `engine-tokens-coverage.test.ts` |
| Canonical selection rejection | `error` | `rejectCanonicalSelection` | No | hard-coded `null` | lower-bound-zero initializer | `engine-tokens-coverage.test.ts` |
| Retry-budget/no-runnable traversal rejection | `error` | `executeCanonicalSelection` final reject | No | hard-coded `null` | lower-bound-zero initializer | covered by rejection constructor |

## Consequences

Downstream readers no longer need to special-case newly emitted null token
blocks from the engine. Historical traces can still contain `tokens: null`, so
reader schemas remain backward-compatible.
