---
name: delegate-runtime
description: Internal runtime contract for the neutral ARC Delegate worker that forwards one bounded lifecycle task to runner-routing-v4
user-invocable: false
---

# ARC Delegate Runtime

Use this skill only inside `arc-orchestrator:arc-delegate`.

## Execution Contract

- Invoke `arc-orchestrator` exactly once.
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
