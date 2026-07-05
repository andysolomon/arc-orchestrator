# Opus Review Prompts (Cursor)

Use when the work needs taste and design critique more than implementation throughput: UI/UX, API ergonomics, component architecture, docs, copy, and prompt wording.

```text
/opus-review <UI_API_DOCS_OR_PROMPT>
```

Manual paste when the plugin is not installed:

```text
Use Opus 4.8 as a read-only review worker for <UI_API_DOCS_OR_PROMPT>. Focus on taste, UX polish, accessibility, API ergonomics, component boundaries, docs/copy clarity, prompt wording, and long-term maintainability. Do not edit files. Return a concise verdict, top findings with evidence, suggested improvements, and whether Composer or Codex should do follow-up implementation. Label the review cursor-opus-review-<short-name>.
```
