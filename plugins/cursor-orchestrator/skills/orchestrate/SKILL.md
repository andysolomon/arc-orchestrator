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

Cursor's three-tier parent availability chain does not change the backend-specific worker choices above.

## Composer Orchestrator Mode

Composer orchestrator mode is an explicit opt-in economy mode for a Cursor-native Composer parent. Cursor carries this required policy because `(O) Composer` is Cursor-native. It is inactive by default and does not change the CC-Fable → Codex 5.6 Sol → Cursor-Fable-High parent availability chain.

Use `/orchestrate-composer <task>` for this economy mode. The normal `/orchestrate <task>` command remains Fable-first.

Fixed opt-in economy tree: (O) Composer -> opus-explore -> composer-implement -> opus-check.

Select the Composer parent identity on every runner call with `--orchestrator composer`, or set `FABLE_ORCHESTRATOR_ORCHESTRATOR=composer` for the session. The CLI flag takes precedence over the environment. With that identity selected, the runner maps `analyze` to `opus-explore`, `implement` to `composer-implement`, and `review` to `opus-check`.

While economy mode is active, explicitly exclude Fable, Codex 5.6 Sol, and default Codex workers (`codex-explore`, `codex-implement`, and `codex-check`) from route selection.

Escalation behavior: remain on the economy stack unless a worker fails. No silent upgrade to Fable, Sol, or default Codex workers is allowed. If an economy worker fails, stop for an explicit parent decision before leaving the economy stack.


## Mechanical ops (dumb models)

The four named mechanical-ops routes are active. Each route is brokered through a non-writing Composer 2.5 operation-plan proposal, followed by runner-side canonical argv validation and shell-free execution of trusted `git` or `gh` binaries. Open-pr, post-comment, and merge plans contain exactly one command. Commit-push plans contain exactly two commands in order: an already-staged `git commit`, then `git push`; if commit fails, push is not invoked.

The runner resolves `git` and `gh` from explicit trusted binary configuration (`FABLE_ORCHESTRATOR_TRUSTED_GIT_BIN` / `FABLE_ORCHESTRATOR_TRUSTED_GH_BIN`) or documented system trusted-bin locations, never from workspace, current checkout, broker temp directories, or PATH-precedence wrappers. Mechanical `gh` operations use the current repository only: `--repo` and arbitrary `--body-file` inputs are rejected. `git commit --no-verify` and unlisted bypass flags are rejected.

| Task class | Bounded operation |
| --- | --- |
| `open-pr` | Open a pull request with `gh pr create`. |
| `post-github-comment` | Post an issue or pull-request comment with `gh issue comment` or `gh pr comment`. |
| `commit-push` | Commit and push an already-approved diff with `git commit` and `git push`. |
| `merge` | Merge an approved pull request with `gh pr merge`. |

**Fixed broker:** Composer 2.5 is the only proposal model for all four task classes. Mechanical routes have no automatic fallback or model override. If Composer 2.5 is unavailable or its proposal fails validation, the operation stops without executing a command.

**Required parent delegation:** Fable, Sol, Terra, and Composer parents must delegate every corresponding operation to its named mechanical-ops route. Parents must never directly run `git commit`, `git push`, `gh pr create`, `gh pr merge`, `gh issue comment`, or `gh pr comment`.

**Worker invariant:** Workers remain prohibited from committing, pushing, merging, making GitHub mutations, or deploying. The exact operations authorized by these four active mechanical-ops routes are the only bounded exception to that general prohibition. Deployment remains prohibited for every route.


## Delegation Contract

Before delegating, state:

1. exact outcome;
2. files or subsystem in scope;
3. behavior that must not change;
4. required tests or verification;
5. prohibited actions: no commits, pushes, merges, deployments, secret edits, or unrelated refactors;
6. short safe label.

Treat worker output as evidence, not ground truth. Inspect diffs and verification before accepting implementation work.
