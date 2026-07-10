---
name: composer-runtime
description: Internal runtime contract for the Composer worker agent that forwards one bounded implementation task to Cursor Composer 2.5
user-invocable: false
---

# Composer Runtime

Use this skill only inside `fable-orchestrator:composer-implement`.

## Execution Contract

- Invoke `fable-orchestrator` exactly once.
- Do not inspect the repository or solve the task in the Claude wrapper.
- Preserve the parent task's outcome, scope, invariants, verification, and prohibitions.
- Return the runner's normalized JSON unchanged.
- If Cursor fails, return its actionable failure and stop. Do not substitute a Claude-side implementation.

## Command

```sh
fable-orchestrator run --backend composer --mode implement --task "<task contract>" --cwd "$PWD" --label "<short safe label>" [--task-class taste-sensitive]
```

Pass `--task-class taste-sensitive` (or `ui`, `copy`, `api-design`) to preserve the parent classification in traces and routing evidence. Cursor always defaults to Composer 2.5, including those classes. `FABLE_ORCHESTRATOR_COMPOSER_MODEL` remains an explicit non-empty override, including `gpt-5.6-sol` when intentionally requested.

Composer uses Cursor Agent's non-interactive write mode. Only send bounded implementation work. Never ask it to commit, push, merge, deploy, access credentials, or work outside the target workspace.
