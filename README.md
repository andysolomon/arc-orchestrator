# Fable Orchestrator

Fable Orchestrator is a Claude Code marketplace plugin that keeps Claude Fable 5 focused on planning, judgment, and final review while delegating bounded execution to Cursor Composer 2.5 and Codex.

```text
                              Claude Fable 5
                         planning and final judgment
                                      |
             +------------------------+------------------------+
             |                        |                        |
    composer-implement         codex-implement        codex-explore/check
     Composer 2.5                GPT-5.5/Sol              GPT-5.6 Luna
   routine implementation     difficult escalation      analysis and review
```

Fable decides what should happen. Workers receive a narrow contract, perform one task, and return compact structured evidence.

## What You Get

- `/arc-orchestrator:orchestrate` chooses the appropriate worker with Fable as the default/recommended parent orchestrator.
- `/arc-orchestrator:orchestrate-with-model` uses the same worker delegation pattern from Opus or the current Claude Code model when the user explicitly wants to orchestrate without Fable.
- `/arc-orchestrator:orchestrate-eco` activates the fixed Eco worker stack; true Eco-parent orchestration requires running the mode from Cursor.
- `/arc-orchestrator:direct-worker` runs one bounded worker directly from the parent Claude Code session when auto mode blocks the thin Agent wrapper.
- `/arc-orchestrator:setup` diagnoses installations, authentication, and unsafe sudo-created Cursor state.
- `/arc-orchestrator:observability` shows local trace status, Laminar readiness, recent delegated runs, and per-model totals inside Claude Code.
- `/arc-orchestrator:story-queue-session` drives the arc-story-queue pull loop from a live Fable session — register, attach, `queue.next` into a worktree, delegate to workers, stream `story.update`, and `story.complete` with a handoff and run records. The daemon stays passive; Fable pulls the work.
- `/arc-orchestrator:prompt-factory` scans a repository and creates `docs/orchestrator/*.md` prompt files for using the orchestrator from the selected surface. In Claude Code, it defaults to Claude Code slash-command examples.
- Cursor projects can use `plugins/cursor-orchestrator` when Fable is available in Cursor; Fable remains the default parent orchestrator there too.
- `composer-implement` handles routine, clear-spec implementation through Cursor Composer 2.5.
- `codex-implement` handles difficult implementation and escalation through GPT-5.5 at high reasoning effort unless `--effort` overrides.
- `codex-explore` performs verbose repository analysis through a read-only GPT-5.6 Luna profile.
- `codex-check` provides an independent read-only implementation review through GPT-5.5 at high reasoning effort unless `--effort` overrides.
- `opus-review` provides high-taste read-only critique for UI/UX, API design, docs, copy, prompts, and long-lived abstractions.
- `opus-explore`, `opus-check`, and `opus-implement` are first-tier availability-fallback workers that route to the `claude` backend (Opus 4.8) when Codex is unavailable or the parent explicitly chooses Opus; they are not the default route and are distinct from `opus-review`.
- `grok-explore`, `grok-check`, and `grok-implement` are second-tier availability-fallback workers that route to the `composer` backend with Grok 4.5 when Claude/Opus is unavailable; they are not the default route, not taste escalation, and not a substitute for `opus-review`.
- `arc-orchestrator` provides a scriptable, structured CLI for Codex, Composer, and Claude backends.

## Routing

| Worker | Backend | Default model | Access | Use when |
| --- | --- | --- | --- | --- |
| `composer-implement` | Cursor Agent | `composer-2.5` | Write-capable | The approach is approved and implementation is clear, repetitive, or high-volume |
| `codex-implement` | Codex CLI | `gpt-5.5` | `workspace-write` | The task is difficult, debugging-heavy, or Composer missed the quality bar |
| `codex-explore` | Codex CLI | `gpt-5.6-luna` | `read-only` | Investigation would consume substantial Fable context |
| `codex-check` | Codex CLI | `gpt-5.5` | `read-only` | Independent correctness, security, regression, or acceptance-criteria review is valuable |
| `opus-review` | Claude Code Agent | Opus 4.8 | `read-only` | Taste, UX, API ergonomics, docs/copy, prompt, or abstraction review is valuable |
| `opus-explore` | Claude CLI (`claude` backend) | Opus 4.8 | `read-only` | Codex unavailable or parent explicitly routes exploration to Opus 4.8 |
| `opus-check` | Claude CLI (`claude` backend) | Opus 4.8 | `read-only` | Codex unavailable or parent explicitly routes review to Opus 4.8 |
| `opus-implement` | Claude CLI (`claude` backend) | Opus 4.8 | workspace-write | Codex unavailable or parent explicitly routes implementation to Opus 4.8 |
| `grok-explore` | Cursor Agent (`composer` backend, `--route grok-explore`) | Grok 4.5 | `read-only` | Claude/Opus unavailable or parent explicitly routes exploration to Grok |
| `grok-check` | Cursor Agent (`composer` backend, `--route grok-check`) | Grok 4.5 | `read-only` | Claude/Opus unavailable or parent explicitly routes review to Grok |
| `grok-implement` | Cursor Agent (`composer` backend, `--route grok-implement`) | Grok 4.5 | workspace-write | Claude/Opus unavailable or parent explicitly routes implementation to Grok |

