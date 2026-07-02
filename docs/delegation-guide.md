# Delegation Guide

## Decision Rule

Delegate when the task is self-contained, expensive in context, and easy to verify. Keep work in Fable when it is ambiguous, architectural, user-facing, or requires frequent decisions.

## Worker Selection

### `composer-implement`

Default for:

- approved feature slices;
- repetitive multi-file edits;
- migrations;
- mechanical refactors;
- straightforward test additions.

Do not use when root-cause reasoning is still unresolved.

### `codex-implement`

Use for:

- difficult debugging;
- non-obvious correctness work;
- implementation requiring stronger unsupervised reasoning;
- retrying work that Composer did not complete adequately.

### `codex-explore`

Use for:

- repository maps;
- dependency and call-site tracing;
- locating authorization or configuration enforcement;
- verbose log analysis;
- gathering file-level evidence before Fable chooses a solution.

### `codex-check`

Use for:

- independent correctness review;
- security and regression review;
- acceptance-criteria verification;
- checking whether tests cover the intended behavior.

## Required Task Contract

Every delegated task should include:

```text
Outcome:
  The exact behavior or artifact that must exist.

Scope:
  Files, directories, or subsystem in bounds.

Invariants:
  Existing behavior and interfaces that must remain unchanged.

Verification:
  Tests, build commands, or evidence required before completion.

Prohibited:
  No unrelated refactors, commits, pushes, merges, deployments, or secret access.
```

## Good Examples

### Exploration

```text
Map the authentication and authorization flow.

Scope: src/auth, middleware, API route guards, and related configuration.
Outcome: identify every enforcement point and any path that bypasses authorization.
Verification: cite concrete files and symbols.
Prohibited: do not modify files or propose a fix.
```

### Composer Implementation

```text
Implement the approved request-validation contract.

Scope: src/api/validation.ts and its existing tests.
Invariants: preserve response status codes and public error shapes.
Verification: run the focused validation tests.
Prohibited: no unrelated refactors, dependency changes, commits, or pushes.
```

### Codex Escalation

```text
Fix the confirmed race condition in session refresh.

Scope: session refresh coordination and its tests.
Invariants: do not change the public session API or token format.
Verification: add a regression test and run the focused suite.
Prohibited: no broad auth refactor, commits, pushes, or deployments.
```

### Independent Check

```text
Review the current implementation against the acceptance criteria.

Focus: correctness, concurrency, regressions, security, and missing tests.
Output: prioritized findings with file-level evidence.
Prohibited: do not edit files.
```

## Weak Prompts

Avoid:

- "Improve the app."
- "Fix authentication."
- "Make this production ready."
- "Review everything."
- "Use your best judgment."

These prompts transfer decisions that should remain with Fable and make scope control impossible.

## Escalation Policy

1. Use Composer for clear, routine implementation.
2. Fable checks the diff and verification.
3. If the result misses the bar, identify the concrete deficiency.
4. Retry with a narrower Composer prompt when the problem is task ambiguity.
5. Escalate to `codex-implement` when the problem requires stronger reasoning.
6. Use `codex-check` only when an independent pass is worth the additional usage.

Do not run multiple workers on the same write task concurrently in the same checkout.
