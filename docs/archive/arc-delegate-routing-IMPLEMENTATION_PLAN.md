# ARC Delegate routing v3 implementation plan

Mode: gap implementation. Arc Orchestrator already has typed automatic routing;
this change extends the existing contract.

## Product goal and scope boundaries

Implement the supplied ARC Delegate rankings and seven-stage workflow in
arc-orchestrator and arc-pi. Include executable routing, effort selection,
deployment HITL, generated surfaces, docs, and tests. Preserve legacy callers.
Do not push, merge, or deploy.

## Current baseline

Runner-routing-v2 provides canonical analyze/implement/review routes, seven
legacy implementation workload classes, explicit override precedence, trace
records, generated cross-surface docs, and Bun tests.

## Missing capabilities

- Seven lifecycle phases and phase/mode validation.
- Phase-specific candidate stacks and nine implementation complexity classes.
- Candidate-specific automatic effort.
- Explicit deploy authorization.
- Synchronized Arc Orchestrator and arc-pi contracts and documentation.

## Phase 1: Arc Orchestrator contract

Goal: make runner-routing-v3 executable.

Deliverables: typed phase schema, exact stacks, effort propagation, CLI guards,
routes schema v3, compatibility behavior, and tests.

Dependencies: locally installed backend model inventory. Risk: model display
names may not equal executable IDs; registry aliases must resolve that boundary.

Acceptance criteria: all supplied rankings are represented in order, phase/mode
mismatches fail closed, deploy lacks implicit authority, and legacy tests remain
green.

## Phase 2: Documentation and generated surfaces

Goal: make the workflow discoverable and consistent across parent surfaces.

Deliverables: generated ARC Delegate policy, updated orchestrate skills/prompts,
README/context/architecture guidance, and lifecycle task artifacts.

Dependencies: generated surface source must be edited before generated files.
Risk: hand-edited generated files drift.

Acceptance criteria: `bun run generate:surfaces` is clean and docs state the
exact stacks, artifact paths, optional stages, and HITL rule.

## Phase 3: arc-pi parity

Goal: expose the same phase/workload contract through Pi.

Deliverables: routes, delegate input validation, runner arguments, tool schema,
docs/default prompts, and tests.

Dependencies: preserve unrelated dirty-worktree changes. Risk: overlapping user
edits require small surgical patches.

Acceptance criteria: Pi selects the same phase/mode/workload policy, forwards
runner-routing-v3, and refuses unauthorized deploy.

## Phase 4: Verification and archival

Goal: prove both repositories are coherent.

Deliverables: focused tests, full available suites, typecheck/lint/build where
defined, diff review, synchronized progress, and archived plan artifacts.

Dependencies: arc-orchestrator's linked `arc-contracts` package is available in
the original checkout. Risk: unrelated pre-existing failures must be separated
from regressions.

Acceptance criteria: relevant checks pass or every unrelated blocker is
identified with evidence; completed plan/progress files move to `docs/archive/`.

## Out of scope

Pushing, merging, deploying, changing secrets, removing legacy workload
classes, or inventing unsupported effort controls.

## Immediate next steps

Completed 2026-07-28: generated surfaces are consistent, all 827 runnable tests
pass with one environment-gated skip, and arc-pi passes all 164 tests. The plan
and synchronized tracker are archived.