Keep architecture, ambiguous requirements, user interaction, and final decisions in the parent orchestrator. Fable is the default/recommended parent; Opus or the current Claude Code model can be used explicitly through `/arc-orchestrator:orchestrate-with-model`.

### Eco orchestrator economy mode

Eco orchestrator mode is an explicit opt-in and does not change any surface's default parent or normal routing. Activate the runner policy on each call with `--orchestrator eco`, or set `ARC_ORCHESTRATOR_ORCHESTRATOR=eco` for the session; the CLI flag takes precedence over the environment.

The fixed economy worker stack is `(O) Eco -> opus-explore [| grok-explore] -> composer-implement -> opus-check [| grok-check]`: `analyze` maps to `opus-explore`, `implement` to `composer-implement`, and `review` to `opus-check`. Claude Code can use `/arc-orchestrator:orchestrate-eco`; Cursor can use `/orchestrate-eco`; Pi and Copilot can select the same runner identity in their orchestration guidance. On Claude Code, Pi, or Copilot, the flag selects economy worker routing but does not turn the current chat into an Eco parent. True Eco-parent orchestration requires Cursor: start from an active Cursor Composer chat and select the same runner identity there.

### Shipping authority

Workers do not commit, push, merge, deploy, or mutate GitHub. There are no
mechanical worker routes. When explicitly authorized, the parent performs the
approved git or GitHub shipping operation directly after reviewing worker evidence.

### Machine-readable route capabilities

External planners can discover the runner's executable routes without starting a
worker:

```sh
./plugins/arc-orchestrator/bin/arc-orchestrator routes --json
```

The JSON-only response is a versioned public contract with `schema_version: 2`,
`source: "arc-orchestrator"`, `workload_classes`, and canonical `routes`. Each
route provides its stable ID, runner backend, execution mode, currently resolved
model, sandbox, and planner guidance. `task_class` is free-form observability
metadata and never selects a model; `workload_class` selects automatic
implementation stacks. Explicit `--route` pins exactly one model. Omit
`--backend` and `--route` for the automatic ADR screenshot policy.
Optional `--routing-policy runner-routing-v2` is a fail-closed compatibility
marker for automatic delegation only; pre-v2 runners reject the unknown flag.

Consumers must reject an unsupported schema version or an unknown route ID
rather than silently executing it. `routes` intentionally requires `--json`;
it has no human-readable form and never dispatches a worker.

### GPT-5.6 model guidance

| Model | Available through | Reach for it when |
| --- | --- | --- |
| `gpt-5.5` | Codex (codex exec) | Default hard implementation and review at high reasoning effort unless `--effort` overrides: difficult debugging, escalation after Composer 2.5 misses the quality bar, and routine independent checks. |
| `gpt-5.6-luna` | Codex (codex exec) | High-volume, low-stakes exploration such as log sifting, dependency tracing, and evidence gathering; escalate to GPT-5.5 if it misses. |
| `gpt-5.6-sol` | Codex (codex exec) | Sol is OpenAI's flagship on Codex; use explicit `sol-implement` (or a model override) when flagship Sol is required; `task_class` never selects a model. |

Use the Codex mode override matching the route to target Luna, GPT-5.5, Sol, or an explicit escape-hatch model:
`ARC_ORCHESTRATOR_ANALYZE_MODEL`, `ARC_ORCHESTRATOR_IMPLEMENT_MODEL`, or
`ARC_ORCHESTRATOR_REVIEW_MODEL`. These env overrides apply only to direct
`--backend` dispatch. Explicit `--route` aliases pin their own models and
ignore ambient model env. `task_class` is observability metadata only and never
selects a model; automatic implementation selection uses `workload_class`.
Cursor always defaults to Composer 2.5, while `ARC_ORCHESTRATOR_COMPOSER_MODEL`
remains a direct-only override. Explicit model overrides always win on direct
dispatch.

## Requirements

- Claude Code with Fable 5 access
- Codex CLI installed and authenticated
- Cursor Agent installed and authenticated for Composer 2.5 implementation
- Bun
- `jq` only for this repository's test suite

