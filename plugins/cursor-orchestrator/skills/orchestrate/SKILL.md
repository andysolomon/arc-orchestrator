---
name: orchestrate
description: Follow the CC-Fable, Codex 5.6 Sol, then Cursor-Fable-High parent availability chain at high reasoning. Route bounded work to Composer 2.5, Codex, or Opus while keeping planning and judgment in the active parent chat.
---

# Cursor Orchestrator

Use this skill when the user asks Cursor Agent to orchestrate work.

## Parent Policy

- Use CC-Fable as the default parent orchestrator when available.
- Follow the cross-harness parent availability chain: CC-Fable → Codex 5.6 Sol → Cursor-Fable-High. If CC-Fable is unavailable because of usage limit, authentication failure, or model unavailable, use Codex 5.6 Sol; if Codex 5.6 Sol is also unavailable, use Cursor-Fable-High. Run every parent in this availability chain at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control, and never use low or unspecified/default reasoning for a parent.
- Keep planning, ambiguity resolution, route selection, final judgment, and user communication in the active parent chat, whether the parent is CC-Fable, Codex 5.6 Sol, or Cursor-Fable-High.
- Delegate only bounded worker tasks.

## Route Selection

- Composer 2.5: clear, mechanical, high-volume implementation after the approach is approved.
- Codex analyze: read-only repo exploration, dependency tracing, evidence gathering, and log/test-failure analysis; defaults to GPT-5.6 Luna.
- Parent availability chain: use CC-Fable first, Codex 5.6 Sol second, and Cursor-Fable-High third, all at high reasoning.
- Codex implement: hard implementation, debugging-heavy fixes, or escalation after Composer misses the bar; defaults to GPT-5.5.
- Codex review: read-only correctness, regression, security, and acceptance-criteria checks; defaults to GPT-5.5.
- Automatic delegation omits `--backend`/`--route` and selects by mode plus `workload_class`; `task_class` is metadata only. Use explicit `sol-implement` when Sol is required.
- Opus 4.8 review: open-ended high-taste critique or design direction before criteria are fixed; use Sol for bounded taste-sensitive Codex implementation/review against explicit criteria.
- Claude backend (`--backend claude`): first-tier availability fallback for analyze, review, or implement when Codex is unavailable or the parent explicitly routes to Opus 4.8. Set `FABLE_ORCHESTRATOR_FALLBACK=claude` for opt-in automatic retry on availability-classified Codex failures.
- Grok routes (`--backend composer --route grok-*`): second-tier availability fallback when Claude/Opus is also unavailable; use `grok-explore`, `grok-check`, or `grok-implement` via the composer backend with Grok 4.5. Grok is availability recovery, not taste escalation and not a substitute for `opus-review`.

## GPT-5.6 Worker Routing

- `gpt-5.6-luna`: Codex analyze default for high-volume, low-stakes exploration and evidence gathering.
- `gpt-5.5`: Codex implement/review default for harder implementation, debugging, escalation, and routine checks at high reasoning effort unless `--effort` overrides.
- `gpt-5.6-sol`: explicit `sol-explore`/`sol-check`/`sol-implement` Codex diagnostic routes for flagship Sol; `task_class` never selects this model.
- Composer 2.5 remains the default Cursor implementation worker; `FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit override escape hatch, not the default.
- Explicit model overrides always win.

Cursor's three-tier parent availability chain does not change the backend-specific worker choices above.

## Eco Orchestrator Mode

Eco orchestrator mode is an explicit opt-in economy mode for a Cursor-native Eco parent. Cursor carries this required policy because Eco-parent orchestration is Cursor-native. It is inactive by default and does not change the CC-Fable → Codex 5.6 Sol → Cursor-Fable-High parent availability chain.

True Eco-parent orchestration requires Cursor; run this mode from an active Cursor Composer chat.

Use `/orchestrate-eco <task>` for this economy mode. The normal `/orchestrate <task>` command remains Fable-first.

Fixed opt-in economy tree: (O) Eco -> opus-explore [| grok-explore] -> composer-implement -> opus-check [| grok-check].

Select the Eco parent identity on every runner call with `--orchestrator eco`, or set `FABLE_ORCHESTRATOR_ORCHESTRATOR=eco` for the session. The CLI flag takes precedence over the environment. With that identity selected, the runner maps `analyze` to `opus-explore`, `implement` to `composer-implement`, and `review` to `opus-check`. Analyze/review availability failures retry once on `grok-explore` / `grok-check` (Grok 4.5).

While economy mode is active, explicitly exclude Fable, Codex 5.6 Sol, and default Codex workers (`codex-explore`, `codex-implement`, and `codex-check`) from route selection.

Escalation behavior: remain on the eco stack (Opus primary, optional Grok availability backup for analyze/review, Composer implement). No silent upgrade to Fable, Sol, or default Codex workers is allowed. If both the primary and in-stack backup fail, or implement fails, stop for an explicit parent decision before leaving the eco stack.


## Shipping authority

Workers are prohibited from commits, pushes, merges, GitHub mutations, and deployment. There are no mechanical worker routes or aliases. When the user authorizes shipping, the parent orchestrator performs the authorized `git` or `gh` operation directly after reviewing worker evidence.

## Delegation Contract

Before delegating, state:

1. exact outcome;
2. files or subsystem in scope;
3. behavior that must not change;
4. required tests or verification;
5. prohibited actions: no commits, pushes, merges, deployments, secret edits, or unrelated refactors;
6. short safe label.

Treat worker output as evidence, not ground truth. Inspect diffs and verification before accepting implementation work.
