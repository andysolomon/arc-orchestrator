---
name: direct-worker
description: Run one bounded orchestrator worker directly from the parent Cursor session with fable-orchestrator instead of spawning a thin Agent wrapper. Use when the Cursor agent wrapper is inconvenient or blocked while preserving the same worker model routing.
---

# Cursor Direct Worker Run

Use this skill as an escape hatch when the normal orchestration Agent wrapper is blocked or awkward in Cursor. This does **not** change the model policy: the parent Cursor model still owns planning, judgment, and final synthesis; the direct command only runs one bounded worker.

## Steps

1. Confirm the task is bounded enough to delegate without more user input.
2. Choose exactly one direct route:
   - `--backend codex --mode analyze` for read-only repo exploration.
   - `--backend codex --mode review` for read-only independent checking.
   - `--backend codex --mode implement` for hard implementation with workspace writes.
   - `--backend composer --mode implement` for mechanical/bulk implementation with Cursor Composer.
   - `--backend claude --mode analyze` for read-only exploration when Codex is unavailable or the parent routes to Opus 4.8.
   - `--backend claude --mode review` for read-only checking when Codex is unavailable or the parent routes to Opus 4.8.
   - `--backend claude --mode implement` for implementation when Codex is unavailable or the parent routes to Opus 4.8.
3. Build a task contract that includes outcome, scope, invariants, verification, prohibitions, and a safe label.
4. Run exactly one `fable-orchestrator run ...` command from the parent Cursor session.
5. Inspect the result, diff, and verification yourself before accepting the work.

Direct workers never commit, push, merge, deploy, edit secrets, or touch unrelated files.

## Command Templates

```sh
fable-orchestrator run --backend codex --mode analyze --task "<bounded read-only analysis contract>" --cwd "$PWD" --label "<safe-label>"
```

```sh
fable-orchestrator run --backend codex --mode review --task "<bounded read-only review contract>" --cwd "$PWD" --label "<safe-label>"
```

```sh
fable-orchestrator run --backend codex --mode implement --task "<bounded implementation contract>" --cwd "$PWD" --label "<safe-label>"
```

```sh
fable-orchestrator run --backend composer --mode implement --task "<bounded mechanical implementation contract>" --cwd "$PWD" --label "<safe-label>"
```

```sh
fable-orchestrator run --backend claude --mode analyze --task "<bounded read-only analysis contract>" --cwd "$PWD" --label "<safe-label>"
```

```sh
fable-orchestrator run --backend claude --mode review --task "<bounded read-only review contract>" --cwd "$PWD" --label "<safe-label>"
```

```sh
fable-orchestrator run --backend claude --mode implement --task "<bounded implementation contract>" --cwd "$PWD" --label "<safe-label>"
```

## Composer Note

If Composer edits files but the runner reports `Cursor did not return the required structured result`, do not assume the work failed. Inspect the worktree, run verification, and decide from evidence. Treat the runner failure as a reporting/handshake failure unless the diff or tests show the implementation failed. Never silently accept unverified changes.
