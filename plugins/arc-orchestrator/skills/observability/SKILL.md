---
name: observability
description: Show Claude Code TUI observability for delegated orchestrator worker runs, including local trace status, Laminar export readiness, recent runs, per-model totals, parent outcomes, comparative reporting, and where to inspect the data. Use when the user asks what the orchestrator has been doing, how models compare, or why runs do or do not appear in Laminar.
disable-model-invocation: true
allowed-tools: Bash(arc-orchestrator observability *) Bash(arc-orchestrator runs *) Bash(arc-orchestrator report *)
---

# Fable Orchestrator Observability

Run:

```sh
arc-orchestrator observability --limit 10
```

Present the result in the Claude Code TUI. When the user wants to compare models, backends, or task classes, also run the comparative report:

```sh
arc-orchestrator report --group-by model
arc-orchestrator report --group-by task_class
```

Explain these boundaries clearly:

- This reports delegated worker runs launched through `arc-orchestrator run`.
- It does not trace every parent Fable/Claude Code message, direct edit, or tool call.
- Local traces are written to `~/.arc-orchestrator/traces/runs.jsonl` unless relocated.
- Laminar export requires both `ARC_ORCHESTRATOR_LAMINAR=1` and `LMNR_PROJECT_API_KEY`.
- Laminar records are evaluations, not traces, in the current integration.

If Laminar is not ready, tell the user to set:

```sh
export ARC_ORCHESTRATOR_LAMINAR=1
export LMNR_PROJECT_NAME=arc-orchestrator
export LMNR_PROJECT_API_KEY=<project key>
```

Never ask the user to paste API keys into chat. Do not print secrets.
