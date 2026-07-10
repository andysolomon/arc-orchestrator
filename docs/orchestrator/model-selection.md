# Orchestrator Model Selection Slash Commands

Use Fable by default. Copy the Opus/current-model commands only when you explicitly want to orchestrate without Fable.

## GPT-5.6 worker targeting

Model availability is backend-specific in this orchestrator: `gpt-5.6-terra`
and `gpt-5.6-luna` are Codex models; `gpt-5.6-sol` is available only through
Cursor Agent. An environment override selects a model only on its own backend;
it does not make that model available on another backend.

| Model | Backend and targeting | Reach for it when |
| --- | --- | --- |
| `gpt-5.6-terra` | Codex default for `implement` and `review`; override with `FABLE_ORCHESTRATOR_IMPLEMENT_MODEL` or `FABLE_ORCHESTRATOR_REVIEW_MODEL`. | Hard implementation, repository analysis, difficult debugging, or escalation when Composer 2.5 misses the bar. |
| `gpt-5.6-luna` | Codex default for `analyze`; override with `FABLE_ORCHESTRATOR_ANALYZE_MODEL`. | High-volume, low-stakes exploration such as log sifting, dependency tracing, and evidence gathering; escalate to Terra if it misses. |
| `gpt-5.6-sol` | Cursor implementation only: set `FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol`. | A bounded Cursor task needs more reasoning or design judgment than Composer 2.5, especially user-facing UI, copy, or API work. |

Codex task classes do not automatically switch between Terra and Luna: the
parent chooses the Codex mode and sets its mode-specific override when needed.
Cursor does have task-class behavior: `taste-sensitive` (also `ui`, `copy`, or
`api-design`) selects Sol unless `FABLE_ORCHESTRATOR_COMPOSER_MODEL` is set.
Bulk clear-spec implementation, migrations, mechanical refactors, and focused
test additions omit that class and remain on Cursor Composer 2.5. Sol is never
routed to read-only exploration or checks because Cursor headless mode is
write-capable only.

```text
/fable-orchestrator:orchestrate <TASK>. Keep planning and final judgment in Fable. Delegate only bounded worker tasks. Require verification. Do not commit or push. Label the run fable-orchestrate-<short-name>.
```

```text
/fable-orchestrator:orchestrate-with-model opus <TASK>. Use Opus as the parent orchestrator for this request. Keep planning and final judgment in the parent Claude Code session. Delegate only bounded worker tasks. Require verification. Do not commit or push. Label the run opus-orchestrate-<short-name>.
```

```text
/fable-orchestrator:orchestrate-with-model current <TASK>. Use the currently selected Claude Code model as the parent orchestrator. Keep planning and final judgment in the parent session. Delegate only bounded worker tasks. Require verification. Do not commit or push. Label the run current-orchestrate-<short-name>.
```
