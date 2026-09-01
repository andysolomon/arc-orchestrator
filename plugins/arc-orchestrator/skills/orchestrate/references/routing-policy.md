# Routing Policy

## ARC Delegate phase policy (runner-routing-v4)

ARC Delegate routes by lifecycle phase. Pass `--phase <phase>`, omit
`--backend` and `--route`, and let the ordered rung stack select the first
available candidate. Explicit backend/model/route overrides still win.
Analyze is parent-local: the parent runs it on its currently selected model
(default Codex Sol at high effort) and never delegates it to a worker.

The ordered rungs below are generated from the authoritative arc-model-policy
block (arc-pi `docs/arc-model-update-08-30-26.md`, updated 2026-09-01,
digest `9b8b3ec20971`).

| Phase | Ordered candidate rungs |
| --- | --- |
| Explore | CC Fable (high) → Codex Sol (high) → Codex Luna (max) → OpenCode Go GLM 5.3 |
| Research | CC Fable (high) → Codex Sol (high) → Codex Luna (max) → OpenCode Go GLM 5.3 |
| Plan | CC Fable (high) → Codex Sol (high) → Codex Luna (max) → OpenCode Go GLM 5.3 |
| Verify | Codex Luna (max) → Codex GPT-5.5 (low) → OpenCode Go DeepSeek V4 Pro → CC Opus 4.8 (low) → Cursor Grok 4.6 High |
| Deploy | Codex GPT-5.5 (low) → CC Opus 4.8 (low) → Cursor Grok 4.6 High |

Every automatic worker stack then appends the shared emergency tail:
Cursor Kimi K3 (fixed high model profile) → MiniMax M3 (high) → Cursor
Composer 2.5 (terminal).

Implementation additionally requires `--workload-class` with one of the nine
canonical difficulty × volume classes (legacy and obsolete class names are
rejected):

| Complexity | Ordered candidate rungs |
| --- | --- |
| Hard–Heavy | CC Fable (high) → Codex Sol (high) → Cursor Grok 4.6 High → OpenCode Go GLM 5.3 |
| Hard–Medium | Codex Sol (high) → Cursor Grok 4.6 High → OpenCode Go GLM 5.3 |
| Hard–Light | Codex Sol (high) → Cursor Grok 4.6 High → OpenCode Go GLM 5.3 |
| Medium–Heavy | Codex Sol (high) → Cursor Grok 4.6 High → OpenCode Go GLM 5.3 |
| Medium–Medium | CC Opus 5 (high) → Cursor Grok 4.6 High → OpenCode Go GLM 5.3 |
| Medium–Light | OpenCode Go GLM 5.3 Flash → Cursor Grok 4.6 High → CC Opus 4.8 (low) → Codex GPT-5.5 (high) → CC Opus 5 (high) |
| Easy–Heavy | OpenCode Go GLM 5.3 Flash → CC Opus 5 (high) → Codex Luna (max) → CC Opus 4.8 (low) → CC Opus 5 (low) → Cursor Grok 4.6 High |
| Easy–Medium | OpenCode Go GLM 5.3 Flash → Codex Luna (max) → CC Opus 4.8 (low) → Codex GPT-5.5 (low) → Cursor Grok 4.6 High |
| Easy–Light | OpenCode Go GLM 5.3 Flash → Codex GPT-5.5 (low) → Cursor Grok 4.6 High |

Cursor Composer, Cursor Kimi K3, and Cursor Grok 4.6 High have no
independently selectable effort control; fixed-effort behavior is a model
profile fact. Traces record that semantic fixed profile, while the Composer
transport receives no generic effort flag. The OpenCode Go rungs (GLM 5.3
Flash, GLM 5.3, DeepSeek V4 Pro) likewise receive no effort flag and run at
`none`; the OpenCode transport's read-only agent boundary applies to their
Explore/Research/Plan and Verify placements.

### Orchestration lifecycle

1. **Explore (optional):** only when missing context makes it necessary. Learn the domain model, conventions, and relevant code. Write `docs/<task-name>/explore.md`.
2. **Analyze (required):** analyze the request and actual problem using exploration evidence when present. Write `docs/<task-name>/analyze.md`.
3. **Research (optional):** use GitHub CLI or web sources only when local evidence is insufficient. Write `docs/<task-name>/research.md`.
4. **Plan (optional):** skip for a simple, bounded change; otherwise write `docs/<task-name>/plan.md`.
5. **Implement (required):** select one of the nine complexity classes and implement from the accumulated artifacts.
6. **Verify (optional):** run relevant unit, end-to-end, typecheck, lint, build, and performance-smoke checks; synchronize plan todos and strike through completed plan steps.
7. **Deploy (optional, HITL):** enter only after explicit user authorization. Monitor CI/deployment and loop back to plan or implementation when needed. Write `docs/<task-name>/build_error.md` for failures or `docs/<task-name>/build_success.md` after success.

