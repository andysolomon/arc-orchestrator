# Implementation Orchestrator Prompt

Use this when the task is bounded enough for a worker to make code or documentation changes.

```text
/fable-orchestrator:orchestrate implement <TASK>. Scope changes to <FILES_OR_SUBSYSTEMS>. Preserve <BEHAVIOR_THAT_MUST_NOT_CHANGE>. Run <FOCUSED_TESTS_OR_VALIDATION>. Do not commit, push, merge, deploy, edit secrets, or touch unrelated files. Label the run implement-<short-name>.
```

## Contract

- Route: `codex/implement` for hard implementation or `composer/implement` for low-risk mechanical work.
- Outcome: bounded code/docs change with verification evidence.
- Scope: exact files, directories, or subsystem named by the parent orchestrator.
- Invariants: public behavior and compatibility constraints that must remain unchanged.
- Verification: focused tests first, then broader validation if the change warrants it.
- Prohibitions: no commits, pushes, merges, deployments, secret edits, or unrelated refactors.
- Safe label: `implement-<short-name>`.
- Claude Code usage: paste the command above into Claude Code TUI and replace `<TASK>`, `<FILES_OR_SUBSYSTEMS>`, `<BEHAVIOR_THAT_MUST_NOT_CHANGE>`, and `<FOCUSED_TESTS_OR_VALIDATION>` before running it.
