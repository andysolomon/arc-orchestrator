# File-Focused Review Prompts (Cursor)

Use the active tier of the CC-Fable → Codex 5.6 Sol → Cursor-Fable-High parent availability chain at high reasoning. Planning, ambiguity resolution, route selection, final judgment, and user communication stay in the active parent chat. Follow the cross-harness parent availability chain: CC-Fable → Codex 5.6 Sol → Cursor-Fable-High. If CC-Fable is unavailable because of usage limit, authentication failure, or model unavailable, use Codex 5.6 Sol; if Codex 5.6 Sol is also unavailable, use Cursor-Fable-High. Run every parent in this availability chain at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control, and never use low or unspecified/default reasoning for a parent. Replace the file path and criteria.

```text
/orchestrate review <FILE_OR_SUBSYSTEM> against these acceptance criteria: <CRITERIA>. Read-only Codex review. Report prioritized findings (blockers, concerns, nits) with file evidence and suggested fixes. Do not edit files. Label the run file-review-<short-name>.
```

Direct runner equivalent:

```sh
arc-orchestrator run --backend codex --mode review --task "Review <FILE_OR_SUBSYSTEM> against: <CRITERIA>. Read-only. Return prioritized findings with evidence and suggested fixes." --cwd "$PWD" --label "file-review-<short-name>"
```

Use Sol for bounded taste-sensitive Codex implementation/review against explicit criteria. Use the Opus route in `opus-review.md` for open-ended high-taste critique or design direction before criteria are fixed.
