# Direct Worker Slash Commands

Use these when Claude Code auto mode blocks the normal Agent wrapper. Copy one command into Claude Code TUI.

```text
/arc-orchestrator:direct-worker codex analyze <READ_ONLY_ANALYSIS_TASK>. Scope to <FILES_OR_SUBSYSTEM>. Do not edit files. Label the run direct-analyze-<short-name>.
```

```text
/arc-orchestrator:direct-worker codex review <REVIEW_TASK>. Keep the run read-only. Report findings with evidence and verification suggestions. Do not edit files. Label the run direct-review-<short-name>.
```

```text
/arc-orchestrator:direct-worker codex implement <IMPLEMENTATION_TASK>. Scope changes to <FILES_OR_SUBSYSTEM>. Run <TESTS>. Explicit sol-* and gpt-5.6-sol-* aliases pin Sol; use workload_class: hard-light or a Codex model override for automatic selection. --task-class is metadata only. Do not commit or push. Label the run direct-codex-implement-<short-name>.
```

```text
/arc-orchestrator:direct-worker composer implement <MECHANICAL_IMPLEMENTATION_TASK>. Scope changes to <FILES_OR_SUBSYSTEM>. Run <TESTS>. Do not commit or push. If Composer reports a structured-result error, inspect the worktree before deciding it failed. Label the run direct-composer-<short-name>.
```
