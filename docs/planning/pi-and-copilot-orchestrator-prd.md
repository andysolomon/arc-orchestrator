# PRD: Pi and Copilot Orchestrator Plugins

## Context

The repository already ships a Claude Code marketplace plugin centered on Fable as the parent orchestrator. The next distribution targets are Pi and GitHub Copilot, where Fable must not be the default parent orchestrator. These plugins should make Codex 5.5 the default orchestrator while preserving the existing bounded-worker model and traceable CLI execution.

## Goal

Ship two installable/adoptable plugin surfaces:

1. a Pi package that exposes ARC orchestration guidance and reusable prompts;
2. a GitHub Copilot instruction/prompt pack that makes Copilot route bounded work through Codex-first orchestration.

Both must be documented, test-covered, and safe by default.

## Non-goals

- Replace the existing Claude/Fable plugin.
- Change the underlying worker CLI contract in this iteration.
- Add hosted telemetry or non-local secrets handling.
- Make Fable the default in Pi or Copilot surfaces.

## Requirements

- Codex 5.5 is named as the default parent/orchestration model for Pi and Copilot.
- The implementation routes bounded work to the existing `fable-orchestrator` runner until the binary is renamed in a separate migration.
- Plugin artifacts include setup, routing policy, task contract requirements, observability, and verification expectations.
- Tests assert package structure, manifests, prompt files, and the absence of Fable-default language in the new plugin surfaces.

## Acceptance Criteria

- `plugins/pi-orchestrator` contains a valid Pi package manifest, skill, and prompt template.
- `plugins/copilot-orchestrator` contains documented Copilot instructions and prompt files.
- README documents how to install/use both plugin surfaces.
- `bun test` passes.
- Changes are merged to `main` after review and validation.
