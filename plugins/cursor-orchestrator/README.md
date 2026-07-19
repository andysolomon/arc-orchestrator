# Cursor Orchestrator Plugin

This is a real Cursor plugin package for continuing orchestration when the parent availability chain reaches Cursor. Follow the cross-harness parent availability chain: CC-Fable → Codex 5.6 Sol → Cursor-Fable-High. If CC-Fable is unavailable because of usage limit, authentication failure, or model unavailable, use Codex 5.6 Sol; if Codex 5.6 Sol is also unavailable, use Cursor-Fable-High. Run every parent in this availability chain at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control, and never use low or unspecified/default reasoning for a parent. Planning, task decomposition, ambiguity resolution, worker selection, final review, and user communication stay in the active parent chat.

Workers remain bounded:

- `composer/implement`: Cursor Composer 2.5 for clear, mechanical, high-volume implementation.
- `codex/analyze`: read-only repository exploration.
- `codex/implement`: harder implementation or escalation when Composer misses the bar; defaults to GPT-5.5.
- `codex/review`: correctness, regression, security, and acceptance-criteria review; defaults to GPT-5.5.
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

- Parent availability chain: CC-Fable → Codex 5.6 Sol → Cursor-Fable-High.
- Parent reasoning effort: high for every tier; use `--effort high` or the surface-equivalent reasoning-effort control.
- Bulk mechanical implementation worker: Composer 2.5.
- Explicit `sol-implement` for bounded taste-sensitive Codex implementation/review against explicit criteria; `task_class` never selects Sol.
- Open-ended high-taste critique or design direction before criteria are fixed: Opus 4.8.
- Repo exploration worker: GPT-5.6 Luna.

## GPT-5.6 worker routing

`gpt-5.6-luna` is the Codex analyze default. `gpt-5.5` is the Codex
implement/review default for harder work. `gpt-5.6-sol` is the Codex
explicit `sol-implement` route (not selected by task classes such as `ui`, `copy`,
or `api-design`). Composer 2.5 remains the default Cursor implementation
worker; `ARC_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit
override escape hatch, not the default. Explicit model overrides always win.
Cursor follows CC-Fable → Codex 5.6 Sol → Cursor-Fable-High at high reasoning for parent orchestration.