Check the local tools:

```sh
claude --version
codex --version
cursor-agent --version
bun --version
```

## arc-contracts pinning

The orchestrator depends on `arc-contracts` via Bun's global link registry:

```json
"arc-contracts": "link:arc-contracts"
```

One-time setup per machine: run `bun link` inside `<arc-board checkout>/arc-story-queue/packages/arc-contracts`, then `bun install` here.

Pinning: the contract version is whatever the linked arc-board checkout declares in `arc-contracts` `package.json` (currently `0.1.0`). Breaking contract changes are semver-major bumps that orchestrator and arc-story-queue adopt together; `test/handoff-parity.test.ts` is the CI seam that catches drift.

## Quick Start

### 1. Validate the repository

```sh
bun run validate
```

This performs strict marketplace validation, strict plugin validation, and the Bun test suite.

### 2. Check both backends

```sh
./plugins/arc-orchestrator/bin/arc-orchestrator doctor
```

Expected result:

```text
Fable Orchestrator: ready
Codex: installed, authenticated
Composer: installed, authenticated
Claude: installed, authenticated
```

When Codex is unhealthy but Claude is ready, `doctor` prints degraded-mode guidance (for example, re-delegate with `--backend claude` or set `ARC_ORCHESTRATOR_FALLBACK=claude`). When Claude is also unavailable, the fallback hint points to Grok on the composer backend (`grok-explore`, `grok-check`, or `grok-implement`), and — when API keys are configured — Grok outages may continue on the `minimax` backend and then the terminal `kimi` backend. `doctor` also reports MiniMax and Kimi readiness.

Fix any reported issue before enabling automatic delegation. Never run Codex or Cursor Agent with `sudo`.

### 3. Load the plugin locally

```sh
claude \
  --plugin-dir ./plugins/arc-orchestrator \
  --model fable \
  --effort high
```

### 4. Verify setup inside Claude Code

```text
/arc-orchestrator:setup
```

### 5. Delegate a bounded task

```text
/arc-orchestrator:orchestrate implement the approved request validation,
limit changes to src/api and its tests, preserve existing response shapes,
run focused tests, and do not commit or touch unrelated files
```

## Installation From a Marketplace

The repository uses the standard Claude Code marketplace layout:

```text
.claude-plugin/marketplace.json
plugins/arc-orchestrator/.claude-plugin/plugin.json
```

During local development, prefer `--plugin-dir`. Install the hosted marketplace with:

```text
/plugin marketplace add andysolomon/arc-orchestrator
/plugin install arc-orchestrator@arc-orchestrator
/reload-plugins
/arc-orchestrator:setup
```

## Cursor, Pi, and Copilot Surfaces

This repository also includes Cursor, Pi, and GitHub Copilot surfaces. Across the canonical Claude Code and Cursor harnesses, follow the parent availability chain **CC-Fable → Codex 5.6 Sol → Cursor-Fable-High**. Run every parent tier at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control, and never use low or unspecified/default reasoning for a parent. Move to the next tier only when the active parent is unavailable because of a usage limit, authentication failure, or model unavailability. Pi and Copilot do **not** make Fable the default parent orchestrator; Pi uses Codex 5.6 Sol and Copilot intentionally remains Codex 5.6 Terra-first as the default parent/orchestration model.

### Cursor rules and prompts

Install locally as a Cursor plugin:

```sh
mkdir -p ~/.cursor/plugins/local
ln -s /Users/andrewsolomon/orchestrator/plugins/cursor-orchestrator ~/.cursor/plugins/local/cursor-orchestrator
```

Then restart Cursor or run **Developer: Reload Window**. You can also copy only the rule into a project:

```sh
mkdir -p .cursor/rules
cp plugins/cursor-orchestrator/rules/orchestrator.mdc .cursor/rules/orchestrator.mdc
```

The Cursor plugin includes:

- `plugins/cursor-orchestrator/.cursor-plugin/plugin.json`
- `plugins/cursor-orchestrator/rules/orchestrator.mdc`
- `plugins/cursor-orchestrator/skills/orchestrate/SKILL.md`
- `plugins/cursor-orchestrator/skills/opus-review/SKILL.md`
- `plugins/cursor-orchestrator/prompts/orchestrate.md`
- `plugins/cursor-orchestrator/prompts/opus-review.md`

### Pi and Copilot surfaces

### Pi package

```sh
pi install ./plugins/pi-orchestrator -l
pi /skill:arc-orchestrator
```

The package includes:

