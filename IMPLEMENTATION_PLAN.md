# Fable Orchestrator Implementation Plan

## 1. Product Goal and Scope Boundaries

Build a reusable Claude Code plugin that keeps Claude Fable 5 at `high` effort as the primary planner and decision-maker while delegating bounded, token-intensive work to Cursor Composer 2.5 or Codex.

The initial product:

- routes repository analysis, implementation, and review tasks to explicit Codex profiles;
- invokes the local `codex exec` CLI rather than introducing another hosted service;
- invokes Cursor Agent headlessly for cost-efficient Composer 2.5 implementation;
- applies least-privilege sandboxing per task class;
- returns schema-validated, compact results for Fable to evaluate;
- ships a Claude Code marketplace plugin, four thin worker agents, orchestration and setup skills, and a reusable `CLAUDE.md` routing policy.

The plugin does not autonomously choose paid API credentials, bypass approval systems, push code, merge changes, deploy, or provide Claude Code computer-use delegation in the first release.

## 2. Current Baseline

**Mode:** Greenfield.

At planning time the repository contained no implementation files. The local environment provides:

- Claude Code `2.1.198`, including plugin validation and local `--plugin-dir` loading;
- Codex CLI `0.141.0`, including stable `codex exec`, model selection, sandbox selection, JSON Schema output, and last-message output;
- Cursor Agent with Composer 2.5, non-interactive JSON output, and write-capable implementation mode;
- Bun for the TypeScript runtime and tests.

External product assumptions are grounded in current official documentation:

- Claude Code plugins may package skills and executables in `bin/`: <https://code.claude.com/docs/en/plugins>
- Claude Code effort levels include `high`, `xhigh`, and `max`: <https://code.claude.com/docs/en/model-config>
- Codex non-interactive runs support explicit models, sandboxes, and structured outputs: <https://developers.openai.com/codex/noninteractive>

Unknowns that require real usage data:

- the token and latency savings across representative repositories;
- how consistently Fable auto-invokes the routing skill without a project `CLAUDE.md` snippet;
- whether future Claude Code releases expose a stable external computer-use delegation interface.

## 3. Full Capability Map

| Capability | Initial status | Target behavior |
| --- | --- | --- |
| Fable routing policy | Included | Fable plans, delegates bounded work, reviews evidence, and owns final decisions |
| Thin worker agents | Included | Low-effort Sonnet wrappers forward exactly one task to Cursor Agent or Codex |
| Repository analysis | Included | Codex uses a faster read-only profile and returns findings without raw transcript noise |
| Implementation | Included | Composer 2.5 handles routine work; GPT-5.5 handles difficult work and escalation |
| Code review | Included | GPT-5.5 runs read-only and reports prioritized risks |
| Structured handoff | Included | Every successful run conforms to one JSON schema |
| Composer 2.5 implementation | Included | Cursor Agent performs bounded write-capable implementation and returns normalized JSON |
| Configuration | Included | Environment variables override profile models and executable paths |
| Auditability | Included | Runner appends redacted JSONL trace records per run and exposes a `runs` summary command |
| Computer use | Deferred | Route browser/desktop work when a stable non-interactive interface is available |
| Parallel orchestration | Deferred | Fable may invoke independent runs, but the plugin does not schedule a task graph |
| Budget telemetry | Partial | Token usage and duration are captured per run; per-task budget enforcement is deferred |

## 4. Milestones

### Phase 1: Routing Contract and Safety Model

**Goal:** Define a small, defensible delegation boundary.

**Deliverables**

- A routing matrix for `analyze`, `implement`, and `review`.
- A shared structured-result schema.
- Explicit model, sandbox, and completion responsibilities for every route.

**Dependencies**

- Installed and authenticated Claude Code and Codex CLIs.

**Risks**

- Broad delegation prompts can cause duplicate work or unclear ownership.
- A write-capable fallback can exceed intended scope without explicit task constraints.

