# ARC Orchestrator for Pi

This is a Pi package for ARC orchestration. It exposes a Codex-first orchestration skill and a reusable prompt template.

Codex 5.6 Terra is the default parent orchestrator for this package. Fable is not required.

## GPT-5.6 worker routing

`gpt-5.6-luna` is the Codex analyze default. `gpt-5.6-terra` is the Codex
implement/review default for harder work. `gpt-5.6-sol` is the Codex
implement/review default for taste-sensitive task classes. Composer 2.5 remains
the default Cursor implementation worker; `FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol`
is an explicit override escape hatch, not the default. Explicit model overrides
always win. Pi remains Codex 5.6 Terra-first for its parent session.

## Local use

From this repository:

```sh
pi install ./plugins/pi-orchestrator -l
pi /skill:arc-orchestrator
```

Or test without installing:

```sh
pi --no-session --skill ./plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md
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
- Prompt template: `/orchestrate`