The CLI enforces the phase/mode pairing and requires
`--deploy-authorized true` for the deploy phase. Supplying that flag records
authorization for this runner invocation; it does not infer permission from a
plan, environment, or prior worker run.

## Explicit public model aliases

The explicit route contract is a closed allowlist. Each base supports the
`-explore`, `-implement`, and `-check` suffixes and executes exactly one
pinned candidate with no automatic fallback. Stable and versioned bases are
both advertised: `fable`, `fable-5.1`, `sol`, `gpt-5.6-sol`, `luna`, `gpt-5.6-luna`, `gpt-5.5`, `opus`, `opus-5`, `opus-4.8`, `grok`, `grok-4.6`, `kimi`, `kimi-k3`, `minimax`, `minimax-m3`, `composer`, `composer-2.5`, `glm-5.3-flash`, `glm-5.3`, `deepseek-v4-pro`, `deepseek-v4-flash`, `go-kimi-k3`, `qwen-3.8-max`, `muse-spark-1.2`, `glm-5.2`, `kimi-k2.7-code`, `go-grok-4.6`, `go-luna`.

`kimi-*` and `kimi-k3-*` pin Cursor Kimi K3 (stable ID
`cursor-kimi-k3`, provider model `kimi-k3`) on the Composer transport. They
never select the OpenCode `moonshotai/kimi-k3` identity. Obsolete Cursor
Fable, Grok 4.5, Codex, and Terra route aliases are rejected rather than
silently redirected. `opus-review` remains the separate read-only taste-review
surface and is not part of automatic stacks.

OpenCode Go bases (`glm-5.3-flash`, `glm-5.3`, `deepseek-v4-pro`, `deepseek-v4-flash`, `go-kimi-k3`, `qwen-3.8-max`, `muse-spark-1.2`, `glm-5.2`, `kimi-k2.7-code`, `go-grok-4.6`, `go-luna`) pin provider-qualified
`opencode-go/<model>` identities on the `opencode` transport, whose stable
ids mirror the provider id (for example `opencode-go-glm-5.3`). Bases that
would collide with an existing Cursor/Codex alias carry a `go-` prefix, so
`kimi-k3-*`, `grok-4.6-*`, and `luna-*` keep their current transports. The
OpenCode transport exposes no effort control: every OpenCode Go alias and
automatic rung runs at `none`. Only GLM 5.3 Flash, GLM 5.3, and DeepSeek V4
Pro hold automatic rungs; every other OpenCode Go base is explicit-only.

## Keep in Fable

- requirements clarification and architecture decisions;
- decomposition of multi-stage work;
- tasks requiring frequent user interaction;
- final review of worker evidence and tradeoffs;
- small changes where delegation overhead exceeds expected savings.

## Prefer automatic explore (`--mode analyze`, no `--route`)

- repository maps and dependency tracing;
- locating all call sites or configuration surfaces;
- verbose log or test-failure analysis;
- gathering file-level evidence before Fable decides on a fix.

Omit `--backend` and `--route` so runner-routing-v4 selects from the `explore.read-only.v1` ordered rung stack. Analyze itself is parent-local; delegate Explore, Research, or Plan. The explore sandbox is read-only.

## Route to `composer-implement`

- a well-specified feature slice;
- mechanical refactors with explicit boundaries;
- migrations and repetitive multi-file edits;
- test additions for already-defined behavior;
The route uses Cursor in non-interactive write mode and defaults to Composer 2.5. For flagship `gpt-5.6-sol`, prefer automatic `--mode implement` with an appropriate `--workload-class` (or a non-empty `ARC_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` override for local Composer experiments). `task_class` never selects a model. Fable must inspect the resulting diff and verification.

## Prefer automatic implement (`--mode implement`, no `--route`)

- a difficult implementation requiring stronger unsupervised reasoning;
- a focused bug fix with non-obvious root cause;
- a rerun after Composer 2.5 misses the quality bar;
- work where GPT-5.5's steerability is more important than cost.

