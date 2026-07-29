# Fable Orchestrator Policy

## ARC Delegate v3

Use the lifecycle and ordered stacks in
`docs/orchestrator/arc-delegate.md`. Automatic runs pass
`--routing-policy runner-routing-v3 --phase <phase>` and omit explicit backend
and route pins. Implementation also passes one of the nine two-axis workload
classes. Analyze is required; other lifecycle stages are conditional. Never
enter Deploy without explicit user authorization, and pass
`--deploy-authorized true` only after receiving it.

## Capability Snapshot Rankings

This human-readable ranking surface is rendered from `plugins/orchestrator-core/capability-snapshot.json` (`2026-07-25+deepswe.v1.1+cursorbench.3.2`) and `MODEL_REGISTRY`; it is not an independent authority. Decision 0005 binds DeepSWE to `swe` and CursorBench to `agentic-edit`, so the columns are not averaged into one global score. The runner dispatches low, medium, high, or `none` rungs only; max/xhigh leaderboard columns must not be used here.

| Model | Backend | Snapshot rungs | SWE snapshot score | Agentic-edit snapshot score | Price band | Cost prior |
| --- | --- | --- | ---: | ---: | --- | ---: |
| `opus-5` | Claude Code | low, medium, high | 73% +/-2 (high) | 67% +/-3 (high) | $$$ | $6.08 (high) |
| `gpt-5.6-sol` | Codex (`codex exec`) | low, medium, high | 69% +/-1 (high) | 64% +/-3 (high) | $$ | $3.47 (high) |
| `fable-5` | Claude Code | low, medium, high | 69% +/-1 (high) | 67% +/-3 (high) | premium | $9.18 (high) |
| `gpt-5.5` | Codex (`codex exec`) | low, medium, high | 64% +/-3 (high) | 58% +/-3 (high) | $$ | $5.10 (high) |
| `gpt-5.6-terra` | Codex (`codex exec`) | low, medium, high | 54% +/-4 (high) | 54% +/-3 (high) | $ | $1.13 (high) |
| `opus-4.8` | Claude Code | low, medium, high | 52% +/-5 (high) | 58% +/-3 (high) | $$$ | $4.28 (high) |
| `sonnet-5` | Claude Code | low, medium, high | 48% +/-5 (high) | 57% +/-3 (high) | $$ | $7.43 (high) |
| `gpt-5.6-luna` | Codex (`codex exec`) | low, medium, high | 44% +/-3 (high) | 57% +/-3 (high) | $ | $0.78 (high) |
| `grok-4.5` | Cursor (`cursor-agent`) | none | - | 67% +/-3 (none) | $ | - |
| `composer-2.5` | Cursor (`cursor-agent`) | none | - | 56% +/-3 (none) | very-cheap | $0.44 (none) |

### How to Apply Routing Defaults

- These are defaults, not limits. If a cheaper model misses the bar, rerun or redo the work with a stronger model without asking. Judge the output, not the price tag.
- Use the capability snapshot for benchmark evidence and the registry/candidate stacks for dispatch authority.
- Use `composer-2.5` by default for bulk clear-spec implementation, migrations, mechanical refactors, and focused test additions.
- Use `gpt-5.5` at high reasoning effort unless `--effort` overrides as the default Codex model for harder implementation, repository analysis, difficult debugging, and escalation when Composer 2.5 misses the quality bar.
- Use `gpt-5.6-luna` only for high-volume, genuinely low-stakes Codex exploration such as log sifting, dependency tracing, and evidence gathering. Escalate to `gpt-5.5` whenever the result matters.
- `gpt-5.6-sol` is OpenAI's flagship on Codex. Sol has no explicit route alias — reach it through automatic Implement with `workload_class: hard-medium` or `hard-easy`, or a Codex model override such as `ARC_ORCHESTRATOR_IMPLEMENT_MODEL=gpt-5.6-sol`; `task_class` is observability metadata only.
- User-facing UI, copy, and API design are taste-sensitive. Fable chooses the direction; Codex may implement a precise approved specification.
- Use Fable 5 at high reasoning effort, or Opus 5, for reviews of plans and implementations. Use GPT-5.5 as an additional independent perspective when the risk justifies it.
- Do not use Haiku.

## Fable as Orchestrator, Specialized Models as Workers

Fable owns judgment. Cursor and Codex workers grind through bounded tasks and return compact evidence.

