---
name: prompt-factory
description: Scan a repository and create docs/orchestrator prompt files that show users exactly how to use the orchestrator from their active surface. Use Claude Code examples when invoked from Claude Code; use Pi or Copilot examples only when that surface is requested.
allowed-tools: Bash(find *), Bash(git *), Bash(bun *), Read, Write, Edit
---

# Orchestrator Prompt Factory

Create repo-specific prompt files under `docs/orchestrator/` that users can copy into their current orchestrator surface. Default to Claude Code TUI when this skill is invoked from Claude Code; switch to Pi or Copilot only when the user asks for that surface.

## Steps

1. **Inventory.** Scan project shape with read-only commands: directories, package manifests, test scripts, plugin surfaces, skills, docs, CI, and notable entrypoints. Completion: you can name the primary languages/frameworks, test commands, plugin surfaces, and documentation sources.
2. **Pick the surface.** Use Claude Code when the user is in Claude Code or does not specify a surface. Use Pi or Copilot only when requested. Completion: the generated prompt examples use exactly one primary surface unless the task is explicitly about comparing plugin surfaces.
3. **Classify prompts.** Choose only prompt files that match repo signals using [references/prompt-types.md](references/prompt-types.md). Completion: every chosen prompt has a route, audience, and concrete use case for the selected surface.
4. **Centralize.** If this repo has a central prompt factory/reference, update shared wording there before editing individual prompt files. Completion: repeated orchestrator wording has one obvious source of truth.
5. **Generate.** Ensure `docs/` and `docs/orchestrator/` exist, then write concise `.md` prompt files. Completion: every generated file includes a copy/paste example for the selected surface, outcome, scope, invariants, verification, prohibitions, route, and safe label guidance.
6. **Quality review.** Challenge each generated prompt for usefulness, ambiguity, missing scope boundaries, missing verification, and documentation drift when local docs exist. Completion: every generated prompt is something a user could copy into the selected surface and immediately understand how to use.
7. **Verify.** Run existing lightweight tests or docs checks when available; otherwise verify files exist and links resolve. Completion: report exact files created/changed and verification run.

## Rules

- Do not overwrite existing human-authored prompt files without preserving their intent.
- Do not include secrets, absolute paths, raw transcripts, or private task text in generated prompts.
- Keep each generated prompt file focused on one selected surface.
- Do not mix Claude Code, Pi, and Copilot instructions in a single prompt unless the prompt is explicitly about plugin-surface alignment.
- Make prompts runnable as copy/paste examples from the selected surface.
