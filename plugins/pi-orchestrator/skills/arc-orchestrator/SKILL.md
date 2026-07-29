---
name: arc-orchestrator
description: Codex-first ARC orchestration for Pi. Use when work should be planned in the parent Pi session and delegated as bounded analyze, implement, or review tasks through the orchestrator runner. Codex 5.6 Sol is the default parent orchestrator; Fable is not required.
---

# ARC Orchestrator for Pi

Use this skill to keep the parent Pi session focused on planning, ambiguity resolution, final judgment, and user communication while delegating bounded execution to the local orchestrator runner.

## ARC Delegate phase policy (runner-routing-v3)

ARC Delegate routes by lifecycle phase. Pass `--phase <phase>`, omit
`--backend` and `--route`, and let the ordered stack select the first
available candidate. Explicit backend/model/route overrides still win.

| Phase | Ordered candidates |
| --- | --- |
| Explore | CC Opus 5 (high) → Moonshot Kimi K3 (high) → Cursor Grok 4.5 (high) → Codex Sol (high) |
| Analyze | CC Fable (high) → Codex Sol (high) → Moonshot Kimi K3 (max) → Cursor Fable (high) → Cursor Grok 4.5 (high) → MiniMax M3 (max) → Cursor Composer |
| Research | Codex Sol (high) → CC Fable (high) → Moonshot Kimi K3 (max) → CC Opus 5 (high) → Cursor Grok 4.5 (high) |
| Plan | CC Fable (high) → Codex Sol (high) → Cursor Fable (high) → Moonshot Kimi K3 (max) → CC Opus 5 (high) → Cursor Grok 4.5 (high) |
| Verify | CC Opus 5 (low) → CC Opus 4.8 (low) → Codex GPT-5.5 (low) → Cursor Grok 4.5 (low) → MiniMax M3 (low) → Cursor Composer |
| Deploy | Codex GPT-5.5 (low) → CC Opus 4.8 (low) → Cursor Grok 4.5 (low) → MiniMax M3 (low) → Cursor Composer |

Implementation additionally requires `--workload-class`:

| Complexity | Ordered candidates |
| --- | --- |
| Hard–Hard | CC Fable (high) → Codex Sol 5.6 (high) → Cursor Fable (high) → Moonshot Kimi K3 (max) → Cursor Grok 4.5 (high) |
| Hard–Medium | Codex Sol 5.6 (high) → CC Fable (high) → Cursor Fable (high) → Moonshot Kimi K3 (high) |
| Hard–Easy | Codex Sol 5.6 (medium) → CC Fable (medium) → Cursor Fable (medium) → Moonshot Kimi K3 (max) |
| Medium–Hard | Codex Sol (high) → Moonshot Kimi K3 → CC Opus 5 (high) → Cursor Sol (high) → Cursor Grok 4.5 (high) |
| Medium–Medium | CC Opus 5 (high) → Moonshot Kimi K3 (max) → Codex Sol (high) → Cursor Grok 4.5 (high) |
| Medium–Easy | CC Opus 5 (high) → Moonshot Kimi K3 (max) → Codex Terra (high) → Cursor Grok 4.5 (high) |
| Easy–Hard | Codex Terra (medium) → Moonshot Kimi K3 (medium) → Cursor Grok 4.5 (high) |
| Easy–Medium | Codex GPT-5.5 (high) → CC Opus 4.8 (high) → Cursor Composer |
| Easy–Easy | Codex GPT-5.5 (low) → CC Opus 4.8 (low) → MiniMax M3 (high) → Cursor Composer |

Cursor Composer has no independently selectable effort control, so an effort
shown for Composer in product guidance is recorded as transport-default rather
than fabricated in traces.

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

## Default Parent Model

Use **Codex 5.6 Sol** as the default parent orchestrator for this Pi workflow, and run that Codex-Sol parent session at high reasoning effort. Start Pi with `--effort high`, or use Pi's equivalent reasoning-effort control when the surface names it differently. Do not assume Fable is present or preferred. If the active Pi model is weaker than Codex 5.6 Sol or is not running at high reasoning effort, ask the user to switch models or effort before high-risk planning or final acceptance.

## Runner

Invoke the package-local wrapper from this Pi package. It resolves the runner automatically via an explicit `ARC_ORCHESTRATOR_BIN` override, `arc-orchestrator` on `PATH`, or the sibling `arc-orchestrator` package when co-installed:

```sh
bin/arc-orchestrator
```

`ARC_ORCHESTRATOR_BIN` is override-only: set it only when you need a non-default runner path. When set, it must point to an executable runner; the wrapper does not fall through to other candidates.

## Operating Model

1. Keep planning, architecture, ambiguity resolution, user questions, and final acceptance in the parent Pi session.
2. Delegate only when the task is self-contained and has explicit boundaries.
3. Pick one route:
   - `codex/analyze`: read-only repository exploration or evidence gathering; defaults to GPT-5.6 Luna.
   - `codex/implement`: difficult implementation through GPT-5.5 with workspace-write access.
   - `codex/review`: independent read-only correctness, regression, security, or acceptance check through GPT-5.5.
   - `composer/implement`: optional bulk mechanical implementation through Cursor Composer 2.5 only when the task is clear and low-risk.
   - `claude/analyze`, `claude/review`, `claude/implement`: first-tier availability fallback through `--backend claude` (Opus 5) when Codex is unavailable or the parent explicitly routes there.
   - `grok/analyze`, `grok/review`, `grok/implement`: second-tier availability fallback through `--backend composer --route grok-*` (Grok 4.5) when Claude/Opus is also unavailable.
