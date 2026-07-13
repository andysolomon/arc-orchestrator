---
name: arc-orchestrator
description: Codex-first ARC orchestration for Pi. Use when work should be planned in the parent Pi session and delegated as bounded analyze, implement, or review tasks through the orchestrator runner. Codex 5.6 Sol is the default parent orchestrator; Fable is not required.
---

# ARC Orchestrator for Pi

Use this skill to keep the parent Pi session focused on planning, ambiguity resolution, final judgment, and user communication while delegating bounded execution to the local orchestrator runner.

## Default Parent Model

Use **Codex 5.6 Sol** as the default parent orchestrator for this Pi workflow, and run that Codex-Sol parent session at high reasoning effort. Start Pi with `--effort high`, or use Pi's equivalent reasoning-effort control when the surface names it differently. Do not assume Fable is present or preferred. If the active Pi model is weaker than Codex 5.6 Sol or is not running at high reasoning effort, ask the user to switch models or effort before high-risk planning or final acceptance.

## Runner

Invoke the package-local wrapper from this Pi package. It resolves the runner automatically via `fable-orchestrator` on `PATH`, the sibling `fable-orchestrator` package when co-installed, or an explicit override:

```sh
bin/arc-orchestrator
```

`ARC_ORCHESTRATOR_BIN` is override-only: set it only when you need a non-default runner path. When set, it must point to an executable runner; the wrapper does not fall through to other candidates.

## Operating Model

1. Keep planning, architecture, ambiguity resolution, user questions, and final acceptance in the parent Pi session.
2. Delegate only when the task is self-contained and has explicit boundaries.
3. Pick one route:
   - `codex/analyze`: read-only repository exploration or evidence gathering; defaults to GPT-5.6 Luna.
   - `codex/implement`: difficult implementation through GPT-5.5 with workspace-write access, or Sol for taste-sensitive task classes.
   - `codex/review`: independent read-only correctness, regression, security, or acceptance check through GPT-5.5, or Sol for taste-sensitive task classes.
   - `composer/implement`: optional bulk mechanical implementation through Cursor Composer 2.5 only when the task is clear and low-risk.
   - `claude/analyze`, `claude/review`, `claude/implement`: first-tier availability fallback through `--backend claude` (Opus 4.8) when Codex is unavailable or the parent explicitly routes there.
   - `grok/analyze`, `grok/review`, `grok/implement`: second-tier availability fallback through `--backend composer --route grok-*` (Grok 4.5) when Claude/Opus is also unavailable.
4. Treat worker output as evidence, not ground truth.
5. Inspect important diffs and verification evidence before final acceptance.
6. Never ask workers to commit, push, merge, deploy, edit secrets, or touch unrelated files.

## GPT-5.6 Worker Routing

