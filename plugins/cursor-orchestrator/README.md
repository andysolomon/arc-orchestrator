# Cursor Orchestrator Plugin

This is a real Cursor plugin package. Use it when working in Cursor with Fable available as the parent model. Fable should do orchestration by default; if Fable is unavailable because Cursor limits are exhausted or the model is not available, Codex 5.5 is the default parent orchestrator fallback. Planning, task decomposition, ambiguity resolution, worker selection, final review, and user communication stay in the parent Cursor chat.

Workers remain bounded:

- `composer/implement`: Cursor Composer 2.5 for clear, mechanical, high-volume implementation.
- `codex/analyze`: read-only repository exploration.
- `codex/implement`: harder implementation or escalation when Composer misses the bar.
- `codex/review`: correctness, regression, security, and acceptance-criteria review.
- `opus/review`: high-taste read-only critique for UI/UX, API ergonomics, docs, copy, prompts, and long-lived abstractions.

## Install Locally

Copy this plugin into Cursor's local plugin directory (the reliable default):

```sh
mkdir -p ~/.cursor/plugins/local
cp -R /Users/andrewsolomon/orchestrator/plugins/cursor-orchestrator ~/.cursor/plugins/local/cursor-orchestrator
```

A symlink also works on some Cursor versions, but Cursor's plugin validation can reject symlinks whose targets live outside `~/.cursor/plugins/local`, so prefer copying unless you have verified symlinks load on your version:

```sh
ln -s /Users/andrewsolomon/orchestrator/plugins/cursor-orchestrator ~/.cursor/plugins/local/cursor-orchestrator
```

Then restart Cursor or run **Developer: Reload Window**.

You can also copy only the rule into a project if you do not want to install the full plugin:

```sh
mkdir -p .cursor/rules
cp /Users/andrewsolomon/orchestrator/plugins/cursor-orchestrator/rules/orchestrator.mdc .cursor/rules/orchestrator.mdc
```

Use `/orchestrate` or `/opus-review` from Cursor chat when the plugin is installed, or use the prompt examples in `prompts/` manually.

## Component Layout

Cursor discovers plugin components by convention from this directory:

| Path | Purpose |
| --- | --- |
| `.cursor-plugin/plugin.json` | Plugin manifest (name, version, author) |
| `rules/` | Project rules (e.g. `orchestrator.mdc`) |
| `skills/` | Agent skills (e.g. `orchestrate/SKILL.md`) |
| `commands/` | Slash commands discovered by Cursor (e.g. `/orchestrate`, `/opus-review`) |
| `prompts/` | Manual copy/paste prompt examples (not auto-discovered by Cursor) |

No extra registration is required beyond placing files in these standard directories.

## Distribution

**Local testing** — Use the install steps above: symlink or copy this directory into `~/.cursor/plugins/local`, then reload Cursor. This is the fastest loop for development and dogfooding.

**Team or marketplace distribution** — When the plugin is ready to share beyond your machine:

1. **GitHub repository import** — Publish or point teammates at the repository containing `plugins/cursor-orchestrator`. In Cursor, use marketplace or team plugin import from a GitHub URL so others install the same package without manual copying.
2. **Manual distribution** — Copy the entire `plugins/cursor-orchestrator` directory (including `.cursor-plugin/`, `rules/`, `skills/`, `commands/`, and `prompts/`) to each developer's `~/.cursor/plugins/local/` or your team's shared plugin path.

Graduate from local copy → versioned release or marketplace listing once manifest, layout, and README match what maintainers expect for distribution.

## Defaults

- Parent orchestrator: Fable in Cursor.
- Parent fallback: Codex 5.5 when Fable is unavailable because Cursor limits are exhausted or the model is not available.
- Bulk mechanical implementation worker: Composer 2.5.
- Hard implementation/review worker: Codex 5.5.
- High-taste review worker: Opus 4.8.
- Repo exploration worker: faster read-only Codex profile.

## GPT-5.6 worker routing

`gpt-5.6-terra` and `gpt-5.6-luna` are Codex worker choices: set the matching
Codex mode override when a bounded task needs either model. `gpt-5.6-sol` is
Cursor-only and write-capable for taste-sensitive implementation (`ui`, `copy`,
or `api-design`); it is never a Codex or read-only route. Explicit model
overrides always win, including `FABLE_ORCHESTRATOR_COMPOSER_MODEL` over the
taste-sensitive Sol default. Cursor remains Fable-first for parent orchestration.
