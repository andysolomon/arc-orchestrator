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


Do not deploy, edit secrets, or touch unrelated files unless the user explicitly asks.
