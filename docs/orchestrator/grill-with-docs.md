# Grill With Docs Orchestrator Prompt

Use this when the repository has docs, PRDs, specs, or architecture notes that should constrain the work.

```text
/fable-orchestrator:orchestrate grill this plan/change against the project documentation. Read the relevant docs first, then identify drift, unsupported assumptions, missing documentation updates, acceptance criteria mismatches, and test gaps. Read-only. Do not edit files. Label the run grill-with-docs.
```

## Contract

- Route: `codex/review`.
- Outcome: documentation-grounded critique and required doc/test follow-ups.
- Scope: specified plan/change plus relevant files under `docs/`, README files, plugin instructions, and linked specs.
- Invariants: do not treat stale docs as automatically correct; flag doc/code disagreements explicitly.
- Verification: cite exact docs and commands that should validate the conclusion.
- Prohibitions: no commits, pushes, merges, deployments, secret edits, or unrelated refactors.
- Safe label: `grill-with-docs`.
