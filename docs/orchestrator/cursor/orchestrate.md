# Cursor Orchestrate Prompts

Use the active tier of the CC-Fable → Codex 5.6 Sol → Cursor-Fable-High parent availability chain at high reasoning. Planning, ambiguity resolution, route selection, final judgment, and user communication stay in the active parent chat. With the cursor-orchestrator plugin installed, `/orchestrate <task>` wraps the same contract. Follow the cross-harness parent availability chain: CC-Fable → Codex 5.6 Sol → Cursor-Fable-High. If CC-Fable is unavailable because of usage limit, authentication failure, or model unavailable, use Codex 5.6 Sol; if Codex 5.6 Sol is also unavailable, use Cursor-Fable-High. Run every parent in this availability chain at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control, and never use low or unspecified/default reasoning for a parent.

```text
/orchestrate <TASK>
```

Manual paste when the plugin is not installed:

```text
Use the active parent tier to orchestrate <TASK>. Follow the cross-harness parent availability chain: CC-Fable → Codex 5.6 Sol → Cursor-Fable-High. If CC-Fable is unavailable because of usage limit, authentication failure, or model unavailable, use Codex 5.6 Sol; if Codex 5.6 Sol is also unavailable, use Cursor-Fable-High. Run every parent in this availability chain at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control, and never use low or unspecified/default reasoning for a parent. First decide whether this should stay in the parent chat or be delegated. If delegated, produce a bounded worker contract with outcome, scope, invariants, verification, prohibitions, and a safe label. Prefer Composer 2.5 for clear mechanical implementation, GPT-5.5 for hard Codex implement/review, GPT-5.6 Luna for repo exploration, GPT-5.6 Sol for bounded taste-sensitive Codex implementation/review against explicit criteria, and Opus 4.8 when the task needs open-ended high-taste critique or design direction before criteria are fixed. The parent must never directly commit, push, create or comment on pull requests or issues, or merge. Do not deploy, edit secrets, or touch unrelated files.
```

Review judgment and approval stay in the active parent.

## Mechanical ship operations

- `mechanical-open-pr` opens an approved pull request.
- `mechanical-post-comment` posts an approved pull-request or issue comment.
- `mechanical-commit-push` commits an already-staged approved diff and pushes it normally.
- `mechanical-merge` merges an approved pull request with explicit merge authority.

The fixed default dumb proposal model Composer 2.5 is the only proposal model for all four mechanical routes, with no automatic fallback or model override. The active parent must never directly commit, push, create or comment on pull requests or issues, or merge; it must delegate each authorized operation to the corresponding mechanical route above.

Verify backends before the first delegation in a new environment:

```sh
fable-orchestrator doctor --json
```
