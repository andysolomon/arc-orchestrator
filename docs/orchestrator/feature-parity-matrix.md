# Orchestrator Feature Parity Matrix

`plugins/orchestrator-core/feature-matrix.ts` is the **source of truth** for cross-surface feature parity. `test/feature-parity.test.ts` enforces it: required artifacts must exist, intentional differences must carry a documented rationale, and parent-model defaults must match policy.

## Parent model defaults

| Surface | Default parent | Fallback parent | Assertion paths |
| --- | --- | --- | --- |
| Claude | Fable | — | `plugins/fable-orchestrator/skills/orchestrate/SKILL.md` |
| Cursor | Fable | Codex 5.6 Sol, then Cursor-Fable-High when Fable is unavailable (usage limit, authentication failure, or model unavailable) | `plugins/cursor-orchestrator/rules/orchestrator.mdc`, `plugins/cursor-orchestrator/skills/orchestrate/SKILL.md` |
| Pi | Codex 5.6 Sol | — | `plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md`, `plugins/pi-orchestrator/prompts/orchestrate.md` (symlink to `plugins/orchestrator-core/prompts/pi-orchestrate.md`) |
| Copilot | Codex 5.6 Terra | — | `plugins/copilot-orchestrator/copilot-instructions.md` |

## Feature matrix

