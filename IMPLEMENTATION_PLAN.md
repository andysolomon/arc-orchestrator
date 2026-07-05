# Fable Orchestrator Implementation Plan

## 1. Product Goal and Scope Boundaries

Build a reusable orchestrator that keeps a strong parent model — Claude Fable 5 at `high` effort by default — focused on planning and decision-making while delegating bounded, token-intensive work to Cursor Composer 2.5 or Codex. The primary surface is a Claude Code marketplace plugin; the same delegation pattern is also packaged for Pi and GitHub Copilot, where Codex 5.5 is the default parent.

The product:

- routes repository analysis, implementation, and review tasks to explicit Codex profiles;
- invokes the local `codex exec` CLI rather than introducing another hosted service;
- invokes Cursor Agent headlessly for cost-efficient Composer 2.5 implementation;
- applies least-privilege sandboxing per task class;
- returns schema-validated, compact results for the parent model to evaluate;
- ships a Claude Code marketplace plugin, four thin worker agents, orchestration, model-selection, observability, prompt-factory, and setup skills, and a reusable `CLAUDE.md` routing policy;
- packages the same routing policy for Pi and GitHub Copilot surfaces through a shared `orchestrator-core`.

The orchestrator does not autonomously choose paid API credentials, bypass approval systems, push code, merge changes, deploy, or provide computer-use delegation.

## 2. Current Baseline

**Mode:** Gap analysis.

The repository now contains a working Claude Code marketplace plugin, four worker agents, Codex and Cursor backends, local run traces, `runs` and `observability` inspection commands, and opt-in Laminar export. It also ships the multi-surface expansion (Phase 9): a shared `orchestrator-core` prompt factory, Pi and Copilot orchestration packs, and the `orchestrate-with-model`, `observability`, and `prompt-factory` skills. Phases 1 through 5, 7, and 9 are implemented, including the observability privacy, retention, and test-portability hardening.

Current validation evidence:

- strict marketplace validation passes;
- strict plugin validation passes;
- all Bun tests pass repeatedly in a normal local environment (25 tests across `test/orchestrator.test.ts` and `test/plugin-surfaces.test.ts`), and the Laminar integration test skips itself with a warning in network-restricted sandboxes that cannot bind a local test server;
- local traces capture model, backend, mode, duration, token usage, status, changed-file count, an opaque project identifier, and an optional explicit `--label`; task text and absolute paths are never recorded;
- the trace file retains a bounded number of records (default 1000, `FABLE_ORCHESTRATOR_TRACE_LIMIT` configurable);
- runs can carry a parent-authored task class and route rationale, and the parent records acceptance/rejection/escalation through the `annotate` command; `runs` and `observability` join each run to its latest outcome;
- the `report` command aggregates runs and outcomes by model, backend, mode, or task class with completion, acceptance, token, and latency measures;
- a representative workload matrix has been run (`docs/orchestrator/workload-matrix.md`): Codex accepted 4/4 across exploration, review, and implementation, while both Composer implementation runs were rejected because the runner could not parse Composer's prose-prefixed JSON envelope even though the code was correct;
- that envelope defect is now fixed: `extractComposerResult` extracts the last valid embedded JSON object via a string-aware balanced-brace scan, regression-tested against the captured prose and prose-fenced shapes and verified with a real end-to-end Composer run;
- the Composer half of the matrix has been re-run post-fix: 2/2 completed and accepted at ~17% of Codex's tokens and ~63% of its wall time on identical tasks, validating the Composer-first implementation routing and the existing usage-headroom rankings;
- persisted error summaries are redacted before they reach `runs.jsonl` or Laminar: echoed task text and absolute paths are replaced with `<task>`/`<path>` placeholders while the parent still receives the full detail on stderr;
- per-run budget thresholds are enforceable: `FABLE_ORCHESTRATOR_MAX_DURATION_MS` kills the worker at the deadline and records an auditable `budget:` failure, while `FABLE_ORCHESTRATOR_MAX_TOKENS` flags completed over-budget runs in the trace and in `report` without discarding finished work. Phase 6 is complete;
- overlapping writes are prevented: write-capable runs serialize per project through an advisory lock with stale-holder reclamation and optional bounded waiting, read-only runs stay lock-free, and the Phase 8 scheduling/computer-use evaluation is recorded in `docs/orchestrator/parallel-delegation.md`.

External product assumptions are grounded in current official documentation:

- Claude Code plugins may package skills and executables in `bin/`: <https://code.claude.com/docs/en/plugins>
- Claude Code effort levels include `high`, `xhigh`, and `max`: <https://code.claude.com/docs/en/model-config>
- Codex non-interactive runs support explicit models, sandboxes, and structured outputs: <https://developers.openai.com/codex/noninteractive>

Unknowns that require real usage data:

- the token and latency savings across representative repositories;
- how consistently Fable auto-invokes the routing skill without a project `CLAUDE.md` snippet;
- whether future Claude Code releases expose a stable external computer-use delegation interface.

