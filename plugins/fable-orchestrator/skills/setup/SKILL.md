---
name: setup
description: Diagnose whether the local Codex and Cursor Composer 2.5 backends are installed, authenticated, and safe to use without sudo
disable-model-invocation: true
allowed-tools: Bash(fable-orchestrator doctor *)
---

# Fable Orchestrator Setup

Run:

```sh
fable-orchestrator doctor --json
```

Present the result without attempting privileged repairs.

- Never run Codex or Cursor Agent with `sudo`.
- If Cursor reports keychain errors, recommend `cursor-agent login` as the user or the documented `CURSOR_API_KEY` environment variable.
- If `foreign_owned_state` is true, explain that an earlier sudo run left root-owned files and show the exact repair action from `next_actions`.
- Do not ask for, accept, print, or store passwords or API keys.
- Report Codex and Composer readiness independently; one backend may remain usable while the other needs attention.
- When a backend is authenticated, report its models from the `models` block (`gpt-5.5`, `gpt-5.6-luna`, `gpt-5.6-terra`, and `gpt-5.6-sol` on Codex; `composer-2.5` on Composer). When unauthenticated, do not claim those models are available.
- Report the Claude backend readiness block independently; when Codex is unhealthy but Claude is ready, present degraded-mode guidance from `next_actions`.
