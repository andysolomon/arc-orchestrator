# Architecture

Visual references:

- [Editable Excalidraw and rendered PNG diagrams](diagrams/README.md)
- [Mermaid component, routing, and sequence diagrams](diagrams/mermaid.md)

## Objective

Fable Orchestrator separates high-value judgment from token-heavy execution:

- Claude Fable 5 owns planning, ambiguity resolution, architecture, worker selection, and final review.
- Thin Sonnet wrappers translate a bounded task into one external CLI invocation.
- Cursor Composer 2.5 or Codex performs the task in an isolated context.
- The worker returns a compact JSON handoff for Fable to evaluate.

This prevents verbose exploration and implementation transcripts from consuming the main Fable context.

## Components

```text
Claude Code
├── orchestrate skill
│   └── selects one worker
├── setup skill
│   └── runs local diagnostics
├── worker agents
│   ├── composer-implement
│   ├── codex-implement
│   ├── codex-explore
│   └── codex-check
└── fable-orchestrator executable
    ├── Cursor Agent backend
    └── Codex CLI backend
```

Worker agents are intentionally thin. They do not inspect the repository or solve the task themselves. Each invokes the runner once and returns its output.

## Execution Flow

```text
User goal
   |
   v
Fable clarifies and chooses an approach
   |
   +--> optional codex-explore --read-only
   |          |
   |          v
   |     compact evidence
   |
   v
Fable writes a bounded implementation contract
   |
   +--> composer-implement --write-capable
   |          or
   +--> codex-implement --workspace-write
   |
   v
Fable inspects changes and verification
   |
   +--> optional codex-check --read-only
   |
   v
Fable makes the final decision
```

## Backend Contracts

### Cursor Composer 2.5

Invocation:

```sh
cursor-agent \
  --print \
  --force \
  --output-format json \
  --model composer-2.5 \
  --workspace <path> \
  <prompt>
```

Cursor is restricted to implementation because `--force` enables edits and terminal commands without interactive confirmation. The plugin does not expose Cursor-backed analysis or review routes.

Cursor does not accept a caller-provided output schema. The runner therefore validates and normalizes Cursor's final response locally before returning it.

### Codex

Invocation:

```sh
codex exec \
  --ephemeral \
  --model <model> \
  --sandbox <read-only|workspace-write> \
  --cd <path> \
  --output-schema <schema> \
  --output-last-message <file> \
  <prompt>
```

Codex receives an explicit sandbox per route:

- `analyze`: `read-only`
- `review`: `read-only`
- `implement`: `workspace-write`

The structured output schema is enforced by Codex and validated again by the runner.

## Trust Boundaries

| Boundary | Enforcement |
| --- | --- |
| Fable versus worker | Worker receives only the bounded task, not authority to make final decisions |
| Claude wrapper versus external CLI | Wrapper performs exactly one runner invocation |
| Read-only versus write work | Codex sandbox and backend/mode validation |
| Worker output versus accepted result | Shared structured-result validation |
| Workspace versus broader filesystem | Codex sandbox; explicit Cursor workspace; task prohibitions |
| User approval versus delivery actions | No worker may commit, push, merge, or deploy |

## Structured Handoff

All successful tasks normalize to:

```json
{
  "status": "completed",
  "summary": "What happened",
  "changes": ["Files or behavior changed"],
  "verification": ["Commands or checks performed"],
  "risks": ["Residual concerns"],
  "next_actions": ["Recommended follow-up"]
}
```

`status` is `completed` or `blocked`. The other collection fields are arrays of strings. Malformed results fail the run.

## Failure Model

- Missing binaries fail before delegation.
- Authentication failures preserve actionable backend error output.
- Cursor keychain and sudo-created ownership issues are reported by `doctor`.
- Unsupported backend/mode combinations fail before invoking a model.
- A worker failure never becomes a Claude-wrapper implementation attempt.
- Fable decides whether to retry, escalate from Composer to GPT-5.5 (or use explicit `sol-implement` / `workload_class` stacks when Sol is required), or return to the user.
