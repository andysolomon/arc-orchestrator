# Model Selection (Cursor)

Fable in Cursor is the default/recommended parent orchestrator: planning, ambiguity resolution, route selection, final judgment, and user communication stay in the parent Cursor chat. Workers are chosen per task:

| Route | Worker | Use for |
| --- | --- | --- |
| `composer/implement` | Composer 2.5 | Clear, mechanical, high-volume implementation |
| `codex/implement` | Codex 5.5 | Hard implementation, debugging-heavy fixes, escalation |
| `codex/analyze` | Faster read-only Codex | Repo exploration and evidence gathering |
| `codex/review` | Codex 5.5 | Correctness, regression, security, acceptance criteria |
| `opus/review` | Opus 4.8 | High-taste UI/UX, API ergonomics, docs, copy, prompts |

Start any task with the parent decision prompt:

```text
/orchestrate <TASK>
```

Compare how routes have actually performed before changing defaults:

```sh
fable-orchestrator report --group-by model
fable-orchestrator report --group-by task_class
```

Record your judgment after each delegated run so the report stays meaningful:

```sh
fable-orchestrator annotate --run latest --outcome accepted
```
