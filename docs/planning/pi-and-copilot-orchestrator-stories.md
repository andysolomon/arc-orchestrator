# User Stories: Pi and Copilot Orchestrator Plugins

These stories follow the requested arc-planning-work, arc-defining-work, arc-prd-to-issues, and arc-creating-user-stories flow: define the outcome, turn it into implementation issues, and capture testable stories.

## Epic 1: Pi Plugin

### Story 1.1 — Installable Pi package

As a Pi user, I want to install an ARC orchestrator package so that Pi can load orchestration skills and prompts without Claude plugin support.

Acceptance criteria:
- Package has `keywords: ["pi-package"]`.
- Package manifest declares Pi skills and prompts.
- Package does not require Fable as the parent model.

### Story 1.2 — Codex-first orchestration skill

As a Pi user, I want a skill that tells the active agent how to delegate bounded work through Codex 5.5 so that difficult implementation and review happen through the intended default orchestrator.

Acceptance criteria:
- Skill name is `arc-orchestrator`.
- Skill names Codex 5.5 as the default orchestrator.
- Skill includes routing rules, task contract requirements, verification, and observability commands.

### Story 1.3 — Reusable Pi prompt

As a Pi user, I want a reusable prompt template for orchestration so that I can start a bounded delegation flow consistently.

Acceptance criteria:
- Prompt exists under the Pi package prompt directory.
- Prompt asks for outcome, scope, invariants, verification, and prohibited actions.

## Epic 2: Copilot Plugin

### Story 2.1 — Copilot instructions

As a GitHub Copilot user, I want repository instructions that define ARC orchestration policy so that Copilot knows Codex 5.5 is the default orchestrator.

Acceptance criteria:
- Instructions are copyable into `.github/copilot-instructions.md`.
- Instructions preserve user interaction and final judgment in the parent session.
- Instructions prohibit commits, pushes, deploys, and broad writes by workers.

### Story 2.2 — Copilot prompt files

As a GitHub Copilot user, I want prompt files for orchestration and review so that common workflows have consistent structure.

Acceptance criteria:
- At least one orchestration prompt exists.
- At least one review prompt exists.
- Prompts reference Codex 5.5 defaults and bounded contracts.

## Epic 3: Quality Gates

### Story 3.1 — Structural tests

As a maintainer, I want tests that assert plugin files and manifests remain valid so that future edits do not silently break distribution.

Acceptance criteria:
- Tests verify Pi package manifest shape.
- Tests verify Copilot files exist.
- Tests verify Codex 5.5 is the default in both new surfaces.
- Tests verify no new plugin surface describes Fable as the default orchestrator.