Omit `--backend` and `--route` so runner-routing-v4 selects from the `implement.workspace-write.v1` ordered rung stack for the chosen canonical `--workload-class`. `task_class` is metadata only.

## Prefer automatic check (`--mode review`, no `--route`)

- independent review of a completed diff;
- regression, security, or correctness checks;
- validation that acceptance criteria are covered.

Omit `--backend` and `--route` so runner-routing-v4 selects from the `check.read-only.v1` Verify stack. The check sandbox is read-only. `task_class` is metadata only and never upgrades the review model.

## Route to `opus-review`

- high-taste review of UI/UX, product polish, accessibility, or user-facing copy;
- API ergonomics, component composition, and long-lived abstraction review;
- developer-experience docs, prompt wording, or skill/plugin instruction review;
- second-opinion critique after Codex or Composer produced a solution where design quality matters more than raw correctness.

The route is read-only and uses Opus 5. Do not use it for bulk implementation, mechanical migrations, large repo scans, straightforward test additions, or generic CI/log summarization.

## Parent orchestrator availability

The orchestrator is the parent authority that owns planning, architecture, ambiguity resolution, route selection, final judgment, and user communication. It is distinct from both the incidental chat parent/model hosting a conversation and the bounded workers selected by worker routes. The runner selects this role only through the public `--orchestrator <identity>` / `ARC_ORCHESTRATOR_ORCHESTRATOR=<identity>` contract; it never infers orchestrator identity from a chat UI model. CLI selection takes precedence over the environment. When neither is supplied (including a blank environment value), the explicit backward-compatible value is `null` / not selected.

The initial identities are exactly `fable`, `sol`, `eco`, `opus`, and `cursor-fable-high`. The `eco` identity activates the fixed eco policy below. All other identities, and a null/unset identity, retain the existing routing and fallback behavior.

When the preferred parent orchestrator is unavailable (usage limit, authentication failure, or model unavailable), Cursor follows an ordered parent availability chain. Planning, architecture, ambiguity resolution, route selection, final judgment, and user communication stay in the **active** parent session — whichever parent is actually running.

### Cursor parent chain

1. **CC-Fable** (Claude Code Fable 5.1) — primary parent orchestrator when available.
2. **Codex-Sol** (`codex-5.6-sol` / GPT-5.6 Sol as parent) — first fallback when CC-Fable is unavailable. Run the Codex-Sol parent fallback at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control.
3. **Cursor-Fable-High** (Fable in Cursor at high reasoning) — second fallback when Codex-Sol is also unavailable.

This is **parent-orchestrator availability**, not worker routing. Under ADR 0004, Fable and Sol are also legitimate *workers* at their exact automatic stack positions. Parent-orchestrator Codex-Sol remains an availability recovery path for the parent session.


## Eco orchestrator mode

Eco orchestrator mode is a fixed opt-in economy policy for an Eco parent. It is never the default parent policy, never changes the CC-Fable → Codex-Sol → Cursor-Fable-High parent availability order, and never changes normal worker routing when economy mode is inactive.

Activate the runner policy on each call with `--orchestrator eco`, or set `ARC_ORCHESTRATOR_ORCHESTRATOR=eco` for the session. The CLI flag takes precedence over the environment. On Claude Code, Pi, or Copilot this selects the economy worker routes but does not turn the current chat into an Eco parent. True Eco-parent orchestration requires Cursor: start from an active Cursor Composer chat and select the same runner identity there.

Fixed opt-in economy tree: (O) Eco -> opus-explore [| grok-explore] -> composer-implement -> opus-check [| grok-check].

The runner maps `analyze` to `opus-explore` (Claude Opus 5, read-only), `implement` to `composer-implement` (Composer 2.5, workspace-write), and `review` to `opus-check` (Claude Opus 5, read-only). For analyze/review only, an availability failure on Opus retries once on `grok-explore` / `grok-check` (Cursor Grok 4.6 High). Implement has no automatic backup. This fixed selection is active whenever the resolved orchestrator identity is `eco`, independently of rollout-stage selection flags. Model override variables do not replace an economy worker.

CLI calls that omit `--backend` and `--route` are resolved to the applicable economy worker. An explicitly supplied conflicting `--backend` or `--route`, and a conflicting direct engine API request, fail visibly instead of silently ignoring the selected orchestrator identity.

While economy mode is active, explicitly exclude Fable, Codex 5.6 Sol, and direct Codex `--backend codex` workers from route selection. The parent must not choose Fable, Sol, or default Codex workers as a quiet upgrade path for economy work.

