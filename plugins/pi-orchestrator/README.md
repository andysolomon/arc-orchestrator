# ARC Orchestrator for Pi

This is a Pi package for ARC orchestration. It exposes a Codex-first orchestration skill and a reusable prompt template.

Codex 5.5 is the default parent orchestrator for this package. Fable is not required.

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
