# ARC Orchestrator for GitHub Copilot

This package contains copyable GitHub Copilot instructions and prompt files for Codex-first ARC orchestration.

Codex 5.6 Terra is the default parent orchestrator. Fable is not required.

## Install into a repository

```sh
mkdir -p .github/prompts
cp plugins/copilot-orchestrator/copilot-instructions.md .github/copilot-instructions.md
cp plugins/copilot-orchestrator/prompts/*.prompt.md .github/prompts/
```

## Files

- `copilot-instructions.md`: repository-level Copilot custom instructions.
- `prompts/orchestrate.prompt.md`: create a bounded delegation contract.
- `prompts/review.prompt.md`: create an independent read-only review contract.

## Runner

Cross-repo use works by default through the arc-orchestrator wrapper:

```sh
bin/arc-orchestrator
```

It resolves the runner automatically via an explicit `ARC_ORCHESTRATOR_BIN` override, `fable-orchestrator` on `PATH`, or the sibling `fable-orchestrator` package when co-installed.

`ARC_ORCHESTRATOR_BIN` is override-only. Set it only when you need a non-default runner path:

```sh
export ARC_ORCHESTRATOR_BIN=/absolute/path/to/fable-orchestrator
```