**Acceptance criteria**

- Every supported route has one default model and sandbox.
- Fable remains responsible for planning, result evaluation, and user-facing conclusions.
- No profile uses `danger-full-access`.

### Phase 2: Claude Code Plugin Scaffold

**Goal:** Make the orchestrator loadable and discoverable by Claude Code.

**Deliverables**

- `.claude-plugin/marketplace.json`.
- `plugins/fable-orchestrator/.claude-plugin/plugin.json`.
- `plugins/fable-orchestrator/skills/orchestrate/SKILL.md`.
- `composer-implement`, `codex-implement`, `codex-check`, and `codex-explore` agents.
- A root `CLAUDE.md` with model rankings and delegation mechanics.
- A `CLAUDE.md` policy template for projects that require persistent automatic routing.
- Plugin usage documentation.

**Dependencies**

- Claude Code plugin format supported by the installed CLI.

**Risks**

- Skill auto-invocation is probabilistic; explicit skill invocation remains necessary for deterministic use.

**Acceptance criteria**

- `claude plugin validate --strict .` succeeds.
- `claude --plugin-dir ./plugins/fable-orchestrator` can discover `/fable-orchestrator:orchestrate`.
- Documentation distinguishes plugin instructions from project-level `CLAUDE.md`.

### Phase 3: Safe Codex Runner

**Goal:** Execute bounded Codex work with machine-readable handoffs.

**Deliverables**

- `plugins/fable-orchestrator/bin/fable-orchestrator` Bun entrypoint.
- Argument validation and profile selection.
- Safe subprocess invocation without shell interpolation.
- JSON Schema-constrained output and meaningful process errors.

**Dependencies**

- `codex exec` with `--output-schema` support.

**Risks**

- User-level Codex configuration can affect behavior.
- Target repositories may not be Git repositories.
- Codex authentication or rate limits may fail independently of Claude Code.

**Acceptance criteria**

- Analysis and review run read-only.
- Implementation runs with `workspace-write`.
- Invalid modes and missing tasks fail before invoking Codex.
- Non-Git targets use the documented Codex opt-out explicitly.
- Codex failures preserve actionable stderr without fabricating a successful result.

### Phase 4: Verification and Routing Guidance

**Goal:** Prove profile selection and make delegation behavior repeatable.

**Deliverables**

- Bun tests using a fake Codex executable.
- README setup, invocation, environment configuration, and safety guidance.
- Editable Excalidraw plus Mermaid architecture and delegation diagrams.
- Synchronized progress tracking.

**Dependencies**

- Bun test runner.

**Risks**

- Mocked subprocess tests cannot prove model quality or authentication.

**Acceptance criteria**

- Tests verify the exact model and sandbox selected for each profile.
- Tests verify structured output pass-through and failure behavior.
- A manual smoke-test command is documented.
- Architecture, routing, and escalation behavior are represented with concrete visual examples.

### Phase 5: Composer 2.5 Backend

**Goal:** Add a lower-cost implementation worker without weakening the safety boundary.

**Deliverables**

- Cursor Agent backend using model ID `composer-2.5`.
- A dedicated `composer-implement` worker.
- Local normalization into the shared handoff contract.
- Explicit rejection of Composer exploration and review routes.
- A setup diagnostic covering binary availability, independent backend authentication, and sudo-created Cursor state.

**Dependencies**

- Installed and authenticated Cursor Agent CLI.
- An unlocked macOS login keychain when Cursor authentication uses it.

**Risks**

- Cursor `--force` allows direct edits and terminal commands without confirmation.
- Cursor JSON output is not constrained by a caller-provided JSON Schema.
- Model availability and billing depend on the user's Cursor plan.

**Acceptance criteria**

- Composer is used only for bounded implementation.
- Cursor output is validated before it reaches Fable.
- GPT-5.5 remains an explicit escalation path.
- Tests verify model selection, write flags, normalization, and route rejection.
- `/fable-orchestrator:setup` reports actionable recovery steps without handling secrets.

