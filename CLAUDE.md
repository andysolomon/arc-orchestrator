# Fable Orchestrator Policy

## Picking the Right Models for Workflows and Subagents

These are local operational heuristics, not vendor benchmarks. Higher is better. Usage headroom reflects practical subscription limits rather than API list price. Intelligence means how difficult a problem the model can handle unsupervised. Taste covers UI/UX, code quality, API design, and copy. Backend names the only surface the runner can invoke for that model; a model is never reachable through a backend not listed here.

| Model | Backend | Usage headroom | Intelligence | Taste |
| --- | --- | ---: | ---: | ---: |
| `composer-2.5` | Cursor (`cursor-agent`) | 10 | 7 | 6 |
| `gpt-5.6-luna` | Codex (`codex exec`) | 10 | 6 | 5 |
| `gpt-5.6-terra` | Codex (`codex exec`) | 10 | 8 | 6 |
| `gpt-5.5` | Codex (`codex exec`) | 9 | 8 | 5 |
| `gpt-5.6-sol` | Codex (`codex exec`) | 5 | 9 | 7 |
| `sonnet-5` | Claude Code | 5 | 5 | 7 |
| `opus-4.8` | Claude Code | 4 | 7 | 8 |
| `fable-5` | Claude Code (parent) | 2 | 9 | 9 |

GPT-5.6 placements: Terra matches GPT-5.5's intelligence while drawing roughly half the usage, and 5.6's shorter output and stronger layout/visual-hierarchy judgment lift its taste to 6, so it saturates the headroom scale alongside Composer. Luna is the lightweight tier — cheapest and fastest in the family, but a step down in what it can handle unsupervised. Sol is OpenAI's flagship with the highest reasoning ceiling on Codex; route Sol through Codex rather than Cursor so it can use Codex's read-only and workspace-write sandbox controls.

### How to Apply the Rankings

- These are defaults, not limits. If a cheaper model misses the bar, rerun or redo the work with a stronger model without asking. Judge the output, not the price tag.
- Usage headroom is a tie-breaker only. For anything that ships, prioritize intelligence, then taste, then usage efficiency.
- Use `composer-2.5` by default for bulk clear-spec implementation, migrations, mechanical refactors, and focused test additions.
- Use `gpt-5.5` at high reasoning effort unless `--effort` overrides as the default Codex model for harder implementation, repository analysis, difficult debugging, and escalation when Composer 2.5 misses the quality bar. Prefer `gpt-5.6-terra` when usage headroom matters more than depth: it matches `gpt-5.5` on intelligence with better layout judgment and terser output, at roughly half the usage draw.
- Use `gpt-5.6-luna` for high-volume, low-stakes Codex exploration — log sifting, dependency tracing, evidence gathering. Escalate to `gpt-5.5` when Luna misses.
- `gpt-5.6-sol` is OpenAI's flagship on Codex. Use explicit `sol-explore`/`sol-check`/`sol-implement` (or a model override) when Sol is required; `task_class` is observability metadata only and never selects a model. Keep routine Cursor work on `composer-2.5`. Automatic delegation omits `--backend`/`--route` and selects by mode plus `workload_class`.
- User-facing UI, copy, and API design require taste of at least 7. Fable chooses the direction; Codex may implement a precise approved specification.
- Use Fable 5 at high reasoning effort, or Opus 4.8, for reviews of plans and implementations. Use GPT-5.5 as an additional independent perspective when the risk justifies it.
- Do not use Haiku.

## Fable as Orchestrator, Specialized Models as Workers

Fable owns judgment. Cursor and Codex workers grind through bounded tasks and return compact evidence.

- `composer-implement`: executes a clear, approved implementation contract through Cursor Composer 2.5.
- `codex-implement`: handles harder implementation or reruns work that did not meet the bar through GPT-5.5 at high reasoning effort unless `--effort` overrides.
- `codex-check`: independently checks correctness, regressions, security, and acceptance criteria through GPT-5.5 at high reasoning effort unless `--effort` overrides.
- `codex-explore`: performs token-heavy repository exploration and evidence gathering through GPT-5.6 Luna by default.
- `opus-explore`, `opus-check`, `opus-implement`: first-tier availability-fallback workers that forward to the `claude` backend (Opus 4.8) when Codex is unavailable or the parent explicitly routes there; not the default route and not the taste-review path (`opus-review`).
- `grok-explore`, `grok-check`, `grok-implement`: second-tier availability-fallback workers that forward to the `composer` backend with Grok 4.5 when Claude/Opus is unavailable; not the default route, not taste escalation, and not the taste-review path (`opus-review`).
- MiniMax is a key-gated Claude CLI backend (`--backend minimax`), not a public worker alias. Public `kimi-*` aliases and automatic runner-routing-v2 stacks use OpenCode (`moonshotai/kimi-k3` via `--backend opencode`). Direct `--backend kimi` is the legacy/terminal Anthropic-compatible Claude CLI transport (`kimi-k3[1m]`). MiniMax and direct Kimi join the opt-in availability chain after Grok when their API keys are configured; direct Kimi is terminal.
- Fable reviews worker results, inspects important diffs and verification, and makes every final decision.

Use `/fable-orchestrator:setup` before the first delegated task in a new environment. Both backends must run as the normal user, never through `sudo`.

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
- Tier 4 (MiniMax → Kimi, terminal): when a Kimi/Moonshot key is configured (`ARC_ORCHESTRATOR_KIMI_API_KEY`, `MOONSHOT_API_KEY`, or `KIMI_API_KEY`), the next availability outage continues once on direct `--backend kimi` (Claude CLI against Moonshot's Anthropic-compatible endpoint; default `kimi-k3[1m]`, `ANTHROPIC_AUTH_TOKEN`). This is distinct from public `kimi-*` / automatic OpenCode (`moonshotai/kimi-k3`). Without MiniMax, a Grok outage can jump directly to Kimi. Kimi is always terminal.
- Parent-driven re-delegation records the switch via `annotate --escalated-to`. This is distinct from `opus-review` (taste) and from quality escalation after a completed run.
- Workers never commit, push, merge, deploy, or use unrestricted filesystem access.
- Treat worker output as evidence, not ground truth. Fable must verify consequential claims before shipping.

## Preferred Workflow

1. Fable clarifies the request and chooses an approach.
2. Spawn `codex-explore` only when investigation would be verbose or context-heavy.
3. Fable turns the evidence into a bounded implementation contract.
4. Spawn `composer-implement`.
5. Fable inspects the diff and focused verification. Escalate to `codex-implement` if the work misses the bar.
6. Spawn `codex-check` when independent review is worth the additional usage.
7. Fable resolves issues and reports the final result.
