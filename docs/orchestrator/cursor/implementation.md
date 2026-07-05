# Implementation Prompts (Cursor)

Paste into Cursor chat with Fable as the parent model. Fable turns the request into a bounded contract and picks the worker.

```text
/orchestrate implement <OUTCOME>. Scope: <FILES_OR_SUBSYSTEM>. Must not change: <INVARIANTS>. Verify with: env -u FABLE_ORCHESTRATOR_LOCK_WAIT_MS bun test. Do not commit, push, merge, deploy, edit secrets, or touch unrelated files. Label the run impl-<short-name>.
```

Direct runner equivalents:

```sh
# Clear, mechanical, high-volume implementation (default)
fable-orchestrator run --backend composer --mode implement --task "<bounded implementation contract with outcome, scope, invariants, verification, prohibitions>" --cwd "$PWD" --label "impl-composer-<short-name>"
```

```sh
# Hard implementation or escalation after Composer misses the bar
fable-orchestrator run --backend codex --mode implement --task "<bounded implementation contract>" --cwd "$PWD" --label "impl-codex-<short-name>"
```

Inspect the diff and run verification yourself before accepting the work. Write-capable runs serialize per project; run independent write tasks from separate worktrees.
