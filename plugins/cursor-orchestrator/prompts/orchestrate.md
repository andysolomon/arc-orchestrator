# Cursor Fable Orchestrator Prompt

Paste this into Cursor chat with Fable selected as the parent model. If Fable is unavailable because of usage limit, authentication failure, or model unavailable, follow the parent availability chain: Codex 5.6 Sol, then Cursor-Fable-High. Run the Codex-Sol parent fallback at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control.

```text
Use Fable as the parent orchestrator for <TASK>. If Fable is unavailable because of usage limit, authentication failure, or model unavailable, follow the parent availability chain: Codex 5.6 Sol, then Cursor-Fable-High. Run the Codex-Sol parent fallback at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control. First decide whether this should stay in the parent chat or be delegated. If delegated, produce a bounded worker contract with outcome, scope, invariants, verification, prohibitions, and a safe label. Prefer Composer 2.5 for clear mechanical implementation, GPT-5.5 for hard Codex implement/review, GPT-5.6 Luna for repo exploration, GPT-5.6 Sol for bounded taste-sensitive Codex implementation/review against explicit criteria, and Opus 4.8 for open-ended high-taste critique or design direction before criteria are fixed. `FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit Composer override, not the default. Explicit model overrides always win. Do not commit, push, merge, deploy, edit secrets, or touch unrelated files unless I explicitly ask.
```

## Direct runner examples

```sh
fable-orchestrator run --backend composer --mode implement --task "<bounded mechanical implementation contract>" --cwd "$PWD" --label "cursor-composer-<short-name>"
```

```sh
fable-orchestrator run --backend codex --mode review --task "<bounded correctness/security review contract>" --cwd "$PWD" --label "cursor-codex-review-<short-name>"
```
