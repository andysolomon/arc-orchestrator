# Fable Orchestrator Policy

## Picking the Right Models for Workflows and Subagents

These are local operational heuristics, not vendor benchmarks. Higher is better. Usage headroom reflects practical subscription limits rather than API list price. Intelligence means how difficult a problem the model can handle unsupervised. Taste covers UI/UX, code quality, API design, and copy. Backend names the only surface the runner can invoke for that model; a model is never reachable through a backend not listed here.

| Model | Backend | Usage headroom | Intelligence | Taste |
| --- | --- | ---: | ---: | ---: |
| `composer-2.5` | Cursor (`cursor-agent`) | 10 | 7 | 6 |
| `gpt-5.6-luna` | Codex (`codex exec`) | 10 | 6 | 5 |
| `gpt-5.6-terra` | Codex (`codex exec`) | 10 | 8 | 6 |
| `gpt-5.5` | Codex (`codex exec`) | 9 | 8 | 5 |
| `gpt-5.6-sol` | Cursor (`cursor-agent --model`) | 5 | 9 | 7 |
| `sonnet-5` | Claude Code | 5 | 5 | 7 |
| `opus-4.8` | Claude Code | 4 | 7 | 8 |
| `fable-5` | Claude Code (parent) | 2 | 9 | 9 |

GPT-5.6 placements: Terra matches GPT-5.5's intelligence while drawing roughly half the usage, and 5.6's shorter output and stronger layout/visual-hierarchy judgment lift its taste to 6, so it saturates the headroom scale alongside Composer. Luna is the lightweight tier — cheapest and fastest in the family, but a step down in what it can handle unsupervised. Sol is OpenAI's flagship with the highest reasoning ceiling on either external backend, but it burns flagship-priced Cursor usage, so its headroom sits at 5; in this app it is reachable only through Cursor, not Codex.

### How to Apply the Rankings

- These are defaults, not limits. If a cheaper model misses the bar, rerun or redo the work with a stronger model without asking. Judge the output, not the price tag.
- Usage headroom is a tie-breaker only. For anything that ships, prioritize intelligence, then taste, then usage efficiency.
- Use `composer-2.5` by default for bulk clear-spec implementation, migrations, mechanical refactors, and focused test additions.
- Use `gpt-5.6-terra` as the default Codex model for harder implementation, repository analysis, difficult debugging, and escalation when Composer 2.5 misses the quality bar: it matches `gpt-5.5` on intelligence with better layout judgment, and its shorter output fits workers that must return compact evidence. Prefer `gpt-5.5` only as an independent second perspective or when Terra's terser output drops detail a review needs.
- Use `gpt-5.6-luna` for high-volume, low-stakes Codex exploration — log sifting, dependency tracing, evidence gathering. Escalate to Terra when Luna misses.
- `gpt-5.6-sol` is OpenAI's flagship, yet in this app it is reachable only through Cursor (`cursor-agent --model gpt-5.6-sol`), whose headless mode is write-capable implementation only — never route Sol to read-only exploration or checks. Use it when a Cursor-surface task outgrows `composer-2.5` in difficulty or design judgment; Sol's layout and visual-hierarchy judgment improves on Composer's, though Fable still chooses the direction.
- User-facing UI, copy, and API design require taste of at least 7. Fable chooses the direction; Codex may implement a precise approved specification.
- Use Fable 5 or Opus 4.8 for reviews of plans and implementations. Use GPT-5.5 as an additional independent perspective when the risk justifies it.
- Do not use Haiku.

## Fable as Orchestrator, Specialized Models as Workers

Fable owns judgment. Cursor and Codex workers grind through bounded tasks and return compact evidence.

- `composer-implement`: executes a clear, approved implementation contract through Cursor Composer 2.5.
- `codex-implement`: handles harder implementation or reruns work that did not meet the bar through GPT-5.5.
- `codex-check`: independently checks correctness, regressions, security, and acceptance criteria through GPT-5.5.
- `codex-explore`: performs token-heavy repository exploration and evidence gathering through a faster Codex profile.
- `opus-explore`, `opus-check`, `opus-implement`: availability-fallback workers that forward to the `claude` backend (Opus 4.8) when Codex is unavailable or the parent explicitly routes there; not the default route and not the taste-review path (`opus-review`).
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

- Run Fable 5 at `high` effort by default. Do not use `xhigh` or `max` unless the user explicitly requests it or a failed high-effort attempt justifies escalation.
- Claude subagents only accept Claude models. Worker agents therefore use thin Sonnet wrappers at low effort, invoke one external CLI, and return its structured result.
- Composer 2.5 is reached through `cursor-agent --print --force --output-format json --model composer-2.5`.
- GPT-5.5 is reached through `codex exec`. Each local CLI's installation, authentication, and project configuration remain authoritative.
- Codex exploration and checks are read-only. Codex implementation is limited to workspace writes. Cursor Composer is only used for implementation because its headless write mode has no equivalent read-only sandbox.
- When Codex is unavailable (usage limit, auth failure, missing binary), the runner classifies the outage as `backend_unavailable` and emits a machine-readable fallback hint on stderr. Workers surface the hint verbatim; they never substitute silently.
- Opt-in automatic retry: `FABLE_ORCHESTRATOR_FALLBACK=claude` (or `--fallback claude`) retries an availability-classified failure exactly once on the `claude` backend and links trace records through `fallback_of`.
- Parent-driven re-delegation uses `opus-explore`, `opus-check`, or `opus-implement` (or `run --backend claude`) and records the switch via `annotate --escalated-to`. This is distinct from `opus-review` (taste) and from quality escalation after a completed run.
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
