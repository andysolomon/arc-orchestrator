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

## Route to `opus-review`

- high-taste review of UI/UX, product polish, accessibility, or user-facing copy;
- API ergonomics, component composition, and long-lived abstraction review;
- developer-experience docs, prompt wording, or skill/plugin instruction review;
- second-opinion critique after Codex or Composer produced a solution where design quality matters more than raw correctness.

The route is read-only and uses Opus 4.8. Do not use it for bulk implementation, mechanical migrations, large repo scans, straightforward test additions, or generic CI/log summarization.

## Backend availability fallback

When Codex is unavailable (usage limit, authentication failure, or missing binary), the runner classifies the outage as `backend_unavailable` and emits a machine-readable fallback hint on stderr (`fallback: { backend: "claude", model: <resolved> }`). Ordinary task failures do not carry this hint.

**Default (parent-driven):** Re-delegate explicitly to the matching availability-fallback worker (`opus-explore`, `opus-check`, or `opus-implement`) or invoke `fable-orchestrator run --backend claude --mode <analyze|review|implement>` directly. Record the switch with `annotate --outcome escalated --escalated-to <model>` on the failed run, or annotate the fallback run's outcome. Do not silently substitute inside a worker.

**Opt-in automatic retry:** Set `FABLE_ORCHESTRATOR_FALLBACK=claude` (or pass `--fallback claude`) for unattended runs. The runner retries an availability-classified failure exactly once on the `claude` backend and links both trace records through `fallback_of`.

**Quality bar:** Opus 4.8 ranks below GPT-5.5 on the intelligence heuristic (7 versus 8). The parent review bar is unchanged. `report` keeps fallback runs distinguishable via `fallback_of` so acceptance rates stay honest.

**Distinct from other Opus routes:** `opus-review` is the taste-review path (content-triggered, read-only critique). Availability fallback is outage-driven or parent-explicit. Quality escalation after a completed-but-rejected run stays a parent decision through `annotate --escalated-to`, never a runner behavior.

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
5. `codex-check` when independent correctness/security review is worth its cost;
6. `opus-review` when the output needs taste/API/UX/prompt critique before final acceptance;
7. Fable makes the final decision and reports to the user.
