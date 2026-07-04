# Prompt Type Catalog

Use this catalog after scanning the target repository. Generate only the prompt files that match real repo signals.

| File | Route | Generate when | Purpose |
| --- | --- | --- | --- |
| `repo-scan.md` | `codex/analyze` | Always | Map project structure, risks, test commands, and good delegation seams. |
| `file-focused-review.md` | `codex/review` | Always | Review a file or subsystem with explicit invariants and verification. |
| `implementation.md` | `codex/implement` or `composer/implement` | Repo has source files and tests | Turn a bounded task into a safe implementation delegation prompt. |
| `plugin-surface-sync.md` | `codex/review` | Multiple orchestrator plugin files exist | Review Claude Code orchestrator plugin docs, skills, agents, tests, and shared wording for drift. |
| `test-strategy.md` | `codex/analyze` | Tests or package scripts exist | Discover focused verification commands and test gaps before implementation. |

## Prompt Quality Checks

Before writing a prompt file, make sure it answers:

- What should the orchestrator do?
- Which route should it use?
- Which files or subsystems are in scope?
- What must not change?
- How should the result be verified?
- What is the safe trace label?
- How does the user copy/paste it in the selected surface?

## Required Sections

Every generated prompt file must include:

1. intended outcome;
2. route and target surface notes;
3. scope placeholders;
4. invariants that must not change;
5. verification commands or discovery steps;
6. prohibitions: no commits, pushes, merges, deployments, secret edits, or unrelated refactors;
7. a short safe label convention.

## Surface Notes

Use only the relevant block in generated files:

### Claude Code

- Use `/fable-orchestrator:setup` first to check backend readiness.
- Use `/fable-orchestrator:observability` to inspect recent delegated worker runs.
- Use `/fable-orchestrator:orchestrate <bounded task>` for repo scans, reviews, implementations, and test-strategy discovery.
- Fable keeps planning, ambiguity resolution, final judgment, and user communication in the parent Claude Code session.

### Pi

- Use the Pi orchestrator package prompt/skill surface.
- Keep planning and final judgment in the parent Pi session.
- Use Codex 5.5 as the default parent orchestrator unless the user intentionally chooses another model.

### GitHub Copilot

- Use the Copilot prompt files/instructions surface.
- Keep the prompt focused on the selected route and bounded task contract.
- Use Codex 5.5 as the default parent orchestrator unless the user intentionally chooses another model.
