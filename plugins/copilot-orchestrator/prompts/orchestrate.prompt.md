# ARC Orchestrate

You are operating with Codex 5.5 as the default parent orchestrator.

User request:

{{input}}

Create a bounded delegation plan. Include:

- exact outcome;
- scoped files/subsystems;
- invariants and behavior that must not change;
- verification/tests;
- prohibited actions: no commits, pushes, merges, deployments, secret edits, or unrelated refactors;
- selected route: codex/analyze, codex/implement, codex/review, or composer/implement. `gpt-5.6-terra` and `gpt-5.6-luna` are Codex worker choices; `gpt-5.6-sol` is Cursor-only and write-capable for taste-sensitive implementation. Explicit model overrides always win.
- one safe trace label.

If any requirement is ambiguous, ask clarifying questions before delegating. If it is bounded, show the exact runner command to execute.
