---
name: orchestrate
description: Use Fable as the parent orchestrator in Cursor. Route bounded work to Composer 2.5, Codex, or Opus based on task type while keeping planning, judgment, and final synthesis in the parent Cursor chat.
---

# Cursor Orchestrator

Use this skill when the user asks Cursor Agent to orchestrate work.

## Parent Policy

- Use Fable as the default parent orchestrator when available in Cursor.
- Whenever Fable is the parent in Cursor, select high reasoning. This applies to both the primary Fable parent and the Cursor-Fable-High fallback tier; do not use low or unspecified/default reasoning for a Fable parent.
- If Fable is unavailable because of usage limit, authentication failure, or model unavailable, follow the parent availability chain: Codex 5.6 Sol, then Cursor-Fable-High. Run the Codex-Sol parent fallback at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control.
- Keep planning, ambiguity resolution, route selection, final judgment, and user communication in the parent Cursor chat, whether the parent is Fable, Codex 5.6 Sol, or Cursor-Fable-High.
- Delegate only bounded worker tasks.

## Route Selection

- Composer 2.5: clear, mechanical, high-volume implementation after the approach is approved.
- Codex analyze: read-only repo exploration, dependency tracing, evidence gathering, and log/test-failure analysis; defaults to GPT-5.6 Luna.
- Parent availability chain: when Fable is unavailable in Cursor, keep orchestration in the parent chat with Codex 5.6 Sol first, then Cursor-Fable-High, instead of silently dropping the orchestration workflow.
- Codex implement: hard implementation, debugging-heavy fixes, or escalation after Composer misses the bar; defaults to GPT-5.5, or Sol for taste-sensitive task classes.
- Codex review: read-only correctness, regression, security, and acceptance-criteria checks; defaults to GPT-5.5, or Sol for taste-sensitive task classes.
- Opus 4.8 review: open-ended high-taste critique or design direction before criteria are fixed; use Sol for bounded taste-sensitive Codex implementation/review against explicit criteria.
- Claude backend (`--backend claude`): first-tier availability fallback for analyze, review, or implement when Codex is unavailable or the parent explicitly routes to Opus 4.8. Set `FABLE_ORCHESTRATOR_FALLBACK=claude` for opt-in automatic retry on availability-classified Codex failures.
- Grok routes (`--backend composer --route grok-*`): second-tier availability fallback when Claude/Opus is also unavailable; use `grok-explore`, `grok-check`, or `grok-implement` via the composer backend with Grok 4.5. Grok is availability recovery, not taste escalation and not a substitute for `opus-review`.

## GPT-5.6 Worker Routing

- `gpt-5.6-luna`: Codex analyze default for high-volume, low-stakes exploration and evidence gathering.
- `gpt-5.5`: Codex implement/review default for harder implementation, debugging, escalation, and routine checks at high reasoning effort unless `--effort` overrides.
- `gpt-5.6-sol`: Codex implement/review default for taste-sensitive task classes (`taste-sensitive`, `ui`, `copy`, `api-design`) unless the matching `FABLE_ORCHESTRATOR_IMPLEMENT_MODEL` or `FABLE_ORCHESTRATOR_REVIEW_MODEL` override is non-empty.
- Composer 2.5 remains the default Cursor implementation worker; `FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit override escape hatch, not the default.
- Explicit model overrides always win.

Cursor intentionally remains Fable-first for the parent chat; that parent policy does not change the backend-specific worker choices above.

## Composer Orchestrator Mode

Composer orchestrator mode is an explicit opt-in economy mode for a Cursor-native Composer parent. Cursor carries this required policy because `(O) Composer` is Cursor-native. It is inactive by default and does not change Cursor's default Fable-first parent policy or the Codex 5.6 Sol, then Cursor-Fable-High parent availability chain.

Fixed opt-in economy tree: (O) Composer -> opus-explore -> composer-implement -> opus-check.

While economy mode is active, explicitly exclude Fable, Codex 5.6 Sol, and default Codex workers (`codex-explore`, `codex-implement`, and `codex-check`) from route selection.

Escalation behavior: remain on the economy stack unless a worker fails. No silent upgrade to Fable, Sol, or default Codex workers is allowed. If an economy worker fails, stop for an explicit parent decision before leaving the economy stack.


## Delegation Contract

Before delegating, state:

1. exact outcome;
2. files or subsystem in scope;
3. behavior that must not change;
4. required tests or verification;
5. prohibited actions: no commits, pushes, merges, deployments, secret edits, or unrelated refactors;
6. short safe label.

Treat worker output as evidence, not ground truth. Inspect diffs and verification before accepting implementation work.