## 3. Capability Status and Missing Capabilities

| Capability | Current status | Target behavior |
| --- | --- | --- |
| Fable routing policy | Included | Fable plans, delegates bounded work, reviews evidence, and owns final decisions |
| Thin worker agents | Included | Low-effort Sonnet wrappers forward exactly one task to Cursor Agent or Codex |
| Repository analysis | Included | Codex uses a faster read-only profile and returns findings without raw transcript noise |
| Implementation | Included | Composer 2.5 handles routine work; GPT-5.5 handles difficult work and escalation |
| Code review | Included | GPT-5.5 runs read-only and reports prioritized risks |
| Structured handoff | Included | Every successful run conforms to one JSON schema |
| Composer 2.5 implementation | Included | Cursor Agent performs bounded write-capable implementation and returns normalized JSON |
| Configuration | Included | Environment variables override profile models and executable paths |
| Auditability | Included | Runner appends redacted, path-free JSONL trace records with bounded retention and exposes `runs` and `observability` commands |
| Multi-surface packaging | Included | A shared `orchestrator-core` powers the Claude Code plugin plus Pi and Copilot orchestration packs |
| Model-agnostic orchestration | Included | `orchestrate-with-model` runs the delegation pattern from Fable (default), Opus, or the current Claude Code model |
| Prompt factory | Included | `prompt-factory` scans a repository and writes `docs/orchestrator/*.md` usage prompts tailored to the active surface |
| Computer use | Deferred | Route browser/desktop work when a stable non-interactive interface is available (re-evaluated 2026-07-05: none exists) |
| Parallel orchestration | Included | The parent dispatches independent runs; the runner serializes write-capable runs per project via an advisory lock, keeps read-only runs lock-free, and allows write parallelism across worktrees |
| Budget telemetry | Included | Per-run thresholds: `FABLE_ORCHESTRATOR_MAX_DURATION_MS` hard-stops runaway workers; `FABLE_ORCHESTRATOR_MAX_TOKENS` flags over-budget completed runs, and `report` counts violations |
| Outcome evaluation | Included | Task class, route rationale, and parent acceptance/escalation are captured per run via `--task-class`/`--route-rationale` and the `annotate` command |
| Comparative reporting | Included | The `report` command aggregates completion, acceptance, token, and latency measures by model, backend, mode, or task class |

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

### Phase 6: Empirical Routing and Budget Control

**Goal:** Turn run telemetry into defensible routing rules and predictable budget controls.

**Deliverables**

- Run telemetry with token and latency data.
- Outcome annotations for accepted, rejected, blocked, verification-failed, and escalated work.
- Task-class and route-rationale fields that do not contain raw prompt text.
- A comparative report grouped by task class, backend, and model with completion, acceptance, token, and latency measures.
- A small representative workload matrix for Composer implementation, Codex implementation, exploration, and review.
- Configurable task-budget thresholds grounded in the observed workload data.

**Dependencies**

- Phase 7 observability hardening.
- Representative workloads and user-approved local telemetry storage.

**Risks**

- Self-reported worker completion is not a quality signal.
- Small or inconsistent samples can produce misleading routing rules.
- Hard budget stops can discard useful work unless failure behavior is explicit.

**Acceptance criteria**

- Every evaluated run can be tied to a task class and parent-model outcome without storing the full task prompt.
- The same bounded workload can be compared across eligible backends.
- Routing changes cite measured acceptance, token, and latency results.
- Budget violations stop or downgrade work predictably and leave an auditable trace.

### Phase 7: Run Observability Observer

**Goal:** Add a lightweight local observer that makes model usage, routing decisions, and task outcomes auditable without turning the orchestrator into a telemetry platform.

**Deliverables**

- A runner-side JSONL trace writer for delegated runs (default on; `FABLE_ORCHESTRATOR_TRACE=0` disables, `FABLE_ORCHESTRATOR_TRACE_DIR` relocates).
- Logged metadata for backend, route, explicit model, sandbox, opaque project/run identifiers, duration, exit code, structured status, changed-file count, token usage, and short error summaries.
- A redaction policy that excludes raw task text, absolute paths, file contents, secrets, and other sensitive payloads by default; runs are named only through an explicit, caller-provided `--label`.
- Bounded trace retention (default 1000 records, `FABLE_ORCHESTRATOR_TRACE_LIMIT` configurable, `0` keeps all).
- A `runs` summary subcommand with `--json` and `--limit` for inspecting recent runs and per-model totals.
- A strictly opt-in Laminar export (`FABLE_ORCHESTRATOR_LAMINAR=1` plus `LMNR_PROJECT_API_KEY`) that ships the same redacted metadata as scored evaluation datapoints over plain HTTPS, and never fails the run.

**Dependencies**

- Stable runner output for Codex and Composer invocations.

**Risks**

