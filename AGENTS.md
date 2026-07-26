# AGENTS.md

## Cursor Cloud specific instructions

This repo is `arc-orchestrator`: a Claude Code marketplace plugin plus a Bun/TypeScript CLI
(`plugins/arc-orchestrator/bin/arc-orchestrator`). There is no web/GUI app — evidence comes
from terminal output and the `bun test` suite. Standard commands live in `package.json`
scripts and `README.md`; only the non-obvious caveats are below.

### Toolchain / runtime
- The runtime is **Bun** (installed at `~/.bun/bin`, already on `PATH` via `~/.bashrc`).
  Node alone is not enough. The `claude` CLI is also installed globally in `~/.bun/bin`
  (needed only by `bun run validate` for `claude plugin validate`).

### The `arc-contracts` dependency (most important gotcha)
- `package.json` pins `"arc-contracts": "link:arc-contracts"`. This is **not** on npm — it is
  vendored from the private `andysolomon/arc-board` repo (sparse path
  `arc-story-queue/packages/arc-contracts`) into `.vendor/arc-board/...`, built with `tsc`,
  and globally `bun link`ed. The startup update script re-establishes this automatically.
- `.vendor/` is a local, untracked vendored checkout. **Never commit `.vendor/`.**
- If tests fail to resolve `arc-contracts`, delete `.vendor/` and re-run the update script
  (or `bun install`) to self-heal the link.

### Common commands
- Test: `bun test` (all 811 tests should pass; ~4s).
- Lint/validate: `bun run validate` (marketplace + plugin manifest validation via `claude`, then `bun test`).
- Build/generate surfaces: `bun run generate:surfaces` (idempotent; regenerates 24 surface files).
- Run the CLI: `./plugins/arc-orchestrator/bin/arc-orchestrator <doctor|routes --json|run ...>`.

### Expected `doctor` behavior in this environment
- `arc-orchestrator doctor` reports Codex / Composer (Cursor Agent) / Claude backends as
  `missing, not authenticated`. That is **expected**: those are external AI-provider CLIs,
  not part of this repo, and are not required to develop, test, or run the orchestrator
  engine. A `run` against a missing backend correctly produces a `backend_unavailable`
  trace and emits a fallback hint — the routing/selection/observability core works without
  any backend installed.
