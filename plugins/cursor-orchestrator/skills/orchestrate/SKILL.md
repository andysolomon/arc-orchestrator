---
name: orchestrate
description: Use Fable as the parent orchestrator in Cursor. Route bounded work to Composer 2.5, Codex, or Opus based on task type while keeping planning, judgment, and final synthesis in the parent Cursor chat.
---

# Cursor Orchestrator

Use this skill when the user asks Cursor Agent to orchestrate work.

## Parent Policy

- Use Fable as the default parent orchestrator when available in Cursor.
- Keep planning, ambiguity resolution, route selection, final judgment, and user communication in the parent Cursor chat.
- Delegate only bounded worker tasks.

## Route Selection

- Composer 2.5: clear, mechanical, high-volume implementation after the approach is approved.
- Codex analyze: read-only repo exploration, dependency tracing, evidence gathering, and log/test-failure analysis.
- Codex implement: hard implementation, debugging-heavy fixes, or escalation after Composer misses the bar.
- Codex review: read-only correctness, regression, security, and acceptance-criteria checks.
- Opus 4.8 review: high-taste UI/UX, API ergonomics, component architecture, docs/copy, prompt wording, and long-lived abstraction critique.
- Claude backend (`--backend claude`): availability fallback for analyze, review, or implement when Codex is unavailable or the parent explicitly routes to Opus 4.8. Set `FABLE_ORCHESTRATOR_FALLBACK=claude` for opt-in automatic retry on availability-classified Codex failures.

## Delegation Contract

Before delegating, state:

1. exact outcome;
2. files or subsystem in scope;
3. behavior that must not change;
4. required tests or verification;
5. prohibited actions: no commits, pushes, merges, deployments, secret edits, or unrelated refactors;
6. short safe label.

Treat worker output as evidence, not ground truth. Inspect diffs and verification before accepting implementation work.
