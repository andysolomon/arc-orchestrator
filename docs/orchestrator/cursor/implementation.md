# Implementation Prompts (Cursor)

Use the active tier of the CC-Fable → Codex 5.6 Sol → Cursor-Fable-High parent availability chain at high reasoning. Planning, ambiguity resolution, route selection, final judgment, and user communication stay in the active parent chat. Follow the cross-harness parent availability chain: CC-Fable → Codex 5.6 Sol → Cursor-Fable-High. If CC-Fable is unavailable because of usage limit, authentication failure, or model unavailable, use Codex 5.6 Sol; if Codex 5.6 Sol is also unavailable, use Cursor-Fable-High. Run every parent in this availability chain at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control, and never use low or unspecified/default reasoning for a parent. The active parent turns the request into a bounded contract and picks the worker.

```text
/orchestrate implement <OUTCOME>. Scope: <FILES_OR_SUBSYSTEM>. Must not change: <INVARIANTS>. Verify with: bun test. Do not commit, push, merge, deploy, edit secrets, or touch unrelated files. Label the run impl-<short-name>.
```

Automatic runner equivalent:

Explore (Analyze itself stays parent-local):

```sh
arc-orchestrator run \
  --mode analyze \
  --phase explore \
  --task "<bounded analysis contract>" \
  --cwd "$PWD" \
  --label "<safe label>" \
  --routing-policy runner-routing-v4
```

Implement:

```sh
arc-orchestrator run \
  --mode implement \
  --phase implement \
  --workload-class <hard-heavy|hard-medium|hard-light|medium-heavy|medium-medium|medium-light|easy-heavy|easy-medium|easy-light> \
  --task "<bounded implementation contract>" \
  --cwd "$PWD" \
  --label "<safe label>" \
  --routing-policy runner-routing-v4
```

Explicit pin equivalents:

```sh
# Explicit single-candidate Composer pin
arc-orchestrator run --backend composer --mode implement --task "<bounded implementation contract with outcome, scope, invariants, verification, prohibitions>" --cwd "$PWD" --label "impl-composer-<short-name>"
```

```sh
# Hard implementation or escalation after Composer misses the bar
arc-orchestrator run --backend codex --mode implement --task "<bounded implementation contract>" --cwd "$PWD" --label "impl-codex-<short-name>"
```

Inspect the diff and run verification yourself before accepting the work. The parent must coordinate concurrent write-capable runs and dispatch only disjoint tasks; use separate worktrees for concurrent writers.
