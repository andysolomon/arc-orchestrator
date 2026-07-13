---
name: mechanical-ops-runtime
description: Internal runtime contract for mechanical GitHub/git operations brokered through Composer 2.5 plan mode and a validated git/gh operation plan
user-invocable: false
---

# Mechanical Ops Runtime

Use this skill only inside the `mechanical-open-pr`, `mechanical-post-comment`, `mechanical-commit-push`, and `mechanical-merge` wrappers.

## Execution Contract

- Invoke `fable-orchestrator` exactly once with the matching `--route mechanical-*` alias.
- Do not inspect the repository or solve the operation in the Claude wrapper.
- Do not run `git` or `gh` in the wrapper; the runtime owns the bounded command sandbox.
- Preserve the parent task's outcome, scope, invariants, verification, and prohibitions.
- Return the runner's normalized JSON unchanged.
- If Cursor, broker validation, or the trusted executor fails, return its actionable failure and stop. Do not substitute a Claude-side implementation or fallback model.

## Commands

```sh
fable-orchestrator run --route mechanical-open-pr --task "<approved PR creation contract>" --cwd "$PWD" --label "<safe-label>"
fable-orchestrator run --route mechanical-post-comment --task "<approved GitHub comment contract>" --cwd "$PWD" --label "<safe-label>"
fable-orchestrator run --route mechanical-commit-push --task "<approved commit and push contract>" --cwd "$PWD" --label "<safe-label>"
fable-orchestrator run --route mechanical-merge --task "<approved PR merge contract>" --cwd "$PWD" --label "<safe-label>"
```

The runtime fixes the worker model to Composer 2.5 and invokes Cursor in non-writing plan mode. Composer returns exactly one structured `{"commands":[{"argv":[...]}]}` operation plan. Open-pr, post-comment, and merge plans must contain exactly one command. Commit-push plans must contain exactly two commands in order: an already-staged `git commit`, then `git push`; if commit fails, push is not invoked. The runner validates the plan with the canonical mechanical policy, resolves trusted `git` or `gh` executables itself from `FABLE_ORCHESTRATOR_TRUSTED_GIT_BIN` / `FABLE_ORCHESTRATOR_TRUSTED_GH_BIN` or system trusted-bin locations, and executes approved argv entries without a shell. Invalid, malformed, multiple-plan, absolute executable path, untrusted executable, `--body-file`, `--repo`, `--no-verify`, or unlisted operations fail before mutation.
