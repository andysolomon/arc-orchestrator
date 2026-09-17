---
name: composer-runtime
description: Internal runtime contract for the Composer worker agent that forwards one bounded implementation task to Cursor Composer 2.5
user-invocable: false
---

# Composer Runtime

Use this skill only inside `arc-orchestrator:composer-implement`.

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
- Return the runner's normalized JSON unchanged.
- If Cursor fails, return its actionable failure and stop. Do not substitute a Claude-side implementation.

## Command

```sh
arc-orchestrator run --backend composer --mode implement --task "<task contract>" --cwd "$PWD" --label "<short safe label>"
```

Bulk mechanical work stays on Composer 2.5. For flagship Sol, prefer automatic `--mode implement` with an appropriate `--workload-class` (or a non-empty `ARC_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` override for local Composer experiments). `task_class` never selects a model. Sol is no longer the Composer default.

Composer uses Cursor Agent's non-interactive write mode. Only send bounded implementation work. Never ask it to commit, push, merge, deploy, access credentials, or work outside the target workspace.
