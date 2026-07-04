# File-Focused Review Slash Commands

Replace placeholders, then copy one command into Claude Code TUI.

```text
/fable-orchestrator:orchestrate review <FILE_OR_SUBSYSTEM> for correctness, regressions, privacy leaks, brittle assumptions, missing tests, and documentation drift. Keep the review read-only. Compare behavior against nearby tests and docs. Do not edit files. Label the run file-review-<short-name>.
```

```text
/fable-orchestrator:orchestrate review <FILE_OR_SUBSYSTEM> against <ACCEPTANCE_CRITERIA_OR_ISSUE>. Identify blockers, risky assumptions, and focused verification steps. Read-only. Do not edit files. Label the run acceptance-review-<short-name>.
```

```text
/fable-orchestrator:orchestrate inspect <FILE_OR_SUBSYSTEM> and explain whether it is safe to change for <TASK>. Include dependencies, likely tests, and files that should not be touched. Read-only. Do not edit files. Label the run change-safety-<short-name>.
```