| Feature | Claude | Cursor | Pi | Copilot |
| --- | --- | --- | --- | --- |
| Orchestrate skill / prompt | required: `plugins/fable-orchestrator/skills/orchestrate/SKILL.md` | required: `plugins/cursor-orchestrator/skills/orchestrate/SKILL.md` | required: `plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md`, `plugins/pi-orchestrator/prompts/orchestrate.md` | required: `plugins/copilot-orchestrator/prompts/orchestrate.prompt.md` |
| Prompt factory skill | required: `plugins/fable-orchestrator/skills/prompt-factory/SKILL.md` | required: `plugins/cursor-orchestrator/skills/prompt-factory/SKILL.md` | intentional difference — Pi is Codex-first and reuses `docs/orchestrator` slash commands for durable prompt generation; it does not ship a dedicated prompt-factory skill. | intentional difference — Copilot uses checked-in prompt templates under `plugins/copilot-orchestrator/prompts/` rather than a prompt-factory skill surface. |
| Setup / doctor skill | required: `plugins/fable-orchestrator/skills/setup/SKILL.md` | required: `plugins/cursor-orchestrator/skills/setup/SKILL.md` | intentional difference — Pi declares the shared runner via `package.json`; backend authentication is the user's local responsibility and is not wrapped in a Pi setup skill. | intentional difference — Copilot setup guidance lives inline in `copilot-instructions.md`; there is no separate setup skill artifact. |
| Observability skill | required: `plugins/fable-orchestrator/skills/observability/SKILL.md` | required: `plugins/cursor-orchestrator/skills/observability/SKILL.md` | intentional difference — Pi covers basic runs inspection inline in the arc-orchestrator skill; it does not ship a dedicated observability skill with Laminar boundaries. | intentional difference — Copilot documents observability inline in `copilot-instructions.md`; there is no separate observability skill artifact. |
| Direct worker escape hatch | required: `plugins/fable-orchestrator/skills/direct-worker/SKILL.md` | required: `plugins/cursor-orchestrator/skills/direct-worker/SKILL.md` | intentional difference — Pi delegates through explicit `fable-orchestrator` CLI commands in arc-orchestrator; it has no auto-mode direct-worker escape hatch. | intentional difference — Copilot invokes workers through explicit prompt templates; it has no direct-worker escape hatch for auto-mode classification blocks. |
| Opus / high-taste review worker | required: `plugins/fable-orchestrator/agents/opus-review.md` | required: `plugins/cursor-orchestrator/skills/opus-review/SKILL.md` | intentional difference — Pi is Codex-first; high-taste review is routed through `codex/review` rather than an Opus 4.8 worker surface. | intentional difference — Copilot is Codex-first; `review.prompt.md` routes through `codex/review` rather than an Opus 4.8 worker surface. |
| Claude (Opus 4.8) availability fallback backend | required: `plugins/fable-orchestrator/skills/claude-runtime/SKILL.md` | required: `plugins/cursor-orchestrator/skills/direct-worker/SKILL.md` | required: `plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md` | required: `plugins/copilot-orchestrator/copilot-instructions.md` |
| Opt-in automatic fallback retry | required: `plugins/fable-orchestrator/skills/orchestrate/references/routing-policy.md` | required: `plugins/cursor-orchestrator/skills/orchestrate/SKILL.md` | required: `plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md` | required: `plugins/copilot-orchestrator/copilot-instructions.md` |
| Doctor Claude backend readiness | required: `plugins/fable-orchestrator/skills/setup/SKILL.md` | required: `plugins/cursor-orchestrator/skills/setup/SKILL.md` | intentional difference — Pi declares the shared runner via `package.json`; backend authentication is the user's local responsibility and is not wrapped in a Pi setup skill. | intentional difference — Copilot setup guidance lives inline in `copilot-instructions.md`; there is no separate setup skill artifact. |
| Opus availability-fallback workers | required: `plugins/fable-orchestrator/agents/opus-explore.md` | intentional difference — Cursor has no thin opus-* Agent wrappers; availability fallback is reached through direct runner invocation (`--backend claude`) in the direct-worker skill. | intentional difference — Pi has no opus-* worker agents; availability fallback is reached through explicit `fable-orchestrator run --backend claude` commands in arc-orchestrator. | intentional difference — Copilot has no opus-* worker agents; availability fallback is reached through explicit `fable-orchestrator run --backend claude` commands documented in copilot-instructions.md. |
| Grok (Grok 4.5) availability fallback runtime | required: `plugins/fable-orchestrator/skills/grok-runtime/SKILL.md` | intentional difference — Cursor has no grok-runtime skill; second-tier availability fallback is reached through direct runner invocation (--backend composer --route grok-*) in the direct-worker skill. | intentional difference — Pi has no grok-runtime skill; second-tier availability fallback is documented through explicit fable-orchestrator run --backend composer --route grok-* commands in arc-orchestrator. | intentional difference — Copilot has no grok-runtime skill; second-tier availability fallback is documented through explicit fable-orchestrator run --backend composer --route grok-* commands in copilot-instructions.md. |
| Grok availability-fallback workers | required: `plugins/fable-orchestrator/agents/grok-explore.md` | intentional difference — Cursor has no thin grok-* Agent wrappers; second-tier availability fallback is reached through direct runner invocation (`--backend composer --route grok-*`) in the direct-worker skill. | intentional difference — Pi has no grok-* worker agents; second-tier availability fallback is reached through explicit `fable-orchestrator run --backend composer --route grok-*` commands in arc-orchestrator. | intentional difference — Copilot has no grok-* worker agents; second-tier availability fallback is reached through explicit `fable-orchestrator run --backend composer --route grok-*` commands documented in copilot-instructions.md. |
| Parent model default policy | required: `plugins/fable-orchestrator/skills/orchestrate/SKILL.md` | required: `plugins/cursor-orchestrator/skills/orchestrate/SKILL.md` | required: `plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md` | required: `plugins/copilot-orchestrator/copilot-instructions.md` |
| GPT-5.6 worker routing guidance | required: `plugins/fable-orchestrator/skills/orchestrate/references/routing-policy.md` | required: `plugins/cursor-orchestrator/skills/orchestrate/SKILL.md` | required: `plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md` | required: `plugins/copilot-orchestrator/copilot-instructions.md` |

## GPT-5.6 worker routing differences

All surfaces document the same worker defaults: `gpt-5.6-luna` for Codex
explore, `gpt-5.5` for hard Codex implement/review, and `gpt-5.6-sol` for
taste-sensitive Codex implement/review. Composer 2.5 remains the default Cursor
implementation worker; `FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an
explicit override escape hatch, not the default. Explicit model overrides win.
The intentionally different parent policies remain unchanged: Cursor is
Fable-first (with its documented Codex 5.6 Sol → Cursor-Fable-High parent
fallback chain), Pi is Codex 5.6 Sol-first, and Copilot is Codex 5.6
Terra-first.

## Updating the matrix

1. Edit `plugins/orchestrator-core/feature-matrix.ts`.
2. Mirror the change in this document.
3. Run `env -u FABLE_ORCHESTRATOR_LOCK_WAIT_MS bun test` from the repository root.

When a Claude Code feature lands, add or update the matrix entry before merging so Cursor (and Pi/Copilot where applicable) cannot silently drift.
