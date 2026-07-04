---
name: prompt-factory
description: Scan a repository and create durable docs/orchestrator prompt files for using ARC/Fable orchestrator across Claude Code, Pi, GitHub Copilot, and future plugin surfaces. Use when the user asks for repo-specific orchestrator prompts, prompt generation, plugin prompt alignment, or a factory-style way to keep orchestrator prompts consistent.
allowed-tools: Bash(find *), Bash(git *), Bash(bun *), Read, Write, Edit
---

# Orchestrator Prompt Factory

Create repo-specific prompt files under `docs/orchestrator/` and align them with the central prompt factory contract.

## Steps

1. **Inventory.** Scan project shape with read-only commands: directories, package manifests, test scripts, plugin surfaces, skills, docs, CI, and notable entrypoints. Completion: you can name the primary languages/frameworks, test commands, plugin surfaces, and documentation sources.
2. **Classify prompts.** Choose only prompt files that match repo signals using [references/prompt-types.md](references/prompt-types.md). Completion: every chosen prompt has a route, audience, and concrete use case.
3. **Centralize.** Check whether this repo has `plugins/orchestrator-core/prompt-factory.ts` or an equivalent central source. If absent and you are allowed to edit the repo, create the smallest central factory/reference before writing generated prompts. Completion: there is one obvious place to update shared orchestrator wording across Claude, Pi, Copilot, and future surfaces.
4. **Generate.** Ensure `docs/` and `docs/orchestrator/` exist, then write concise `.md` prompt files. Completion: every generated file includes outcome, scope, invariants, verification, prohibitions, route, safe label guidance, and plugin-surface notes.
5. **Skill-aware review.** Use `arc-creating-skill` and writing-great-skills principles when designing the skill output; use `grill-me` and `grill-with-docs` as review lenses for adversarial critique and doc-grounded drift checks. Do not generate standalone prompt files for those lenses unless the user explicitly asks. Completion: generated prompts reflect those methods without pretending unavailable commands exist.
6. **Verify.** Run existing lightweight tests or docs checks when available; otherwise verify files exist and links resolve. Completion: report exact files created/changed and verification run.

## Rules

- Do not overwrite existing human-authored prompt files without preserving their intent.
- Do not include secrets, absolute paths, raw transcripts, or private task text in generated prompts.
- Prefer Codex 5.5 as the default parent orchestrator for Pi and Copilot surfaces; do not make Fable their default.
- Keep Claude/Fable-specific language isolated to Claude Code prompt guidance.
- Make prompts runnable as copy/paste examples from the target tool's TUI or prompt picker.
