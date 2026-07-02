# Routing Policy

## Keep in Fable

- requirements clarification and architecture decisions;
- decomposition of multi-stage work;
- tasks requiring frequent user interaction;
- final review of worker evidence and tradeoffs;
- small changes where delegation overhead exceeds expected savings.

## Route to `codex-explore`

- repository maps and dependency tracing;
- locating all call sites or configuration surfaces;
- verbose log or test-failure analysis;
- gathering file-level evidence before Fable decides on a fix.

The route is read-only and defaults to `gpt-5.4-mini`.

## Route to `composer-implement`

- a well-specified feature slice;
- mechanical refactors with explicit boundaries;
- migrations and repetitive multi-file edits;
- test additions for already-defined behavior.

The route uses Cursor Composer 2.5 in non-interactive write mode. It is the default for clear-spec, high-volume implementation. Fable must inspect the resulting diff and verification.

## Route to `codex-implement`

- a difficult implementation requiring stronger unsupervised reasoning;
- a focused bug fix with non-obvious root cause;
- a rerun after Composer 2.5 misses the quality bar;
- work where GPT-5.5's steerability is more important than cost.

The route is workspace-write and defaults to `gpt-5.5`.

## Route to `codex-check`

- independent review of a completed diff;
- regression, security, or correctness checks;
- validation that acceptance criteria are covered.

The route is read-only and defaults to `gpt-5.5`.

## Avoid Delegation

- the request is ambiguous or high stakes;
- the task needs secrets not already available through approved local tooling;
- the worker would need unrestricted filesystem or shell access;
- the task includes committing, pushing, merging, or deploying without explicit user approval;
- the worker output would be larger than doing the task directly.

## Mixed Tasks

Split mixed tasks into sequential bounded calls:

1. `codex-explore` to collect evidence;
2. Fable decides the approach;
3. `composer-implement` with the chosen approach and acceptance criteria;
4. escalate to `codex-implement` only if Composer misses the bar;
5. `codex-check` only when independent review is worth its cost;
6. Fable makes the final decision and reports to the user.
