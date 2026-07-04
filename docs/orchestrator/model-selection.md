# Orchestrator Model Selection Slash Commands

Use Fable by default. Copy the Opus/current-model commands only when you explicitly want to orchestrate without Fable.

```text
/fable-orchestrator:orchestrate <TASK>. Keep planning and final judgment in Fable. Delegate only bounded worker tasks. Require verification. Do not commit or push. Label the run fable-orchestrate-<short-name>.
```

```text
/fable-orchestrator:orchestrate-with-model opus <TASK>. Use Opus as the parent orchestrator for this request. Keep planning and final judgment in the parent Claude Code session. Delegate only bounded worker tasks. Require verification. Do not commit or push. Label the run opus-orchestrate-<short-name>.
```

```text
/fable-orchestrator:orchestrate-with-model current <TASK>. Use the currently selected Claude Code model as the parent orchestrator. Keep planning and final judgment in the parent session. Delegate only bounded worker tasks. Require verification. Do not commit or push. Label the run current-orchestrate-<short-name>.
```
