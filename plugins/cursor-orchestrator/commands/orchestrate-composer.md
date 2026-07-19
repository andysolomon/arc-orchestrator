---
name: orchestrate-composer
description: Orchestrate the given task in explicit Composer-parent economy mode, routing analyze to opus-explore, implement to composer-implement, and review to opus-check.
---

Use a Cursor-native Composer parent to orchestrate the user-supplied task in the fixed opt-in economy mode. This command is an explicit alternative to `/orchestrate`; it does not change that command's Fable-first default.

1. Keep planning, ambiguity resolution, route selection, final judgment, and user communication in the active Composer parent chat.
2. Select Composer parent identity on every runner call with `--orchestrator composer`, or set `FABLE_ORCHESTRATOR_ORCHESTRATOR=composer` for the session. The CLI flag takes precedence over the environment.
3. Delegate only bounded contracts through the fixed economy routes: `analyze` → `opus-explore` (read-only), `implement` → `composer-implement` (workspace-write), and `review` → `opus-check` (read-only). Let the runner select the fixed backend, route, and model from the mode; do not supply conflicting `--backend` or `--route` values.
4. Exclude Fable, Codex 5.6 Sol, `codex-explore`, `codex-implement`, and `codex-check` while economy mode is active.
5. Inspect diffs and verification evidence before accepting worker output; treat it as evidence, not ground truth.

Remain on the economy stack unless a worker fails. Never silently upgrade to Fable, Sol, or default Codex workers. If an economy worker fails, stop for an explicit parent decision before leaving the economy stack.

Every delegated contract must include outcome, scope, invariants, verification, prohibitions, and a safe label.

## Shipping authority

Workers are prohibited from commits, pushes, merges, GitHub mutations, and deployment. There are no mechanical worker routes or aliases. When the user authorizes shipping, the parent orchestrator performs the authorized `git` or `gh` operation directly after reviewing worker evidence.

Do not deploy, edit secrets, or touch unrelated files unless the user explicitly asks.
