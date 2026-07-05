# Fable Orchestrator

Fable Orchestrator is a Claude Code marketplace plugin that keeps Claude Fable 5 focused on planning, judgment, and final review while delegating bounded execution to Cursor Composer 2.5 and Codex.

```text
                              Claude Fable 5
                         planning and final judgment
                                      |
             +------------------------+------------------------+
             |                        |                        |
    composer-implement         codex-implement        codex-explore/check
     Composer 2.5                  GPT-5.5              GPT-5.4-mini/5.5
   routine implementation     difficult escalation      analysis and review
```

Fable decides what should happen. Workers receive a narrow contract, perform one task, and return compact structured evidence.

## What You Get

- `/fable-orchestrator:orchestrate` chooses the appropriate worker with Fable as the default/recommended parent orchestrator.
- `/fable-orchestrator:orchestrate-with-model` uses the same worker delegation pattern from Opus or the current Claude Code model when the user explicitly wants to orchestrate without Fable.
- `/fable-orchestrator:direct-worker` runs one bounded worker directly from the parent Claude Code session when auto mode blocks the thin Agent wrapper.
- `/fable-orchestrator:setup` diagnoses installations, authentication, and unsafe sudo-created Cursor state.
- `/fable-orchestrator:observability` shows local trace status, Laminar readiness, recent delegated runs, and per-model totals inside Claude Code.
- `/fable-orchestrator:prompt-factory` scans a repository and creates `docs/orchestrator/*.md` prompt files for using the orchestrator from the selected surface. In Claude Code, it defaults to Claude Code slash-command examples.
- Cursor projects can use `plugins/cursor-orchestrator` when Fable is available in Cursor; Fable remains the default parent orchestrator there too.
- `composer-implement` handles routine, clear-spec implementation through Cursor Composer 2.5.
- `codex-implement` handles difficult implementation and escalation through GPT-5.5.
- `codex-explore` performs verbose repository analysis through a read-only Codex profile.
- `codex-check` provides an independent read-only implementation review.
- `opus-review` provides high-taste read-only critique for UI/UX, API design, docs, copy, prompts, and long-lived abstractions.
- `fable-orchestrator` provides a scriptable, structured CLI for both backends.

## Routing

| Worker | Backend | Default model | Access | Use when |
| --- | --- | --- | --- | --- |
| `composer-implement` | Cursor Agent | `composer-2.5` | Write-capable | The approach is approved and implementation is clear, repetitive, or high-volume |
| `codex-implement` | Codex CLI | `gpt-5.5` | `workspace-write` | The task is difficult, debugging-heavy, or Composer missed the quality bar |
| `codex-explore` | Codex CLI | `gpt-5.4-mini` | `read-only` | Investigation would consume substantial Fable context |
| `codex-check` | Codex CLI | `gpt-5.5` | `read-only` | Independent correctness, security, regression, or acceptance-criteria review is valuable |
| `opus-review` | Claude Code Agent | Opus 4.8 | `read-only` | Taste, UX, API ergonomics, docs/copy, prompt, or abstraction review is valuable |

Keep architecture, ambiguous requirements, user interaction, and final decisions in the parent orchestrator. Fable is the default/recommended parent; Opus or the current Claude Code model can be used explicitly through `/fable-orchestrator:orchestrate-with-model`.

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
```

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

This repository also includes a Fable-first Cursor surface plus Codex-first surfaces for Pi and GitHub Copilot. Cursor can use Fable as the default parent orchestrator because Fable is available there. Pi and Copilot do **not** make Fable the default parent orchestrator; they use Codex 5.5 as the default parent/orchestration model.

### Cursor rules and prompts

Install into a Cursor project:

```sh
mkdir -p .cursor/rules
cp plugins/cursor-orchestrator/rules/orchestrator.mdc .cursor/rules/orchestrator.mdc
```

The Cursor surface includes:

- `plugins/cursor-orchestrator/rules/orchestrator.mdc`
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
| `FABLE_ORCHESTRATOR_ANALYZE_MODEL` | `gpt-5.4-mini` | Codex analysis model |
| `FABLE_ORCHESTRATOR_IMPLEMENT_MODEL` | `gpt-5.5` | Codex implementation model |
| `FABLE_ORCHESTRATOR_REVIEW_MODEL` | `gpt-5.5` | Codex review model |
| `CURSOR_API_KEY` | unset | Cursor's supported non-keychain authentication path |
| `FABLE_ORCHESTRATOR_TRACE` | `1` | Set to `0` to disable local trace records |
| `FABLE_ORCHESTRATOR_TRACE_DIR` | `~/.fable-orchestrator/traces` | Trace record location |
| `FABLE_ORCHESTRATOR_TRACE_LIMIT` | `1000` | Retained trace records; `0` keeps all |
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

Each group reports run count, completion rate (by run status), acceptance rate (accepted ÷ rated runs — `n/a` when nothing in the group was annotated), the outcome breakdown, and mean/total tokens and duration. Only annotated runs count toward acceptance, so the report distinguishes "the worker finished" from "the parent kept the result."

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