4. Treat worker output as evidence, not ground truth.
5. Inspect important diffs and verification evidence before final acceptance.
6. Never ask workers to commit, push, merge, deploy, edit secrets, or touch unrelated files.

## GPT-5.6 Worker Routing

- `gpt-5.6-luna`: Codex analyze default for high-volume, low-stakes exploration and evidence gathering.
- `gpt-5.5`: Codex implement/review default for harder implementation, debugging, escalation, and routine checks at high reasoning effort unless `--effort` overrides.
- `gpt-5.6-sol`: flagship Sol has no explicit route alias — reach it through automatic implement with `workload_class: hard-light-work` (Sol leads that stack, and is second behind Fable 5 on the automatic analyze/review chains) or a non-empty Codex model override such as `ARC_ORCHESTRATOR_IMPLEMENT_MODEL=gpt-5.6-sol`; `task_class` never selects this model.
- Composer 2.5 remains the default Cursor implementation worker; `ARC_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit override escape hatch, not the default.
- Explicit model overrides always win.

Pi intentionally remains Codex 5.6 Sol-first for parent orchestration. It can invoke
the Cursor implementation backend for a bounded task, but that worker route does
not change the parent model selection.

## Eco Orchestrator Mode

Eco orchestrator mode is an explicit opt-in economy mode. Activate the runner policy on each call with `--orchestrator eco`, or set `ARC_ORCHESTRATOR_ORCHESTRATOR=eco` for the session. The CLI flag takes precedence over the environment. On Pi, this selects the economy worker routes but does not turn the current chat into an Eco parent. True Eco-parent orchestration requires Cursor: open an active Cursor Composer chat and select the same runner identity there.

Fixed opt-in economy tree: (O) Eco -> opus-explore [| grok-explore] -> composer-implement -> opus-check [| grok-check].

With that identity selected, the runner maps `analyze` to `opus-explore`, `implement` to `composer-implement`, and `review` to `opus-check`. Analyze/review availability failures retry once on `grok-explore` / `grok-check`. Do not supply conflicting `--backend` or `--route` values. This opt-in does not change the surface's default parent, normal routing, or non-economy activation.

## Shipping authority

Workers are prohibited from commits, pushes, merges, GitHub mutations, and deployment. There are no mechanical worker routes or aliases. When the user authorizes shipping, the parent orchestrator performs the authorized `git` or `gh` operation directly after reviewing worker evidence.

## Task Contract

Every delegated task must include:

- exact outcome;
- files/subsystems in scope;
- behavior that must remain unchanged;
- required verification or tests;
- prohibited actions and scope boundaries;
- a short non-sensitive `--label` for trace readability.

## Commands

Analyze:

```sh
bin/arc-orchestrator run \
  --backend codex \
  --mode analyze \
  --task "<bounded exploration contract>" \
  --cwd "$PWD" \
  --label "<safe label>"
```

Implement with Codex (GPT-5.5 by default):

```sh
bin/arc-orchestrator run \
  --backend codex \
  --mode implement \
  --task "<bounded implementation contract>" \
  --cwd "$PWD" \
  --label "<safe label>"
```

Review with Codex (GPT-5.5 by default):

```sh
bin/arc-orchestrator run \
  --backend codex \
  --mode review \
  --task "<bounded review contract>" \
  --cwd "$PWD" \
  --label "<safe label>"
```

Claude backend fallback (when Codex is unavailable or parent routes to Opus 5):

```sh
bin/arc-orchestrator run \
  --backend claude \
  --mode analyze \
  --task "<bounded exploration contract>" \
  --cwd "$PWD" \
  --label "<safe label>"
```

Set `ARC_ORCHESTRATOR_FALLBACK=claude` for opt-in automatic retry on availability-classified Codex failures. When Claude/Opus is also unavailable, re-delegate to `grok-explore`, `grok-check`, or `grok-implement` (or the matching `--backend composer --route grok-*` command below).

Grok second-tier fallback (when Claude/Opus is unavailable):

```sh
bin/arc-orchestrator run \
  --backend composer \
  --mode analyze \
  --route grok-explore \
  --task "<bounded exploration contract>" \
  --cwd "$PWD" \
  --label "<safe label>"
```

For UI/UX, user-facing copy, API design, or other taste-sensitive implement tasks, use automatic implement with `workload_class: hard-light-work` (Sol leads that stack, and is second behind Fable 5 on the automatic analyze/review chains) or a non-empty Codex model override such as `ARC_ORCHESTRATOR_IMPLEMENT_MODEL=gpt-5.6-sol`. `--task-class` is observability metadata only and never selects a model.

Inspect recent runs:

```sh
bin/arc-orchestrator runs --limit 10
```

## Verification

After implementation work, run focused tests yourself when practical, inspect the diff, and then decide whether to accept, request changes, or escalate to another Codex pass.
