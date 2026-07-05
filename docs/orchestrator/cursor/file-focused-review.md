# File-Focused Review Prompts (Cursor)

Paste into Cursor chat with Fable as the parent model. Replace the file path and criteria.

```text
/orchestrate review <FILE_OR_SUBSYSTEM> against these acceptance criteria: <CRITERIA>. Read-only Codex review. Report prioritized findings (blockers, concerns, nits) with file evidence and suggested fixes. Do not edit files. Label the run file-review-<short-name>.
```

Direct runner equivalent:

```sh
fable-orchestrator run --backend codex --mode review --task "Review <FILE_OR_SUBSYSTEM> against: <CRITERIA>. Read-only. Return prioritized findings with evidence and suggested fixes." --cwd "$PWD" --label "file-review-<short-name>"
```

For taste-heavy targets (UI, API surface, docs, prompt wording), prefer the Opus route in `opus-review.md` instead.
