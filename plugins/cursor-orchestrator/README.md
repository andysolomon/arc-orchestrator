# Cursor Orchestrator Plugin

This is a real Cursor plugin package. Use it when working in Cursor with Fable available as the parent model. Fable should do orchestration by default: planning, task decomposition, ambiguity resolution, worker selection, final review, and user communication stay in the parent Cursor chat.

Workers remain bounded:

- `composer/implement`: Cursor Composer 2.5 for clear, mechanical, high-volume implementation.
- `codex/analyze`: read-only repository exploration.
- `codex/implement`: harder implementation or escalation when Composer misses the bar.
- `codex/review`: correctness, regression, security, and acceptance-criteria review.
- `opus/review`: high-taste read-only critique for UI/UX, API ergonomics, docs, copy, prompts, and long-lived abstractions.

## Install Locally

Symlink or copy this plugin into Cursor's local plugin directory:

```sh
mkdir -p ~/.cursor/plugins/local
ln -s /Users/andrewsolomon/orchestrator/plugins/cursor-orchestrator ~/.cursor/plugins/local/cursor-orchestrator
```

Then restart Cursor or run **Developer: Reload Window**.

You can also copy only the rule into a project if you do not want to install the full plugin:

```sh
mkdir -p .cursor/rules
cp /Users/andrewsolomon/orchestrator/plugins/cursor-orchestrator/rules/orchestrator.mdc .cursor/rules/orchestrator.mdc
```

Use `/orchestrate` or `/opus-review` from Cursor chat when the plugin is installed, or use the prompt examples in `prompts/` manually.

## Defaults

- Parent orchestrator: Fable in Cursor.
- Bulk mechanical implementation worker: Composer 2.5.
- Hard implementation/review worker: Codex 5.5.
- High-taste review worker: Opus 4.8.
- Repo exploration worker: faster read-only Codex profile.
