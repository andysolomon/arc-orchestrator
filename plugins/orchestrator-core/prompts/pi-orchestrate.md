---
description: Use ARC orchestration with Codex 5.6 Sol as the default parent orchestrator
argument-hint: "<task>"
---
Use ARC orchestration with Codex 5.6 Sol as the default parent orchestrator.

## ARC Delegate phase policy (runner-routing-v3)

ARC Delegate routes by lifecycle phase. Pass `--phase <phase>`, omit
`--backend` and `--route`, and let the ordered stack select the first
available candidate. Explicit backend/model/route overrides still win.

| Phase | Ordered candidates |
| --- | --- |
| Explore | CC Opus 5 (high) → Moonshot Kimi K3 (high) → Cursor Grok 4.5 (high) → Codex Sol (high) |
| Analyze | CC Fable (high) → Codex Sol (high) → Moonshot Kimi K3 (max) → Cursor Fable (high) → Cursor Grok 4.5 (high) → MiniMax M3 (max) → Cursor Composer |
| Research | Codex Sol (high) → CC Fable (high) → Moonshot Kimi K3 (max) → CC Opus 5 (high) → Cursor Grok 4.5 (high) |
| Plan | CC Fable (high) → Codex Sol (high) → Cursor Fable (high) → Moonshot Kimi K3 (max) → CC Opus 5 (high) → Cursor Grok 4.5 (high) |
| Verify | CC Opus 5 (low) → CC Opus 4.8 (low) → Codex GPT-5.5 (low) → Cursor Grok 4.5 (low) → MiniMax M3 (low) → Cursor Composer |
| Deploy | Codex GPT-5.5 (low) → CC Opus 4.8 (low) → Cursor Grok 4.5 (low) → MiniMax M3 (low) → Cursor Composer |

Implementation additionally requires `--workload-class`:

| Complexity | Ordered candidates |
| --- | --- |
| Hard–Hard | CC Fable (high) → Codex Sol 5.6 (high) → Cursor Fable (high) → Moonshot Kimi K3 (max) → Cursor Grok 4.5 (high) |
| Hard–Medium | Codex Sol 5.6 (high) → CC Fable (high) → Cursor Fable (high) → Moonshot Kimi K3 (high) |
| Hard–Easy | Codex Sol 5.6 (medium) → CC Fable (medium) → Cursor Fable (medium) → Moonshot Kimi K3 (max) |
| Medium–Hard | Codex Sol (high) → Moonshot Kimi K3 → CC Opus 5 (high) → Cursor Sol (high) → Cursor Grok 4.5 (high) |
| Medium–Medium | CC Opus 5 (high) → Moonshot Kimi K3 (max) → Codex Sol (high) → Cursor Grok 4.5 (high) |
| Medium–Easy | CC Opus 5 (high) → Moonshot Kimi K3 (max) → Codex Terra (high) → Cursor Grok 4.5 (high) |
| Easy–Hard | Codex Terra (medium) → Moonshot Kimi K3 (medium) → Cursor Grok 4.5 (high) |
| Easy–Medium | Codex GPT-5.5 (high) → CC Opus 4.8 (high) → Cursor Composer |
| Easy–Easy | Codex GPT-5.5 (low) → CC Opus 4.8 (low) → MiniMax M3 (high) → Cursor Composer |

Cursor Composer has no independently selectable effort control, so an effort
shown for Composer in product guidance is recorded as transport-default rather
than fabricated in traces.

### Orchestration lifecycle

1. **Explore (optional):** only when missing context makes it necessary. Learn the domain model, conventions, and relevant code. Write `docs/<task-name>/explore.md`.
2. **Analyze (required):** analyze the request and actual problem using exploration evidence when present. Write `docs/<task-name>/analyze.md`.
3. **Research (optional):** use GitHub CLI or web sources only when local evidence is insufficient. Write `docs/<task-name>/research.md`.
4. **Plan (optional):** skip for a simple, bounded change; otherwise write `docs/<task-name>/plan.md`.
5. **Implement (required):** select one of the nine complexity classes and implement from the accumulated artifacts.
6. **Verify (optional):** run relevant unit, end-to-end, typecheck, lint, build, and performance-smoke checks; synchronize plan todos and strike through completed plan steps.
7. **Deploy (optional, HITL):** enter only after explicit user authorization. Monitor CI/deployment and loop back to plan or implementation when needed. Write `docs/<task-name>/build_error.md` for failures or `docs/<task-name>/build_success.md` after success.

The CLI enforces the phase/mode pairing and requires
`--deploy-authorized true` for the deploy phase. Supplying that flag records
authorization for this runner invocation; it does not infer permission from a
plan, environment, or prior worker run.

Task to prepare for delegation:

$ARGUMENTS

Before delegating, produce a bounded contract with:

1. exact outcome;
2. files or subsystems in scope;
3. behavior that must remain unchanged;
4. required tests or verification;
5. prohibited actions, especially no commits, pushes, merges, deployments, secret edits, or unrelated refactors;
6. the lifecycle phase and, for Implement, one of the nine ARC Delegate complexity classes. Use automatic runner-routing-v3 without backend, route, model, or effort pins. Named Codex, Composer, and Opus routes are explicit overrides. `ARC_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit Composer override, not the default. Explicit model overrides always win;
7. a short safe label for traces.

## Eco Orchestrator Mode

Eco orchestrator mode is an explicit opt-in economy mode. Activate the runner policy on each call with `--orchestrator eco`, or set `ARC_ORCHESTRATOR_ORCHESTRATOR=eco` for the session. The CLI flag takes precedence over the environment. On Pi, this selects the economy worker routes but does not turn the current chat into an Eco parent. True Eco-parent orchestration requires Cursor: open an active Cursor Composer chat and select the same runner identity there.

Fixed opt-in economy tree: (O) Eco -> opus-explore [| grok-explore] -> composer-implement -> opus-check [| grok-check].

With that identity selected, the runner maps `analyze` to `opus-explore`, `implement` to `composer-implement`, and `review` to `opus-check`. Analyze/review availability failures retry once on `grok-explore` / `grok-check`. Do not supply conflicting `--backend` or `--route` values. This opt-in does not change the surface's default parent, normal routing, or non-economy activation.

## Shipping authority

Workers are prohibited from commits, pushes, merges, GitHub mutations, and deployment. There are no mechanical worker routes or aliases. When the user authorizes shipping, the parent orchestrator performs the authorized `git` or `gh` operation directly after reviewing worker evidence.

If the task is ambiguous, ask clarifying questions instead of delegating.
