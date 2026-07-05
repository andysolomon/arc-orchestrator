# Cursor Opus Review Prompt

Paste this into Cursor chat when the work needs taste/design critique more than implementation throughput.

```text
Use Opus 4.8 as a read-only review worker for <UI_API_DOCS_OR_PROMPT>. Focus on taste, UX polish, accessibility, API ergonomics, component boundaries, docs/copy clarity, prompt wording, and long-term maintainability. Do not edit files. Return a concise verdict, top findings with evidence, suggested improvements, and whether Composer or Codex should do follow-up implementation. Label the review cursor-opus-review-<short-name>.
```
