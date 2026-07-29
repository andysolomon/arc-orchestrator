---
name: delegate-runtime
description: Internal runtime contract for the neutral ARC Delegate worker that forwards one bounded lifecycle task to runner-routing-v3
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

Explore, Analyze, Research, or Plan:

```sh
arc-orchestrator run --mode analyze --phase <phase> --task "<task contract>" --cwd "$PWD" --label "<short safe label>" --routing-policy runner-routing-v3
```

Implement:

```sh
arc-orchestrator run --mode implement --phase implement --workload-class <complexity> --task "<task contract>" --cwd "$PWD" --label "<short safe label>" --routing-policy runner-routing-v3
```

Verify:

```sh
arc-orchestrator run --mode review --phase verify --task "<task contract>" --cwd "$PWD" --label "<short safe label>" --routing-policy runner-routing-v3
```

Deploy is permitted only when the parent contract records explicit human
authorization:

```sh
arc-orchestrator run --mode implement --phase deploy --deploy-authorized true --task "<task contract>" --cwd "$PWD" --label "<short safe label>" --routing-policy runner-routing-v3
```

Valid implementation complexity values are `hard-hard`, `hard-medium`,
`hard-easy`, `medium-hard`, `medium-medium`, `medium-easy`, `easy-hard`,
`easy-medium`, and `easy-easy`. Never invent a default when the parent has not
classified the implementation.

