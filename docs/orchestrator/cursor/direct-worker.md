# Direct Worker Commands (Cursor)

Use the active tier of the CC-Fable → Codex 5.6 Sol → Cursor-Fable-High parent availability chain at high reasoning. Planning, ambiguity resolution, route selection, final judgment, and user communication stay in the active parent chat. Follow the cross-harness parent availability chain: CC-Fable → Codex 5.6 Sol → Cursor-Fable-High. If CC-Fable is unavailable because of usage limit, authentication failure, or model unavailable, use Codex 5.6 Sol; if Codex 5.6 Sol is also unavailable, use Cursor-Fable-High. Run every parent in this availability chain at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control, and never use low or unspecified/default reasoning for a parent.

Use these when the agent wrapper is inconvenient or blocked. One bounded worker per command; the active parent chat still owns planning and final judgment. Every task must state outcome, scope, invariants, verification, prohibitions, and a safe label.

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

Grok second-tier availability fallback (when Claude/Opus is unavailable):

```sh
fable-orchestrator run --backend composer --mode analyze --route grok-explore --task "<bounded read-only analysis contract>" --cwd "$PWD" --label "<safe-label>"
```

```sh
fable-orchestrator run --backend composer --mode review --route grok-check --task "<bounded read-only review contract>" --cwd "$PWD" --label "<safe-label>"
```

```sh
fable-orchestrator run --backend composer --mode implement --route grok-implement --task "<bounded implementation contract>" --cwd "$PWD" --label "<safe-label>"
```

Direct workers never commit, push, merge, deploy, or edit secrets. Use explicit `--route sol-implement` when Sol is required; `--task-class` is metadata only. If Composer edits files but the runner reports it did not return the required structured result, inspect the worktree and run verification before deciding failure.
