---
name: grok-runtime
description: Internal runtime contract for worker agents that forward one bounded task to the Grok route via the composer backend
user-invocable: false
---

# Grok Runtime

Use this skill only inside the plugin's Grok availability-fallback worker agents.

## Execution Contract

- Invoke `arc-orchestrator` exactly once.
- Do not inspect the repository or solve the task in the Claude wrapper.
- Preserve the parent task's outcome, scope, invariants, verification, and prohibitions.
- Return the runner's stdout unchanged.
- If the runner fails, return its actionable failure and stop. Do not substitute a Claude-side implementation.
- When the runner emits a `backend_unavailable` JSON hint line on stderr, include that line verbatim in the failure report so the parent can re-route.

## Commands

```sh
arc-orchestrator run --backend composer --mode analyze --route grok-explore --task "<task contract>" --cwd "$PWD" --label "<short safe label>"
arc-orchestrator run --backend composer --mode implement --route grok-implement --task "<task contract>" --cwd "$PWD" --label "<short safe label>"
arc-orchestrator run --backend composer --mode review --route grok-check --task "<task contract>" --cwd "$PWD" --label "<short safe label>"
```

`--label` is optional and appears in local run traces. Keep it to a short, non-sensitive description of the work; never include secrets, paths, or task details that should stay private.

Grok routes use the composer backend with `--route` selecting `grok-4.5` instead of Composer 2.5. These are second-tier Opus-unavailability fallbacks, not default routes.

Never use unrestricted filesystem access, commit, push, merge, or deploy.
