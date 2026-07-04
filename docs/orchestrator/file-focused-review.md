# File-Focused Review Orchestrator Prompt

Use this when a specific file, skill, plugin surface, or subsystem needs independent review.

```text
/fable-orchestrator:orchestrate review <FILE_OR_SUBSYSTEM> for correctness, regressions, privacy leaks, brittle assumptions, missing tests, and documentation drift. Keep the review read-only. Compare behavior against nearby tests and docs. Do not edit files. Label the run file-review-<short-name>.
```

## Contract

- Route: `codex/review`.
- Outcome: actionable findings with severity, evidence, and suggested fixes.
- Scope: replace `<FILE_OR_SUBSYSTEM>` with the exact files/directories.
- Invariants: preserve existing public behavior unless explicitly part of the review target.
- Verification: identify the focused tests/docs that should be run or updated.
- Prohibitions: no edits, commits, pushes, merges, deployments, secret reads, or unrelated refactors.
- Safe label: `file-review-<short-name>`.
- Surface notes: Claude uses `/fable-orchestrator:orchestrate`; Pi/Copilot should use Codex 5.5 as parent and produce the equivalent runner command.