Escalation behavior: remain on the eco stack (Opus primary, optional Grok availability backup for analyze/review, Composer implement). No silent upgrade: never silently upgrade to Fable, Sol, or default Codex workers. If both the primary and in-stack backup fail, or implement fails, stop for an explicit parent decision before leaving the eco stack.


## Shipping authority

Workers are prohibited from commits, pushes, merges, GitHub mutations, and deployment. There are no mechanical worker routes or aliases. When the user authorizes shipping, the parent orchestrator performs the authorized `git` or `gh` operation directly after reviewing worker evidence.

## Backend availability fallback

When a worker backend is unavailable (usage limit, authentication failure, or missing binary), the runner classifies the outage as `backend_unavailable` and emits a machine-readable fallback hint on stderr. Ordinary task failures do not carry this hint. Workers surface the hint verbatim; they never substitute silently.

### Tier 1 — Codex → Opus (Claude)

When **Codex** is unavailable, stderr includes `fallback: { backend: "claude", model: <resolved> }`.

**Default (parent-driven):** Re-delegate explicitly to the matching first-tier availability-fallback worker (`opus-explore`, `opus-check`, or `opus-implement`) or invoke `arc-orchestrator run --backend claude --mode <analyze|review|implement>` directly. Record the switch with `annotate --outcome escalated --escalated-to <model>` on the failed run, or annotate the fallback run's outcome. Do not silently substitute inside a worker.

**Opt-in automatic retry:** Set `ARC_ORCHESTRATOR_FALLBACK=claude` (or pass `--fallback claude`) for unattended runs. The runner retries an availability-classified Codex failure exactly once on the `claude` backend and links both trace records through `fallback_of`.

### Tier 2 — Opus → Grok (Composer)

When **Claude/Opus** is also unavailable (or a `claude` backend run fails with availability), stderr includes a bounded Composer fallback hint naming Cursor Grok 4.6 High.

**Default (parent-driven):** Re-delegate explicitly to the matching second-tier worker (`grok-explore`, `grok-check`, or `grok-implement`) or invoke `arc-orchestrator run --backend composer --mode <analyze|review|implement> --route <grok-explore|grok-check|grok-implement>` directly. Record the switch with `annotate --escalated-to` as above.

**Opt-in direct-path retry:** When `ARC_ORCHESTRATOR_FALLBACK=claude` is set, an availability-classified Claude failure during the legacy direct chain continues once more on the `composer` backend with Cursor Grok 4.6 High. Linked trace records still use `fallback_of`.

### Tier 3 — Grok → MiniMax (key-gated)

When a MiniMax key is configured (`ARC_ORCHESTRATOR_MINIMAX_API_KEY` or `MINIMAX_API_KEY`), an availability-classified Grok failure during the retry chain continues once more on the `minimax` backend: the Claude CLI run against MiniMax's Anthropic-compatible endpoint (default model `MiniMax-M3`), with `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` injected per invocation and the operator's normal Claude credentials untouched. As a pay-as-you-go API tier it survives subscription exhaustion of Codex, Claude, and Cursor. The backend is also directly selectable with `--backend minimax`, and the composer-tier outage hint names it when the key is configured. Without a MiniMax key the chain skips this tier.

### Tier 4 — MiniMax → Kimi (terminal, key-gated)

When a Kimi/Moonshot key is configured (`ARC_ORCHESTRATOR_KIMI_API_KEY`, `MOONSHOT_API_KEY`, or `KIMI_API_KEY`), an availability-classified failure on the preceding tier continues once more on the terminal direct `kimi` backend: the Claude CLI run against Moonshot's Anthropic-compatible endpoint (default model `kimi-k3[1m]`), with `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` injected per invocation (not `ANTHROPIC_API_KEY`), recommended Kimi env vars set per invocation, and inherited `ANTHROPIC_API_KEY` removed from the worker env so operator Claude credentials cannot conflict. When MiniMax is not configured, a Grok outage can jump directly to Kimi. Direct Kimi is always terminal — no further fallback. The backend is also directly selectable with `--backend kimi`. This is distinct from public `kimi-*` and `kimi-k3-*` aliases, which pin Cursor Kimi K3 on the Composer transport. Without a Kimi key the chain terminates after Grok or MiniMax exactly as before.

