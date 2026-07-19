# Model Selection (Cursor)

Use the active tier of the CC-Fable → Codex 5.6 Sol → Cursor-Fable-High parent availability chain at high reasoning. Planning, ambiguity resolution, route selection, final judgment, and user communication stay in the active parent chat. Follow the cross-harness parent availability chain: CC-Fable → Codex 5.6 Sol → Cursor-Fable-High. If CC-Fable is unavailable because of usage limit, authentication failure, or model unavailable, use Codex 5.6 Sol; if Codex 5.6 Sol is also unavailable, use Cursor-Fable-High. Run every parent in this availability chain at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control, and never use low or unspecified/default reasoning for a parent. Workers are chosen per task:

| Route | Worker | Use for |
| --- | --- | --- |
| `composer/implement` | Composer 2.5 | Clear, mechanical, high-volume implementation |
| `codex/implement` | GPT-5.5 | Hard implementation, debugging-heavy fixes, escalation; use explicit `sol-implement` when Sol is required |
| `codex/analyze` | GPT-5.6 Luna | Repo exploration and evidence gathering |
| `codex/review` | GPT-5.5 | Correctness, regression, security, acceptance criteria |
| `opus/review` | Opus 4.8 | Open-ended high-taste critique or design direction before criteria are fixed |

Use Sol for bounded taste-sensitive Codex implementation/review against explicit criteria. Reserve Opus for open-ended high-taste critique or design direction before criteria are fixed.

`ARC_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit Composer override escape hatch, not the default.

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
