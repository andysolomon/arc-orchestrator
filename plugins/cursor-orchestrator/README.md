# Cursor Orchestrator Surface

Use this surface when working in Cursor with Fable available as the parent model. Fable should do orchestration by default: planning, task decomposition, ambiguity resolution, worker selection, final review, and user communication stay in the parent Cursor chat.

Workers remain bounded:

- `composer/implement`: Cursor Composer 2.5 for clear, mechanical, high-volume implementation.
- `codex/analyze`: read-only repository exploration.
- `codex/implement`: harder implementation or escalation when Composer misses the bar.
- `codex/review`: correctness, regression, security, and acceptance-criteria review.
- `opus/review`: high-taste read-only critique for UI/UX, API ergonomics, docs, copy, prompts, and long-lived abstractions.

## Install

Copy the rules into a Cursor project:

```sh
mkdir -p .cursor/rules
cp plugins/cursor-orchestrator/rules/orchestrator.mdc .cursor/rules/orchestrator.mdc
```

Use the prompt examples in `prompts/` from Cursor chat when you want a structured orchestration contract.

## Defaults

- Parent orchestrator: Fable in Cursor.
- Bulk mechanical implementation worker: Composer 2.5.
- Hard implementation/review worker: Codex 5.5.
- High-taste review worker: Opus 4.8.
- Repo exploration worker: faster read-only Codex profile.
