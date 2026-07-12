# Repo Scan Prompts (Cursor)

Use the active tier of the CC-Fable → Codex 5.6 Sol → Cursor-Fable-High parent availability chain at high reasoning. Planning, ambiguity resolution, route selection, final judgment, and user communication stay in the active parent chat. Follow the cross-harness parent availability chain: CC-Fable → Codex 5.6 Sol → Cursor-Fable-High. If CC-Fable is unavailable because of usage limit, authentication failure, or model unavailable, use Codex 5.6 Sol; if Codex 5.6 Sol is also unavailable, use Cursor-Fable-High. Run every parent in this availability chain at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control, and never use low or unspecified/default reasoning for a parent. Run these from the repository root.

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
