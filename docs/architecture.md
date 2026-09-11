# Architecture

Visual references:

- [Editable Excalidraw and rendered PNG diagrams](diagrams/README.md)
- [Mermaid component, routing, and sequence diagrams](diagrams/mermaid.md)

## ARC Delegate lifecycle routing

Runner-routing-v4 uses lifecycle phase as an explicit routing dimension.
Explore, Research, Plan, Verify, and Deploy each have an ordered model/effort
stack; Analyze is parent-local and never delegated. Implement requires one of
the nine canonical two-axis difficulty × volume classes — `hard-heavy`,
`hard-medium`, `hard-light`, `medium-heavy`, `medium-medium`, `medium-light`,
`easy-heavy`, `easy-medium`, or `easy-light` — and maps each class to its own
ordered stack. Automatic calls pass `--phase`, omit `--backend` and `--route`,
and add `--workload-class` for Implement. Explicit routes pin one candidate
without inheriting automatic fallback. Every automatic stack appends the
shared MiniMax M3 → Composer 2.5 emergency tail, and only availability
failures advance it. OpenCode Go candidates may appear in approved primary
stacks; their transport exposes no effort control and runs at `none`.

Phase-to-mode validation keeps Explore/Research/Plan read-only, Verify in
review mode, and Implement/Deploy write-capable.

Deploy remains human-in-the-loop. The CLI rejects a deploy-phase invocation
unless `--deploy-authorized true` is present. The parent is responsible for
obtaining that authorization; workers cannot infer it. See
[`docs/orchestrator/arc-delegate.md`](orchestrator/arc-delegate.md) for the
complete contract and lifecycle artifact rules.

## Objective

Fable Orchestrator separates high-value judgment from token-heavy execution:

- The active parent orchestrator owns planning, ambiguity resolution, architecture, worker selection, and final review.
- Thin worker agents translate a bounded task into one external CLI invocation.
- Claude Code, Codex, Cursor, OpenCode Go, MiniMax, or direct Kimi-compatible backends perform bounded work through the runner's approved routes.
- The worker returns a compact JSON handoff for the parent to evaluate.

This prevents verbose exploration and implementation transcripts from consuming the main parent context.

## Components

```text
Parent surfaces (Claude Code, Pi, Cursor, or Copilot)
├── orchestrate skill / command
│   └── selects a bounded worker route
├── setup and diagnostics surfaces
│   └── validate local runner and backend readiness
├── worker agents and explicit aliases
│   ├── Composer, Opus, and Grok routes
│   └── provider-qualified OpenCode Go routes
└── arc-orchestrator executable
    ├── Claude Code backend
    ├── Cursor Agent backend
    ├── Codex CLI backend
    ├── OpenCode Go backend
    └── MiniMax / Kimi-compatible Claude transports
```

Worker agents are intentionally thin. They do not inspect the repository or solve the task themselves. Each invokes the runner once and returns its output.

## Execution Flow

```text
User goal
   |
   v
Parent orchestrator clarifies and chooses an approach
   |
   +--> optional automatic Explore / Research / Plan (read-only)
   |          |
   |          v
   |     compact evidence
   |
   v
Parent-local Analyze (no worker invocation)
   |
   v
Parent orchestrator writes a bounded implementation contract
   |
   +--> automatic Implement + workload class (write-capable)
   |          or
   +--> explicit pinned route (write-capable)
   |
   v
Parent orchestrator inspects changes and verification
   |
   +--> optional automatic Verify (read-only)
   |
   v
Parent orchestrator makes the final decision
```

## Backend Contracts

### Cursor-backed routes

Composer 2.5 remains the explicit write-capable Cursor route:

```sh
cursor-agent \
  --print \
  --force \
  --output-format json \
  --model composer-2.5 \
  --workspace <path> \
  <prompt>
```

Cursor Grok 4.6 High may also appear in automatic read-only and
write-capable stacks. Read-only Cursor calls use plan mode; fixed-high model
profiles do not receive a fabricated generic effort flag. Cursor does not
accept a caller-provided output schema, so the runner validates and normalizes
its final response locally.

### OpenCode Go

OpenCode Go routes use provider-qualified model identities and no effort flag:

```sh
opencode --pure run \
  --agent <read-only-agent-for-analyze-or-review> \
  --format json \
  --model opencode-go/<model> \
  <prompt>
```

The runner applies its read-only agent boundary for Explore, Research, Plan,
and Verify placements. OpenCode Go aliases are explicit pins unless the
current policy places the corresponding identity in an automatic stack.

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
| ------------------------------------- | ---------------------------------------------------------------------------- |
| Parent versus worker | Worker receives only the bounded task, not authority to make final decisions |
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
- Availability failures can advance only the current automatic stack; task,
  malformed-output, and verification failures are terminal.
- The parent decides whether to retry the current phase stack, select a different
  Implement complexity class, or return to the user.