- `plugins/pi-orchestrator/bin/arc-orchestrator` (package-local runner wrapper)
- `plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md`
- `plugins/pi-orchestrator/prompts/orchestrate.md`

Cross-repo use works by default through `bin/arc-orchestrator`, which resolves the underlying runner automatically. `ARC_ORCHESTRATOR_BIN` is an optional override only when you need a non-default runner path.

### GitHub Copilot instructions and prompts

```sh
mkdir -p .github/prompts
cp plugins/copilot-orchestrator/copilot-instructions.md .github/copilot-instructions.md
cp plugins/copilot-orchestrator/prompts/*.prompt.md .github/prompts/
```

The Copilot pack includes repository instructions plus orchestration and review prompt files. Copilot and Pi both invoke the package-local `bin/arc-orchestrator` wrapper by default, with `ARC_ORCHESTRATOR_BIN` as an override-only escape hatch.

## Updating Each Surface

After pulling new orchestrator changes, refresh each integration you use. The steps below match the install paths documented above.

### Claude Code

**Marketplace install** — use the same marketplace and plugin names from [Installation From a Marketplace](#installation-from-a-marketplace):

```text
/plugin marketplace update arc-orchestrator
/plugin update arc-orchestrator@arc-orchestrator
/reload-plugins
/arc-orchestrator:setup
```

From a shell you can run the same steps with the CLI:

```sh
claude plugin marketplace update arc-orchestrator
claude plugin update arc-orchestrator@arc-orchestrator
claude plugin list
```

Restart Claude Code if skills or slash commands still look stale after `/reload-plugins`. Verify the installed version in the `/plugin` **Installed** tab (or `claude plugin list`) matches the version in `plugins/arc-orchestrator/.claude-plugin/plugin.json`, then run `/arc-orchestrator:setup` to confirm the plugin loads.

Previously installed plugin versions (for example 0.1.x) predate the Codex-to-Opus availability fallback; update to 0.2.0 or later so `opus-*` workers, the `claude` backend, and fallback routing are available.

**Local `--plugin-dir` development** — `git pull` in this repository, then restart Claude Code with the same `--plugin-dir ./plugins/arc-orchestrator` flag. No marketplace update is required.

### Cursor

**Copy install (recommended)** — after `git pull` in this repository, re-copy `plugins/cursor-orchestrator` into `~/.cursor/plugins/local/` (or re-copy the project rule file), then reload Cursor with **Developer: Reload Window** (or restart Cursor) and confirm updated rules and skills are active. Copying is the reliable default because Cursor's plugin validation can reject symlinks that point outside `~/.cursor/plugins/local`.

**Symlink install (if it loads on your Cursor version)** — `git pull` is enough; the symlink under `~/.cursor/plugins/local/` points at the updated plugin tree. Reload Cursor the same way.

See [plugins/cursor-orchestrator/README.md](plugins/cursor-orchestrator/README.md) for install layout, component paths, and distribution options.

### Pi

The documented install uses a **symlink** (`pi install ./plugins/pi-orchestrator -l`). After `git pull` in this repository, Pi reads the linked package files directly — no separate Pi update command is required. Re-run `pi install ./plugins/pi-orchestrator -l` only if you moved the repository or need to refresh Pi's package registration. Confirm `/skill:arc-orchestrator` still resolves after an update. Cross-repo orchestration uses the package-local `bin/arc-orchestrator` wrapper by default; set `ARC_ORCHESTRATOR_BIN` only when you need a non-default runner path.

### GitHub Copilot

Copilot uses **copied** prompt files, not symlinks. When `plugins/copilot-orchestrator/` changes, re-copy the updated files into your target repository:

```sh
cp plugins/copilot-orchestrator/copilot-instructions.md .github/copilot-instructions.md
cp plugins/copilot-orchestrator/prompts/*.prompt.md .github/prompts/
```

Reload or reopen the Copilot chat session so the refreshed instructions and prompts are picked up.

## Direct CLI

The CLI is useful for debugging integrations or calling workers outside Claude Code.

### Analyze with Codex

```sh
./plugins/arc-orchestrator/bin/arc-orchestrator run \
  --backend codex \
  --mode analyze \
  --task "Map the authorization flow and identify every enforcement point" \
  --cwd "$PWD"
```

### Implement with Composer 2.5

```sh
./plugins/arc-orchestrator/bin/arc-orchestrator run \
  --backend composer \
  --mode implement \
  --task "Implement the approved validation contract and run focused tests" \
  --cwd "$PWD"
```

### Implement with GPT-5.5

```sh
./plugins/arc-orchestrator/bin/arc-orchestrator run \
  --backend codex \
  --mode implement \
  --task "Fix the confirmed race condition without changing the public API" \
  --cwd "$PWD"
```

### Review with Codex

```sh
./plugins/arc-orchestrator/bin/arc-orchestrator run \
  --backend codex \
  --mode review \
  --task "Review the current changes for correctness, regressions, and missing tests" \
  --cwd "$PWD"
```

### Analyze, implement, or review with Claude (Opus 4.8 fallback)

Use when Codex is unavailable or the parent explicitly routes to Opus 4.8:

```sh
./plugins/arc-orchestrator/bin/arc-orchestrator run \
  --backend claude \
  --mode analyze \
  --task "Map the authorization flow and identify every enforcement point" \
  --cwd "$PWD"
```

```sh
./plugins/arc-orchestrator/bin/arc-orchestrator run \
  --backend claude \
  --mode implement \
  --task "Implement the approved validation contract and run focused tests" \
  --cwd "$PWD"
```

```sh
./plugins/arc-orchestrator/bin/arc-orchestrator run \
  --backend claude \
  --mode review \
  --task "Review the current changes for correctness, regressions, and missing tests" \
  --cwd "$PWD"
```

### Codex and Claude outage fallback

When Codex fails with a usage limit, authentication error, or missing binary, the runner classifies the outage as `backend_unavailable` and prints a machine-readable fallback hint on stderr (`fallback: { backend: "claude", model: <resolved> }`). By default the parent re-delegates explicitly (for example to `opus-explore` or `run --backend claude`) and records the switch with `annotate --escalated-to`. For unattended runs, set `ARC_ORCHESTRATOR_FALLBACK=claude` (or pass `--fallback claude`) to retry once on the `claude` backend; linked trace records use `fallback_of`.

When Claude/Opus is also unavailable, stderr includes `fallback: { backend: "composer", model: <grok-4.5 or ARC_ORCHESTRATOR_GROK_MODEL> }`. Re-delegate explicitly to `grok-explore`, `grok-check`, or `grok-implement`, or invoke `run --backend composer --route <grok-*>`. With `ARC_ORCHESTRATOR_FALLBACK=claude`, an availability-classified Claude failure during that retry chain continues once more on the composer backend with Grok. Grok is availability recovery, not taste escalation and not a substitute for `opus-review`.

When a MiniMax key is configured (`ARC_ORCHESTRATOR_MINIMAX_API_KEY` or `MINIMAX_API_KEY`), the chain gains a key-gated tier: an availability-classified Grok failure continues once more on the `minimax` backend, which reuses the Claude Code CLI against MiniMax's Anthropic-compatible endpoint (`ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` are injected per invocation; the operator's normal Claude credentials and environment are untouched; default model `MiniMax-M3`). Because MiniMax is a pay-as-you-go API tier, it survives subscription exhaustion of Codex, Claude, and Cursor simultaneously. The `minimax` backend is also directly selectable with `--backend minimax` for all three modes.

