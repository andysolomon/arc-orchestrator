---
name: arc-orchestrator
description: Codex-first ARC orchestration for Pi. Use when work should be planned in the parent Pi session and delegated as bounded analyze, implement, or review tasks through the orchestrator runner. Codex 5.6 Sol is the default parent orchestrator; Fable is not required.
---

# ARC Orchestrator for Pi

Use this skill to keep the parent Pi session focused on planning, ambiguity resolution, final judgment, and user communication while delegating bounded execution to the local orchestrator runner.

## ARC Delegate phase policy (runner-routing-v4)

ARC Delegate routes by lifecycle phase. Pass `--phase <phase>`, omit
`--backend` and `--route`, and let the ordered rung stack select the first
available candidate. Explicit backend/model/route overrides still win.
Analyze is parent-local: the parent runs it on its currently selected model
(default Codex Sol at high effort) and never delegates it to a worker.

The ordered rungs below are generated from the authoritative arc-model-policy
block (arc-pi `docs/arc-model-update-08-30-26.md`, updated 2026-08-30,
digest `5d18618f4ff5`).

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
3. Use automatic runner-routing-v4 for normal lifecycle work: pass `--phase`, add the nine-cell `--workload-class` for Implement, and omit backend, route, model, and effort pins.
   - `codex/analyze`, `codex/implement`, and `codex/review`: explicit Codex pins for operator-requested or diagnostic use.
   - `composer/implement`: explicit single-candidate Cursor Composer 2.5 pin; not the normal implementation default.
   - `claude/analyze`, `claude/review`, `claude/implement`: first-tier availability fallback through `--backend claude` (Opus 5) when Codex is unavailable or the parent explicitly routes there.
   - `grok/analyze`, `grok/review`, `grok/implement`: explicit diagnostic pins through `--backend composer --route grok-*` (Cursor Grok 4.6 High).
4. Treat worker output as evidence, not ground truth.
5. Inspect important diffs and verification evidence before final acceptance.
6. Never ask workers to commit, push, merge, deploy, edit secrets, or touch unrelated files.

## GPT-5.6 Worker Routing

- `gpt-5.6-luna`: Codex analyze default for high-volume, low-stakes exploration and evidence gathering.
- `gpt-5.5`: Codex implement/review default for harder implementation, debugging, escalation, and routine checks at high reasoning effort unless `--effort` overrides.
- `gpt-5.6-sol`: flagship Sol has no explicit route alias — reach it through automatic implement with `workload_class: hard-light` (Sol leads that stack) or a non-empty Codex model override such as `ARC_ORCHESTRATOR_IMPLEMENT_MODEL=gpt-5.6-sol`; `task_class` never selects this model.
- Composer 2.5 is the Cursor candidate when an automatic stack reaches it; `composer-implement` remains an explicit single-candidate pin outside Eco mode; `ARC_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit override escape hatch, not the default.
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

Automatic lifecycle routing:

Explore (Analyze itself stays parent-local):

```sh
bin/arc-orchestrator run \
  --mode analyze \
  --phase explore \
  --task "<bounded analysis contract>" \
  --cwd "$PWD" \
  --label "<safe label>" \
  --routing-policy runner-routing-v4
```

Implement:

```sh
bin/arc-orchestrator run \
  --mode implement \
  --phase implement \
  --workload-class <hard-heavy|hard-medium|hard-light|medium-heavy|medium-medium|medium-light|easy-heavy|easy-medium|easy-light> \
  --task "<bounded implementation contract>" \
  --cwd "$PWD" \
  --label "<safe label>" \
  --routing-policy runner-routing-v4
```

Explicit provider pins:

Analyze with Codex:

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

For UI/UX, user-facing copy, API design, or other taste-sensitive implement tasks, use automatic implement with `workload_class: hard-light` (Sol leads that stack) or a non-empty Codex model override such as `ARC_ORCHESTRATOR_IMPLEMENT_MODEL=gpt-5.6-sol`. `--task-class` is observability metadata only and never selects a model.

Inspect recent runs:

```sh
bin/arc-orchestrator runs --limit 10
```

## Verification

After implementation work, run focused tests yourself when practical, inspect the diff, and then decide whether to accept, request changes, or escalate to another Codex pass.
