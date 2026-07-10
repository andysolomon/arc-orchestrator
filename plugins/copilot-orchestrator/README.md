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

The instructions currently reuse the existing runner:

```sh
./plugins/fable-orchestrator/bin/fable-orchestrator
```

Set `ARC_ORCHESTRATOR_BIN` when the runner lives elsewhere.
