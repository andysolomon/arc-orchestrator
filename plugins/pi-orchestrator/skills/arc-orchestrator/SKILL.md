---
name: arc-orchestrator
description: Codex-first ARC orchestration for Pi. Use when work should be planned in the parent Pi session and delegated as bounded analyze, implement, or review tasks through the orchestrator runner. Codex 5.6 Terra is the default parent orchestrator; Fable is not required.
---

# ARC Orchestrator for Pi

Use this skill to keep the parent Pi session focused on planning, ambiguity resolution, final judgment, and user communication while delegating bounded execution to the local orchestrator runner.

## Default Parent Model

Use **Codex 5.6 Terra** as the default parent orchestrator for this Pi workflow. Do not assume Fable is present or preferred. If the active Pi model is weaker than Codex 5.6 Terra, ask the user to switch models before high-risk planning or final acceptance.

## Runner

This package currently reuses the repository runner while the binary retains its historical name:

```sh
${ARC_ORCHESTRATOR_BIN:-./plugins/fable-orchestrator/bin/fable-orchestrator}
```

If the package is installed outside this repository, set `ARC_ORCHESTRATOR_BIN` to the absolute path of the runner.

## Operating Model

1. Keep planning, architecture, ambiguity resolution, user questions, and final acceptance in the parent Pi session.
2. Delegate only when the task is self-contained and has explicit boundaries.
3. Pick one route:
   - `codex/analyze`: read-only repository exploration or evidence gathering; defaults to GPT-5.6 Luna.
   - `codex/implement`: difficult implementation through GPT-5.6 Terra with workspace-write access, or Sol for taste-sensitive task classes.
   - `codex/review`: independent read-only correctness, regression, security, or acceptance check through GPT-5.6 Terra, or Sol for taste-sensitive task classes.
   - `composer/implement`: optional bulk mechanical implementation through Cursor Composer 2.5 only when the task is clear and low-risk.
   - `claude/analyze`, `claude/review`, `claude/implement`: availability fallback through `--backend claude` (Opus 4.8) when Codex is unavailable or the parent explicitly routes there.
4. Treat worker output as evidence, not ground truth.
5. Inspect important diffs and verification evidence before final acceptance.
6. Never ask workers to commit, push, merge, deploy, edit secrets, or touch unrelated files.

## GPT-5.6 Worker Routing

- `gpt-5.6-luna`: Codex analyze default for high-volume, low-stakes exploration and evidence gathering.
- `gpt-5.6-terra`: Codex implement/review default for harder implementation, debugging, escalation, and routine checks.
- `gpt-5.6-sol`: Codex implement/review default for taste-sensitive task classes (`taste-sensitive`, `ui`, `copy`, `api-design`) unless the matching `FABLE_ORCHESTRATOR_IMPLEMENT_MODEL` or `FABLE_ORCHESTRATOR_REVIEW_MODEL` override is non-empty.
- Composer 2.5 remains the default Cursor implementation worker; `FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit override escape hatch, not the default.
- Explicit model overrides always win.

Pi intentionally remains Codex 5.6 Terra-first for parent orchestration. It can invoke
the Cursor implementation backend for a bounded task, but that does not make
Sol a Pi parent model.

## Task Contract

Every delegated task must include:

- exact outcome;
- files/subsystems in scope;
- behavior that must remain unchanged;
- required verification or tests;
- prohibited actions and scope boundaries;
- a short non-sensitive `--label` for trace readability.

## Commands

Analyze:

```sh
${ARC_ORCHESTRATOR_BIN:-./plugins/fable-orchestrator/bin/fable-orchestrator} run \
  --backend codex \
  --mode analyze \
  --task "<bounded exploration contract>" \
  --cwd "$PWD" \
  --label "<safe label>"
```

Implement with Codex (GPT-5.6 Terra by default, Sol for taste-sensitive):

```sh
${ARC_ORCHESTRATOR_BIN:-./plugins/fable-orchestrator/bin/fable-orchestrator} run \
  --backend codex \
  --mode implement \
  --task "<bounded implementation contract>" \
  --cwd "$PWD" \
  --label "<safe label>"
```

Review with Codex (GPT-5.6 Terra by default, Sol for taste-sensitive):

```sh
${ARC_ORCHESTRATOR_BIN:-./plugins/fable-orchestrator/bin/fable-orchestrator} run \
  --backend codex \
  --mode review \
  --task "<bounded review contract>" \
  --cwd "$PWD" \
  --label "<safe label>"
```

Claude backend fallback (when Codex is unavailable or parent routes to Opus 4.8):

```sh
${ARC_ORCHESTRATOR_BIN:-./plugins/fable-orchestrator/bin/fable-orchestrator} run \
  --backend claude \
  --mode analyze \
  --task "<bounded exploration contract>" \
  --cwd "$PWD" \
  --label "<safe label>"
```

Set `FABLE_ORCHESTRATOR_FALLBACK=claude` for opt-in automatic retry on availability-classified Codex failures. For UI/UX, user-facing copy, API design, or other taste-sensitive implement/review tasks, add `--task-class taste-sensitive` (or `ui`, `copy`, `api-design`) so the runner selects GPT-5.6 Sol.

Inspect recent runs:

```sh
${ARC_ORCHESTRATOR_BIN:-./plugins/fable-orchestrator/bin/fable-orchestrator} runs --limit 10
```

## Verification

After implementation work, run focused tests yourself when practical, inspect the diff, and then decide whether to accept, request changes, or escalate to another Codex pass.
