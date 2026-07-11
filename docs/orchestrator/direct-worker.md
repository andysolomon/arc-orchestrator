# Direct Worker Slash Commands

Use these when Claude Code auto mode blocks the normal Agent wrapper. Copy one command into Claude Code TUI.

```text
/fable-orchestrator:direct-worker codex analyze <READ_ONLY_ANALYSIS_TASK>. Scope to <FILES_OR_SUBSYSTEM>. Do not edit files. Label the run direct-analyze-<short-name>.
```

```text
/fable-orchestrator:direct-worker codex review <REVIEW_TASK>. Keep the run read-only. Report findings with evidence and verification suggestions. Use --task-class taste-sensitive for GPT-5.6 Sol when reviewing UI/UX, copy, or API design. Do not edit files. Label the run direct-review-<short-name>.
```

```text
/fable-orchestrator:direct-worker codex implement <IMPLEMENTATION_TASK>. Scope changes to <FILES_OR_SUBSYSTEM>. Run <TESTS>. Use --task-class taste-sensitive for GPT-5.6 Sol when implementing UI/UX, copy, or API design. Do not commit or push. Label the run direct-codex-implement-<short-name>.
```

```text
/fable-orchestrator:direct-worker composer implement <MECHANICAL_IMPLEMENTATION_TASK>. Scope changes to <FILES_OR_SUBSYSTEM>. Run <TESTS>. Do not commit or push. If Composer reports a structured-result error, inspect the worktree before deciding it failed. Label the run direct-composer-<short-name>.
```
