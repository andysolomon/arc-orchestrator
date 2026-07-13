# Plugin Surface Sync Prompts (Cursor)

Use the active tier of the CC-Fable → Codex 5.6 Sol → Cursor-Fable-High parent availability chain at high reasoning. Planning, ambiguity resolution, route selection, final judgment, and user communication stay in the active parent chat. Follow the cross-harness parent availability chain: CC-Fable → Codex 5.6 Sol → Cursor-Fable-High. If CC-Fable is unavailable because of usage limit, authentication failure, or model unavailable, use Codex 5.6 Sol; if Codex 5.6 Sol is also unavailable, use Cursor-Fable-High. Run every parent in this availability chain at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control, and never use low or unspecified/default reasoning for a parent.

Keep Claude Code, Cursor, Pi, and Copilot orchestrator surfaces aligned. The source of truth is `plugins/orchestrator-core/feature-matrix.ts`, rendered in `docs/orchestrator/feature-parity-matrix.md` and enforced by `test/feature-parity.test.ts`.

```text
/orchestrate review the orchestrator plugin surfaces for drift. Compare plugins/fable-orchestrator, plugins/cursor-orchestrator, plugins/pi-orchestrator, and plugins/copilot-orchestrator against plugins/orchestrator-core/feature-matrix.ts. Report features present in one surface but missing or stale in another, and whether each gap needs a matrix entry, an intentional-difference rationale, or new artifacts. Read-only. Do not edit files. Label the run surface-sync.
```

After adding a feature to any surface, update the matrix first, mirror `docs/orchestrator/feature-parity-matrix.md`, then verify:

```sh
env -u FABLE_ORCHESTRATOR_LOCK_WAIT_MS bun test
```
