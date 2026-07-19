---
name: direct-worker
description: Run a bounded orchestrator worker directly from the parent Claude Code session with Bash instead of spawning the thin Agent wrapper. Use when Claude Code auto mode blocks subagent-launched arc-orchestrator runs, or when the user explicitly wants to bypass the wrapper while preserving the same worker model routing.
argument-hint: "<codex analyze|codex implement|codex review|composer implement|claude analyze|claude implement|claude review> <bounded task>"
allowed-tools: Bash(arc-orchestrator run *), Bash(./plugins/arc-orchestrator/bin/arc-orchestrator run *)
---

# Direct Worker Run

Use this skill as an escape hatch when the normal `/arc-orchestrator:orchestrate` Agent wrapper is blocked by Claude Code auto-mode classification. This does **not** change the model policy: the parent Claude Code model still owns planning, judgment, and final synthesis; the direct command only runs one bounded worker.

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
3. Build a task contract that includes outcome, scope, invariants, verification, prohibitions, and a safe label. Prefer automatic delegation (omit `--backend`/`--route`; select by mode plus `workload_class`) so Codex models participate only through the ADR chain. `--task-class` is observability metadata only and never selects a model.
4. Run exactly one `arc-orchestrator run ...` command from the parent Claude Code session.
5. Inspect the result, diff, and verification yourself before accepting the work.

## Command Templates

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

## Composer Note

If Composer edits files but the runner reports `Cursor did not return the required structured result`, do not assume the work failed. Inspect the worktree, run verification, and decide from evidence. Treat the runner failure as a reporting/handshake failure unless the diff or tests show the implementation failed.

The user-supplied direct worker request is:

`$ARGUMENTS`
