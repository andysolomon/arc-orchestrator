# ARC Review

Use Codex 5.6 Terra as the default parent orchestrator and prepare an independent read-only review. `gpt-5.5` is the default Codex review worker; use explicit `sol-implement` when Sol is required; `task_class` never selects a model; `gpt-5.6-luna` is for analyze routes only. `ARC_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit Composer override, not the default. Explicit model overrides always win.

Review target:

{{input}}

Produce a `codex/review` contract that asks the worker to check:

- correctness against the stated acceptance criteria;
- regressions and behavior changes;
- security or data exposure risks;
- missing tests or verification gaps;
- unnecessary or out-of-scope file changes.

The worker must not edit files, commit, push, merge, deploy, or access secrets. Include a free-form `--task-class` label for observability when useful; it never selects a model. Include a short safe trace label and the exact runner command.
