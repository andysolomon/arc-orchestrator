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

## Parent orchestrator availability

The orchestrator is the parent authority that owns planning, architecture, ambiguity resolution, route selection, final judgment, and user communication. It is distinct from both the incidental chat parent/model hosting a conversation and the bounded workers selected by worker routes. The runner selects this role only through the public `--orchestrator <identity>` / `FABLE_ORCHESTRATOR_ORCHESTRATOR=<identity>` contract; it never infers orchestrator identity from a chat UI model. CLI selection takes precedence over the environment. When neither is supplied (including a blank environment value), the explicit backward-compatible value is `null` / not selected.

The initial identities are exactly `fable`, `sol`, `composer`, `opus`, and `cursor-fable-high`. The `composer` identity activates the fixed Composer economy policy below. All other identities, and a null/unset identity, retain the existing routing and fallback behavior.

When the preferred parent orchestrator is unavailable (usage limit, authentication failure, or model unavailable), Cursor follows an ordered parent availability chain. Planning, architecture, ambiguity resolution, route selection, final judgment, and user communication stay in the **active** parent session — whichever parent is actually running.

### Cursor parent chain

1. **CC-Fable** (Claude Code Fable 5) — primary parent orchestrator when available.
2. **Codex-Sol** (`codex-5.6-sol` / GPT-5.6 Sol as parent) — first fallback when CC-Fable is unavailable. Run the Codex-Sol parent fallback at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control.
3. **Cursor-Fable-High** (Fable in Cursor at high reasoning) — second fallback when Codex-Sol is also unavailable.

This is **parent-orchestrator availability**, not worker routing. **Distinct from worker Sol authorization:** Sol as a *worker* still requires explicit parent authorization and is never an automatic *worker* fallback. Parent-orchestrator Codex-Sol is an availability recovery path for the parent session only.


## Composer orchestrator mode

Composer orchestrator mode is a fixed opt-in economy policy for a Composer parent. It is never the default parent policy, never changes the CC-Fable → Codex-Sol → Cursor-Fable-High parent availability order, and never changes normal worker routing when economy mode is inactive.

Activate the runner policy on each call with `--orchestrator composer`, or set `FABLE_ORCHESTRATOR_ORCHESTRATOR=composer` for the session. The CLI flag takes precedence over the environment. On Claude Code, Pi, or Copilot this selects the economy worker routes but does not turn the current chat into a Composer parent. True Composer-parent orchestration requires Cursor: start from an active Cursor Composer chat and select the same runner identity there.

Fixed opt-in economy tree: (O) Composer -> opus-explore -> composer-implement -> opus-check.

The runner maps `analyze` to `opus-explore` (Claude Opus 4.8, read-only), `implement` to `composer-implement` (Composer 2.5, workspace-write), and `review` to `opus-check` (Claude Opus 4.8, read-only). This fixed selection is active whenever the resolved orchestrator identity is `composer`, independently of rollout-stage selection flags. Model override variables and automatic fallback do not replace an economy worker.

CLI calls that omit `--backend` and `--route` are resolved to the applicable economy worker. An explicitly supplied conflicting `--backend` or `--route`, and a conflicting direct engine API request, fail visibly instead of silently ignoring the selected orchestrator identity.

While economy mode is active, explicitly exclude Fable, Codex 5.6 Sol, and default Codex workers (`codex-explore`, `codex-implement`, and `codex-check`) from route selection. The parent must not choose Fable, Sol, or default Codex workers as a quiet upgrade path for economy work.

Escalation behavior: remain on the economy stack unless a worker fails. No silent upgrade: never silently upgrade to Fable, Sol, or default Codex workers. If an economy worker fails, stop for an explicit parent decision before leaving the economy stack.


## Mechanical ops (dumb models)

The three named mechanical-ops routes are active. Each route is brokered through a non-writing Composer 2.5 operation-plan proposal, followed by runner-side canonical argv validation and shell-free execution of trusted `git` or `gh` binaries. Post-comment and merge plans contain exactly one command. Commit-push plans contain exactly two commands in order: an already-staged `git commit`, then `git push`; if commit fails, push is not invoked.

Opening a pull request is **not** a mechanical route. Authorized parents open PRs directly with `gh pr create`.

The runner resolves `git` and `gh` from explicit trusted binary configuration (`FABLE_ORCHESTRATOR_TRUSTED_GIT_BIN` / `FABLE_ORCHESTRATOR_TRUSTED_GH_BIN`) or documented system trusted-bin locations, never from workspace, current checkout, broker temp directories, or PATH-precedence wrappers. Mechanical `gh` operations use the current repository only: `--repo` and arbitrary `--body-file` inputs are rejected. `git commit --no-verify` and unlisted bypass flags are rejected.

| Task class | Required route alias | Bounded operation |
| --- | --- | --- |
| `post-github-comment` | `mechanical-post-comment` | Post an issue or pull-request comment with `gh issue comment` or `gh pr comment`. |
| `commit-push` | `mechanical-commit-push` | Commit and push an already-approved diff with `git commit` and `git push`. |
| `merge` | `mechanical-merge` | Merge an approved pull request with `gh pr merge`. |

