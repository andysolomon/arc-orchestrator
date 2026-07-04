# Repo Scan Orchestrator Prompt

Use this prompt first in a new repository to discover how to delegate work safely.

## Claude Code

```text
/fable-orchestrator:orchestrate scan this repository and produce a concise delegation map. Identify project type, major subsystems, test/build commands, docs/spec sources, skill/plugin surfaces, risky files, and the best orchestrator routes for common work. Read-only. Do not edit files. Label the run repo-scan.
```

## Claude Code Usage

Paste the command above into Claude Code TUI from the repository root.

## Contract

- Route: `codex/analyze`.
- Outcome: repository delegation map with routes and verification commands.
- Scope: current repository only.
- Invariants: do not modify files; do not expose secrets; do not include absolute paths in shared output.
- Verification: cite discovered package scripts, CI config, docs, and plugin/skill directories.
- Prohibitions: no commits, pushes, merges, deployments, secret edits, or unrelated refactors.
- Safe label: `repo-scan`.
