# ARC Orchestrator for Pi

This is a Pi package for ARC orchestration. It exposes a Codex-first orchestration skill and a reusable prompt template.

Codex 5.6 Sol is the default parent orchestrator for this package. Fable is not required.

## GPT-5.6 worker routing

`gpt-5.6-luna` is the Codex analyze default. `gpt-5.6-terra` is the Codex
implement/review default for harder work. `gpt-5.6-sol` is the Codex
implement/review default for taste-sensitive task classes. Composer 2.5 remains
the default Cursor implementation worker; `FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol`
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

The package currently reuses the existing runner:

```sh
./plugins/fable-orchestrator/bin/fable-orchestrator
```

When installed elsewhere, set:

```sh
export ARC_ORCHESTRATOR_BIN=/absolute/path/to/fable-orchestrator
```

## Resources

- Skill: `/skill:arc-orchestrator`
- Prompt template: `/orchestrate` (symlinked from `plugins/orchestrator-core/prompts/pi-orchestrate.md`)
