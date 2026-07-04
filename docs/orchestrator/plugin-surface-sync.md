# Plugin Surface Sync Orchestrator Prompt

Use this when changing orchestrator behavior that must stay aligned across Claude Code, Pi, GitHub Copilot, and future plugin surfaces.

```text
/fable-orchestrator:orchestrate review the orchestrator plugin surfaces for drift. Compare Claude skills, worker agents, Pi package skills/prompts, Copilot instructions/prompts, README guidance, tests, and the central prompt factory. Identify wording or behavior that should be centralized so future plugin variants update from one source. Read-only unless explicitly asked to implement. Label the run plugin-surface-sync.
```

## Contract

- Route: `codex/review` for drift detection; `codex/implement` only for a bounded centralization change.
- Outcome: list of drift points and central factory updates needed.
- Scope: `plugins/fable-orchestrator/`, `plugins/pi-orchestrator/`, `plugins/copilot-orchestrator/`, `plugins/orchestrator-core/`, tests, and README docs.
- Invariants: Pi and Copilot stay Codex 5.5-first; Fable is not their default parent orchestrator.
- Verification: run focused plugin tests and validation when changes are made.
- Prohibitions: no commits, pushes, merges, deployments, secret edits, or unrelated refactors.
- Safe label: `plugin-surface-sync`.
