---
name: orchestrate-composer
description: Run the explicit Composer-parent economy orchestration pattern, routing exploration to Opus 4.8, implementation to Composer 2.5, and checking to Opus 4.8 without changing the normal Fable-first default.
argument-hint: "<task to route>"
allowed-tools: Bash(fable-orchestrator run *), Bash(./plugins/fable-orchestrator/bin/fable-orchestrator run *)
---

# Composer Orchestrator Mode

Use this skill only when the user explicitly selects Composer-parent economy mode. The normal `orchestrate` skill remains Fable-first; this opt-in contract does not change its parent availability chain, worker defaults, model overrides, or fallback policy.

On Claude Code, this skill activates the runner's economy worker routes but does not turn the current Claude chat into a Composer parent. True Composer-parent orchestration requires Cursor: open an active Cursor Composer chat and use `/orchestrate-composer <task>` there.

## Parent Identity

Select the Composer parent identity on every runner call with `--orchestrator composer`, or set `FABLE_ORCHESTRATOR_ORCHESTRATOR=composer` for the session. The CLI flag takes precedence over the environment. The runner never infers parent identity from the chat model.

Do not combine this identity with explicit `--backend` or `--route` values. The runner owns the fixed economy mapping and rejects conflicting selections.

## Fixed Economy Routes

Fixed opt-in economy tree: `(O) Composer -> opus-explore -> composer-implement -> opus-check`.

- Explore: `--mode analyze` routes to `opus-explore` (Claude Opus 4.8, read-only).
- Implement: `--mode implement` routes to `composer-implement` (Cursor Composer 2.5, workspace-write).
- Check: `--mode review` routes to `opus-check` (Claude Opus 4.8, read-only).

Keep planning, task decomposition, ambiguity resolution, route selection, final judgment, and user communication in the active parent chat. In true Composer-parent mode that chat is Cursor Composer; on Claude Code this skill selects only the runner's economy routes. Delegate only self-contained tasks with explicit boundaries and verifiable completion conditions.

## Operating Contract

1. Build a bounded worker contract containing the outcome, scope, invariants, verification, prohibitions, and a short safe label.
2. Choose exactly one mode from the fixed economy routes.
3. Run exactly one `fable-orchestrator run` command with Composer parent identity selected.
4. Treat returned JSON as evidence, not ground truth. Inspect relevant diffs and verification before accepting implementation work.
5. Exclude Fable, Codex 5.6 Sol, `codex-explore`, `codex-implement`, and `codex-check` while this mode is active.

Remain on the economy stack unless a worker fails. Never silently upgrade to Fable, Sol, or default Codex workers. If an economy worker fails, stop for an explicit parent decision before leaving the economy stack. Do not enable automatic fallback for an economy run.

## Mechanical Ship Operations

During every ship flow, delegate Git and GitHub mutations through `mechanical-open-pr`, `mechanical-post-comment`, `mechanical-commit-push`, or `mechanical-merge`. Fable, Sol, Terra, Composer, Claude, Pi, Copilot, and Cursor parents must never directly commit, push, create or comment on pull requests or issues, or merge—even when the user authorized the ship flow. Authorization selects the bounded mechanical route; it does not authorize direct parent mutation.

All four routes use fixed default dumb proposal model Composer 2.5, with no model override or automatic fallback. Mechanical routes are outside the analyze/implement/review economy mapping and preserve parent review judgment. Read the canonical operation contracts and sandbox limits in [the routing policy](../orchestrate/references/routing-policy.md#mechanical-ops-dumb-models).

## Command Templates

```sh
fable-orchestrator run --orchestrator composer --mode analyze --task "<bounded read-only exploration contract>" --cwd "$PWD" --label "composer-explore-<short-name>"
```

```sh
fable-orchestrator run --orchestrator composer --mode implement --task "<bounded implementation contract>" --cwd "$PWD" --label "composer-implement-<short-name>"
```

```sh
fable-orchestrator run --orchestrator composer --mode review --task "<bounded read-only check contract>" --cwd "$PWD" --label "composer-check-<short-name>"
```

Generic workers must not commit, push, merge, make GitHub mutations, deploy, edit secrets, or touch files outside the bounded task. Authorized ship mutations must use the four mechanical routes.

The user-supplied task is:

`$ARGUMENTS`
