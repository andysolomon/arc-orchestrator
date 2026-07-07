---
name: orchestrate
description: Orchestrate the given task with Fable as the parent model, falling back to Codex 5.5 as parent when Fable is unavailable, and delegating only bounded worker contracts to Composer, Codex, or Opus routes.
---

Use Fable as the parent orchestrator for the user-supplied task. If Fable is unavailable because Cursor limits are exhausted or the model is not available, use Codex 5.5 as the parent orchestrator fallback. Follow the `orchestrate` skill in this plugin.

1. Decide whether the work should stay in the parent chat or be delegated.
2. If delegated, produce a bounded worker contract with outcome, scope, invariants, verification, prohibitions, and a safe label.
3. Route: Composer 2.5 for clear mechanical implementation, Codex 5.5 for hard implementation or review, the faster read-only Codex profile for repo exploration, and Opus 4.8 for high-taste UI/UX, API, docs, or prompt critique.
4. Inspect diffs and verification evidence before accepting worker output; treat it as evidence, not ground truth.

Do not commit, push, merge, deploy, edit secrets, or touch unrelated files unless the user explicitly asks.
