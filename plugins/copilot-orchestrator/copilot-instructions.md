# ARC Orchestrator Instructions for GitHub Copilot

Use these instructions as `.github/copilot-instructions.md` in repositories that should use ARC orchestration.

## Default Orchestrator

Codex 5.6 Terra is the default parent orchestrator. Do not treat Fable as the default or required orchestrator for this workflow.

## Runner

Invoke the arc-orchestrator wrapper. It resolves the runner automatically via an explicit `ARC_ORCHESTRATOR_BIN` override, `fable-orchestrator` on `PATH`, or the sibling `fable-orchestrator` package when co-installed:

```sh
bin/arc-orchestrator
```

`ARC_ORCHESTRATOR_BIN` is override-only: set it only when you need a non-default runner path. When set, it must point to an executable runner; the wrapper does not fall through to other candidates.

## Operating Model

- Keep planning, architecture, ambiguity resolution, user interaction, and final acceptance in the parent Copilot session.
- Delegate only bounded, self-contained work with explicit scope and verification requirements.
- Use the arc-orchestrator wrapper for worker execution when available.
- Treat worker output as evidence, not truth. Inspect important diffs and verification before accepting.
- Never instruct workers to commit, push, merge, deploy, edit secrets, or touch unrelated files.

## Routing

- `codex/analyze`: read-only exploration, repository mapping, evidence gathering; defaults to GPT-5.6 Luna.
- `codex/implement`: default difficult implementation route through GPT-5.5 with workspace-write access, or Sol for taste-sensitive task classes.
- `codex/review`: independent read-only review through GPT-5.5, or Sol for taste-sensitive task classes.
- `composer/implement`: optional clear, mechanical bulk implementation through Composer 2.5 when the contract is already approved.
- `claude/analyze`, `claude/review`, `claude/implement`: first-tier availability fallback through `--backend claude` (Opus 4.8) when Codex is unavailable or the parent explicitly routes there. Set `FABLE_ORCHESTRATOR_FALLBACK=claude` for opt-in automatic retry on availability-classified Codex failures.
- `grok/analyze`, `grok/review`, `grok/implement`: second-tier availability fallback through `--backend composer --route grok-*` (Grok 4.5) when Claude/Opus is also unavailable. Grok is availability recovery, not taste escalation and not a substitute for `opus-review`.

## GPT-5.6 Worker Routing

- `gpt-5.6-luna`: Codex analyze default for high-volume, low-stakes exploration and evidence gathering.
- `gpt-5.5`: Codex implement/review default for harder implementation, debugging, escalation, and routine checks at high reasoning effort unless `--effort` overrides.
- `gpt-5.6-sol`: Codex implement/review default for taste-sensitive task classes (`taste-sensitive`, `ui`, `copy`, `api-design`) unless the matching `FABLE_ORCHESTRATOR_IMPLEMENT_MODEL` or `FABLE_ORCHESTRATOR_REVIEW_MODEL` override is non-empty.
- Composer 2.5 remains the default Cursor implementation worker; `FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit override escape hatch, not the default.
- Explicit model overrides always win.

Copilot intentionally remains Codex 5.6 Terra-first for parent orchestration. It can
invoke the Cursor implementation backend for a bounded task, but that does not
make Sol a Copilot parent model.

## Composer Orchestrator Mode

Composer orchestrator mode is an explicit opt-in economy mode. Activate the runner policy on each call with `--orchestrator composer`, or set `FABLE_ORCHESTRATOR_ORCHESTRATOR=composer` for the session. The CLI flag takes precedence over the environment. On Copilot, this selects the economy worker routes but does not turn the current chat into a Composer parent. True Composer-parent orchestration requires Cursor: open an active Cursor Composer chat and select the same runner identity there.

Fixed opt-in economy tree: (O) Composer -> opus-explore -> composer-implement -> opus-check.

With that identity selected, the runner maps `analyze` to `opus-explore`, `implement` to `composer-implement`, and `review` to `opus-check`. Do not supply conflicting `--backend` or `--route` values. This opt-in does not change the surface's default parent, normal routing, or non-economy activation.

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


## Delegation Contract

Before invoking a worker, define:

1. exact outcome;
2. files or subsystem in scope;
3. behavior that must remain unchanged;
4. tests or verification to run;
5. prohibited actions and scope boundaries;
6. short safe label for trace records.

## Observability

Inspect local traces with:

```sh
bin/arc-orchestrator runs --limit 10
```

Local traces record backend, mode, resolved model, sandbox, duration, token usage, status, changed-file count, project hash, and optional label. They must not include prompts, secrets, file contents, or absolute paths.
