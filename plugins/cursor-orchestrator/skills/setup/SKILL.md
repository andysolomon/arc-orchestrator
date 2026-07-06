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

- **Codex CLI**: installed on `PATH` and authenticated (`codex login status` under the hood).
- **Cursor Agent** (`cursor-agent`): installed on `PATH` and authenticated (`cursor-agent status`, or `CURSOR_API_KEY` when set).
- **Composer readiness**: whether Cursor Agent state is owned by the current user (not root from an earlier `sudo` run).
- **Claude backend**: whether the Claude Code CLI is installed and authenticated for `--backend claude` fallback runs.

Report Codex, Composer, and Claude readiness independently; one backend may remain usable while another needs attention. When Codex is unhealthy but Claude is ready, present degraded-mode guidance from `next_actions`.

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
