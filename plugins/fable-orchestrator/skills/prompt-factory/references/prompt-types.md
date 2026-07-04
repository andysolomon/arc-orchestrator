# Prompt Type Catalog

Use this catalog after scanning the target repository. Generate only the prompt files that match real repo signals.

| File | Route | Generate when | Purpose |
| --- | --- | --- | --- |
| `repo-scan.md` | `codex/analyze` | Always | Map project structure, risks, test commands, and good delegation seams. |
| `file-focused-review.md` | `codex/review` | Always | Review a file or subsystem with explicit invariants and verification. |
| `skill-authoring.md` | `codex/review` | Skills exist or user mentions skill creation | Apply `arc-creating-skill` and writing-great-skills principles to create/review skills. |
| `plugin-surface-sync.md` | `codex/review` | Multiple plugin surfaces exist | Keep Claude, Pi, Copilot, and future surfaces aligned through a central factory. |
| `test-strategy.md` | `codex/analyze` | Tests or package scripts exist | Discover focused verification commands and test gaps before implementation. |

## Review Lenses

Use these methods while authoring and reviewing generated prompts; do not create standalone files for them unless explicitly requested:

- `grill-me`: adversarially challenge assumptions, acceptance criteria, risks, tests, rollback, and simpler alternatives.
- `grill-with-docs`: compare proposed prompts and plugin behavior against local docs/specs and flag drift.
- `arc-creating-skill` / writing-great-skills: keep the skill behavior spine short, disclose long references, and make every instruction operational.

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

- Claude Code: use `/fable-orchestrator:orchestrate` when available; Fable keeps final judgment.
- Pi: use the ARC orchestrator package; Codex 5.5 is the default parent orchestrator.
- Copilot: use prompt files or instructions; Codex 5.5 is the default parent orchestrator.
- Future surfaces: adapt wording through the central factory/reference, not one-off prompt drift.
