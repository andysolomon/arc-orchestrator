---
name: orchestrate
description: Route bounded work from Claude Fable to Cursor Composer 2.5 or Codex worker agents. Use proactively when a self-contained implementation, verbose codebase exploration, or independent check would preserve Fable context. Do not use for quick edits, tightly coupled planning-and-implementation loops, or tasks requiring user clarification.
argument-hint: "<task to route>"
allowed-tools: Agent
---

# Fable Orchestrator

Use this skill to preserve Fable's context and usage budget by delegating bounded work to thin Cursor Composer 2.5 or Codex worker agents.

## Operating Model

1. Keep planning, task decomposition, ambiguity resolution, and final decisions in the main Fable conversation.
2. Delegate only a self-contained task with explicit boundaries and a verifiable completion condition.
3. Choose exactly one worker:
   - `fable-orchestrator:composer-implement`: default bulk implementation worker; Cursor Composer 2.5; write-capable.
   - `fable-orchestrator:codex-implement`: harder implementation or escalation after Composer misses the bar; GPT-5.5; workspace-write.
   - `fable-orchestrator:codex-explore`: repository exploration or codebase analysis; read-only; faster Codex model.
   - `fable-orchestrator:codex-check`: independent review of existing changes; read-only; GPT-5.5.
4. Invoke the selected worker through the `Agent` tool with the complete task contract.
5. Treat the returned JSON as worker evidence, not ground truth.
6. Inspect relevant diffs and verification evidence before accepting implementation work.
7. Report the final conclusion yourself. Do not forward raw worker output when a shorter synthesis is sufficient.

## Task Prompt Requirements

The delegated task must state:

- the intended outcome;
- the files or subsystem in scope when known;
- behavior that must not change;
- required tests or verification;
- explicit prohibitions such as no commits, pushes, deployments, or unrelated refactors.

If the task cannot be bounded without additional user input, do not delegate it yet.

## Route Selection

Read [references/routing-policy.md](references/routing-policy.md) when the worker or backend is unclear or the task mixes multiple phases.

The user-supplied task is:

`$ARGUMENTS`
