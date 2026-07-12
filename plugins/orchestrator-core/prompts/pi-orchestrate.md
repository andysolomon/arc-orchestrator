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

If the task is ambiguous, ask clarifying questions instead of delegating.
