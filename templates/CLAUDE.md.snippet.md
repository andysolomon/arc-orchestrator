## Model Orchestration

- Use Claude Fable 5.1 at `high` effort for planning, architecture, ambiguity resolution, task decomposition, and final decisions.
- Run `/arc-orchestrator:setup` before first use in a new environment; never run Cursor Agent or Codex with `sudo`.
- Use `arc-orchestrator:composer-implement` as the default bulk implementation worker through Cursor Composer 2.5.
- Use `--backend codex --mode implement` for harder work or escalation, `--backend codex --mode analyze` for read-only codebase exploration, and `--backend codex --mode review` for independent validation. There are no `codex-*` agents or route aliases.
- When Codex is unavailable, re-delegate to `opus-explore`, `opus-check`, or `opus-implement`, or set `ARC_ORCHESTRATOR_FALLBACK=claude` for opt-in automatic retry; workers surface the fallback hint but never substitute silently.
- When Claude/Opus is also unavailable, re-delegate to `grok-explore`, `grok-check`, or `grok-implement` on the composer backend with Grok 4.5; Grok is availability recovery, not taste escalation and not a substitute for `opus-review`.
- Before delegating, state the outcome, scope, invariants, verification, and prohibited actions.
- Treat worker results as evidence. Inspect diffs and test results before accepting them.
- Do not delegate quick edits or work that requires frequent user interaction.
- Do not let workers commit, push, merge, deploy, or use unrestricted filesystem access unless the user explicitly requests and approves it.
- Keep worker handoffs compact; summarize findings rather than copying full transcripts into the main context.
