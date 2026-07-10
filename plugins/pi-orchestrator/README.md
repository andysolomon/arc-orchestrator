# ARC Orchestrator for Pi

This is a Pi package for ARC orchestration. It exposes a Codex-first orchestration skill and a reusable prompt template.

Codex 5.5 is the default parent orchestrator for this package. Fable is not required.

## GPT-5.6 worker routing

`gpt-5.6-terra` and `gpt-5.6-luna` are Codex worker choices, selected with the
matching mode-specific Codex override. `gpt-5.6-sol` is Cursor-only and
write-capable for taste-sensitive implementation; it is never a Codex or
read-only route. Explicit model overrides always win, including
`FABLE_ORCHESTRATOR_COMPOSER_MODEL` over the taste-sensitive Sol default. Pi
remains Codex 5.5-first for its parent session.

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
