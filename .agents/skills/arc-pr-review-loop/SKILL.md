---
name: arc-pr-review-loop
description: Review a PR against its plan, keep mutations on the authorized parent, and repeat until approved or a round limit is hit. Invoke with a PR number/URL, e.g. `/arc-pr-review-loop 27`.
---

# PR Review Loop

Converge a PR to plan-alignment. Every round must approve or produce actionable findings that shrink the gap; never rubber-stamp and never post vague feedback.

The parent owns scope, judgment, approval, and shipping. Read-only review stays on `opus-review` for taste-sensitive surfaces or automatic `--mode review` for correctness, security, regressions, and acceptance criteria. Ordinary workers never run mutating `git` or `gh` commands. When shipping is authorized, the parent posts comments, commits/pushes, and merges directly after reviewing evidence. There are no mechanical worker routes.

## Input

- PR number or URL (required). If absent, ask and stop.
- `--plan <file|issue>` — plan source override.
- `--max-rounds <N>` — review rounds before escalating (default 3).
- `--merge-on-approve` — perform an authorized squash merge; without it, report approval and leave the PR open.

## Steps

1. **Resolve the PR and plan through the read-only review worker.**
   - Delegate collection of PR metadata, diff, referenced issue, plan, and acceptance criteria to `opus-review` or automatic `--mode review`.
   - Identify the PR branch's existing worktree for any later implementation fix, without changing branch history.

   Completion criterion: the parent receives the diff, a plan with acceptance criteria (or an explicit note that none exists), and the scoped checkout identity.

2. **Review round: diff vs plan.**
   - Delegate read-only judgment to `opus-review` for taste-sensitive work or automatic `--mode review` for correctness/security/acceptance validation.
   - Judge only plan requirements plus correctness and safety; do not expand scope.
   - Classify each finding as **blocking** or **nit**. Approve only when no blocking findings remain.

   Completion criterion: a verdict and findings where every blocker names the file, problem, and done condition.

3. **Post the approved round directly.**
   - The parent approves the exact review body, then posts it with `gh` when shipping is authorized.
   - On approval, post the approval/result comment and continue to step 6.
   - On revision, post the round summary and independently actionable blocking comments.

   Completion criterion: every blocker is posted and independently actionable.

4. **Address comments, then commit/push directly.**
   - Delegate only named fixes to an implementation worker in the PR worktree.
   - Inspect the resulting diff and verification; require only approved files to be staged.
   - When authorized, the parent commits the staged conventional fix and performs a normal push.
   - Never amend, rebase, reset, force-push, force-with-lease, or rewrite history.

   Completion criterion: every blocking comment has a verified fix or explanation and a successful parent commit/push.

5. **Loop.**
   - Return to step 2. After `--max-rounds` (default 3) without approval, stop and escalate; never silently extend the loop or accept unresolved blockers.

6. **Hand off or merge.**
   - Without `--merge-on-approve`, report verdict, rounds, resolved findings, and PR URL; leave the PR open.
   - With explicit `--merge-on-approve`, the parent performs the approved squash merge and confirms the result.

## Traced end-to-end flow

```text
  parent: gh pr create (when no PR exists yet)
  -> opus-review | automatic --mode review
  -> parent: gh pr comment / gh pr review
  -> implementation worker (blocking findings only; stages approved fixes)
  -> parent: git commit + git push
  -> opus-review | automatic --mode review (repeat, maximum 3 rounds)
  -> parent: gh pr comment / gh pr review
  -> parent: gh pr merge only when --merge-on-approve was explicit
```

Retain review and implementation run evidence:

```bash
arc-orchestrator runs --json --limit 20
```

Preserve the review verdict separately: automatic `--mode review` supplies a runner trace, while direct `opus-review` supplies a review artifact and does not claim a runner trace.

## Boundaries

- Never force-push or rewrite published history.
- Never expand review findings into a new feature request mid-loop.
- Never implement the original issue from scratch inside the review loop.
- Deployment and secret edits remain prohibited.
