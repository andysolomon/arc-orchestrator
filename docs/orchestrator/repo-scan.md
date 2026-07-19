# Repo Scan Slash Commands

Copy one of these into Claude Code TUI from the repository root.

```text
/arc-orchestrator:setup
```

```text
/arc-orchestrator:orchestrate scan this repository and produce a concise delegation map. Identify project type, major subsystems, test/build commands, docs/spec sources, risky files, and the best orchestrator routes for common work. Read-only. Do not edit files. Do not expose secrets or absolute paths. Label the run repo-scan.
```

```text
/arc-orchestrator:orchestrate inspect this repository and list the best first five orchestrator prompts a new contributor should use here. Read-only. Do not edit files. Label the run repo-prompt-map.
```

```text
/arc-orchestrator:observability
```
