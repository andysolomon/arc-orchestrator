# Opus Review Slash Commands

Use these when you want a high-taste read-only critique. For generic correctness/security review, use Codex check instead.

```text
/fable-orchestrator:orchestrate ask Opus 4.8 to review <UI_OR_COMPONENT> for UX polish, accessibility, visual hierarchy, copy clarity, and confusing states. Keep the review read-only. Do not edit files. Label the run opus-ux-review-<short-name>.
```

```text
/fable-orchestrator:orchestrate ask Opus 4.8 to review <API_OR_ABSTRACTION> for ergonomics, long-term maintainability, naming, composition boundaries, and whether the abstraction is pleasant to use. Keep the review read-only. Do not edit files. Label the run opus-api-review-<short-name>.
```

```text
/fable-orchestrator:orchestrate ask Opus 4.8 to review <DOCS_PROMPT_OR_SKILL> for clarity, ambiguity, user guidance, durable wording, and copy/paste usability. Keep the review read-only. Do not edit files. Label the run opus-docs-review-<short-name>.
```

```text
/fable-orchestrator:orchestrate after the implementation of <TASK>, ask Opus 4.8 for a second-opinion design critique before final acceptance. Focus on taste, UX, API shape, maintainability, and tradeoffs. Keep the review read-only. Do not edit files. Label the run opus-second-opinion-<short-name>.
```
