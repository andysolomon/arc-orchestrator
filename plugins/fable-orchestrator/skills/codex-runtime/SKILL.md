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
fable-orchestrator run --backend codex --mode implement --task "<task contract>" --cwd "$PWD" --label "<short safe label>"
fable-orchestrator run --backend codex --mode review --task "<task contract>" --cwd "$PWD" --label "<short safe label>"
```

`--label` is optional and appears in local run traces. Keep it to a short, non-sensitive description of the work; never include secrets, paths, or task details that should stay private.

Default Codex models are `gpt-5.6-luna` for analyze and `gpt-5.5` for implement/review (at high reasoning effort unless `--effort` overrides). Prefer automatic selection (omit `--route`) so Codex stays on the ADR fallback chain; use `--workload-class` for automatic implementation stacks. `--task-class` is observability metadata only and never selects a model.

Never use unrestricted filesystem access, commit, push, merge, or deploy.
