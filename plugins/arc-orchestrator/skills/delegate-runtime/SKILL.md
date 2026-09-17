---
name: delegate-runtime
description: Internal runtime contract for the neutral ARC Delegate worker that forwards one bounded lifecycle task to runner-routing-v4
user-invocable: false
---

# ARC Delegate Runtime

Use this skill only inside `arc-orchestrator:arc-delegate`.

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
- Use the parent-supplied lifecycle phase and matching mode.
- For Implement, require the parent-supplied nine-cell complexity class.
- Do not add provider, backend, public route, worker-model, model, or effort
  selection flags. The runner owns candidate selection.
- Do not inspect the repository or solve the task in the Claude wrapper.
- Preserve the parent task's outcome, scope, invariants, verification, and
  prohibitions.
- Return the runner's normalized JSON unchanged.
- If the runner fails, return its actionable failure and stop. Do not substitute
  a Claude-side implementation.

## Phase Commands

Explore, Research, or Plan:

```sh
arc-orchestrator run --mode analyze --phase <phase> --task "<task contract>" --cwd "$PWD" --label "<short safe label>" --routing-policy runner-routing-v4
```

Implement:

```sh
arc-orchestrator run --mode implement --phase implement --workload-class <complexity> --task "<task contract>" --cwd "$PWD" --label "<short safe label>" --routing-policy runner-routing-v4
```

Verify:

```sh
arc-orchestrator run --mode review --phase verify --task "<task contract>" --cwd "$PWD" --label "<short safe label>" --routing-policy runner-routing-v4
```

Deploy is permitted only when the parent contract records explicit human
authorization:

```sh
arc-orchestrator run --mode implement --phase deploy --deploy-authorized true --task "<task contract>" --cwd "$PWD" --label "<short safe label>" --routing-policy runner-routing-v4
```

Analyze is parent-local and must never be forwarded as an automatic v4 worker
phase.

Valid implementation complexity values are `hard-heavy`, `hard-medium`,
`hard-light`, `medium-heavy`, `medium-medium`, `medium-light`, `easy-heavy`,
`easy-medium`, and `easy-light`. Never invent a default when the parent has not
classified the implementation.
