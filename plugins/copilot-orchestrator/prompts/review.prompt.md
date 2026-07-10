# ARC Review

Use Codex 5.5 as the default parent orchestrator and prepare an independent read-only review. `gpt-5.6-terra` and `gpt-5.6-luna` are Codex worker choices. `gpt-5.6-sol` is Cursor-only and write-capable for taste-sensitive implementation, never this read-only route. Explicit model overrides always win.

Review target:

{{input}}

Produce a `codex/review` contract that asks the worker to check:

- correctness against the stated acceptance criteria;
- regressions and behavior changes;
- security or data exposure risks;
- missing tests or verification gaps;
- unnecessary or out-of-scope file changes.

The worker must not edit files, commit, push, merge, deploy, or access secrets. Include a short safe trace label and the exact runner command.
