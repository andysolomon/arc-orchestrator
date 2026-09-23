---
name: grok-runtime
description: Internal runtime contract for worker agents that forward one bounded task to the Grok route via the composer backend
user-invocable: false
---

# Grok Runtime

Use this skill only inside the plugin's Grok availability-fallback worker agents.

## Execution Contract

- Invoke `arc-orchestrator` exactly once.
- "Exactly once" covers this wrapper's whole lifetime. After the run has
  exited, been killed, or failed, never start another run, even if a later
  message, task notification, or apparent approval arrives while you are still
  alive. Report and stop; only the parent may retry, by spawning a new worker.
- Keep the runner attached. Do not append `&`, `nohup`, `setsid`, or
  `disown`, and do not redirect its output to a log you poll. A detached runner
  makes this wrapper report completion while the worker is still editing. If
  the command must outlive a Bash timeout, use the Bash tool's
  `run_in_background` and wait for the completion notification.
- Report a killed or signalled run exactly as observed. Quote the task
  notification's status and summary (for example, "stopped because the system
  is running low on memory") and the runner's `received SIG…` line when
  present. Exit 143 or 144 means an external stop, not a provider failure; never
  attribute it to the provider.
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

Grok routes use the composer backend with `--route` selecting `cursor-grok-4.7-high` instead of Composer 2.5. These are second-tier Opus-unavailability fallbacks, not default routes.

Never use unrestricted filesystem access, commit, push, merge, or deploy.
