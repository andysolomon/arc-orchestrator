---
name: orchestrate
description: Route bounded work from Claude Fable, the default/recommended parent orchestrator, to Cursor Composer 2.5 or Codex worker agents. Use proactively when a self-contained implementation, verbose codebase exploration, or independent check would preserve Fable context. If the user explicitly wants Opus or another current Claude Code model to orchestrate without Fable, use orchestrate-with-model instead.
argument-hint: "<task to route>"
allowed-tools: Agent
---

# Fable Orchestrator

Use this skill to preserve Fable's context and usage budget by delegating bounded work to thin Cursor Composer 2.5 or Codex worker agents. Fable remains the default/recommended parent orchestrator; use `orchestrate-with-model` when the user explicitly wants Opus or another current Claude Code model to orchestrate without Fable. The CC-Fable parent must be Fable 5 at high reasoning effort (`high`); do not use low or unspecified/default effort for the parent session.

## ARC Delegate lifecycle

Use runner-routing-v3 and pass the current lifecycle phase on every automatic
run: `explore`, `analyze`, `research`, `plan`, `implement`, `verify`, or
`deploy`. Read the generated
[routing policy](references/routing-policy.md#arc-delegate-phase-policy-runner-routing-v3)
for the exact ordered candidate stacks and implementation complexity matrix.

1. Explore only when necessary and write `docs/<task-name>/explore.md`.
2. Always analyze the request and write `docs/<task-name>/analyze.md`.
3. Research only when local evidence is insufficient; write
   `docs/<task-name>/research.md`.
4. Plan only for non-trivial work; write `docs/<task-name>/plan.md`.
5. Implement using one of the nine complexity classes from `hard-hard` through
   `easy-easy`.
6. Verify with the relevant unit, e2e, typecheck, lint, build, and performance
   checks; synchronize and strike through completed plan items.
7. Deploy only after explicit human authorization. Invoke deploy with
   `--phase deploy --deploy-authorized true`, monitor the result, and write
   `docs/<task-name>/build_error.md` or `build_success.md`. Loop failures back
   to planning or implementation.

Analyze is required. Explore, research, plan, verify, and deploy remain
conditional on the task. The parent persists lifecycle artifacts after
read-only workers return their evidence.

## Operating Model

1. Keep planning, task decomposition, ambiguity resolution, and final decisions in the main Fable conversation.
2. Delegate only a self-contained task with explicit boundaries and a verifiable completion condition.
3. Choose exactly one worker:
   - `arc-orchestrator:arc-delegate`: default worker for automatic runner-routing-v3. Pass the lifecycle phase and, for implementation, the nine-cell workload class. This neutral wrapper omits backend, route, model, and effort pins so the ordered candidate stack selects naturally.
   - `arc-orchestrator:composer-implement`: explicit single-candidate Cursor Composer 2.5 pin for operator-requested or diagnostic use; write-capable. It is not the normal implementation default. Eco mode still selects it as that mode's fixed implementation route.
   - `arc-orchestrator:opus-review`: high-taste read-only review for UI/UX, API design, architecture, copy, docs, prompts, and skill wording; Opus 5.
   - `arc-orchestrator:opus-explore`: availability fallback for read-only exploration when Codex is unavailable or the parent explicitly routes to Opus 5; not the default route.
   - `arc-orchestrator:opus-check`: availability fallback for read-only review when Codex is unavailable or the parent explicitly routes to Opus 5; not the default route.
   - `arc-orchestrator:opus-implement`: first-tier availability fallback for implementation when Codex is unavailable or the parent explicitly routes to Opus 5; not the default route.
   - `arc-orchestrator:grok-explore`: second-tier availability fallback for read-only exploration when Claude/Opus is unavailable; not the default route.
   - `arc-orchestrator:grok-check`: second-tier availability fallback for read-only review when Claude/Opus is unavailable; not the default route.
   - `arc-orchestrator:grok-implement`: second-tier availability fallback for implementation when Claude/Opus is unavailable; not the default route.
4. Invoke `arc-delegate` through the `Agent` tool for normal lifecycle work. Invoke a named provider worker only when the user or an explicit recovery policy requests that pin.
5. Treat the returned JSON as worker evidence, not ground truth.
6. Inspect relevant diffs and verification evidence before accepting implementation work.
7. Report the final conclusion yourself. Do not forward raw worker output when a shorter synthesis is sufficient.
8. After judging a worker run, record the outcome so routing stays measurable: `arc-orchestrator annotate --run latest --outcome <accepted|rejected|blocked|verification-failed|escalated>` (add `--escalated-to <model>` when escalating). Skip this only when tracing is disabled.
9. When a worker reports `backend_unavailable` with a fallback hint on stderr, re-delegate along the availability chain: Codex outages → matching `opus-*` worker (or `run --backend claude`); Claude/Opus outages → matching `grok-*` worker (or `run --backend composer --route grok-*`). Record `annotate --outcome escalated --escalated-to <model>` on the failed run, or annotate the fallback run's outcome, so routing stays measurable. Do not silently substitute; Grok is availability recovery, not taste escalation and not a substitute for `opus-review`.

## Shipping authority

Workers never commit, push, merge, deploy, or mutate GitHub. There are no
mechanical worker routes or aliases. When shipping is explicitly authorized, the
parent performs the approved operation directly after reviewing worker evidence.

## Parallel Delegation

Sequential delegation is the default. When tasks are genuinely independent, read-only workers (`opus-explore`, `opus-check`, `opus-review`, `grok-explore`, `grok-check`, and automatic analyze/review runs) may run concurrently. Never run two write-capable workers against the same checkout: the runner serializes write-capable runs per project and fails the second one; for concurrent implementation, give each worker its own worktree.

## Task Prompt Requirements

The delegated task must state:

- the intended outcome;
- the files or subsystem in scope when known;
- behavior that must not change;
- required tests or verification;
- explicit prohibitions for workers, including no commits, pushes, GitHub mutations, deployments, or unrelated refactors.

If the task cannot be bounded without additional user input, do not delegate it yet.

## Route Selection

Read [references/routing-policy.md](references/routing-policy.md) when the worker or backend is unclear or the task mixes multiple phases.

The user-supplied task is:

`$ARGUMENTS`
