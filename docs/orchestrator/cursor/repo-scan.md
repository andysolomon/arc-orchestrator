# Repo Scan Prompts (Cursor)

Paste into Cursor chat with Fable as the parent model, from the repository root.

```text
/orchestrate scan this repository and produce a concise delegation map. Identify project type, major subsystems, test/build commands, docs/spec sources, risky files, and the best orchestrator routes for common work. Read-only. Do not edit files. Do not expose secrets or absolute paths. Label the run repo-scan.
```

```text
/orchestrate inspect this repository and list the best first five orchestrator prompts a new contributor should use here. Read-only. Do not edit files. Label the run repo-prompt-map.
```

Direct runner equivalent (read-only Codex exploration):

```sh
fable-orchestrator run --backend codex --mode analyze --task "Map repository structure, subsystems, test commands, and risky files. Read-only. Do not expose secrets or absolute paths." --cwd "$PWD" --label "repo-scan"
```
