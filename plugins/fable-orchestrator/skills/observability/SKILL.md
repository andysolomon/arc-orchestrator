---
name: observability
description: Show Claude Code TUI observability for delegated orchestrator worker runs, including local trace status, Laminar export readiness, recent runs, per-model totals, and where to inspect the data. Use when the user asks what the orchestrator has been doing or why runs do or do not appear in Laminar.
disable-model-invocation: true
allowed-tools: Bash(fable-orchestrator observability *) Bash(fable-orchestrator runs *)
---

# Fable Orchestrator Observability

Run:

```sh
fable-orchestrator observability --limit 10
```

Present the result in the Claude Code TUI.

Explain these boundaries clearly:

- This reports delegated worker runs launched through `fable-orchestrator run`.
- It does not trace every parent Fable/Claude Code message, direct edit, or tool call.
- Local traces are written to `~/.fable-orchestrator/traces/runs.jsonl` unless relocated.
- Laminar export requires both `FABLE_ORCHESTRATOR_LAMINAR=1` and `LMNR_PROJECT_API_KEY`.
- Laminar records are evaluations, not traces, in the current integration.

If Laminar is not ready, tell the user to set:

```sh
export FABLE_ORCHESTRATOR_LAMINAR=1
export LMNR_PROJECT_NAME=arc-orchestrator
export LMNR_PROJECT_API_KEY=<project key>
```

Never ask the user to paste API keys into chat. Do not print secrets.
