# ARC Orchestrator for Pi

This is a Pi package for ARC orchestration. It exposes a Codex-first orchestration skill and a reusable prompt template.

Codex 5.6 Sol is the default parent orchestrator for this package. Fable is not required.

## GPT-5.6 worker routing

`gpt-5.6-luna` is the Codex analyze default. `gpt-5.5` is the Codex
implement/review default for harder work at high reasoning effort unless
`--effort` overrides. `gpt-5.6-sol` is reached via explicit `sol-implement`
(or a model override); `task_class` never selects a model. Composer 2.5 remains
the default Cursor implementation worker; `ARC_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol`
is an explicit override escape hatch, not the default. Explicit model overrides
always win. Pi remains Codex 5.6 Sol-first for its parent session.

## Local use

From this repository:

```sh
pi install ./plugins/pi-orchestrator -l
pi /orchestrate "prepare a bounded repo-scan delegation contract"
# or load the skill directly:
pi /skill:arc-orchestrator "prepare a bounded repo-scan delegation contract"
```

Or test without installing:

```sh
pi --no-session --skill ./plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md \
  /skill:arc-orchestrator "prepare a bounded repo-scan delegation contract"
```

## Runner

Cross-repo use works by default through the package-local wrapper shipped with this package:

```sh
bin/arc-orchestrator
```

The wrapper resolves the underlying runner automatically: `fable-orchestrator` on `PATH`, the sibling `fable-orchestrator` package when co-installed, or an explicit override.

`ARC_ORCHESTRATOR_BIN` is override-only. Set it only when you need a non-default runner path:

```sh
export ARC_ORCHESTRATOR_BIN=/absolute/path/to/fable-orchestrator
```

## Resources

- Skill: `/skill:arc-orchestrator`
- Prompt template: `/orchestrate` (symlinked from `plugins/orchestrator-core/prompts/pi-orchestrate.md`)
