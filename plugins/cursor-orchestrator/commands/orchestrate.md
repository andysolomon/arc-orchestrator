---
name: orchestrate
description: Orchestrate the given task through the CC-Fable, Codex 5.6 Sol, then Cursor-Fable-High parent availability chain at high reasoning, delegating only bounded worker contracts to Composer, Codex, or Opus routes.
---

Use the active tier in the parent availability chain to orchestrate the user-supplied task. Follow the cross-harness parent availability chain: CC-Fable → Codex 5.6 Sol → Cursor-Fable-High. If CC-Fable is unavailable because of usage limit, authentication failure, or model unavailable, use Codex 5.6 Sol; if Codex 5.6 Sol is also unavailable, use Cursor-Fable-High. Run every parent in this availability chain at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control, and never use low or unspecified/default reasoning for a parent. Follow the `orchestrate` skill in this plugin.

1. Decide whether the work should stay in the parent chat or be delegated.
2. If delegated, produce a bounded worker contract with outcome, scope, invariants, verification, prohibitions, and a safe label.
3. Route: Composer 2.5 for clear mechanical implementation, GPT-5.5 for hard Codex implement/review, GPT-5.6 Luna for repo exploration, GPT-5.6 Sol for bounded taste-sensitive Codex implementation/review against explicit criteria, and Opus 4.8 for open-ended high-taste critique or design direction before criteria are fixed. `FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit Composer override, not the default. Explicit model overrides always win.
4. Inspect diffs and verification evidence before accepting worker output; treat it as evidence, not ground truth.

Do not commit, push, merge, deploy, edit secrets, or touch unrelated files unless the user explicitly asks.
