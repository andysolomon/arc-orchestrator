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

- `/fable-orchestrator:orchestrate` chooses the appropriate worker with Fable as the default/recommended parent orchestrator.
- `/fable-orchestrator:orchestrate-with-model` uses the same worker delegation pattern from Opus or the current Claude Code model when the user explicitly wants to orchestrate without Fable.
- `/fable-orchestrator:direct-worker` runs one bounded worker directly from the parent Claude Code session when auto mode blocks the thin Agent wrapper.
- `/fable-orchestrator:setup` diagnoses installations, authentication, and unsafe sudo-created Cursor state.
- `/fable-orchestrator:observability` shows local trace status, Laminar readiness, recent delegated runs, and per-model totals inside Claude Code.
- `/fable-orchestrator:story-queue-session` drives the arc-story-queue pull loop from a live Fable session — register, attach, `queue.next` into a worktree, delegate to workers, stream `story.update`, and `story.complete` with a handoff and run records. The daemon stays passive; Fable pulls the work.
- `/fable-orchestrator:prompt-factory` scans a repository and creates `docs/orchestrator/*.md` prompt files for using the orchestrator from the selected surface. In Claude Code, it defaults to Claude Code slash-command examples.
- Cursor projects can use `plugins/cursor-orchestrator` when Fable is available in Cursor; Fable remains the default parent orchestrator there too.
- `composer-implement` handles routine, clear-spec implementation through Cursor Composer 2.5.
- `codex-implement` handles difficult implementation and escalation through GPT-5.5 at high reasoning effort unless `--effort` overrides, using GPT-5.6 Sol for taste-sensitive task classes.
- `codex-explore` performs verbose repository analysis through a read-only GPT-5.6 Luna profile.
- `codex-check` provides an independent read-only implementation review through GPT-5.5 at high reasoning effort unless `--effort` overrides, using GPT-5.6 Sol for taste-sensitive task classes.
- `opus-review` provides high-taste read-only critique for UI/UX, API design, docs, copy, prompts, and long-lived abstractions.
- `opus-explore`, `opus-check`, and `opus-implement` are availability-fallback workers that route to the `claude` backend (Opus 4.8) when Codex is unavailable or the parent explicitly chooses Opus; they are not the default route and are distinct from `opus-review`.
- `fable-orchestrator` provides a scriptable, structured CLI for Codex, Composer, and Claude backends.

## Routing

| Worker | Backend | Default model | Access | Use when |
| --- | --- | --- | --- | --- |
| `composer-implement` | Cursor Agent | `composer-2.5` | Write-capable | The approach is approved and implementation is clear, repetitive, or high-volume |
| `codex-implement` | Codex CLI | `gpt-5.5` (`gpt-5.6-sol` for taste-sensitive task classes) | `workspace-write` | The task is difficult, debugging-heavy, or Composer missed the quality bar |
| `codex-explore` | Codex CLI | `gpt-5.6-luna` | `read-only` | Investigation would consume substantial Fable context |
| `codex-check` | Codex CLI | `gpt-5.5` (`gpt-5.6-sol` for taste-sensitive task classes) | `read-only` | Independent correctness, security, regression, or acceptance-criteria review is valuable |
| `opus-review` | Claude Code Agent | Opus 4.8 | `read-only` | Taste, UX, API ergonomics, docs/copy, prompt, or abstraction review is valuable |
| `opus-explore` | Claude CLI (`claude` backend) | Opus 4.8 | `read-only` | Codex unavailable or parent explicitly routes exploration to Opus 4.8 |
| `opus-check` | Claude CLI (`claude` backend) | Opus 4.8 | `read-only` | Codex unavailable or parent explicitly routes review to Opus 4.8 |
| `opus-implement` | Claude CLI (`claude` backend) | Opus 4.8 | workspace-write | Codex unavailable or parent explicitly routes implementation to Opus 4.8 |

Keep architecture, ambiguous requirements, user interaction, and final decisions in the parent orchestrator. Fable is the default/recommended parent; Opus or the current Claude Code model can be used explicitly through `/fable-orchestrator:orchestrate-with-model`.

