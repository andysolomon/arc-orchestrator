# ARC Orchestrator Instructions for GitHub Copilot

Use these instructions as `.github/copilot-instructions.md` in repositories that should use ARC orchestration.

## Default Orchestrator

Codex 5.6 Terra is the default parent orchestrator. Do not treat Fable as the default or required orchestrator for this workflow.

## Runner

Invoke the arc-orchestrator wrapper. It resolves the runner automatically via an explicit `ARC_ORCHESTRATOR_BIN` override, `fable-orchestrator` on `PATH`, or the sibling `fable-orchestrator` package when co-installed:

```sh
bin/arc-orchestrator
```

`ARC_ORCHESTRATOR_BIN` is override-only: set it only when you need a non-default runner path. When set, it must point to an executable runner; the wrapper does not fall through to other candidates.

## Operating Model

- Keep planning, architecture, ambiguity resolution, user interaction, and final acceptance in the parent Copilot session.
- Delegate only bounded, self-contained work with explicit scope and verification requirements.
- Use the arc-orchestrator wrapper for worker execution when available.
- Treat worker output as evidence, not truth. Inspect important diffs and verification before accepting.
- Never instruct workers to commit, push, merge, deploy, edit secrets, or touch unrelated files.

## Routing

- `codex/analyze`: read-only exploration, repository mapping, evidence gathering; defaults to GPT-5.6 Luna.
- `codex/implement`: default difficult implementation route through GPT-5.5 with workspace-write access.
- `codex/review`: independent read-only review through GPT-5.5.
- `composer/implement`: optional clear, mechanical bulk implementation through Composer 2.5 when the contract is already approved.
- `claude/analyze`, `claude/review`, `claude/implement`: first-tier availability fallback through `--backend claude` (Opus 4.8) when Codex is unavailable or the parent explicitly routes there. Set `FABLE_ORCHESTRATOR_FALLBACK=claude` for opt-in automatic retry on availability-classified Codex failures.
- `grok/analyze`, `grok/review`, `grok/implement`: second-tier availability fallback through `--backend composer --route grok-*` (Grok 4.5) when Claude/Opus is also unavailable. Grok is availability recovery, not taste escalation and not a substitute for `opus-review`.

## GPT-5.6 Worker Routing

- `gpt-5.6-luna`: Codex analyze default for high-volume, low-stakes exploration and evidence gathering.
- `gpt-5.5`: Codex implement/review default for harder implementation, debugging, escalation, and routine checks at high reasoning effort unless `--effort` overrides.
- `gpt-5.6-sol`: explicit `sol-explore`/`sol-check`/`sol-implement` Codex diagnostic routes for flagship Sol; `task_class` never selects this model.
- Composer 2.5 remains the default Cursor implementation worker; `FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit override escape hatch, not the default.
- Explicit model overrides always win.

Copilot intentionally remains Codex 5.6 Terra-first for parent orchestration. It can
invoke the Cursor implementation backend for a bounded task, but that does not
make Sol a Copilot parent model.

## Eco Orchestrator Mode

Eco orchestrator mode is an explicit opt-in economy mode. Activate the runner policy on each call with `--orchestrator eco`, or set `FABLE_ORCHESTRATOR_ORCHESTRATOR=eco` for the session. The CLI flag takes precedence over the environment. On Copilot, this selects the economy worker routes but does not turn the current chat into an Eco parent. True Eco-parent orchestration requires Cursor: open an active Cursor Composer chat and select the same runner identity there.

Fixed opt-in economy tree: (O) Eco -> opus-explore [| grok-explore] -> composer-implement -> opus-check [| grok-check].

With that identity selected, the runner maps `analyze` to `opus-explore`, `implement` to `composer-implement`, and `review` to `opus-check`. Analyze/review availability failures retry once on `grok-explore` / `grok-check`. Do not supply conflicting `--backend` or `--route` values. This opt-in does not change the surface's default parent, normal routing, or non-economy activation.

## Shipping authority

Workers are prohibited from commits, pushes, merges, GitHub mutations, and deployment. There are no mechanical worker routes or aliases. When the user authorizes shipping, the parent orchestrator performs the authorized `git` or `gh` operation directly after reviewing worker evidence.

## Delegation Contract

Before invoking a worker, define:

1. exact outcome;
2. files or subsystem in scope;
3. behavior that must remain unchanged;
4. tests or verification to run;
5. prohibited actions and scope boundaries;
6. short safe label for trace records.

## Observability

Inspect local traces with:

```sh
bin/arc-orchestrator runs --limit 10
```

Local traces record backend, mode, resolved model, sandbox, duration, token usage, status, changed-file count, project hash, and optional label. They must not include prompts, secrets, file contents, or absolute paths.
