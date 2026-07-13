---
description: Use ARC orchestration with Codex 5.6 Sol as the default parent orchestrator
argument-hint: "<task>"
---
Use ARC orchestration with Codex 5.6 Sol as the default parent orchestrator.

Task to prepare for delegation:

$ARGUMENTS

Before delegating, produce a bounded contract with:

1. exact outcome;
2. files or subsystems in scope;
3. behavior that must remain unchanged;
4. required tests or verification;
5. prohibited actions, especially no commits, pushes, merges, deployments, secret edits, or unrelated refactors;
6. the best route: codex/analyze (GPT-5.6 Luna), codex/implement (GPT-5.5 or Sol for taste-sensitive), codex/review (GPT-5.5 or Sol for taste-sensitive), or composer/implement (Composer 2.5). `FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit Composer override, not the default. Explicit model overrides always win;
7. a short safe label for traces.

## Composer Orchestrator Mode

Composer orchestrator mode is an explicit opt-in economy mode. Activate the runner policy on each call with `--orchestrator composer`, or set `FABLE_ORCHESTRATOR_ORCHESTRATOR=composer` for the session. The CLI flag takes precedence over the environment. On Pi, this selects the economy worker routes but does not turn the current chat into a Composer parent. True Composer-parent orchestration requires Cursor: open an active Cursor Composer chat and select the same runner identity there.

Fixed opt-in economy tree: (O) Composer -> opus-explore -> composer-implement -> opus-check.

With that identity selected, the runner maps `analyze` to `opus-explore`, `implement` to `composer-implement`, and `review` to `opus-check`. Do not supply conflicting `--backend` or `--route` values. This opt-in does not change the surface's default parent, normal routing, or non-economy activation.

If the task is ambiguous, ask clarifying questions instead of delegating.