When a Kimi/Moonshot key is configured (`ARC_ORCHESTRATOR_KIMI_API_KEY`, `MOONSHOT_API_KEY`, or `KIMI_API_KEY`), the chain gains a terminal tier after MiniMax (or directly after Grok when MiniMax is not configured): direct `--backend kimi` reuses the Claude Code CLI against Moonshot's Anthropic-compatible endpoint (`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` are injected per invocation; inherited `ANTHROPIC_API_KEY` is removed from the worker env; default model `kimi-k3[1m]`). Direct Kimi is always terminal. This is distinct from public `kimi-*` aliases and automatic stacks, which use OpenCode (`moonshotai/kimi-k3` via `--backend opencode`).

`--worker-model <model>` pins the worker model for the requested backend explicitly, winning over both environment overrides and routing policy; the pinned model is recorded in the run's trace. Fallback tiers ignore it and use their own defaults, and it cannot be combined with `--route` (the route contract owns its model) or Eco mode.

Every successful task returns:

```json
{
  "status": "completed",
  "summary": "Concise outcome",
  "changes": ["src/example.ts"],
  "verification": ["bun test src/example.test.ts"],
  "risks": [],
  "next_actions": []
}
```

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `ARC_ORCHESTRATOR_CODEX_BIN` | `codex` | Codex executable |
| `ARC_ORCHESTRATOR_CURSOR_BIN` | `cursor-agent` | Cursor Agent executable |
| `ARC_ORCHESTRATOR_COMPOSER_MODEL` | `composer-2.5` | Cursor implementation model |
| `ARC_ORCHESTRATOR_ANALYZE_MODEL` | `gpt-5.6-luna` | Codex analysis model |
| `ARC_ORCHESTRATOR_IMPLEMENT_MODEL` | `gpt-5.5` | Codex implementation model (direct `--backend` path only; ignored by automatic/explicit canonical routes) |
| `ARC_ORCHESTRATOR_REVIEW_MODEL` | `gpt-5.5` | Codex review model (direct `--backend` path only; ignored by automatic/explicit canonical routes) |
| `ARC_ORCHESTRATOR_CLAUDE_BIN` | `claude` | Claude Code CLI executable for the `claude` backend |
| `ARC_ORCHESTRATOR_CLAUDE_MODEL` | `claude-opus-4-8` | Claude backend model (Opus 4.8 default) |
| `ARC_ORCHESTRATOR_FALLBACK` | unset | Set to `claude` to retry availability-classified Codex failures once on the `claude` backend; Claude availability failures during that chain may continue once on the composer Grok route, then on the `minimax` backend when a MiniMax key is configured, then on the terminal `kimi` backend when a Kimi/Moonshot key is configured |
| `ARC_ORCHESTRATOR_GROK_MODEL` | `grok-4.5` | Grok model for second-tier availability fallback on the composer backend |
| `ARC_ORCHESTRATOR_MINIMAX_MODEL` | `MiniMax-M3` | MiniMax backend model |
| `ARC_ORCHESTRATOR_MINIMAX_BASE_URL` | `https://api.minimax.io/anthropic` | MiniMax Anthropic-compatible endpoint used by the `minimax` backend |
| `ARC_ORCHESTRATOR_MINIMAX_API_KEY` | unset (falls back to `MINIMAX_API_KEY`) | Pay-as-you-go MiniMax API key; enables the `minimax` backend and fallback tier |
| `ARC_ORCHESTRATOR_OPENCODE_BIN` | `opencode` | OpenCode CLI for public `kimi-*` aliases and `--backend opencode` |
| `ARC_ORCHESTRATOR_OPENCODE_MODEL` | `moonshotai/kimi-k3` | OpenCode model for direct `--backend opencode` (does not rewrite public `kimi-*` pins or direct `--backend kimi`) |
| `ARC_ORCHESTRATOR_KIMI_MODEL` | `kimi-k3[1m]` | Direct `--backend kimi` / terminal fallback model only (Anthropic-compatible; does not rewrite public OpenCode `kimi-*` pins) |
| `ARC_ORCHESTRATOR_KIMI_BASE_URL` | `https://api.moonshot.ai/anthropic` | Moonshot Anthropic-compatible endpoint used by direct `--backend kimi` |
| `ARC_ORCHESTRATOR_KIMI_API_KEY` | unset (falls back to `MOONSHOT_API_KEY`, then `KIMI_API_KEY`) | Pay-as-you-go Kimi/Moonshot API key; enables direct `--backend kimi` and the terminal fallback tier |
| `ARC_ORCHESTRATOR_ORCHESTRATOR` | unset | Set to `composer` to activate the fixed Eco worker routes; true Eco-parent orchestration requires Cursor |
| `CURSOR_API_KEY` | unset | Cursor's supported non-keychain authentication path |
| `ARC_ORCHESTRATOR_TRACE` | `1` | Set to `0` to disable local trace records |
| `ARC_ORCHESTRATOR_TRACE_DIR` | `~/.arc-orchestrator/traces` | Trace record location |
| `ARC_ORCHESTRATOR_TRACE_LIMIT` | `1000` | Retained trace records; `0` keeps all |
| `ARC_ORCHESTRATOR_MAX_DURATION_MS` | unset | Hard per-run deadline: the worker is killed and the run fails predictably |
| `ARC_ORCHESTRATOR_MAX_TOKENS` | unset | Per-run token ceiling: completed runs that exceed it are flagged, not discarded |
| `ARC_ORCHESTRATOR_WRITE_LOCK` | `1` | Set to `0` to disable per-project write serialization |
| `ARC_ORCHESTRATOR_LOCK_WAIT_MS` | unset | Wait this long for the project write lock before failing |
| `ARC_ORCHESTRATOR_LAMINAR` | unset | Set to `1` to export run metadata to Laminar |
| `LMNR_PROJECT_API_KEY` | unset | Laminar project API key (required when export is enabled) |
| `LMNR_BASE_URL` | `https://api.lmnr.ai` | Laminar API base URL |
| `LMNR_PROJECT_NAME` | `arc-orchestrator` | Laminar evaluation group name |

