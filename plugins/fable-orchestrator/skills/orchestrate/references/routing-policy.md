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

The route is read-only and defaults to `gpt-5.6-luna`.

## Route to `composer-implement`

- a well-specified feature slice;
- mechanical refactors with explicit boundaries;
- migrations and repetitive multi-file edits;
- test additions for already-defined behavior;
The route uses Cursor in non-interactive write mode and defaults to Composer 2.5. Keep taste-sensitive UI/UX, user-facing copy, and API-design work on Codex (`gpt-5.6-sol`) unless the parent explicitly forces a Composer model with `FABLE_ORCHESTRATOR_COMPOSER_MODEL`. Fable must inspect the resulting diff and verification.

## Route to `codex-implement`

- a difficult implementation requiring stronger unsupervised reasoning;
- a focused bug fix with non-obvious root cause;
- a rerun after Composer 2.5 misses the quality bar;
- work where GPT-5.5's steerability is more important than cost.

The route is workspace-write and defaults to `gpt-5.5` at high reasoning effort unless `--effort` overrides; taste-sensitive task classes default to `gpt-5.6-sol` unless `FABLE_ORCHESTRATOR_IMPLEMENT_MODEL` is set.

## Route to `codex-check`

- independent review of a completed diff;
- regression, security, or correctness checks;
- validation that acceptance criteria are covered.

The route is read-only and defaults to `gpt-5.5` at high reasoning effort unless `--effort` overrides; taste-sensitive task classes default to `gpt-5.6-sol` unless `FABLE_ORCHESTRATOR_REVIEW_MODEL` is set.

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

## Staged routing rollout

Rollout gates coordinate canonical route selection, the bounded one-pass availability fallback engine, routing-trace v2 writes, and future delegation activation. Stages progress only after telemetry gates pass **and** `humanApproved=true`; unset or invalid `FABLE_ORCHESTRATOR_ROLLOUT_STAGE` preserves legacy off behavior with no automatic promotion.

`FABLE_ORCHESTRATOR_ROLLOUT_HUMAN_APPROVED=1` is a runtime prerequisite for `shadow`, `opt-in`, `limited-cohort`, and `default` projection. Without it, the configured stage does not activate selection, fallback, or delegation (fixture/off projection), while routing-trace v2 writing remains enabled unless explicitly rolled back.

### Stages

| Stage | Selection | Fallback | Execution |
| --- | --- | --- | --- |
| `fixture` | off | off | legacy backend/mode only |
| `shadow` | shadow | shadow | legacy control path; observational shadow only |
| `opt-in` | active when `FABLE_ORCHESTRATOR_ROLLOUT_OPT_IN=1` | same | canonical selection only for exact opt-in |
| `limited-cohort` | active for deterministic cohort hash | same | bounded `FABLE_ORCHESTRATOR_COHORT_ID` + percent |
| `default` | active | active | canonical selection for eligible aliases |

Shadow mode never changes execution: the runner invokes the same legacy backend/model as control while recording proposed canonical selection for `Composer 2.5` implementation defaults and Codex defaults (`gpt-5.6-luna` explore, `gpt-5.5` implement, `gpt-5.5` review, `gpt-5.6-sol` / `gpt-5.6-sol` taste-sensitive variants).

### Independent rollback switches

Set any of these to `0` to roll back without changing the configured stage:

- `FABLE_ORCHESTRATOR_ROLLOUT_SELECTION`
- `FABLE_ORCHESTRATOR_ROLLOUT_FALLBACK`
- `FABLE_ORCHESTRATOR_ROLLOUT_TRACE_V2`
- `FABLE_ORCHESTRATOR_ROLLOUT_DELEGATION` (library gate only; CLI delegation is not activated here)

Legacy per-feature selection and fallback env controls (`FABLE_ORCHESTRATOR_ROUTE_SELECTION`, `FABLE_ORCHESTRATOR_FALLBACK_ENGINE`) retain precedence only when rollout stage is unset or `humanApproved=true`; configured `shadow`, `opt-in`, `limited-cohort`, or `default` without approval keeps selection, fallback, and delegation off while routing-trace v2 stays on. Legacy `FABLE_ORCHESTRATOR_TRACE_V2` and rollout rollback switches are applied afterward; rollback flags always win for safety.

Routing-trace v2 writing is projected on for unset, `fixture`, `shadow`, `opt-in`, `limited-cohort`, and `default` unless explicitly disabled by legacy `FABLE_ORCHESTRATOR_TRACE_V2=0` or rollout `FABLE_ORCHESTRATOR_ROLLOUT_TRACE_V2=0`.

Automatic fallback remains **availability-only**. Completed-but-low-quality output never triggers fallback or quality escalation.

### Transition telemetry (schema v1)

Each transition requires named numeric entry/exit criteria and explicit human approval. Evaluation returns visible unmet reasons when blocked.

| Transition | min sample | min match | min coverage | max error | max availability fallback |
| --- | ---: | ---: | ---: | ---: | ---: |
| `fixture-to-shadow` | 100 | 0.95 | 0.9 | 0.02 | 0.15 |
| `shadow-to-opt-in` | 500 | 0.97 | 0.95 | 0.015 | 0.1 |
| `opt-in-to-limited-cohort` | 1000 | 0.98 | 0.97 | 0.01 | 0.08 |
| `limited-cohort-to-default` | 2500 | 0.99 | 0.98 | 0.008 | 0.05 |

Additional zero-tolerance gates on every transition: redaction violations, schema violations, budget-reset violations, and guardrail violations.

### Guardrails validated at every stage

- planned/screenshot inventory is never runnable;
- GLM remains absent from registry, stacks, and probes;
- Fable stays parent-only and is never a worker candidate;
- Sol requires explicit parent authorization and is never an automatic fallback;
- taste-review (`opus-review`) has no automatic fallback;
- completed-low-quality disposition is terminal and never retryable or fallback-eligible;
- no quality-based fallback escalation.

Stages: `fixture`, `shadow`, `opt-in`, `limited-cohort`, and `default`.


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
