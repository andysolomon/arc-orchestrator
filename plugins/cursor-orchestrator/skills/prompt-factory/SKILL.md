---
name: prompt-factory
description: Scan a repository and create docs/orchestrator prompt files with Cursor-oriented copy/paste examples that preserve the three-tier high-reasoning parent availability chain. Use Pi or Copilot examples only when requested.
---

# Orchestrator Prompt Factory

Create repo-specific prompt files under `docs/orchestrator/` as copy/paste examples for the user's active orchestrator surface. Default to the Cursor surface when this skill is invoked from Cursor; switch to Pi or Copilot only when the user asks for that surface.

Shared orchestrator wording comes from [plugins/orchestrator-core/prompt-factory.ts](../../../orchestrator-core/prompt-factory.ts). Generated Cursor prompts must preserve the exact ordered parent availability chain CC-Fable → Codex 5.6 Sol → Cursor-Fable-High. Run every parent in this availability chain at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control. Planning, ambiguity resolution, route selection, final judgment, and user communication stay in the active parent chat.

## Steps

1. **Inventory.** Scan project shape with read-only commands: directories, package manifests, test scripts, plugin surfaces, skills, docs, CI, and notable entrypoints. Completion: you can name the primary languages/frameworks, test commands, plugin surfaces, and documentation sources.
2. **Pick the surface.** Use Cursor when the user is in Cursor or does not specify a surface. Use Pi or Copilot only when requested. Completion: the generated prompt examples use exactly one primary surface unless the task is explicitly about comparing plugin surfaces.
3. **Classify prompts.** Choose only prompt files that match repo signals. Completion: every chosen prompt has a route, audience, and concrete use case for the selected surface.
4. **Centralize.** Update shared wording in `plugins/orchestrator-core/prompt-factory.ts` before editing individual prompt files when repeated orchestrator text drifts. Completion: repeated orchestrator wording has one obvious source of truth.
5. **Generate.** Ensure `docs/` and `docs/orchestrator/` exist, then write concise `.md` files that are primarily copy/paste examples, not long explanations. For Cursor, use Cursor chat and `/orchestrate`-style delegation examples—not Claude Code slash commands. Completion: every generated file gives multiple copy/paste commands for the selected surface, with labels and safety boundaries embedded in the examples.
6. **Quality review.** Challenge each generated prompt for usefulness, ambiguity, missing scope boundaries, missing verification, and documentation drift when local docs exist. Completion: every generated prompt is something a user could copy into the selected surface and immediately understand how to use.
7. **Verify.** Run existing lightweight tests or docs checks when available; otherwise verify files exist and links resolve. Completion: report exact files created/changed and verification run.

## Rules

- Do not overwrite existing human-authored prompt files without preserving their intent.
- Do not include secrets, absolute paths, raw transcripts, or private task text in generated prompts.
- Keep each generated prompt file focused on one selected surface.
- Do not mix Cursor, Claude Code, Pi, and Copilot instructions in a single prompt unless the prompt is explicitly about plugin-surface alignment.
- Make prompts runnable as copy/paste examples from the selected surface.
- Preserve the exact ordered Cursor parent availability chain: CC-Fable → Codex 5.6 Sol → Cursor-Fable-High.
- Require every Cursor parent tier to use high reasoning via `--effort high` or the surface-equivalent reasoning-effort control; never use low or unspecified/default reasoning for a parent.
- Delegate only bounded worker tasks and keep planning and final synthesis in the active parent chat.