Codex continues to load normal user and trusted-project configuration. Cursor Agent continues to load its normal rules and project state.

## Observability

Every delegated run appends one JSON line to `~/.arc-orchestrator/traces/runs.jsonl` recording the run id, backend, mode, **resolved model**, sandbox, an opaque project identifier (a short hash of the working directory — the absolute path itself is never recorded), duration, token usage (parsed from `codex exec --json` events and the Cursor JSON envelope), structured status, changed-file count, and a short error summary on failure. Task text, full prompts, filesystem paths, file contents, and raw transcripts are never written; because worker CLI diagnostics can echo the prompt or paths, persisted error summaries are additionally redacted (`<task>`/`<path>` placeholders) while the full detail still reaches the parent on stderr. To make runs recognizable, pass an explicit safe label with `--label "<short description>"`; it is recorded verbatim (truncated to 80 characters) and is never derived from the task prompt.

The parent model can also record, at spawn time, why it chose a route with `--task-class "<class>"` (for example `bugfix`, `migration`, `test-addition`) and `--route-rationale "<reason>"`. Both are parent-authored, bounded, and never derived from the task prompt.

The trace file is bounded: after each run only the most recent `ARC_ORCHESTRATOR_TRACE_LIMIT` records (default 1000) are retained; set it to `0` to keep everything.

