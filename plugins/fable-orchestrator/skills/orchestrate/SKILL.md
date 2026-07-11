---
name: orchestrate
description: Route bounded work from Claude Fable, the default/recommended parent orchestrator, to Cursor Composer 2.5 or Codex worker agents. Use proactively when a self-contained implementation, verbose codebase exploration, or independent check would preserve Fable context. If the user explicitly wants Opus or another current Claude Code model to orchestrate without Fable, use orchestrate-with-model instead.
argument-hint: "<task to route>"
allowed-tools: Agent
---

# Fable Orchestrator

Use this skill to preserve Fable's context and usage budget by delegating bounded work to thin Cursor Composer 2.5 or Codex worker agents. Fable remains the default/recommended parent orchestrator; use `orchestrate-with-model` when the user explicitly wants Opus or another current Claude Code model to orchestrate without Fable.

## Operating Model

1. Keep planning, task decomposition, ambiguity resolution, and final decisions in the main Fable conversation.
2. Delegate only a self-contained task with explicit boundaries and a verifiable completion condition.
3. Choose exactly one worker:
   - `fable-orchestrator:composer-implement`: default bulk implementation worker; Cursor Composer 2.5; write-capable.
   - `fable-orchestrator:codex-implement`: harder implementation or escalation after Composer misses the bar; GPT-5.6 Terra by default, GPT-5.6 Sol for taste-sensitive task classes; workspace-write.
   - `fable-orchestrator:codex-explore`: repository exploration or codebase analysis; read-only; GPT-5.6 Luna by default.
   - `fable-orchestrator:codex-check`: independent review of existing changes; read-only; GPT-5.6 Terra by default, GPT-5.6 Sol for taste-sensitive task classes.
   - `fable-orchestrator:opus-review`: high-taste read-only review for UI/UX, API design, architecture, copy, docs, prompts, and skill wording; Opus 4.8.
   - `fable-orchestrator:opus-explore`: availability fallback for read-only exploration when Codex is unavailable or the parent explicitly routes to Opus 4.8; not the default route.
   - `fable-orchestrator:opus-check`: availability fallback for read-only review when Codex is unavailable or the parent explicitly routes to Opus 4.8; not the default route.
   - `fable-orchestrator:opus-implement`: availability fallback for implementation when Codex is unavailable or the parent explicitly routes to Opus 4.8; not the default route.
4. Invoke the selected worker through the `Agent` tool with the complete task contract.
5. Treat the returned JSON as worker evidence, not ground truth.
6. Inspect relevant diffs and verification evidence before accepting implementation work.
7. Report the final conclusion yourself. Do not forward raw worker output when a shorter synthesis is sufficient.
8. After judging a worker run, record the outcome so routing stays measurable: `fable-orchestrator annotate --run latest --outcome <accepted|rejected|blocked|verification-failed|escalated>` (add `--escalated-to <model>` when escalating). Skip this only when tracing is disabled.
9. When a worker reports `backend_unavailable` with a fallback hint on stderr, you may re-delegate to the matching `opus-*` worker. Record `annotate --outcome escalated --escalated-to <model>` on the failed run, or annotate the fallback run's outcome, so routing stays measurable.

## Parallel Delegation

Sequential delegation is the default. When tasks are genuinely independent, read-only workers (`codex-explore`, `codex-check`, `opus-explore`, `opus-check`, `opus-review`) may run concurrently. Never run two write-capable workers against the same checkout: the runner serializes write-capable runs per project and fails the second one; for concurrent implementation, give each worker its own worktree.

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