- `gpt-5.6-luna`: Codex analyze default for high-volume, low-stakes exploration and evidence gathering.
- `gpt-5.5`: Codex implement/review default for harder implementation, debugging, escalation, and routine checks at high reasoning effort unless `--effort` overrides.
- `gpt-5.6-sol`: Codex implement/review default for taste-sensitive task classes (`taste-sensitive`, `ui`, `copy`, `api-design`) unless the matching `FABLE_ORCHESTRATOR_IMPLEMENT_MODEL` or `FABLE_ORCHESTRATOR_REVIEW_MODEL` override is non-empty.
- Composer 2.5 remains the default Cursor implementation worker; `FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit override escape hatch, not the default.
- Explicit model overrides always win.

Pi intentionally remains Codex 5.6 Sol-first for parent orchestration. It can invoke
the Cursor implementation backend for a bounded task, but that worker route does
not change the parent model selection.

## Composer Orchestrator Mode

Composer orchestrator mode is an explicit opt-in economy mode. Activate the runner policy on each call with `--orchestrator composer`, or set `FABLE_ORCHESTRATOR_ORCHESTRATOR=composer` for the session. The CLI flag takes precedence over the environment. On Pi, this selects the economy worker routes but does not turn the current chat into a Composer parent. True Composer-parent orchestration requires Cursor: open an active Cursor Composer chat and select the same runner identity there.

Fixed opt-in economy tree: (O) Composer -> opus-explore -> composer-implement -> opus-check.

With that identity selected, the runner maps `analyze` to `opus-explore`, `implement` to `composer-implement`, and `review` to `opus-check`. Do not supply conflicting `--backend` or `--route` values. This opt-in does not change the surface's default parent, normal routing, or non-economy activation.

## Mechanical ops (dumb models)

The four named mechanical-ops routes are active. Each route is brokered through a non-writing Composer 2.5 operation-plan proposal, followed by runner-side canonical argv validation and shell-free execution of trusted `git` or `gh` binaries. Open-pr, post-comment, and merge plans contain exactly one command. Commit-push plans contain exactly two commands in order: an already-staged `git commit`, then `git push`; if commit fails, push is not invoked.

The runner resolves `git` and `gh` from explicit trusted binary configuration (`FABLE_ORCHESTRATOR_TRUSTED_GIT_BIN` / `FABLE_ORCHESTRATOR_TRUSTED_GH_BIN`) or documented system trusted-bin locations, never from workspace, current checkout, broker temp directories, or PATH-precedence wrappers. Mechanical `gh` operations use the current repository only: `--repo` and arbitrary `--body-file` inputs are rejected. `git commit --no-verify` and unlisted bypass flags are rejected.

| Task class | Required route alias | Bounded operation |
| --- | --- | --- |
| `open-pr` | `mechanical-open-pr` | Open a pull request with `gh pr create`. |
| `post-github-comment` | `mechanical-post-comment` | Post an issue or pull-request comment with `gh issue comment` or `gh pr comment`. |
| `commit-push` | `mechanical-commit-push` | Commit and push an already-approved diff with `git commit` and `git push`. |
| `merge` | `mechanical-merge` | Merge an approved pull request with `gh pr merge`. |

**Fixed broker:** Composer 2.5 is the only proposal model for all four task classes: the fixed default dumb proposal model Composer 2.5 cannot be replaced for mechanical operations. Mechanical routes have no automatic fallback or model override. If Composer 2.5 is unavailable or its proposal fails validation, the operation stops without executing a command.

**Required parent delegation during ship flows:** Fable, Sol, Terra, Composer, Claude, Pi, Copilot, and Cursor parents must delegate every corresponding operation to its named mechanical-ops route: `mechanical-open-pr`, `mechanical-post-comment`, `mechanical-commit-push`, or `mechanical-merge`. These parents must never directly commit, push, create or comment on pull requests or issues, or merge. Parents must never directly run `git commit`, `git push`, `gh pr create`, `gh pr merge`, `gh issue comment`, or `gh pr comment`, even when the user has authorized the ship flow. Authorization selects the bounded mechanical route; it does not authorize direct parent mutation.

**Worker invariant:** Workers remain prohibited from committing, pushing, merging, making GitHub mutations, or deploying. The exact operations authorized by these four active mechanical-ops routes are the only bounded exception to that general prohibition. Deployment remains prohibited for every route.


## Task Contract

Every delegated task must include:

- exact outcome;
- files/subsystems in scope;
- behavior that must remain unchanged;
- required verification or tests;
- prohibited actions and scope boundaries;
- a short non-sensitive `--label` for trace readability.

## Commands

Analyze:

```sh
bin/arc-orchestrator run \
  --backend codex \
  --mode analyze \
  --task "<bounded exploration contract>" \
  --cwd "$PWD" \
  --label "<safe label>"
```

Implement with Codex (GPT-5.5 by default, Sol for taste-sensitive):

```sh
bin/arc-orchestrator run \
  --backend codex \
  --mode implement \
  --task "<bounded implementation contract>" \
  --cwd "$PWD" \
  --label "<safe label>"
```

Review with Codex (GPT-5.5 by default, Sol for taste-sensitive):

```sh
bin/arc-orchestrator run \
  --backend codex \
  --mode review \
  --task "<bounded review contract>" \
  --cwd "$PWD" \
  --label "<safe label>"
```

Claude backend fallback (when Codex is unavailable or parent routes to Opus 4.8):

```sh
bin/arc-orchestrator run \
  --backend claude \
  --mode analyze \
  --task "<bounded exploration contract>" \
  --cwd "$PWD" \
  --label "<safe label>"
```

Set `FABLE_ORCHESTRATOR_FALLBACK=claude` for opt-in automatic retry on availability-classified Codex failures. When Claude/Opus is also unavailable, re-delegate to `grok-explore`, `grok-check`, or `grok-implement` (or the matching `--backend composer --route grok-*` command below).

Grok second-tier fallback (when Claude/Opus is unavailable):

```sh
bin/arc-orchestrator run \
  --backend composer \
  --mode analyze \
  --route grok-explore \
  --task "<bounded exploration contract>" \
  --cwd "$PWD" \
  --label "<safe label>"
```

For UI/UX, user-facing copy, API design, or other taste-sensitive implement/review tasks, add `--task-class taste-sensitive` (or `ui`, `copy`, `api-design`) so the runner selects GPT-5.6 Sol.

Inspect recent runs:

```sh
bin/arc-orchestrator runs --limit 10
```

## Verification

After implementation work, run focused tests yourself when practical, inspect the diff, and then decide whether to accept, request changes, or escalate to another Codex pass.