### Parent outcome annotations

A trace records what a worker did; it cannot know whether the parent model accepted the result. After evaluating a worker run, the parent records its judgment with `annotate`:

```sh
./plugins/arc-orchestrator/bin/arc-orchestrator annotate --run latest --outcome accepted
./plugins/arc-orchestrator/bin/arc-orchestrator annotate --run <run id> --outcome escalated --escalated-to gpt-5.5 --note "analysis missed the failing path"
```

`--outcome` is one of `accepted`, `rejected`, `blocked`, `verification-failed`, or `escalated`. `--run latest` targets the most recent recorded run (the orchestrator runs sequentially), or pass an explicit run id from `runs --json`. Annotations are written to a sibling `annotations.jsonl` with the same redaction and bounded-retention rules; the most recent annotation per run wins, so a later `accepted` supersedes an earlier `escalated`. Both `runs` and `observability` join each run to its latest outcome (`[accepted]`, `[escalated]`, `[unrated]`, …) and `observability` reports a runs-by-outcome breakdown.

Inspect recent runs:

```sh
./plugins/arc-orchestrator/bin/arc-orchestrator runs            # human summary with per-model totals and outcomes
./plugins/arc-orchestrator/bin/arc-orchestrator runs --json     # records enriched with the joined outcome
./plugins/arc-orchestrator/bin/arc-orchestrator runs --limit 5  # most recent five
./plugins/arc-orchestrator/bin/arc-orchestrator observability   # trace, Laminar readiness, outcome, and recent-run summary
```

### Comparative report

`report` aggregates the captured runs and their latest outcomes into a comparison you can use to justify routing changes. Group by `model` (default), `backend`, `mode`, or `task_class`:

```sh
./plugins/arc-orchestrator/bin/arc-orchestrator report                        # by model
./plugins/arc-orchestrator/bin/arc-orchestrator report --group-by task_class  # by parent-authored class
./plugins/arc-orchestrator/bin/arc-orchestrator report --json --limit 200     # machine-readable, last 200 runs
```

Each group reports run count, completion rate (by run status), acceptance rate (accepted ÷ rated runs — `n/a` when nothing in the group was annotated), the outcome breakdown, budget violations, and mean/total tokens and duration. Only annotated runs count toward acceptance, so the report distinguishes "the worker finished" from "the parent kept the result."

### Budget thresholds

Two opt-in, per-run thresholds bound delegated work, with deliberately different enforcement because of what each can know mid-flight:

- `ARC_ORCHESTRATOR_MAX_DURATION_MS` is a **hard stop**: the runner kills the worker subprocess at the deadline, the run fails with a `budget:` error, and the trace records `duration_exceeded`. Use it to stop stuck or runaway workers.
- `ARC_ORCHESTRATOR_MAX_TOKENS` is a **post-run flag**: token usage is only known once the CLI exits, so a completed run that exceeds the ceiling still returns its result, but the runner warns on stderr, the trace records `tokens_exceeded`, and `report` counts the violation for its group. Discarding finished work would waste exactly the usage the budget exists to protect.

From the measured workload matrix (`docs/orchestrator/workload-matrix.md`): bounded implementation runs land around 16k (Composer) to 114k (Codex) tokens, scoped analysis/review around 100k–200k, while an unscoped Codex analysis of a large repository has reached 2.75M tokens. A reasonable starting point is `ARC_ORCHESTRATOR_MAX_TOKENS=500000` with a 10–15 minute duration ceiling, tightened per task class as your own `report` data accumulates.

## Parallel Delegation

Task scheduling stays in the parent model — it can dispatch several workers at once — and the runner enforces the safety boundary (see `docs/orchestrator/parallel-delegation.md` for the full evaluation):

