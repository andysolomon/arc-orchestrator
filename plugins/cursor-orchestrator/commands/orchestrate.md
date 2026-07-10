---
name: orchestrate
description: Orchestrate the given task with Fable as the parent model, falling back to Codex 5.6 Terra as parent when Fable is unavailable, and delegating only bounded worker contracts to Composer, Codex, or Opus routes.
---

Use Fable as the parent orchestrator for the user-supplied task. If Fable is unavailable because Cursor limits are exhausted or the model is not available, use Codex 5.6 Terra as the parent orchestrator fallback. Follow the `orchestrate` skill in this plugin.

1. Decide whether the work should stay in the parent chat or be delegated.
2. If delegated, produce a bounded worker contract with outcome, scope, invariants, verification, prohibitions, and a safe label.
3. Route: Composer 2.5 for clear mechanical implementation, GPT-5.6 Terra for hard Codex implement/review, GPT-5.6 Luna for repo exploration, GPT-5.6 Sol for bounded taste-sensitive Codex implementation/review against explicit criteria, and Opus 4.8 for open-ended high-taste critique or design direction before criteria are fixed. `FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit Composer override, not the default. Explicit model overrides always win.
4. Inspect diffs and verification evidence before accepting worker output; treat it as evidence, not ground truth.

Do not commit, push, merge, deploy, edit secrets, or touch unrelated files unless the user explicitly asks.
