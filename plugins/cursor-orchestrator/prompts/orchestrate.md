# Cursor Fable Orchestrator Prompt

Paste this into Cursor chat with Fable selected as the parent model. If Fable is unavailable because Cursor limits are exhausted, use Codex 5.5 as the parent model fallback.

```text
Use Fable as the parent orchestrator for <TASK>. If Fable is unavailable because Cursor limits are exhausted or the model is not available, use Codex 5.5 as the parent orchestrator fallback. First decide whether this should stay in the parent chat or be delegated. If delegated, produce a bounded worker contract with outcome, scope, invariants, verification, prohibitions, and a safe label. Prefer Composer 2.5 for clear mechanical implementation, Codex 5.5 for hard implementation/review, faster read-only Codex for repo exploration, and Opus 4.8 for high-taste UI/UX/API/docs/prompt critique. Do not commit, push, merge, deploy, edit secrets, or touch unrelated files unless I explicitly ask.
```

## Direct runner examples

```sh
fable-orchestrator run --backend composer --mode implement --task "<bounded mechanical implementation contract>" --cwd "$PWD" --label "cursor-composer-<short-name>"
```

```sh
fable-orchestrator run --backend codex --mode review --task "<bounded correctness/security review contract>" --cwd "$PWD" --label "cursor-codex-review-<short-name>"
```
