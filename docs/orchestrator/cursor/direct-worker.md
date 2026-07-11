# Direct Worker Commands (Cursor)

Use these when the agent wrapper is inconvenient or blocked. One bounded worker per command; the parent Cursor chat still owns planning and final judgment. Every task must state outcome, scope, invariants, verification, prohibitions, and a safe label.

```sh
fable-orchestrator run --backend codex --mode analyze --task "<bounded read-only analysis contract>" --cwd "$PWD" --label "<safe-label>"
```

```sh
fable-orchestrator run --backend codex --mode review --task "<bounded read-only review contract>" --cwd "$PWD" --label "<safe-label>"
```

```sh
fable-orchestrator run --backend codex --mode implement --task "<bounded implementation contract>" --cwd "$PWD" --label "<safe-label>"
```

```sh
fable-orchestrator run --backend composer --mode implement --task "<bounded mechanical implementation contract>" --cwd "$PWD" --label "<safe-label>"
```

Direct workers never commit, push, merge, deploy, or edit secrets. Use `--task-class taste-sensitive` for GPT-5.6 Sol when Codex implement/review covers UI/UX, copy, or API design. If Composer edits files but the runner reports it did not return the required structured result, inspect the worktree and run verification before deciding failure.
