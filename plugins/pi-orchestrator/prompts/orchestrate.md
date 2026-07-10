Use ARC orchestration with Codex 5.5 as the default parent orchestrator.

Task to prepare for delegation:

{{task}}

Before delegating, produce a bounded contract with:

1. exact outcome;
2. files or subsystems in scope;
3. behavior that must remain unchanged;
4. required tests or verification;
5. prohibited actions, especially no commits, pushes, merges, deployments, secret edits, or unrelated refactors;
6. the best route: codex/analyze, codex/implement, codex/review, or composer/implement. `gpt-5.6-terra` and `gpt-5.6-luna` are Codex worker choices; `gpt-5.6-sol` is Cursor-only and write-capable for taste-sensitive implementation. Explicit model overrides always win;
7. a short safe label for traces.

If the task is ambiguous, ask clarifying questions instead of delegating.
