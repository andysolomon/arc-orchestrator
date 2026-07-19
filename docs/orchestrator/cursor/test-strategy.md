# Test Strategy Prompts (Cursor)

Use the active tier of the CC-Fable → Codex 5.6 Sol → Cursor-Fable-High parent availability chain at high reasoning. Planning, ambiguity resolution, route selection, final judgment, and user communication stay in the active parent chat. Follow the cross-harness parent availability chain: CC-Fable → Codex 5.6 Sol → Cursor-Fable-High. If CC-Fable is unavailable because of usage limit, authentication failure, or model unavailable, use Codex 5.6 Sol; if Codex 5.6 Sol is also unavailable, use Cursor-Fable-High. Run every parent in this availability chain at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control, and never use low or unspecified/default reasoning for a parent. Use this before delegating implementation.

```text
/orchestrate analyze this repository's test setup: enumerate test files, the exact commands for focused and full runs, gaps in coverage for <AREA>, and which verification a worker contract should require. Read-only. Do not edit files. Label the run test-strategy.
```

Direct runner equivalent:

```sh
arc-orchestrator run --backend codex --mode analyze --task "Enumerate test files and exact focused/full verification commands. Identify coverage gaps in <AREA>. Read-only." --cwd "$PWD" --label "test-strategy"
```

For this repository the full suite is:

```sh
env -u ARC_ORCHESTRATOR_LOCK_WAIT_MS bun test
```