**Quality bar:** The ordered rungs above are the complete runner-routing-v4 policy; the runner does not dynamically reorder them from cost or benchmark scores. Cursor Grok 4.6 High appears only at its approved fixed-high rung positions and remains distinct from taste escalation. The parent review bar is unchanged. `report` keeps fallback runs distinguishable via `fallback_of` so acceptance rates stay honest.

**Distinct from taste and quality escalation:** `opus-review` is the taste-review path (content-triggered, read-only critique). `grok-*` explicit routes remain diagnostic pins and Grok still serves as availability recovery when Anthropic is unavailable, but it is now also a first-class automatic candidate on capability grounds. It is still not taste escalation and not a substitute for `opus-review`. Availability fallback is outage-driven or parent-explicit. Quality escalation after a completed-but-rejected run stays a parent decision through `annotate --escalated-to`, never a runner behavior.

## Staged routing rollout

Rollout gates coordinate canonical route selection, the bounded one-pass availability fallback engine, routing-trace v2 writes, and future delegation activation. Stages progress only after telemetry gates pass **and** `humanApproved=true`; unset or invalid `ARC_ORCHESTRATOR_ROLLOUT_STAGE` preserves legacy off behavior with no automatic promotion.

`ARC_ORCHESTRATOR_ROLLOUT_HUMAN_APPROVED=1` is a runtime prerequisite for `shadow`, `opt-in`, `limited-cohort`, and `default` projection. Without it, the configured stage does not activate selection, fallback, or delegation (fixture/off projection), while routing-trace v2 writing remains enabled unless explicitly rolled back.

### Stages

| Stage | Selection | Fallback | Execution |
| --- | --- | --- | --- |
| `fixture` | off | off | legacy backend/mode only |
| `shadow` | shadow | shadow | legacy control path; observational shadow only |
| `opt-in` | active when `ARC_ORCHESTRATOR_ROLLOUT_OPT_IN=1` | same | canonical selection only for exact opt-in |
| `limited-cohort` | active for deterministic cohort hash | same | bounded `ARC_ORCHESTRATOR_COHORT_ID` + percent |
| `default` | active | active | canonical selection for eligible aliases |

Shadow mode never changes execution: the runner invokes the same legacy backend/model as control while recording proposed canonical selection for `Composer 2.5` implementation defaults and Codex defaults (`gpt-5.6-luna` explore, `gpt-5.5` implement, `gpt-5.5` review) plus automatic `workload_class` stacks for Sol.

### Independent rollback switches

Set any of these to `0` to roll back without changing the configured stage:

- `ARC_ORCHESTRATOR_ROLLOUT_SELECTION`
- `ARC_ORCHESTRATOR_ROLLOUT_FALLBACK`
- `ARC_ORCHESTRATOR_ROLLOUT_TRACE_V2`
- `ARC_ORCHESTRATOR_ROLLOUT_DELEGATION` (library gate only; CLI delegation is not activated here)

Legacy per-feature selection and fallback env controls (`ARC_ORCHESTRATOR_ROUTE_SELECTION`, `ARC_ORCHESTRATOR_FALLBACK_ENGINE`) retain precedence only when rollout stage is unset or `humanApproved=true`; configured `shadow`, `opt-in`, `limited-cohort`, or `default` without approval keeps selection, fallback, and delegation off while routing-trace v2 stays on. Legacy `ARC_ORCHESTRATOR_TRACE_V2` and rollout rollback switches are applied afterward; rollback flags always win for safety.

Routing-trace v2 writing is projected on for unset, `fixture`, `shadow`, `opt-in`, `limited-cohort`, and `default` unless explicitly disabled by legacy `ARC_ORCHESTRATOR_TRACE_V2=0` or rollout `ARC_ORCHESTRATOR_ROLLOUT_TRACE_V2=0`.

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
- GLM is reachable only through provider-qualified OpenCode Go identities (`opencode-go/glm-*`); no direct Z.AI provider, probe, or adapter exists;
- Fable and Sol are ordinary ADR 0004 workers at their exact automatic placements (not parent-only / never-worker);
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

1. automatic `--mode analyze` to collect evidence;
2. Fable decides the approach;
3. `composer-implement` with the chosen approach and acceptance criteria;
4. escalate via automatic `--mode implement` (workload_class) only if Composer misses the bar;
5. automatic `--mode review` when independent correctness/security review is worth its cost;
6. `opus-review` when the output needs taste/API/UX/prompt critique before final acceptance;
7. Fable makes the final decision and reports to the user.
