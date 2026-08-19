---
name: direct-worker
description: Run one bounded orchestrator worker directly from the parent Cursor session with arc-orchestrator instead of spawning a thin Agent wrapper. Use when the Cursor agent wrapper is inconvenient or blocked while preserving the same worker model routing.
---

# Cursor Direct Worker Run

Use this skill as an escape hatch when the normal orchestration Agent wrapper is blocked or awkward in Cursor. This does **not** change the model policy: the parent Cursor model still owns planning, judgment, and final synthesis; the direct command only runs one bounded worker.

## Steps

1. Confirm the task is bounded enough to delegate without more user input.
2. Use automatic runner-routing-v4 for normal lifecycle work: pass the phase and,
   for Implement, the nine-cell complexity class. Do not add backend, route,
   model, or effort pins.
3. Use a named direct route only for an operator-requested or diagnostic pin:
   - `--backend codex --mode analyze` for read-only repo exploration.
   - `--backend codex --mode review` for read-only independent checking.
   - `--backend codex --mode implement` for hard implementation with workspace writes.
   - `--backend composer --mode implement` for mechanical/bulk implementation with Cursor Composer.
   - `--backend claude --mode analyze` for read-only exploration when Codex is unavailable or the parent routes to Opus 5.
   - `--backend claude --mode review` for read-only checking when Codex is unavailable or the parent routes to Opus 5.
   - `--backend claude --mode implement` for implementation when Codex is unavailable or the parent routes to Opus 5.
   - `--backend composer --mode analyze --route grok-explore` for read-only exploration when Claude/Opus is unavailable (second-tier availability fallback).
   - `--backend composer --mode review --route grok-check` for read-only checking when Claude/Opus is unavailable.
   - `--backend composer --mode implement --route grok-implement` for implementation when Claude/Opus is unavailable.
4. Build a task contract that includes outcome, scope, invariants, verification, prohibitions, and a safe label. Sol is selected through the automatic phase/workload stack or an explicit Codex model override; `--task-class` is observability metadata only and never selects a model.
5. Run exactly one `arc-orchestrator run ...` command from the parent Cursor session.
6. Inspect the result, diff, and verification yourself before accepting the work.

Direct workers never commit, push, merge, deploy, edit secrets, or touch unrelated files.

## GPT-5.6 Model Targeting

`gpt-5.6-luna` is the Codex analyze default for high-volume, low-stakes work.
`gpt-5.5` is the Codex implement/review default for harder work at high reasoning effort unless `--effort` overrides.
Explicit `sol-*` and `gpt-5.6-sol-*` aliases pin `gpt-5.6-sol`; automatic selection uses the phase/workload stack or a Codex model override. `task_class` never selects a model. Composer 2.5 is selected when an automatic stack reaches it or the operator explicitly pins `composer-implement`; `ARC_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol`
is an explicit override escape hatch, not the default. Explicit model overrides
always win.

## Command Templates

Normal Explore (Analyze itself stays parent-local):

```sh
arc-orchestrator run --mode analyze --phase explore --task "<bounded exploration contract>" --cwd "$PWD" --label "<safe-label>" --routing-policy runner-routing-v4
```

Normal Implement:

```sh
arc-orchestrator run --mode implement --phase implement --workload-class <complexity> --task "<bounded implementation contract>" --cwd "$PWD" --label "<safe-label>" --routing-policy runner-routing-v4
```

Explicit provider pins:

```sh
arc-orchestrator run --backend codex --mode analyze --task "<bounded read-only analysis contract>" --cwd "$PWD" --label "<safe-label>"
```

```sh
arc-orchestrator run --backend codex --mode review --task "<bounded read-only review contract>" --cwd "$PWD" --label "<safe-label>"
```

```sh
arc-orchestrator run --backend codex --mode implement --task "<bounded implementation contract>" --cwd "$PWD" --label "<safe-label>"
```

```sh
arc-orchestrator run --backend composer --mode implement --task "<bounded mechanical implementation contract>" --cwd "$PWD" --label "<safe-label>"
```

```sh
arc-orchestrator run --backend claude --mode analyze --task "<bounded read-only analysis contract>" --cwd "$PWD" --label "<safe-label>"
```

```sh
arc-orchestrator run --backend claude --mode review --task "<bounded read-only review contract>" --cwd "$PWD" --label "<safe-label>"
```

```sh
arc-orchestrator run --backend claude --mode implement --task "<bounded implementation contract>" --cwd "$PWD" --label "<safe-label>"
```

Grok second-tier availability fallback (when Claude/Opus is unavailable; not taste escalation):

```sh
arc-orchestrator run --backend composer --mode analyze --route grok-explore --task "<bounded read-only analysis contract>" --cwd "$PWD" --label "<safe-label>"
```

```sh
arc-orchestrator run --backend composer --mode review --route grok-check --task "<bounded read-only review contract>" --cwd "$PWD" --label "<safe-label>"
```

```sh
arc-orchestrator run --backend composer --mode implement --route grok-implement --task "<bounded implementation contract>" --cwd "$PWD" --label "<safe-label>"
```

## Composer Note

If Composer edits files but the runner reports `Cursor did not return the required structured result`, do not assume the work failed. Inspect the worktree, run verification, and decide from evidence. Treat the runner failure as a reporting/handshake failure unless the diff or tests show the implementation failed. Never silently accept unverified changes.
