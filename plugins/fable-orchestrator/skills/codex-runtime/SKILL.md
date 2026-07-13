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
- When the runner emits a `backend_unavailable` JSON hint line on stderr, include that line verbatim in the failure report so the parent can re-route.

## Commands

```sh
fable-orchestrator run --backend codex --mode analyze --task "<task contract>" --cwd "$PWD" --label "<short safe label>"
fable-orchestrator run --backend codex --mode implement --task "<task contract>" --cwd "$PWD" --label "<short safe label>" [--task-class taste-sensitive]
fable-orchestrator run --backend codex --mode review --task "<task contract>" --cwd "$PWD" --label "<short safe label>" [--task-class taste-sensitive]
```

`--label` is optional and appears in local run traces. Keep it to a short, non-sensitive description of the work; never include secrets, paths, or task details that should stay private.

Pass `--task-class taste-sensitive` (or `ui`, `copy`, `api-design`) for bounded UI/UX, user-facing copy, API design, or other high-taste implementation/review so the runner selects `gpt-5.6-sol`. Default Codex models are `gpt-5.6-luna` for analyze and `gpt-5.5` for implement/review (at high reasoning effort unless `--effort` overrides).

Never use unrestricted filesystem access, commit, push, merge, or deploy.
