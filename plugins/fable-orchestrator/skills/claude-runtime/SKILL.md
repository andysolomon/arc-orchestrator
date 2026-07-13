---
name: claude-runtime
description: Internal runtime contract for worker agents that forward one bounded task to the claude backend (Opus 4.8)
user-invocable: false
---

# Claude Runtime

Use this skill only inside the plugin's Opus availability-fallback worker agents.

## Execution Contract

- Invoke `fable-orchestrator` exactly once.
- Do not inspect the repository or solve the task in the Claude wrapper.
- Preserve the parent task's outcome, scope, invariants, verification, and prohibitions.
- Return the runner's stdout unchanged.
- If the runner fails, return its actionable failure and stop. Do not substitute a Claude-side implementation.
- If stderr includes a `backend_unavailable` JSON fallback hint, surface that hint verbatim and stop. Do not silently retry or substitute Grok inside the Opus worker.

## Commands

```sh
fable-orchestrator run --backend claude --mode analyze --task "<task contract>" --cwd "$PWD" --label "<short safe label>"
fable-orchestrator run --backend claude --mode implement --task "<task contract>" --cwd "$PWD" --label "<short safe label>"
fable-orchestrator run --backend claude --mode review --task "<task contract>" --cwd "$PWD" --label "<short safe label>"
```

`--label` is optional and appears in local run traces. Keep it to a short, non-sensitive description of the work; never include secrets, paths, or task details that should stay private.

Never use unrestricted filesystem access, commit, push, merge, or deploy.
