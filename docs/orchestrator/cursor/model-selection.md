# Model Selection (Cursor)

Fable in Cursor is the default/recommended parent orchestrator: planning, ambiguity resolution, route selection, final judgment, and user communication stay in the parent Cursor chat. Workers are chosen per task:

| Route | Worker | Use for |
| --- | --- | --- |
| `composer/implement` | Composer 2.5 | Clear, mechanical, high-volume implementation |
| `codex/implement` | GPT-5.6 Terra (Sol for taste-sensitive) | Hard implementation, debugging-heavy fixes, escalation; use Sol for bounded taste-sensitive work against explicit criteria |
| `codex/analyze` | GPT-5.6 Luna | Repo exploration and evidence gathering |
| `codex/review` | GPT-5.6 Terra (Sol for taste-sensitive) | Correctness, regression, security, acceptance criteria; use Sol for bounded taste-sensitive review against explicit criteria |
| `opus/review` | Opus 4.8 | Open-ended high-taste critique or design direction before criteria are fixed |

Use Sol for bounded taste-sensitive Codex implementation/review against explicit criteria. Reserve Opus for open-ended high-taste critique or design direction before criteria are fixed.

`FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit Composer override escape hatch, not the default.

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
