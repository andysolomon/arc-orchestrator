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

- `/fable-orchestrator:orchestrate` chooses the appropriate worker.
- `/fable-orchestrator:setup` diagnoses installations, authentication, and unsafe sudo-created Cursor state.
- `composer-implement` handles routine, clear-spec implementation through Cursor Composer 2.5.
- `codex-implement` handles difficult implementation and escalation through GPT-5.5.
- `codex-explore` performs verbose repository analysis through a read-only Codex profile.
- `codex-check` provides an independent read-only implementation review.
- `fable-orchestrator` provides a scriptable, structured CLI for both backends.

## Routing

| Worker | Backend | Default model | Access | Use when |
| --- | --- | --- | --- | --- |
| `composer-implement` | Cursor Agent | `composer-2.5` | Write-capable | The approach is approved and implementation is clear, repetitive, or high-volume |
| `codex-implement` | Codex CLI | `gpt-5.5` | `workspace-write` | The task is difficult, debugging-heavy, or Composer missed the quality bar |
| `codex-explore` | Codex CLI | `gpt-5.4-mini` | `read-only` | Investigation would consume substantial Fable context |
| `codex-check` | Codex CLI | `gpt-5.5` | `read-only` | Independent correctness, security, regression, or acceptance-criteria review is valuable |

Keep architecture, ambiguous requirements, user interaction, and final decisions in Fable.

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

Codex continues to load normal user and trusted-project configuration. Cursor Agent continues to load its normal rules and project state.

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
- `docs/delegation-guide.md` — route selection, task contracts, examples, and escalation
- `docs/troubleshooting.md` — authentication, keychain, ownership, and backend failures
- `IMPLEMENTATION_PLAN.md` — roadmap, risks, and acceptance criteria
- `progress.txt` — synchronized execution state

## Current Limits

- Routing is policy-driven, not telemetry-driven.
- The runner does not persist an audit history.
- Parallel task scheduling and budget enforcement are deferred.
- Computer-use delegation is not implemented.
- Real-world model rankings remain heuristics until representative workloads are measured.

## References

- [Claude Code plugins](https://code.claude.com/docs/en/plugins)
- [OpenAI Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc)
- [Cursor Composer 2.5](https://cursor.com/docs/models/cursor-composer-2-5)
- [Cursor Agent headless CLI](https://cursor.com/docs/cli/headless)
- [Composer 2.5 orchestration article](https://note.com/ai_driven/n/n9018ad630d78?hl=en)
