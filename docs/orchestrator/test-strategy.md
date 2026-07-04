# Test Strategy Orchestrator Prompt

Use this before a risky implementation to discover the cheapest reliable verification path.

```text
/fable-orchestrator:orchestrate inspect the repository's test and validation setup. Identify focused tests for <CHANGE_AREA>, full validation commands, likely missing coverage, and commands that are too expensive or flaky for the current task. Read-only. Do not edit files. Label the run test-strategy-<area>.
```

## Contract

- Route: `codex/analyze`.
- Outcome: ordered verification plan from fastest focused checks to full validation.
- Scope: package scripts, test directories, CI config, framework configs, and relevant source files.
- Invariants: no file changes; do not run destructive commands.
- Verification: cite package scripts or CI jobs and explain when each should run.
- Prohibitions: no commits, pushes, merges, deployments, secret edits, or unrelated refactors.
- Safe label: `test-strategy-<area>`.
