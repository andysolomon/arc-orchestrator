---
name: orchestrate
description: Use Fable as the parent orchestrator in Cursor. Route bounded work to Composer 2.5, Codex, or Opus based on task type while keeping planning, judgment, and final synthesis in the parent Cursor chat.
---

# Cursor Orchestrator

Use this skill when the user asks Cursor Agent to orchestrate work.

## Parent Policy

- Use Fable as the default parent orchestrator when available in Cursor.
- If Fable is unavailable because Cursor limits are exhausted or the model is not available, use Codex 5.6 Terra as the default parent orchestrator fallback.
- Keep planning, ambiguity resolution, route selection, final judgment, and user communication in the parent Cursor chat, whether the parent is Fable or the Codex 5.6 Terra fallback.
- Delegate only bounded worker tasks.

## Route Selection

- Composer 2.5: clear, mechanical, high-volume implementation after the approach is approved.
- Codex analyze: read-only repo exploration, dependency tracing, evidence gathering, and log/test-failure analysis; defaults to GPT-5.6 Luna.
- Codex 5.6 Terra parent fallback: when Fable is unavailable in Cursor, keep orchestration in the parent chat with Codex 5.6 Terra instead of silently dropping the orchestration workflow.
- Codex implement: hard implementation, debugging-heavy fixes, or escalation after Composer misses the bar; defaults to GPT-5.6 Terra, or Sol for taste-sensitive task classes.
- Codex review: read-only correctness, regression, security, and acceptance-criteria checks; defaults to GPT-5.6 Terra, or Sol for taste-sensitive task classes.
- Opus 4.8 review: open-ended high-taste critique or design direction before criteria are fixed; use Sol for bounded taste-sensitive Codex implementation/review against explicit criteria.
- Claude backend (`--backend claude`): availability fallback for analyze, review, or implement when Codex is unavailable or the parent explicitly routes to Opus 4.8. Set `FABLE_ORCHESTRATOR_FALLBACK=claude` for opt-in automatic retry on availability-classified Codex failures.

## GPT-5.6 Worker Routing

- `gpt-5.6-luna`: Codex analyze default for high-volume, low-stakes exploration and evidence gathering.
- `gpt-5.6-terra`: Codex implement/review default for harder implementation, debugging, escalation, and routine checks.
- `gpt-5.6-sol`: Codex implement/review default for taste-sensitive task classes (`taste-sensitive`, `ui`, `copy`, `api-design`) unless the matching `FABLE_ORCHESTRATOR_IMPLEMENT_MODEL` or `FABLE_ORCHESTRATOR_REVIEW_MODEL` override is non-empty.
- Composer 2.5 remains the default Cursor implementation worker; `FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit override escape hatch, not the default.
- Explicit model overrides always win.

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
