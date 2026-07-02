---
name: codex-runtime
description: Internal runtime contract for Composer worker agents that forward one bounded task to Codex
user-invocable: false
---

# Codex Runtime

Use this skill only inside the plugin's Composer worker agents.

## Execution Contract

- Invoke `fable-orchestrator` exactly once.
- Do not inspect the repository or solve the task in the Claude wrapper.
- Preserve the parent task's outcome, scope, invariants, verification, and prohibitions.
- Return the runner's stdout unchanged.
- If the runner fails, return its actionable failure and stop. Do not substitute a Claude-side implementation.

## Commands

```sh
fable-orchestrator run --backend codex --mode analyze --task "<task contract>" --cwd "$PWD"
fable-orchestrator run --backend codex --mode implement --task "<task contract>" --cwd "$PWD"
fable-orchestrator run --backend codex --mode review --task "<task contract>" --cwd "$PWD"
```

Never use unrestricted filesystem access, commit, push, merge, or deploy.
