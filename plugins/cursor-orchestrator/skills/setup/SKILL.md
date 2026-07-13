---
name: setup
description: Diagnose whether the local Codex and Cursor Agent backends are installed, authenticated, and safe to use without sudo before delegating orchestrator worker runs from Cursor.
---

# Cursor Orchestrator Setup

Run this before the first delegated worker task in a new environment:

```sh
fable-orchestrator doctor --json
```

Present the result in the parent Cursor chat without attempting privileged repairs.

## What the doctor checks

- **Codex CLI**: installed on `PATH` and authenticated (`codex login status` under the hood). When authenticated, reports `gpt-5.5`, `gpt-5.6-terra`, `gpt-5.6-luna`, and `gpt-5.6-sol` as available in the `codex.models` block.
- **Cursor Agent** (`cursor-agent`): installed on `PATH` and authenticated (`cursor-agent status`, or `CURSOR_API_KEY` when set). When authenticated and state is user-owned, reports only `composer-2.5` in the `composer.models` block.
- **Composer readiness**: whether Cursor Agent state is owned by the current user (not root from an earlier `sudo` run).
- **Claude backend**: whether the Claude Code CLI is installed and authenticated for `--backend claude` fallback runs.

Report Codex, Composer, and Claude readiness independently; one backend may remain usable while another needs attention. When a backend is unauthenticated, do not claim its models are available — surface the remediation from `next_actions` instead. When Codex is unhealthy but Claude is ready, present degraded-mode guidance from `next_actions`.

`gpt-5.5` is the Codex implement/review default; `gpt-5.6-terra` and `gpt-5.6-luna` are additional Codex worker choices. `gpt-5.6-sol` is the Codex implement/review default for taste-sensitive task classes; Composer defaults to `composer-2.5`, with `FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` as an explicit override escape hatch, not the default. The doctor reports availability; explicit model overrides still determine the selected worker model.

## Safety rules

- Never run Codex or Cursor Agent with `sudo`.
- If Cursor reports keychain errors, recommend `cursor-agent login` as the normal user or the documented `CURSOR_API_KEY` environment variable.
- If `foreign_owned_state` is true, explain that an earlier sudo run left root-owned files and show the exact repair action from `next_actions`.
- Do not ask for, accept, print, or store passwords or API keys.

## Manual verification (when doctor is inconclusive)

```sh
codex login status
cursor-agent status
```

Both commands must succeed as the normal user, without `sudo`.