- **Read-only routes (`analyze`, `review`) always run in parallel safely.** They never take a lock.
- **Write-capable runs (`implement`) serialize per project.** The runner claims an advisory lock keyed to the working directory's project identifier before spawning the worker; a second write-capable run against the same project fails fast with an actionable error instead of silently interleaving edits. Set `ARC_ORCHESTRATOR_LOCK_WAIT_MS` to queue behind the current run instead of failing, or `ARC_ORCHESTRATOR_WRITE_LOCK=0` to opt out entirely.
- **Separate worktrees parallelize writes safely.** Different checkouts resolve to different project identifiers, so giving each worker its own worktree is the supported way to run implementation tasks concurrently.
- Locks record their holder (pid + run id); locks left by dead processes are reclaimed automatically, and every lock is released when its run finishes.

Inside Claude Code TUI, use `/arc-orchestrator:observability` for the same delegated-worker view. This observes worker runs launched through the orchestrator runner; it does not trace every parent Fable message, direct edit, or Claude Code tool call.

Generate repo-specific prompt packs:

```sh
# In Claude Code TUI
/arc-orchestrator:prompt-factory scan this repository and create docs/orchestrator prompt md files that show exactly how to use the orchestrator for repo scan, file review, plugin sync, implementation, and test strategy.
```

Shared prompt wording belongs in `plugins/orchestrator-core/prompt-factory.ts`; generated docs should focus on the user's selected surface instead of mixing Claude Code, Pi, and Copilot instructions in every prompt.

Disable tracing with `ARC_ORCHESTRATOR_TRACE=0`; relocate it with `ARC_ORCHESTRATOR_TRACE_DIR`.

### Optional Laminar export

With `ARC_ORCHESTRATOR_LAMINAR=1` and `LMNR_PROJECT_API_KEY` set, each run is also exported to [Laminar](https://www.laminar.sh) as a scored evaluation datapoint (grouped under `LMNR_PROJECT_NAME`), carrying the same redacted metadata plus numeric scores for duration, tokens, changed files, and completion. Export is strictly opt-in, uses plain HTTPS with no extra dependency, and a failed export never fails the run — it logs one stderr warning and continues. After a successful export the runner prints the evaluation's dashboard URL to stderr (`arc-orchestrator: laminar: …`) so each run is one click to inspect.

## Persistent Project Policy

The source policy is `CLAUDE.md`. For repositories that should always use this routing strategy, copy the shorter `templates/CLAUDE.md.snippet.md` into the target repository's `CLAUDE.md`.

Keep stable routing principles in `CLAUDE.md`; keep procedural detail in the plugin skills so it loads only when used.

## Safety

- Fable remains responsible for accepting worker output.
- Codex analysis and review are read-only.
- Codex implementation is limited to workspace writes.
- Composer is implementation-only because Cursor headless mode does not provide a Codex-equivalent read-only sandbox.
- Composer uses Cursor's `--force` flag and therefore receives only explicit, bounded write tasks.
- No route uses unrestricted Codex filesystem access.
- Workers are instructed not to commit, push, merge, deploy, access credentials, or make unrelated changes.
- The runner uses process argument arrays rather than shell interpolation.
- Failed or malformed worker output is rejected rather than presented as success.

## Documentation

- `docs/branch-protection.md` — `main` branch protection, Merge Gate required check, and release automation bypass
- `docs/architecture.md` — trust boundaries, execution flow, and backend behavior
- `docs/diagrams/README.md` — editable Excalidraw sources and rendered architecture examples
- `docs/diagrams/mermaid.md` — Mermaid architecture, routing, and sequence diagrams
- `docs/delegation-guide.md` — route selection, task contracts, examples, and escalation
- `docs/troubleshooting.md` — authentication, keychain, ownership, and backend failures
- `IMPLEMENTATION_PLAN.md` — roadmap, risks, and acceptance criteria
- `progress.txt` — synchronized execution state

## Current Limits

- Routing is policy-driven; recorded traces inform but do not yet drive routing.
- Parallel task scheduling and budget enforcement are deferred.
- Computer-use delegation is not implemented.
- Real-world model rankings remain heuristics until representative workloads are measured.

## References

- [Claude Code plugins](https://code.claude.com/docs/en/plugins)
- [OpenAI Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc)
- [Cursor Composer 2.5](https://cursor.com/docs/models/cursor-composer-2-5)
- [Cursor Agent headless CLI](https://cursor.com/docs/cli/headless)
- [Composer 2.5 orchestration article](https://note.com/ai_driven/n/n9018ad630d78?hl=en)
