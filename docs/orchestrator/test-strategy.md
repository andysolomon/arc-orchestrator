# Test Strategy Slash Commands

Replace placeholders, then copy one command into Claude Code TUI.

```text
/fable-orchestrator:orchestrate inspect the repository's test and validation setup. Identify focused tests for <CHANGE_AREA>, full validation commands, likely missing coverage, and commands that are too expensive or flaky for the current task. Read-only. Do not edit files. Label the run test-strategy-<area>.
```

```text
/fable-orchestrator:orchestrate find the fastest reliable verification path for <TASK>. Include exact commands, what each command proves, and when full validation is required. Read-only. Do not edit files. Label the run verification-plan-<short-name>.
```

```text
/fable-orchestrator:orchestrate review current tests around <FILE_OR_SUBSYSTEM>. Identify missing coverage and recommend focused tests without editing files. Label the run test-gap-review-<short-name>.
```
