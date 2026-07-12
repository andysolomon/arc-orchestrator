---
name: orchestrate-with-model
description: Run the orchestrator pattern from the current Claude Code parent model instead of requiring Fable. Default to Fable 5 as the recommended/best orchestrator, but allow Opus or another selected Claude model when the user explicitly asks to orchestrate without Fable.
argument-hint: "<fable|opus|current> <task to route>"
allowed-tools: Agent
---

# Orchestrate With Selected Parent Model

Use this skill when the user wants the orchestrator workflow but does not want to require Fable as the parent model. Fable 5 remains the default recommendation for orchestration because it has the best judgment/taste profile in this project, but Opus can also act as the parent orchestrator when the user selects or requests it.

## Parent Model Policy

1. If the user does not specify a parent model, recommend and use the normal Fable-first orchestration pattern.
2. If the user asks for Opus, current model, or "without Fable," proceed with the same orchestration pattern from the current Claude Code session instead of refusing.
3. Do not delegate parent-level planning, ambiguity resolution, user interaction, or final judgment to a worker.
4. If the user asks to switch to a model that is not active and the TUI must perform the switch, briefly tell them to switch models in Claude Code, then continue only when the selected parent model is available or the user accepts the current model.

## Operating Model

1. Keep planning, task decomposition, ambiguity resolution, and final decisions in the parent Claude Code conversation, whether that parent is Fable, Opus, or another explicitly selected model.
2. Delegate only a self-contained task with explicit boundaries and a verifiable completion condition.
3. Choose exactly one worker:
   - `fable-orchestrator:composer-implement`: default bulk implementation worker; Cursor Composer 2.5; write-capable.
   - `fable-orchestrator:codex-implement`: harder implementation or escalation after Composer misses the bar; GPT-5.5 by default, GPT-5.6 Sol for taste-sensitive task classes; workspace-write.
   - `fable-orchestrator:codex-explore`: repository exploration or codebase analysis; read-only; GPT-5.6 Luna by default.
   - `fable-orchestrator:codex-check`: independent review of existing changes; read-only; GPT-5.5 by default, GPT-5.6 Sol for taste-sensitive task classes.
   - `fable-orchestrator:opus-review`: high-taste read-only review for UI/UX, API design, architecture, copy, docs, prompts, and skill wording; Opus 4.8.
4. Invoke the selected worker through the `Agent` tool with the complete task contract.
5. Treat returned worker JSON as evidence, not ground truth.
6. Inspect relevant diffs and verification evidence before accepting implementation work.
7. Report the final conclusion yourself. Do not forward raw worker output when a shorter synthesis is sufficient.

## Task Prompt Requirements

The delegated task must state:

- the intended outcome;
- the files or subsystem in scope when known;
- behavior that must not change;
- required tests or verification;
- explicit prohibitions such as no commits, pushes, deployments, or unrelated refactors;
- a short safe label for observability.

If the task cannot be bounded without additional user input, do not delegate it yet.

## Route Selection

Read [../orchestrate/references/routing-policy.md](../orchestrate/references/routing-policy.md) when the worker or backend is unclear or the task mixes multiple phases.

The user-supplied model/task request is:

`$ARGUMENTS`
