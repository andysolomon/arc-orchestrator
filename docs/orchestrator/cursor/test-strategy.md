# Test Strategy Prompts (Cursor)

Paste into Cursor chat with Fable as the parent model before delegating implementation.

```text
/orchestrate analyze this repository's test setup: enumerate test files, the exact commands for focused and full runs, gaps in coverage for <AREA>, and which verification a worker contract should require. Read-only. Do not edit files. Label the run test-strategy.
```

Direct runner equivalent:

```sh
fable-orchestrator run --backend codex --mode analyze --task "Enumerate test files and exact focused/full verification commands. Identify coverage gaps in <AREA>. Read-only." --cwd "$PWD" --label "test-strategy"
```

For this repository the full suite is:

```sh
env -u FABLE_ORCHESTRATOR_LOCK_WAIT_MS bun test
```
