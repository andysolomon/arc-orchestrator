# ARC Orchestrator Instructions for GitHub Copilot

Use these instructions as `.github/copilot-instructions.md` in repositories that should use ARC orchestration.

## Default Orchestrator

Codex 5.5 is the default parent orchestrator. Do not treat Fable as the default or required orchestrator for this workflow.

## Operating Model

- Keep planning, architecture, ambiguity resolution, user interaction, and final acceptance in the parent Copilot session.
- Delegate only bounded, self-contained work with explicit scope and verification requirements.
- Use the local orchestrator runner for worker execution when available:

```sh
${ARC_ORCHESTRATOR_BIN:-./plugins/fable-orchestrator/bin/fable-orchestrator}
```

- Treat worker output as evidence, not truth. Inspect important diffs and verification before accepting.
- Never instruct workers to commit, push, merge, deploy, edit secrets, or touch unrelated files.

## Routing

- `codex/analyze`: read-only exploration, repository mapping, evidence gathering.
- `codex/implement`: default difficult implementation route through GPT-5.5 with workspace-write access.
- `codex/review`: independent read-only review through GPT-5.5.
- `composer/implement`: optional clear, mechanical bulk implementation through Composer 2.5 when the contract is already approved.
- `claude/analyze`, `claude/review`, `claude/implement`: availability fallback through `--backend claude` (Opus 4.8) when Codex is unavailable or the parent explicitly routes there. Set `FABLE_ORCHESTRATOR_FALLBACK=claude` for opt-in automatic retry on availability-classified Codex failures.

## GPT-5.6 Worker Routing

- `gpt-5.6-terra` and `gpt-5.6-luna` are Codex worker choices. Set the applicable `FABLE_ORCHESTRATOR_ANALYZE_MODEL`, `FABLE_ORCHESTRATOR_IMPLEMENT_MODEL`, or `FABLE_ORCHESTRATOR_REVIEW_MODEL` value for that Codex mode.
- `gpt-5.6-sol` is Cursor-only and write-capable: use it only for taste-sensitive Cursor implementation (`taste-sensitive`, `ui`, `copy`, or `api-design`), never for a Codex or read-only route. It is selected for those task classes when no model is specified.
- Explicit model overrides always win. `FABLE_ORCHESTRATOR_COMPOSER_MODEL` overrides the Cursor task-class default; the mode-specific Codex variables select only their matching Codex worker mode.

Copilot intentionally remains Codex 5.5-first for parent orchestration. It can
invoke the Cursor implementation backend for a bounded task, but that does not
make Sol a Copilot parent model or a Codex worker choice.

## Delegation Contract

Before invoking a worker, define:

1. exact outcome;
2. files or subsystem in scope;
3. behavior that must remain unchanged;
4. tests or verification to run;
5. prohibited actions and scope boundaries;
6. short safe label for trace records.

## Observability

Inspect local traces with:

```sh
${ARC_ORCHESTRATOR_BIN:-./plugins/fable-orchestrator/bin/fable-orchestrator} runs --limit 10
```

Local traces record backend, mode, resolved model, sandbox, duration, token usage, status, changed-file count, project hash, and optional label. They must not include prompts, secrets, file contents, or absolute paths.
