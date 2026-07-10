# Orchestrator Model Selection Slash Commands

Use Fable by default. Copy the Opus/current-model commands only when you explicitly want to orchestrate without Fable.

## GPT-5.6 worker targeting

Doctor's advertised model availability is backend-specific: Codex lists
`gpt-5.6-terra`, `gpt-5.6-luna`, and `gpt-5.6-sol`, while Cursor Agent lists
`composer-2.5`. An environment override affects only its matching backend and
does not change those availability reports; the explicit Composer Sol override
below remains a supported escape hatch.

| Model | Backend and targeting | Reach for it when |
| --- | --- | --- |
| `gpt-5.6-terra` | Codex default for non-taste-sensitive `implement` and `review`; override with `FABLE_ORCHESTRATOR_IMPLEMENT_MODEL` or `FABLE_ORCHESTRATOR_REVIEW_MODEL`. | Hard implementation, repository analysis, difficult debugging, or escalation when Composer 2.5 misses the bar. |
| `gpt-5.6-luna` | Codex default for `analyze`; override with `FABLE_ORCHESTRATOR_ANALYZE_MODEL`. | High-volume, low-stakes exploration such as log sifting, dependency tracing, and evidence gathering; escalate to Terra if it misses. |
| `gpt-5.6-sol` | Codex default for taste-sensitive `implement` and `review`; override with the matching mode override. | Bounded user-facing UI, copy, or API design work, including read-only review. |

Codex `implement` and `review` select Sol for `taste-sensitive` (also `ui`,
`copy`, or `api-design`) unless the matching mode override is non-empty.
`analyze` remains Luna regardless of task class. Bulk clear-spec implementation,
migrations, mechanical refactors, and focused test additions remain on Cursor
Composer 2.5; Cursor never auto-selects Sol, though an explicit
`FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` remains honored.

```text
/fable-orchestrator:orchestrate <TASK>. Keep planning and final judgment in Fable. Delegate only bounded worker tasks. Require verification. Do not commit or push. Label the run fable-orchestrate-<short-name>.
```

```text
/fable-orchestrator:orchestrate-with-model opus <TASK>. Use Opus as the parent orchestrator for this request. Keep planning and final judgment in the parent Claude Code session. Delegate only bounded worker tasks. Require verification. Do not commit or push. Label the run opus-orchestrate-<short-name>.
```

```text
/fable-orchestrator:orchestrate-with-model current <TASK>. Use the currently selected Claude Code model as the parent orchestrator. Keep planning and final judgment in the parent session. Delegate only bounded worker tasks. Require verification. Do not commit or push. Label the run current-orchestrate-<short-name>.
```
