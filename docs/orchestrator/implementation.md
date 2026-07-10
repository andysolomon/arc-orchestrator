# Implementation Slash Commands

Replace placeholders, then copy one command into Claude Code TUI.

```text
/fable-orchestrator:orchestrate implement <TASK>. Scope changes to <FILES_OR_SUBSYSTEMS>. Preserve <BEHAVIOR_THAT_MUST_NOT_CHANGE>. Run <FOCUSED_TESTS_OR_VALIDATION>. Do not commit, push, merge, deploy, edit secrets, or touch unrelated files. Label the run implement-<short-name>.
```

```text
/fable-orchestrator:orchestrate implement the smallest safe change for <TASK>. Prefer GPT-5.6 Terra if the work is complex, or GPT-5.6 Sol for taste-sensitive Codex implementation/review; use Composer only if the task is mechanical and well-scoped. Scope changes to <FILES_OR_SUBSYSTEMS>. Run <TESTS>. Do not commit or push. Label the run small-implement-<short-name>.
```

```text
/fable-orchestrator:orchestrate update documentation for <FEATURE_OR_CHANGE>. Limit edits to <DOC_FILES>. Verify links and examples. Do not change code. Do not commit or push. Label the run docs-implement-<short-name>.
```