### Phase 6: Empirical Routing and Advanced Delegation

**Goal:** Optimize routing using observed cost, quality, and latency.

**Deliverables**

- Run telemetry with token, latency, and outcome data.
- Configurable task-budget thresholds.
- Optional parallel task scheduling for independent work.
- A supported computer-use route when an appropriate CLI or API surface exists.

**Dependencies**

- Representative workloads and user-approved telemetry storage.
- Stable provider interfaces for advanced routes.

**Risks**

- Premature automation can spend more tokens through duplicated context and review.
- Provider capabilities and model identifiers can change.

**Acceptance criteria**

- Routing changes are justified by measured workloads.
- Budget violations stop or downgrade work predictably.
- Advanced routes preserve least privilege and compact handoffs.

### Phase 7: Run Observability Observer

**Goal:** Add a lightweight local observer that makes model usage, routing decisions, and task outcomes auditable without turning the orchestrator into a telemetry platform.

**Deliverables**

- A runner-side JSONL trace writer for delegated runs (default on; `FABLE_ORCHESTRATOR_TRACE=0` disables, `FABLE_ORCHESTRATOR_TRACE_DIR` relocates).
- Logged metadata for backend, route, explicit model, sandbox, cwd, duration, exit code, structured status, changed-file count, token usage, and short error summaries.
- A redaction policy that excludes full prompts, raw file contents, secrets, and other sensitive payloads by default; task text is reduced to a truncated label.
- A `runs` summary subcommand with `--json` and `--limit` for inspecting recent runs and per-model totals.
- A strictly opt-in Laminar export (`FABLE_ORCHESTRATOR_LAMINAR=1` plus `LMNR_PROJECT_API_KEY`) that ships the same redacted metadata as scored evaluation datapoints over plain HTTPS, and never fails the run.

**Dependencies**

- Stable runner output for Codex and Composer invocations.
- A decision on the storage location and retention behavior for local trace files.

**Risks**

- Over-logging can expose sensitive material or recreate the context-bloat problem the orchestrator is meant to avoid.
- Trace files can become noisy if they do not preserve one record per delegation attempt.
- Observability can drift into product analytics unless the scope stays local and opt-in.

**Acceptance criteria**

- A delegated run can be inspected after the fact without reading raw prompts.
- The observer clearly shows which model and backend were used for each task.
- Sensitive data remains absent from default logs.
- The observer works for both Codex and Cursor Composer paths.
- Documentation explains how to enable, inspect, and disable the observer.

## 5. Out of Scope / Deferred

- Replacing Claude Code's native subagent system.
- Sending repository contents to an intermediary service.
- Automatic Git commits, pushes, pull requests, merges, or deployments.
- Unrestricted shell execution.
- Provider-agnostic orchestration before the Fable-to-Codex workflow is validated.
- A web dashboard or persistent control plane.
- Centralized analytics or any always-on hosted observability backend. The sole exception is the strictly opt-in, redacted Laminar run export, which is disabled unless the user sets `FABLE_ORCHESTRATOR_LAMINAR=1`.

## 6. Immediate Next Steps

1. Load the plugin locally with `claude --plugin-dir ./plugins/fable-orchestrator --model fable --effort high`.
2. Run `/fable-orchestrator:setup` and confirm both backends are ready.
3. Execute one read-only Codex analysis task and inspect the structured handoff.
4. Execute one Composer implementation task in a disposable Git repository.
5. Escalate the same bounded task to GPT-5.5 only if Composer misses the quality bar.
6. Record token, latency, and result-quality observations before changing routing defaults; `fable-orchestrator runs` now surfaces token and duration totals per model.
7. After representative workloads, review the accumulated `runs.jsonl` (or the Laminar dashboard) and revisit the CLAUDE.md usage-headroom rankings with measured data.
