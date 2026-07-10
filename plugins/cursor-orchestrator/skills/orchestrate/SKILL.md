---
name: orchestrate
description: Use Fable as the parent orchestrator in Cursor. Route bounded work to Composer 2.5, Codex, or Opus based on task type while keeping planning, judgment, and final synthesis in the parent Cursor chat.
---

# Cursor Orchestrator

Use this skill when the user asks Cursor Agent to orchestrate work.

## Parent Policy

- Use Fable as the default parent orchestrator when available in Cursor.
- If Fable is unavailable because Cursor limits are exhausted or the model is not available, use Codex 5.5 as the default parent orchestrator fallback.
- Keep planning, ambiguity resolution, route selection, final judgment, and user communication in the parent Cursor chat, whether the parent is Fable or the Codex 5.5 fallback.
- Delegate only bounded worker tasks.

## Route Selection

- Composer 2.5: clear, mechanical, high-volume implementation after the approach is approved.
- Codex analyze: read-only repo exploration, dependency tracing, evidence gathering, and log/test-failure analysis.
- Codex 5.5 parent fallback: when Fable is unavailable in Cursor, keep orchestration in the parent chat with Codex 5.5 instead of silently dropping the orchestration workflow.
- Codex implement: hard implementation, debugging-heavy fixes, or escalation after Composer misses the bar.
- Codex review: read-only correctness, regression, security, and acceptance-criteria checks.
- Opus 4.8 review: high-taste UI/UX, API ergonomics, component architecture, docs/copy, prompt wording, and long-lived abstraction critique.
- Claude backend (`--backend claude`): availability fallback for analyze, review, or implement when Codex is unavailable or the parent explicitly routes to Opus 4.8. Set `FABLE_ORCHESTRATOR_FALLBACK=claude` for opt-in automatic retry on availability-classified Codex failures.

## GPT-5.6 Worker Routing

- `gpt-5.6-terra` and `gpt-5.6-luna` are Codex worker choices. Set the applicable `FABLE_ORCHESTRATOR_ANALYZE_MODEL`, `FABLE_ORCHESTRATOR_IMPLEMENT_MODEL`, or `FABLE_ORCHESTRATOR_REVIEW_MODEL` value when the bounded Codex task needs one.
- `gpt-5.6-sol` is Cursor-only and write-capable: use it for taste-sensitive Cursor implementation (`taste-sensitive`, `ui`, `copy`, or `api-design`), never for a Codex or read-only route. It is selected for those task classes when no model is specified.
- Explicit model overrides always win. `FABLE_ORCHESTRATOR_COMPOSER_MODEL` overrides the Cursor task-class default; the mode-specific Codex variables select only their matching Codex worker mode.

Cursor intentionally remains Fable-first for the parent chat; that parent policy does not change the backend-specific worker choices above.

## Delegation Contract

Before delegating, state:

1. exact outcome;
2. files or subsystem in scope;
3. behavior that must not change;
4. required tests or verification;
5. prohibited actions: no commits, pushes, merges, deployments, secret edits, or unrelated refactors;
6. short safe label.

Treat worker output as evidence, not ground truth. Inspect diffs and verification before accepting implementation work.
