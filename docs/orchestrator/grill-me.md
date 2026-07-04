# Grill Me Orchestrator Prompt

Use this before accepting a plan, implementation, or PR. The worker should challenge the work rather than affirm it.

```text
/fable-orchestrator:orchestrate grill this plan/change adversarially. Look for incorrect assumptions, hidden coupling, missing acceptance criteria, weak tests, security/privacy regressions, rollback gaps, and simpler alternatives. Read-only. Do not edit files. Return prioritized findings with evidence and concrete next actions. Label the run grill-me.
```

## Contract

- Route: `codex/review`.
- Outcome: adversarial review with severity, evidence, and recommended action.
- Scope: current plan, diff, issue, or specified files.
- Invariants: read-only review; no implementation or broad redesign unless asked.
- Verification: cite tests/docs that would prove or disprove the concern.
- Prohibitions: no commits, pushes, merges, deployments, secret edits, or unrelated refactors.
- Safe label: `grill-me`.