- Over-logging can expose sensitive material or recreate the context-bloat problem the orchestrator is meant to avoid.
- Trace files can become noisy if they do not preserve one record per delegation attempt.
- Observability can drift into product analytics unless the scope stays local and opt-in.
- Environment-dependent network tests can make repository validation unreliable.

**Acceptance criteria**

- A delegated run can be inspected after the fact without reading raw prompts.
- The observer clearly shows which model and backend were used for each task.
- Default local and remote records contain no raw task text, filesystem paths, secrets, or file contents.
- Trace retention is bounded and documented.
- The observer works for both Codex and Cursor Composer paths.
- Repository validation stays green in network-restricted sandboxes: the Laminar integration test detects when it cannot bind a localhost test server and skips itself with a warning instead of failing.
- Documentation explains how to enable, inspect, and disable the observer.

### Phase 8: Advanced Delegation

**Goal:** Add concurrency or computer-use routes only after the routing evidence and budget controls are reliable.

**Status:** 8.1 and 8.2 implemented; 8.3 evaluated and deferred (no stable non-interactive interface). See `docs/orchestrator/parallel-delegation.md`.

**Deliverables**

- An evaluation of parallel scheduling for independent, non-overlapping tasks (delivered: scheduling stays in the parent; the runner enforces the safety floor).
- Conflict prevention for write-capable workers sharing a checkout (delivered: per-project advisory write lock with stale-holder reclamation, optional `FABLE_ORCHESTRATOR_LOCK_WAIT_MS` queueing, and `FABLE_ORCHESTRATOR_WRITE_LOCK=0` opt-out).
- A supported computer-use route only when a stable, non-interactive provider interface exists (deferred: none exists as of 2026-07-05).

**Dependencies**

- Completed Phase 6 routing evidence and budget controls.
- Stable provider interfaces for any new route.

**Risks**

- Parallel workers can duplicate context, exceed budgets, or edit overlapping files.
- Computer-use routes can weaken least-privilege guarantees.

**Acceptance criteria**

- Parallel execution is limited to proven-independent tasks and prevents overlapping writes.
- New routes use explicit models, permissions, compact handoffs, and trace records.
- Sequential execution remains the safe default.

### Phase 9: Multi-Surface Packaging and Author Tooling

**Status:** Implemented (documented as-built).

**Goal:** Reuse one delegation policy across Claude Code, Pi, and GitHub Copilot, and give users tools to select the parent model and generate surface-specific usage prompts.

**Deliverables**

- A shared `plugins/orchestrator-core/prompt-factory.ts` that centralizes prompt wording for every surface.
- A `prompt-factory` skill that scans a repository and writes `docs/orchestrator/*.md` prompts tailored to the invoking surface (Claude Code by default; Pi or Copilot only when requested).
- An `orchestrate-with-model` skill that runs the delegation pattern from Fable (recommended), Opus, or the current Claude Code model.
- An `observability` skill and `fable-orchestrator observability` command that surface trace status, Laminar readiness, recent runs, and per-model totals inside the Claude Code TUI.
- A `pi-orchestrator` pack (skill plus `orchestrate` prompt) and a `copilot-orchestrator` pack (repository instructions plus `orchestrate`/`review` prompts), both defaulting to Codex 5.5 as the parent and reusing the existing runner path or `ARC_ORCHESTRATOR_BIN`.
- Surface tests in `test/plugin-surfaces.test.ts`.

**Dependencies**

- The shared runner and structured-handoff contract from Phases 3 and 5.

**Risks**

- Divergent surface instructions can drift from the shared policy if wording is duplicated per prompt rather than sourced from `orchestrator-core`.
- Non-Claude surfaces cannot reuse Claude subagents and must invoke the runner directly.

**Acceptance criteria**

- Each surface reuses the same runner and safety boundary rather than reimplementing delegation.
- Generated prompts focus on the user's selected surface instead of mixing all three.
- Strict marketplace and plugin validation and the surface tests pass.

## 5. Out of Scope / Deferred

- Replacing Claude Code's native subagent system.
- Sending repository contents to an intermediary service.
- Automatic Git commits, pushes, pull requests, merges, or deployments.
- Unrestricted shell execution.
- Provider-agnostic orchestration before the Fable-to-Codex workflow is validated.
- A web dashboard or persistent control plane.
- Centralized analytics or any always-on hosted observability backend. The sole exception is the strictly opt-in, redacted Laminar run export, which is disabled unless the user sets `FABLE_ORCHESTRATOR_LAMINAR=1`.
- Parallel scheduling or computer-use delegation before Phase 6 acceptance criteria are met.

## 6. Immediate Next Steps

1. Keep annotating real delegated runs so acceptance rates accumulate beyond the matrix sample before any ranking change, and tighten budget thresholds per task class as `report` data accumulates.
2. Exercise parallel delegation on real work: read-only workers concurrently, and write-capable workers across separate worktrees, confirming the lock behavior under real contention.
3. Re-evaluate the computer-use route (8.3) when a provider ships a stable non-interactive interface.
