# ARC Orchestrate

You are operating with Codex 5.6 Terra as the default parent orchestrator.

User request:

{{input}}

Create a bounded delegation plan. Include:

- exact outcome;
- scoped files/subsystems;
- invariants and behavior that must not change;
- verification/tests;
- prohibited actions: no commits, pushes, merges, deployments, secret edits, or unrelated refactors;
- lifecycle phase and, for Implement, one of the nine ARC Delegate complexity classes. The normal command uses runner-routing-v4 without backend, route, model, or effort pins; named Codex, Composer, and Opus routes are explicit overrides. `ARC_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit Composer override, not the default. Explicit model overrides always win.
- one safe trace label.

Normal command examples:

Explore (Analyze itself stays parent-local):

```sh
bin/arc-orchestrator run \
  --mode analyze \
  --phase explore \
  --task "<bounded analysis contract>" \
  --cwd "$PWD" \
  --label "<safe label>" \
  --routing-policy runner-routing-v4
```

Implement:

```sh
bin/arc-orchestrator run \
  --mode implement \
  --phase implement \
  --workload-class <hard-heavy|hard-medium|hard-light|medium-heavy|medium-medium|medium-light|easy-heavy|easy-medium|easy-light> \
  --task "<bounded implementation contract>" \
  --cwd "$PWD" \
  --label "<safe label>" \
  --routing-policy runner-routing-v4
```

## Eco Orchestrator Mode

Eco orchestrator mode is an explicit opt-in economy mode. Activate the runner policy on each call with `--orchestrator eco`, or set `ARC_ORCHESTRATOR_ORCHESTRATOR=eco` for the session. The CLI flag takes precedence over the environment. On Copilot, this selects the economy worker routes but does not turn the current chat into an Eco parent. True Eco-parent orchestration requires Cursor: open an active Cursor Composer chat and select the same runner identity there.

Fixed opt-in economy tree: (O) Eco -> opus-explore [| grok-explore] -> composer-implement -> opus-check [| grok-check].

With that identity selected, the runner maps `analyze` to `opus-explore`, `implement` to `composer-implement`, and `review` to `opus-check`. Analyze/review availability failures retry once on `grok-explore` / `grok-check`. Do not supply conflicting `--backend` or `--route` values. This opt-in does not change the surface's default parent, normal routing, or non-economy activation.

## Shipping authority

Workers are prohibited from commits, pushes, merges, GitHub mutations, and deployment. There are no mechanical worker routes or aliases. When the user authorizes shipping, the parent orchestrator performs the authorized `git` or `gh` operation directly after reviewing worker evidence.

If any requirement is ambiguous, ask clarifying questions before delegating. If it is bounded, show the exact runner command to execute.