**Fixed broker:** Composer 2.5 is the only proposal model for all three task classes: the fixed default dumb proposal model Composer 2.5 cannot be replaced for mechanical operations. Mechanical routes have no automatic fallback or model override. If Composer 2.5 is unavailable or its proposal fails validation, the operation stops without executing a command.

**Required parent delegation during ship flows:** Fable, Sol, Terra, Composer, Claude, Pi, Copilot, and Cursor parents must delegate every corresponding operation to its named mechanical-ops route: `mechanical-post-comment`, `mechanical-commit-push`, or `mechanical-merge`. These parents must never directly commit, push, comment on pull requests or issues, or merge. Parents must never directly run `git commit`, `git push`, `gh pr merge`, `gh issue comment`, or `gh pr comment`, even when the user has authorized the ship flow. Authorization selects the bounded mechanical route; it does not authorize direct parent mutation for those operations.

**Worker invariant:** Workers remain prohibited from committing, pushing, merging, making GitHub mutations, or deploying. The exact operations authorized by these three active mechanical-ops routes are the only bounded exception to that general prohibition. Deployment remains prohibited for every route.


## Backend availability fallback

When a worker backend is unavailable (usage limit, authentication failure, or missing binary), the runner classifies the outage as `backend_unavailable` and emits a machine-readable fallback hint on stderr. Ordinary task failures do not carry this hint. Workers surface the hint verbatim; they never substitute silently.

### Tier 1 — Codex → Opus (Claude)

When **Codex** is unavailable, stderr includes `fallback: { backend: "claude", model: <resolved> }`.

**Default (parent-driven):** Re-delegate explicitly to the matching first-tier availability-fallback worker (`opus-explore`, `opus-check`, or `opus-implement`) or invoke `fable-orchestrator run --backend claude --mode <analyze|review|implement>` directly. Record the switch with `annotate --outcome escalated --escalated-to <model>` on the failed run, or annotate the fallback run's outcome. Do not silently substitute inside a worker.

**Opt-in automatic retry:** Set `FABLE_ORCHESTRATOR_FALLBACK=claude` (or pass `--fallback claude`) for unattended runs. The runner retries an availability-classified Codex failure exactly once on the `claude` backend and links both trace records through `fallback_of`.

### Tier 2 — Opus → Grok (Composer)

When **Claude/Opus** is also unavailable (or a `claude` backend run fails with availability), stderr includes `fallback: { backend: "composer", model: <grok-4.5 or FABLE_ORCHESTRATOR_GROK_MODEL> }`.

**Default (parent-driven):** Re-delegate explicitly to the matching second-tier worker (`grok-explore`, `grok-check`, or `grok-implement`) or invoke `fable-orchestrator run --backend composer --mode <analyze|review|implement> --route <grok-explore|grok-check|grok-implement>` directly. Record the switch with `annotate --escalated-to` as above.

**Opt-in automatic retry:** When `FABLE_ORCHESTRATOR_FALLBACK=claude` is set, an availability-classified Claude failure during that retry chain continues once more on the `composer` backend with the Grok route (`grok-4.5` by default). Linked trace records still use `fallback_of`.

### Tier 3 — Grok → MiniMax (key-gated)

When a MiniMax key is configured (`FABLE_ORCHESTRATOR_MINIMAX_API_KEY` or `MINIMAX_API_KEY`), an availability-classified Grok failure during the retry chain continues once more on the `minimax` backend: the Claude CLI run against MiniMax's Anthropic-compatible endpoint (default model `MiniMax-M3`), with `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` injected per invocation and the operator's normal Claude credentials untouched. As a pay-as-you-go API tier it survives subscription exhaustion of Codex, Claude, and Cursor. The backend is also directly selectable with `--backend minimax`, and the composer-tier outage hint names it when the key is configured. Without a MiniMax key the chain skips this tier.

### Tier 4 — MiniMax → Kimi (terminal, key-gated)

When a Kimi/Moonshot key is configured (`FABLE_ORCHESTRATOR_KIMI_API_KEY`, `MOONSHOT_API_KEY`, or `KIMI_API_KEY`), an availability-classified failure on the preceding tier continues once more on the terminal `kimi` backend: the Claude CLI run against Moonshot's Anthropic-compatible endpoint (default model `kimi-k3[1m]`), with `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` injected per invocation (not `ANTHROPIC_API_KEY`), recommended Kimi env vars set per invocation, and inherited `ANTHROPIC_API_KEY` removed from the worker env so operator Claude credentials cannot conflict. When MiniMax is not configured, a Grok outage can jump directly to Kimi. Kimi is always terminal — no further fallback. The backend is also directly selectable with `--backend kimi`. Without a Kimi key the chain terminates after Grok or MiniMax exactly as before.

**Quality bar:** Opus 4.8 ranks below GPT-5.5 on the intelligence heuristic (7 versus 8). Grok is availability recovery, not taste escalation. The parent review bar is unchanged. `report` keeps fallback runs distinguishable via `fallback_of` so acceptance rates stay honest.

**Distinct from taste and quality escalation:** `opus-review` is the taste-review path (content-triggered, read-only critique). `grok-*` workers are second-tier availability recovery when Anthropic is unavailable — not taste escalation and not a substitute for `opus-review`. Availability fallback is outage-driven or parent-explicit. Quality escalation after a completed-but-rejected run stays a parent decision through `annotate --escalated-to`, never a runner behavior.

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
