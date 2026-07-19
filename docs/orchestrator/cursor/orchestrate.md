# Cursor Orchestrate Prompts

Use the active tier of the CC-Fable → Codex 5.6 Sol → Cursor-Fable-High parent availability chain at high reasoning. Planning, ambiguity resolution, route selection, final judgment, and user communication stay in the active parent chat. With the cursor-orchestrator plugin installed, `/orchestrate <task>` wraps the same contract. Follow the cross-harness parent availability chain: CC-Fable → Codex 5.6 Sol → Cursor-Fable-High. If CC-Fable is unavailable because of usage limit, authentication failure, or model unavailable, use Codex 5.6 Sol; if Codex 5.6 Sol is also unavailable, use Cursor-Fable-High. Run every parent in this availability chain at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control, and never use low or unspecified/default reasoning for a parent.

```text
/orchestrate <TASK>
```

Manual paste when the plugin is not installed:

```text
Use the active parent tier to orchestrate <TASK>. Follow the cross-harness parent availability chain: CC-Fable → Codex 5.6 Sol → Cursor-Fable-High. If CC-Fable is unavailable because of usage limit, authentication failure, or model unavailable, use Codex 5.6 Sol; if Codex 5.6 Sol is also unavailable, use Cursor-Fable-High. Run every parent in this availability chain at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control, and never use low or unspecified/default reasoning for a parent. First decide whether this should stay in the parent chat or be delegated. If delegated, produce a bounded worker contract with outcome, scope, invariants, verification, prohibitions, and a safe label. Prefer Composer 2.5 for clear mechanical implementation, GPT-5.5 for hard Codex implement/review, GPT-5.6 Luna for repo exploration, GPT-5.6 Sol via explicit `sol-implement` for bounded taste-sensitive Codex implementation/review against explicit criteria, and Opus 4.8 when the task needs open-ended high-taste critique or design direction before criteria are fixed. Use `workload_class` for automatic implementation stacks; `task_class` is metadata only. When shipping is authorized, the parent performs `git`/`gh` operations directly after reviewing worker evidence; there are no mechanical worker routes. Do not deploy, edit secrets, or touch unrelated files.
```

Review judgment and approval stay in the active parent.

## Shipping authority

Workers do not commit, push, merge, deploy, or mutate GitHub. There are no
mechanical worker aliases. The parent performs an explicitly authorized shipping
operation directly after reviewing worker evidence.

Verify backends before the first delegation in a new environment:

```sh
arc-orchestrator doctor --json
```