- `arc-delegate`: normal lifecycle worker; forwards phase and implementation complexity to runner-routing-v3 without provider pins.
- `composer-implement`: explicit single-candidate pin for a clear, approved Cursor Composer 2.5 implementation contract; not the normal default outside Eco mode.
- `--backend codex --mode implement`: handles harder implementation or reruns work that did not meet the bar through GPT-5.5 at high reasoning effort unless `--effort` overrides.
- `--backend codex --mode review`: independently checks correctness, regressions, security, and acceptance criteria through GPT-5.5 at high reasoning effort unless `--effort` overrides.
- `--backend codex --mode analyze`: performs token-heavy repository exploration and evidence gathering through GPT-5.6 Luna by default.
- `opus-explore`, `opus-check`, `opus-implement`: first-tier availability-fallback workers that forward to the `claude` backend (Opus 5) when Codex is unavailable or the parent explicitly routes there; not the default route and not the taste-review path (`opus-review`).
- `grok-explore`, `grok-check`, `grok-implement`: second-tier availability-fallback workers that forward to the `composer` backend with Grok 4.5 when Claude/Opus is unavailable; not the default route, not taste escalation, and not the taste-review path (`opus-review`).
- MiniMax is a key-gated Claude CLI backend (`--backend minimax`), not a public worker alias. Public `kimi-*` aliases and legacy v2 stacks use OpenCode. Runner-routing-v3 phase stacks use the direct Moonshot Kimi backend so medium/high/max effort can be selected.
- Fable reviews worker results, inspects important diffs and verification, and makes every final decision.

Use `/arc-orchestrator:setup` before the first delegated task in a new environment. Both backends must run as the normal user, never through `sudo`.

### Delegation Contract

Before spawning a worker, provide:

1. the exact outcome;
2. the files or subsystem in scope when known;
3. behavior that must remain unchanged;
4. required tests or verification;
5. prohibited actions and explicit scope boundaries.

Keep planning, architecture, ambiguity resolution, user interaction, and final synthesis in the Fable thread. Do not delegate quick edits or work that requires constant shared context.

### Mechanics

- Run the CC-Fable parent as Fable 5 at high reasoning effort (`high`). Do not run the parent at low or unspecified/default effort; do not use `xhigh` or `max` unless the user explicitly requests it or a failed high-effort attempt justifies escalation.
- Claude subagents only accept Claude models. Worker agents therefore use thin Sonnet wrappers at low effort, invoke one external CLI, and return its structured result. That low wrapper effort is worker-only and must never be applied to the CC-Fable parent.
- Composer 2.5 is reached through `cursor-agent --print --force --output-format json --model composer-2.5`.
- GPT-5.6 Luna, Terra, and Sol are reached through `codex exec`. Each local CLI's installation, authentication, and project configuration remain authoritative.
- Codex exploration and checks are read-only. Codex implementation is limited to workspace writes. Cursor Composer is only used for implementation because its headless write mode has no equivalent read-only sandbox.
- When Codex is unavailable (usage limit, auth failure, missing binary), the runner classifies the outage as `backend_unavailable` and emits a machine-readable fallback hint on stderr. Workers surface the hint verbatim; they never substitute silently.
- Tier 1 (Codex → Opus): re-delegate to `opus-explore`, `opus-check`, or `opus-implement`, or set `ARC_ORCHESTRATOR_FALLBACK=claude` (or `--fallback claude`) for opt-in automatic retry on the `claude` backend; linked trace records use `fallback_of`.
- Tier 2 (Opus → Grok): when Claude/Opus is also unavailable, re-delegate to `grok-explore`, `grok-check`, or `grok-implement` (composer backend with Grok 4.5). With `ARC_ORCHESTRATOR_FALLBACK=claude`, availability-classified Claude failures during that chain continue once on the composer Grok route. Grok is availability recovery, not taste escalation.
- Tier 3 (Grok → MiniMax): when a MiniMax key is configured (`ARC_ORCHESTRATOR_MINIMAX_API_KEY` or `MINIMAX_API_KEY`), an availability-classified Grok failure continues once on `--backend minimax` (Claude CLI against MiniMax's Anthropic-compatible endpoint; default `MiniMax-M3`).
- Tier 4 (MiniMax → Kimi, terminal): when a Kimi/Moonshot key is configured (`ARC_ORCHESTRATOR_KIMI_API_KEY`, `MOONSHOT_API_KEY`, or `KIMI_API_KEY`), the next availability outage continues once on direct `--backend kimi` (Claude CLI against Moonshot's Anthropic-compatible endpoint; default `kimi-k3[1m]`, `ANTHROPIC_AUTH_TOKEN`). Public `kimi-*` diagnostic aliases remain OpenCode-backed. Without MiniMax, a Grok outage can jump directly to Kimi. Kimi is always terminal.
- Parent-driven re-delegation records the switch via `annotate --escalated-to`. This is distinct from `opus-review` (taste) and from quality escalation after a completed run.
- Workers never commit, push, merge, deploy, or use unrestricted filesystem access.
- Treat worker output as evidence, not ground truth. Fable must verify consequential claims before shipping.

## Preferred Workflow

1. Fable clarifies the request and chooses an approach.
2. Delegate `--backend codex --mode analyze` only when investigation would be verbose or context-heavy.
3. Fable turns the evidence into a bounded implementation contract.
4. Spawn `composer-implement`.
5. Fable inspects the diff and focused verification. Escalate to `--backend codex --mode implement` if the work misses the bar.
6. Delegate `--backend codex --mode review` when independent review is worth the additional usage.
7. Fable resolves issues and reports the final result.
