# Plugin Surface Sync Slash Commands

Use these only in repositories that contain orchestrator plugin code. Copy one command into Claude Code TUI.

```text
/fable-orchestrator:orchestrate review the orchestrator plugin surfaces for drift. Compare Claude Code skills, worker agents, README guidance, tests, and shared prompt factory wording. Identify wording or behavior that should be centralized instead of duplicated. Read-only. Do not edit files. Label the run plugin-surface-sync.
```

```text
/fable-orchestrator:orchestrate review the Claude Code orchestrator plugin for slash-command discoverability. Confirm setup, observability, prompt-factory, and orchestrate are documented and easy to use from the TUI. Read-only. Do not edit files. Label the run claude-plugin-discoverability.
```

```text
/fable-orchestrator:orchestrate implement a small plugin documentation cleanup for Claude Code usage. Limit changes to README.md, docs/orchestrator, and Claude plugin skill docs. Run validation. Do not commit or push. Label the run plugin-docs-cleanup.
```

## Routing Change Checklist

When a PR changes default models, worker routes, or harness parent defaults — touching `plugins/*/skills/orchestrate*`, `routing-policy.md`, `plugins/orchestrator-core/feature-matrix.ts`, or backend selection in `fable-orchestrator` — the PR must:

1. Update `docs/diagrams/harness-overview.mermaid.md` (and affected per-harness views) when delegation semantics change.
2. Name the updated diagram files in the PR description, or explain why no diagram change was needed.