### Machine-readable route capabilities

External planners can discover the runner's executable routes without starting a
worker:

```sh
./plugins/fable-orchestrator/bin/fable-orchestrator routes --json
```

The JSON-only response is a versioned public contract with `schema_version: 1`,
`source: "fable-orchestrator"`, and canonical `routes`. Each route provides its
stable ID, runner backend, execution mode, currently resolved model, sandbox,
and planner guidance. Where a Codex route has task-class variants,
`task_class_variants` enumerates every matching canonical class
(`taste-sensitive`, `ui`, `copy`, and `api-design`); each entry explicitly
states that matching is case-insensitive and trims surrounding whitespace. The
values use the same model-resolution functions as execution, including
non-empty model environment overrides. It lists only routes the current runner
can execute: `codex-explore`, `composer-implement`, `codex-implement`,
`codex-check`, `opus-explore`, `opus-implement`, and `opus-check`.

Consumers must reject an unsupported schema version or an unknown route ID
rather than silently executing it. `routes` intentionally requires `--json`;
it has no human-readable form and never dispatches a worker.

### GPT-5.6 model guidance

| Model | Available through | Reach for it when |
| --- | --- | --- |
| `gpt-5.5` | Codex (codex exec) | Default hard implementation and review at high reasoning effort unless `--effort` overrides: difficult debugging, escalation after Composer 2.5 misses the quality bar, and routine independent checks. |
| `gpt-5.6-luna` | Codex (codex exec) | High-volume, low-stakes exploration such as log sifting, dependency tracing, and evidence gathering; escalate to GPT-5.5 if it misses. |
| `gpt-5.6-sol` | Codex (codex exec) | Sol is OpenAI's flagship on Codex; use it for taste-sensitive or especially difficult bounded Codex implementation/review (`--task-class taste-sensitive`, `ui`, `copy`, or `api-design`) when GPT-5.5 is not enough. |

Use the Codex mode override matching the route to target Luna, GPT-5.5, Sol, or an explicit escape-hatch model:
`FABLE_ORCHESTRATOR_ANALYZE_MODEL`, `FABLE_ORCHESTRATOR_IMPLEMENT_MODEL`, or
`FABLE_ORCHESTRATOR_REVIEW_MODEL`. Without a non-empty matching override,
Codex `implement` and `review` task classes `taste-sensitive`, `ui`, `copy`,
and `api-design` select Sol; `analyze` remains Luna. Cursor always defaults to
Composer 2.5, while `FABLE_ORCHESTRATOR_COMPOSER_MODEL` remains an explicit
override. Explicit model overrides always win.

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
./plugins/fable-orchestrator/bin/fable-orchestrator doctor
```

Expected result:

```text
Fable Orchestrator: ready
Codex: installed, authenticated
Composer: installed, authenticated
Claude: installed, authenticated
```

When Codex is unhealthy but Claude is ready, `doctor` prints degraded-mode guidance (for example, re-delegate with `--backend claude` or set `FABLE_ORCHESTRATOR_FALLBACK=claude`).

Fix any reported issue before enabling automatic delegation. Never run Codex or Cursor Agent with `sudo`.

### 3. Load the plugin locally

```sh
claude \
  --plugin-dir ./plugins/fable-orchestrator \
  --model fable \
  --effort high
