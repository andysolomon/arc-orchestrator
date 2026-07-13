# Opus Review Prompts (Cursor)

Use the active tier of the CC-Fable → Codex 5.6 Sol → Cursor-Fable-High parent availability chain at high reasoning. Planning, ambiguity resolution, route selection, final judgment, and user communication stay in the active parent chat. Follow the cross-harness parent availability chain: CC-Fable → Codex 5.6 Sol → Cursor-Fable-High. If CC-Fable is unavailable because of usage limit, authentication failure, or model unavailable, use Codex 5.6 Sol; if Codex 5.6 Sol is also unavailable, use Cursor-Fable-High. Run every parent in this availability chain at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control, and never use low or unspecified/default reasoning for a parent.

Use Opus for open-ended high-taste critique or design direction before criteria are fixed. Use Sol for bounded taste-sensitive Codex implementation/review against explicit criteria.

```text
/opus-review <UI_API_DOCS_OR_PROMPT>
```

Manual paste when the plugin is not installed:

```text
Use Opus 4.8 as a read-only review worker for <UI_API_DOCS_OR_PROMPT>. Focus on taste, UX polish, accessibility, API ergonomics, component boundaries, docs/copy clarity, prompt wording, and long-term maintainability. Do not edit files. Return a concise verdict, top findings with evidence, suggested improvements, and whether Composer or Codex should do follow-up implementation. Label the review cursor-opus-review-<short-name>.
```
