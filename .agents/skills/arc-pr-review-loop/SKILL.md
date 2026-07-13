---
name: arc-pr-review-loop
description: Review a PR against its plan, delegate all PR/git mutations to bounded mechanical workers, and repeat until approved or a round limit is hit. Invoke with a PR number/URL, e.g. `/arc-pr-review-loop 27`.
---

# PR Review Loop

Converge a PR to plan-alignment. Every round must approve or produce actionable findings that shrink the gap; never rubber-stamp and never post vague feedback.

The parent owns scope, judgment, and approval. Read-only review stays on `opus-review` for taste-sensitive surfaces or `codex-check` for correctness, security, regressions, and acceptance criteria. The parent never runs mutating `git` or `gh` commands: posting, commit/push, and merge are delegated to the bounded mechanical routes.

## Input

- PR number or URL (required). If absent, ask and stop.
- `--plan <file|issue>` — plan source override.
- `--max-rounds <N>` — review rounds before escalating (default 3).
- `--merge-on-approve` — delegate a squash merge to `mechanical-merge`; without it, report approval and leave the PR open.

## Steps

1. **Resolve the PR and plan through the read-only review worker.**
   - Delegate collection of PR metadata, diff, referenced issue, plan, and acceptance criteria to `opus-review` or `codex-check`; the parent does not perform GitHub mechanics itself.
   - Identify the PR branch's existing worktree for any later implementation fix, without changing branch history.

   Completion criterion: the parent receives the diff, a plan with acceptance criteria (or an explicit note that none exists), and the scoped checkout identity.

2. **Review round: diff vs plan.**
   - Delegate read-only judgment to `opus-review` for taste-sensitive work or `codex-check` for correctness/security/acceptance validation.
   - Judge only plan requirements plus correctness and safety; do not expand scope.
   - Classify each finding as **blocking** or **nit**. Approve only when no blocking findings remain.

   Completion criterion: a verdict and findings where every blocker names the file, problem, and done condition.

3. **Post the approved round through `mechanical-post-comment`.**
   - The parent approves the exact review body before delegation.
   - On approval, delegate the approval/result comment and continue to step 6.
   - On revision, delegate the round summary and independently actionable blocking comments.
   - Capture the mechanical trace; the parent never invokes `gh pr review`, `gh pr comment`, or another GitHub mutation directly.

   Completion criterion: every blocker is posted and independently actionable, with a successful `mechanical-post-comment` trace.

4. **Address comments, then delegate commit/push.**
   - Delegate only named fixes to an implementation worker in the PR worktree.
   - Inspect the resulting diff and verification; require only approved files to be staged.
   - Delegate the staged conventional fix commit followed by a normal push to `mechanical-commit-push`.
   - Never amend, rebase, reset, force-push, force-with-lease, or rewrite history.

   Completion criterion: every blocking comment has a verified fix or explanation and a successful `mechanical-commit-push` trace.

5. **Loop.**
   - Return to step 2. After `--max-rounds` (default 3) without approval, stop and escalate; never silently extend the loop or accept unresolved blockers.

6. **Hand off or merge.**
   - Without `--merge-on-approve`, report verdict, rounds, resolved findings, and PR URL; leave the PR open.
   - With explicit `--merge-on-approve`, delegate the approved squash merge to `mechanical-merge`, capture its trace, and confirm the result.
   - The parent never runs `gh pr merge` or a direct merge fallback.

## Traced end-to-end flow

```text
  parent: gh pr create (when no PR exists yet; not mechanical)
  -> opus-review | codex-check
  -> mechanical-post-comment
  -> implementation worker (blocking findings only; stages approved fixes)
  -> mechanical-commit-push
  -> opus-review | codex-check (repeat, maximum 3 rounds)
  -> mechanical-post-comment
  -> mechanical-merge only when --merge-on-approve was explicit
```

Retain each mechanical run id and verify its requested alias, task class, and model in the raw durable evidence:

```bash
fable-orchestrator runs --json --limit 20
```

Preserve the review verdict separately: `codex-check` supplies a runner trace, while direct `opus-review` supplies a review artifact and does not claim a runner trace. A missing or failed mechanical trace blocks the transition; it never authorizes the parent to perform the mutation directly.

## Boundaries

- This skill reviews an existing PR; it never implements the original issue from scratch.
- Open a PR with `gh pr create` before this loop when a PR does not yet exist; opening a PR is not a mechanical route.
- Review judgment remains on `opus-review` or `codex-check`; mechanical workers do not decide scope or approval.
- Use `arc-bug-finder` for defects outside PR scope; file them instead of fixing them here.
- Never force-push, rewrite history, deploy, edit secrets, or broaden the accepted plan.
