# Skill Authoring Orchestrator Prompt

Use this when creating or reviewing agent skills.

```text
/fable-orchestrator:orchestrate review or draft the requested skill using arc-creating-skill and writing-great-skills principles. Classify invocation mode, keep SKILL.md short, move long references to sibling markdown, add eval hooks when the repo supports them, and verify every instruction changes behavior. Scope changes to the skill files and tests/evals needed. Label the run skill-authoring-<name>.
```

## Contract

- Route: `codex/review` for critique; `codex/implement` for a bounded skill edit.
- Outcome: predictable `SKILL.md` plus references/evals when appropriate.
- Scope: target skill directory, sibling reference files, and relevant tests/evals.
- Invariants: do not make every helper model-invoked; do not add long checklists directly to `SKILL.md`; preserve installed skill conventions.
- Verification: inspect frontmatter, links, completion criteria, and any eval/test coverage.
- Prohibitions: no commits, pushes, merges, deployments, secret edits, or unrelated refactors.
- Safe label: `skill-authoring-<name>`.