```

### 4. Verify setup inside Claude Code

```text
/fable-orchestrator:setup
```

### 5. Delegate a bounded task

```text
/fable-orchestrator:orchestrate implement the approved request validation,
limit changes to src/api and its tests, preserve existing response shapes,
run focused tests, and do not commit or touch unrelated files
```

## Installation From a Marketplace

The repository uses the standard Claude Code marketplace layout:

```text
.claude-plugin/marketplace.json
plugins/fable-orchestrator/.claude-plugin/plugin.json
```

During local development, prefer `--plugin-dir`. Install the hosted marketplace with:

```text
/plugin marketplace add andysolomon/arc-orchestrator
/plugin install fable-orchestrator@fable-orchestrator
/reload-plugins
/fable-orchestrator:setup
```

## Cursor, Pi, and Copilot Surfaces

This repository also includes a Fable-first Cursor surface plus Codex-first surfaces for Pi and GitHub Copilot. Cursor can use Fable as the default parent orchestrator because Fable is available there; when Fable is unavailable because Cursor limits are exhausted or the model is not available, Cursor falls back to Codex 5.6 Terra as the default parent orchestrator. Pi and Copilot do **not** make Fable the default parent orchestrator; Pi uses Codex 5.6 Sol and Copilot uses Codex 5.6 Terra as the default parent/orchestration model.

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

- `plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md`
- `plugins/pi-orchestrator/prompts/orchestrate.md`

### GitHub Copilot instructions and prompts

```sh
mkdir -p .github/prompts
cp plugins/copilot-orchestrator/copilot-instructions.md .github/copilot-instructions.md
cp plugins/copilot-orchestrator/prompts/*.prompt.md .github/prompts/
```

The Copilot pack includes repository instructions plus orchestration and review prompt files. Both surfaces currently reuse the existing runner path, or `ARC_ORCHESTRATOR_BIN` when set.

## Updating Each Surface

After pulling new orchestrator changes, refresh each integration you use. The steps below match the install paths documented above.

### Claude Code

**Marketplace install** — use the same marketplace and plugin names from [Installation From a Marketplace](#installation-from-a-marketplace):

```text
/plugin marketplace update fable-orchestrator
/plugin update fable-orchestrator@fable-orchestrator
/reload-plugins
/fable-orchestrator:setup
```

From a shell you can run the same steps with the CLI:

```sh
claude plugin marketplace update fable-orchestrator
claude plugin update fable-orchestrator@fable-orchestrator
claude plugin list
```

Restart Claude Code if skills or slash commands still look stale after `/reload-plugins`. Verify the installed version in the `/plugin` **Installed** tab (or `claude plugin list`) matches the version in `plugins/fable-orchestrator/.claude-plugin/plugin.json`, then run `/fable-orchestrator:setup` to confirm the plugin loads.

Previously installed plugin versions (for example 0.1.x) predate the Codex-to-Opus availability fallback; update to 0.2.0 or later so `opus-*` workers, the `claude` backend, and fallback routing are available.

**Local `--plugin-dir` development** — `git pull` in this repository, then restart Claude Code with the same `--plugin-dir ./plugins/fable-orchestrator` flag. No marketplace update is required.

### Cursor

**Copy install (recommended)** — after `git pull` in this repository, re-copy `plugins/cursor-orchestrator` into `~/.cursor/plugins/local/` (or re-copy the project rule file), then reload Cursor with **Developer: Reload Window** (or restart Cursor) and confirm updated rules and skills are active. Copying is the reliable default because Cursor's plugin validation can reject symlinks that point outside `~/.cursor/plugins/local`.

**Symlink install (if it loads on your Cursor version)** — `git pull` is enough; the symlink under `~/.cursor/plugins/local/` points at the updated plugin tree. Reload Cursor the same way.

See [plugins/cursor-orchestrator/README.md](plugins/cursor-orchestrator/README.md) for install layout, component paths, and distribution options.

### Pi

The documented install uses a **symlink** (`pi install ./plugins/pi-orchestrator -l`). After `git pull` in this repository, Pi reads the linked package files directly — no separate Pi update command is required. Re-run `pi install ./plugins/pi-orchestrator -l` only if you moved the repository or need to refresh Pi's package registration. Confirm `/skill:arc-orchestrator` still resolves after an update.

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
./plugins/fable-orchestrator/bin/fable-orchestrator run \
  --backend codex \
  --mode analyze \
  --task "Map the authorization flow and identify every enforcement point" \
  --cwd "$PWD"
```

### Implement with Composer 2.5

```sh
./plugins/fable-orchestrator/bin/fable-orchestrator run \
  --backend composer \
  --mode implement \
  --task "Implement the approved validation contract and run focused tests" \
  --cwd "$PWD"
```

### Implement with GPT-5.5

```sh
./plugins/fable-orchestrator/bin/fable-orchestrator run \
  --backend codex \
  --mode implement \
  --task "Fix the confirmed race condition without changing the public API" \
  --cwd "$PWD"
```

### Review with Codex

```sh
./plugins/fable-orchestrator/bin/fable-orchestrator run \
  --backend codex \
  --mode review \
  --task "Review the current changes for correctness, regressions, and missing tests" \
  --cwd "$PWD"
```

### Analyze, implement, or review with Claude (Opus 4.8 fallback)

Use when Codex is unavailable or the parent explicitly routes to Opus 4.8:

```sh
./plugins/fable-orchestrator/bin/fable-orchestrator run \
  --backend claude \
  --mode analyze \
  --task "Map the authorization flow and identify every enforcement point" \
  --cwd "$PWD"
```

```sh
./plugins/fable-orchestrator/bin/fable-orchestrator run \
  --backend claude \
  --mode implement \
  --task "Implement the approved validation contract and run focused tests" \
  --cwd "$PWD"
```

```sh
./plugins/fable-orchestrator/bin/fable-orchestrator run \
  --backend claude \
  --mode review \
  --task "Review the current changes for correctness, regressions, and missing tests" \
  --cwd "$PWD"
```

### Codex outage and fallback

When Codex fails with a usage limit, authentication error, or missing binary, the runner classifies the outage as `backend_unavailable` and prints a machine-readable fallback hint on stderr. By default the parent re-delegates explicitly (for example to `opus-explore` or `run --backend claude`) and records the switch with `annotate --escalated-to`. For unattended runs, set `FABLE_ORCHESTRATOR_FALLBACK=claude` (or pass `--fallback claude`) to retry once on the `claude` backend; linked trace records use `fallback_of`.

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
| `FABLE_ORCHESTRATOR_CODEX_BIN` | `codex` | Codex executable |
| `FABLE_ORCHESTRATOR_CURSOR_BIN` | `cursor-agent` | Cursor Agent executable |
| `FABLE_ORCHESTRATOR_COMPOSER_MODEL` | `composer-2.5` | Cursor implementation model |
| `FABLE_ORCHESTRATOR_ANALYZE_MODEL` | `gpt-5.6-luna` | Codex analysis model |
| `FABLE_ORCHESTRATOR_IMPLEMENT_MODEL` | `gpt-5.5` (`gpt-5.6-sol` when `--task-class` is taste-sensitive) | Codex implementation model |
| `FABLE_ORCHESTRATOR_REVIEW_MODEL` | `gpt-5.5` (`gpt-5.6-sol` when `--task-class` is taste-sensitive) | Codex review model |
| `FABLE_ORCHESTRATOR_CLAUDE_BIN` | `claude` | Claude Code CLI executable for the `claude` backend |
| `FABLE_ORCHESTRATOR_CLAUDE_MODEL` | `claude-opus-4-8` | Claude backend model (Opus 4.8 default) |
| `FABLE_ORCHESTRATOR_FALLBACK` | unset | Set to `claude` to retry availability-classified Codex failures once on the `claude` backend |
| `CURSOR_API_KEY` | unset | Cursor's supported non-keychain authentication path |
| `FABLE_ORCHESTRATOR_TRACE` | `1` | Set to `0` to disable local trace records |
| `FABLE_ORCHESTRATOR_TRACE_DIR` | `~/.fable-orchestrator/traces` | Trace record location |
| `FABLE_ORCHESTRATOR_TRACE_LIMIT` | `1000` | Retained trace records; `0` keeps all |
| `FABLE_ORCHESTRATOR_MAX_DURATION_MS` | unset | Hard per-run deadline: the worker is killed and the run fails predictably |
| `FABLE_ORCHESTRATOR_MAX_TOKENS` | unset | Per-run token ceiling: completed runs that exceed it are flagged, not discarded |
| `FABLE_ORCHESTRATOR_WRITE_LOCK` | `1` | Set to `0` to disable per-project write serialization |
| `FABLE_ORCHESTRATOR_LOCK_WAIT_MS` | unset | Wait this long for the project write lock before failing |
| `FABLE_ORCHESTRATOR_LAMINAR` | unset | Set to `1` to export run metadata to Laminar |
| `LMNR_PROJECT_API_KEY` | unset | Laminar project API key (required when export is enabled) |
| `LMNR_BASE_URL` | `https://api.lmnr.ai` | Laminar API base URL |
| `LMNR_PROJECT_NAME` | `fable-orchestrator` | Laminar evaluation group name |

Codex continues to load normal user and trusted-project configuration. Cursor Agent continues to load its normal rules and project state.

## Observability

Every delegated run appends one JSON line to `~/.fable-orchestrator/traces/runs.jsonl` recording the run id, backend, mode, **resolved model**, sandbox, an opaque project identifier (a short hash of the working directory — the absolute path itself is never recorded), duration, token usage (parsed from `codex exec --json` events and the Cursor JSON envelope), structured status, changed-file count, and a short error summary on failure. Task text, full prompts, filesystem paths, file contents, and raw transcripts are never written; because worker CLI diagnostics can echo the prompt or paths, persisted error summaries are additionally redacted (`<task>`/`<path>` placeholders) while the full detail still reaches the parent on stderr. To make runs recognizable, pass an explicit safe label with `--label "<short description>"`; it is recorded verbatim (truncated to 80 characters) and is never derived from the task prompt.

The parent model can also record, at spawn time, why it chose a route with `--task-class "<class>"` (for example `bugfix`, `migration`, `test-addition`) and `--route-rationale "<reason>"`. Both are parent-authored, bounded, and never derived from the task prompt.

The trace file is bounded: after each run only the most recent `FABLE_ORCHESTRATOR_TRACE_LIMIT` records (default 1000) are retained; set it to `0` to keep everything.

### Parent outcome annotations

A trace records what a worker did; it cannot know whether the parent model accepted the result. After evaluating a worker run, the parent records its judgment with `annotate`:

```sh
./plugins/fable-orchestrator/bin/fable-orchestrator annotate --run latest --outcome accepted
./plugins/fable-orchestrator/bin/fable-orchestrator annotate --run <run id> --outcome escalated --escalated-to gpt-5.5 --note "analysis missed the failing path"
```

`--outcome` is one of `accepted`, `rejected`, `blocked`, `verification-failed`, or `escalated`. `--run latest` targets the most recent recorded run (the orchestrator runs sequentially), or pass an explicit run id from `runs --json`. Annotations are written to a sibling `annotations.jsonl` with the same redaction and bounded-retention rules; the most recent annotation per run wins, so a later `accepted` supersedes an earlier `escalated`. Both `runs` and `observability` join each run to its latest outcome (`[accepted]`, `[escalated]`, `[unrated]`, …) and `observability` reports a runs-by-outcome breakdown.

Inspect recent runs:

```sh
./plugins/fable-orchestrator/bin/fable-orchestrator runs            # human summary with per-model totals and outcomes
./plugins/fable-orchestrator/bin/fable-orchestrator runs --json     # records enriched with the joined outcome
./plugins/fable-orchestrator/bin/fable-orchestrator runs --limit 5  # most recent five
./plugins/fable-orchestrator/bin/fable-orchestrator observability   # trace, Laminar readiness, outcome, and recent-run summary
```

### Comparative report

`report` aggregates the captured runs and their latest outcomes into a comparison you can use to justify routing changes. Group by `model` (default), `backend`, `mode`, or `task_class`:

```sh
./plugins/fable-orchestrator/bin/fable-orchestrator report                        # by model
./plugins/fable-orchestrator/bin/fable-orchestrator report --group-by task_class  # by parent-authored class
./plugins/fable-orchestrator/bin/fable-orchestrator report --json --limit 200     # machine-readable, last 200 runs
```

Each group reports run count, completion rate (by run status), acceptance rate (accepted ÷ rated runs — `n/a` when nothing in the group was annotated), the outcome breakdown, budget violations, and mean/total tokens and duration. Only annotated runs count toward acceptance, so the report distinguishes "the worker finished" from "the parent kept the result."

### Budget thresholds

Two opt-in, per-run thresholds bound delegated work, with deliberately different enforcement because of what each can know mid-flight:

- `FABLE_ORCHESTRATOR_MAX_DURATION_MS` is a **hard stop**: the runner kills the worker subprocess at the deadline, the run fails with a `budget:` error, and the trace records `duration_exceeded`. Use it to stop stuck or runaway workers.
- `FABLE_ORCHESTRATOR_MAX_TOKENS` is a **post-run flag**: token usage is only known once the CLI exits, so a completed run that exceeds the ceiling still returns its result, but the runner warns on stderr, the trace records `tokens_exceeded`, and `report` counts the violation for its group. Discarding finished work would waste exactly the usage the budget exists to protect.

From the measured workload matrix (`docs/orchestrator/workload-matrix.md`): bounded implementation runs land around 16k (Composer) to 114k (Codex) tokens, scoped analysis/review around 100k–200k, while an unscoped Codex analysis of a large repository has reached 2.75M tokens. A reasonable starting point is `FABLE_ORCHESTRATOR_MAX_TOKENS=500000` with a 10–15 minute duration ceiling, tightened per task class as your own `report` data accumulates.

## Parallel Delegation

Task scheduling stays in the parent model — it can dispatch several workers at once — and the runner enforces the safety boundary (see `docs/orchestrator/parallel-delegation.md` for the full evaluation):

- **Read-only routes (`analyze`, `review`) always run in parallel safely.** They never take a lock.
- **Write-capable runs (`implement`) serialize per project.** The runner claims an advisory lock keyed to the working directory's project identifier before spawning the worker; a second write-capable run against the same project fails fast with an actionable error instead of silently interleaving edits. Set `FABLE_ORCHESTRATOR_LOCK_WAIT_MS` to queue behind the current run instead of failing, or `FABLE_ORCHESTRATOR_WRITE_LOCK=0` to opt out entirely.
- **Separate worktrees parallelize writes safely.** Different checkouts resolve to different project identifiers, so giving each worker its own worktree is the supported way to run implementation tasks concurrently.
- Locks record their holder (pid + run id); locks left by dead processes are reclaimed automatically, and every lock is released when its run finishes.

Inside Claude Code TUI, use `/fable-orchestrator:observability` for the same delegated-worker view. This observes worker runs launched through the orchestrator runner; it does not trace every parent Fable message, direct edit, or Claude Code tool call.

Generate repo-specific prompt packs:

```sh
# In Claude Code TUI
/fable-orchestrator:prompt-factory scan this repository and create docs/orchestrator prompt md files that show exactly how to use the orchestrator for repo scan, file review, plugin sync, implementation, and test strategy.
```

Shared prompt wording belongs in `plugins/orchestrator-core/prompt-factory.ts`; generated docs should focus on the user's selected surface instead of mixing Claude Code, Pi, and Copilot instructions in every prompt.

Disable tracing with `FABLE_ORCHESTRATOR_TRACE=0`; relocate it with `FABLE_ORCHESTRATOR_TRACE_DIR`.

### Optional Laminar export

With `FABLE_ORCHESTRATOR_LAMINAR=1` and `LMNR_PROJECT_API_KEY` set, each run is also exported to [Laminar](https://www.laminar.sh) as a scored evaluation datapoint (grouped under `LMNR_PROJECT_NAME`), carrying the same redacted metadata plus numeric scores for duration, tokens, changed files, and completion. Export is strictly opt-in, uses plain HTTPS with no extra dependency, and a failed export never fails the run — it logs one stderr warning and continues. After a successful export the runner prints the evaluation's dashboard URL to stderr (`fable-orchestrator: laminar: …`) so each run is one click to inspect.

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
