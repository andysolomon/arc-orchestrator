# ARC Review

Use Codex 5.5 as the default parent orchestrator and prepare an independent read-only review.

Review target:

{{input}}

Produce a `codex/review` contract that asks the worker to check:

- correctness against the stated acceptance criteria;
- regressions and behavior changes;
- security or data exposure risks;
- missing tests or verification gaps;
- unnecessary or out-of-scope file changes.

The worker must not edit files, commit, push, merge, deploy, or access secrets. Include a short safe trace label and the exact runner command.
