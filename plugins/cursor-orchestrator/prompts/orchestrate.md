# Cursor Orchestrator Prompt

Paste this into Cursor chat when the parent availability chain reaches Cursor, or use the same contract from an earlier parent tier. Follow the cross-harness parent availability chain: CC-Fable → Codex 5.6 Sol → Cursor-Fable-High. If CC-Fable is unavailable because of usage limit, authentication failure, or model unavailable, use Codex 5.6 Sol; if Codex 5.6 Sol is also unavailable, use Cursor-Fable-High. Run every parent in this availability chain at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control, and never use low or unspecified/default reasoning for a parent.

```text
Use the active parent tier to orchestrate <TASK>. Follow the cross-harness parent availability chain: CC-Fable → Codex 5.6 Sol → Cursor-Fable-High. If CC-Fable is unavailable because of usage limit, authentication failure, or model unavailable, use Codex 5.6 Sol; if Codex 5.6 Sol is also unavailable, use Cursor-Fable-High. Run every parent in this availability chain at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control, and never use low or unspecified/default reasoning for a parent. First decide whether this should stay in the parent chat or be delegated. If delegated, produce a bounded worker contract with outcome, scope, invariants, verification, prohibitions, and a safe label. Prefer Composer 2.5 for clear mechanical implementation, GPT-5.5 for hard Codex implement/review, GPT-5.6 Luna for repo exploration, GPT-5.6 Sol for bounded taste-sensitive Codex implementation/review against explicit criteria, and Opus 4.8 for open-ended high-taste critique or design direction before criteria are fixed. `FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit Composer override, not the default. Explicit model overrides always win. During ship flows, delegate Git and GitHub mutations through the required mechanical routes below. Do not deploy, edit secrets, or touch unrelated files unless I explicitly ask.
```

## Mechanical ops (dumb models)

The three named mechanical-ops routes are active. Each route is brokered through a non-writing Composer 2.5 operation-plan proposal, followed by runner-side canonical argv validation and shell-free execution of trusted `git` or `gh` binaries. Post-comment and merge plans contain exactly one command. Commit-push plans contain exactly two commands in order: an already-staged `git commit`, then `git push`; if commit fails, push is not invoked.

Opening a pull request is **not** a mechanical route. Authorized parents open PRs directly with `gh pr create`.

The runner resolves `git` and `gh` from explicit trusted binary configuration (`FABLE_ORCHESTRATOR_TRUSTED_GIT_BIN` / `FABLE_ORCHESTRATOR_TRUSTED_GH_BIN`) or documented system trusted-bin locations, never from workspace, current checkout, broker temp directories, or PATH-precedence wrappers. Mechanical `gh` operations use the current repository only: `--repo` and arbitrary `--body-file` inputs are rejected. `git commit --no-verify` and unlisted bypass flags are rejected.

| Task class | Required route alias | Bounded operation |
| --- | --- | --- |
| `post-github-comment` | `mechanical-post-comment` | Post an issue or pull-request comment with `gh issue comment` or `gh pr comment`. |
| `commit-push` | `mechanical-commit-push` | Commit and push an already-approved diff with `git commit` and `git push`. |
| `merge` | `mechanical-merge` | Merge an approved pull request with `gh pr merge`. |

**Fixed broker:** Composer 2.5 is the only proposal model for all three task classes: the fixed default dumb proposal model Composer 2.5 cannot be replaced for mechanical operations. Mechanical routes have no automatic fallback or model override. If Composer 2.5 is unavailable or its proposal fails validation, the operation stops without executing a command.

**Required parent delegation during ship flows:** Fable, Sol, Terra, Composer, Claude, Pi, Copilot, and Cursor parents must delegate every corresponding operation to its named mechanical-ops route: `mechanical-post-comment`, `mechanical-commit-push`, or `mechanical-merge`. These parents must never directly commit, push, comment on pull requests or issues, or merge. Parents must never directly run `git commit`, `git push`, `gh pr merge`, `gh issue comment`, or `gh pr comment`, even when the user has authorized the ship flow. Authorization selects the bounded mechanical route; it does not authorize direct parent mutation for those operations.

**Worker invariant:** Workers remain prohibited from committing, pushing, merging, making GitHub mutations, or deploying. The exact operations authorized by these three active mechanical-ops routes are the only bounded exception to that general prohibition. Deployment remains prohibited for every route.


## Direct runner examples

```sh
fable-orchestrator run --backend composer --mode implement --task "<bounded mechanical implementation contract>" --cwd "$PWD" --label "cursor-composer-<short-name>"
```

```sh
fable-orchestrator run --backend codex --mode review --task "<bounded correctness/security review contract>" --cwd "$PWD" --label "cursor-codex-review-<short-name>"
```
