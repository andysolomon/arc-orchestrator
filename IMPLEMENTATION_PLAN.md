# Fable Orchestrator Implementation Plan

## 1. Product Goal and Scope Boundaries

Build a reusable orchestrator that keeps a strong parent model — Claude Fable 5 at `high` effort by default — focused on planning and decision-making while delegating bounded, token-intensive work to Cursor Composer 2.5 or Codex. The primary surface is a Claude Code marketplace plugin; the same delegation pattern is also packaged for Pi and GitHub Copilot, where Codex 5.6 Terra is the default parent.

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
- the trace file retains a bounded number of records (default 1000, `ARC_ORCHESTRATOR_TRACE_LIMIT` configurable);
- runs can carry a parent-authored task class and route rationale, and the parent records acceptance/rejection/escalation through the `annotate` command; `runs` and `observability` join each run to its latest outcome;
- the `report` command aggregates runs and outcomes by model, backend, mode, or task class with completion, acceptance, token, and latency measures;
- a representative workload matrix has been run (`docs/orchestrator/workload-matrix.md`): Codex accepted 4/4 across exploration, review, and implementation, while both Composer implementation runs were rejected because the runner could not parse Composer's prose-prefixed JSON envelope even though the code was correct;
- that envelope defect is now fixed: `extractComposerResult` extracts the last valid embedded JSON object via a string-aware balanced-brace scan, regression-tested against the captured prose and prose-fenced shapes and verified with a real end-to-end Composer run;
- the Composer half of the matrix has been re-run post-fix: 2/2 completed and accepted at ~17% of Codex's tokens and ~63% of its wall time on identical tasks, validating the Composer-first implementation routing and the existing usage-headroom rankings;
- persisted error summaries are redacted before they reach `runs.jsonl` or Laminar: echoed task text and absolute paths are replaced with `<task>`/`<path>` placeholders while the parent still receives the full detail on stderr;
- per-run budget thresholds are enforceable: `ARC_ORCHESTRATOR_MAX_DURATION_MS` kills the worker at the deadline and records an auditable `budget:` failure, while `ARC_ORCHESTRATOR_MAX_TOKENS` flags completed over-budget runs in the trace and in `report` without discarding finished work. Phase 6 is complete;
- overlapping writes are prevented: write-capable runs serialize per project through an advisory lock with stale-holder reclamation and optional bounded waiting, read-only runs stay lock-free, and the Phase 8 scheduling/computer-use evaluation is recorded in `docs/orchestrator/parallel-delegation.md`;
- a live Codex usage-limit outage on 2026-07-06 confirmed the designed clean-fail behavior and exposed an availability gap: the delegated run failed with actionable stderr and was annotated `blocked`, but no alternative backend existed because `--backend` accepts only `codex` or `composer` and neither `doctor` nor the error path offers a degraded-mode route.

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
| Implementation | Included | Composer 2.5 handles routine work; GPT-5.6 Terra handles difficult work and escalation, while GPT-5.6 Sol handles taste-sensitive work |
| Code review | Included | GPT-5.6 Terra runs read-only and reports prioritized risks; GPT-5.6 Sol handles taste-sensitive review |
| Structured handoff | Included | Every successful run conforms to one JSON schema |
| Composer 2.5 implementation | Included | Cursor Agent performs bounded write-capable implementation and returns normalized JSON |
| Configuration | Included | Environment variables override profile models and executable paths |
| Auditability | Included | Runner appends redacted, path-free JSONL trace records with bounded retention and exposes `runs` and `observability` commands |
| Multi-surface packaging | Included | A shared `orchestrator-core` powers the Claude Code plugin plus Pi and Copilot orchestration packs |
| Model-agnostic orchestration | Included | `orchestrate-with-model` runs the delegation pattern from Fable (default), Opus, or the current Claude Code model |
| Prompt factory | Included | `prompt-factory` scans a repository and writes `docs/orchestrator/*.md` usage prompts tailored to the active surface |
| Computer use | Deferred | Route browser/desktop work when a stable non-interactive interface is available (re-evaluated 2026-07-05: none exists) |
| Parallel orchestration | Included | The parent dispatches independent runs; the runner serializes write-capable runs per project via an advisory lock, keeps read-only runs lock-free, and allows write parallelism across worktrees |
| Budget telemetry | Included | Per-run thresholds: `ARC_ORCHESTRATOR_MAX_DURATION_MS` hard-stops runaway workers; `ARC_ORCHESTRATOR_MAX_TOKENS` flags over-budget completed runs, and `report` counts violations |
| Outcome evaluation | Included | Task class, route rationale, and parent acceptance/escalation are captured per run via `--task-class`/`--route-rationale` and the `annotate` command |
| Comparative reporting | Included | The `report` command aggregates completion, acceptance, token, and latency measures by model, backend, mode, or task class |
| Story queue integration | Included | A live Fable session pulls stories from the passive arc-story-queue daemon over HTTP MCP, delegates through the existing runner, and completes with `arc-contracts`-valid handoffs and RunRecords; the daemon never invokes a model |
| Backend availability fallback | Included | When Codex is unavailable (usage limit, auth failure, missing binary), the runner classifies the outage with a machine-readable hint, `doctor` reports degraded-mode options, and the Opus 4.8 `claude` backend takes the run — parent-driven by default, automatic via opt-in `ARC_ORCHESTRATOR_FALLBACK=claude` — with full trace, budget, and report parity |
| Reasoning-effort routing | Partial | Rungs `(stableId, effort)` are addressable: the registry declares per-backend levels, the CLI validates against that declaration, and both the codex and claude transports forward the requested level (13.1, 13.1b). Selection still does not *order* rungs — stacks and shadow selection remain rung-blind, which is the rest of Phase 13 |
| Evidence-backed ordering | Missing | Candidate ordering derives from a versioned `capability-snapshot.json` with benchmark provenance, band quantization, and dominance pruning, replacing the hand-authored `MODEL_RANKINGS` table currently restated in `routing-policy.ts`, `CLAUDE.md`, and `README.md` (Phase 13) |
| Budget-aware selection | Missing | Remaining root budget is an input to which rung is chosen, not only an admission gate; an unaffordable floor degrades explicitly or refuses with a recorded explanation (Phase 13) |
| Task lifecycle | Missing | The task, not the dispatch, is the orchestration unit. The `accepted`/`rejected`/`blocked`/`verification-failed`/`escalated` vocabulary that exists today only as post-hoc annotation becomes an executed machine (Phase 14) |
| Verification | Missing | Verification is a first-class state with a typed verdict, declared evidence, and an independence rule, rather than a prose obligation on the parent (Phase 14) |
| Quality escalation | Missing | Escalation is a bounded, budgeted, authorized state that raises the capability floor — structurally distinct from availability fallback by input type, not by convention (Phase 14) |

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
- `plugins/arc-orchestrator/.claude-plugin/plugin.json`.
- `plugins/arc-orchestrator/skills/orchestrate/SKILL.md`.
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
- `claude --plugin-dir ./plugins/arc-orchestrator` can discover `/arc-orchestrator:orchestrate`.
- Documentation distinguishes plugin instructions from project-level `CLAUDE.md`.

### Phase 3: Safe Codex Runner

**Goal:** Execute bounded Codex work with machine-readable handoffs.

**Deliverables**

- `plugins/arc-orchestrator/bin/arc-orchestrator` Bun entrypoint.
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
- GPT-5.6 Terra remains the explicit difficult-work escalation path.
- Tests verify model selection, write flags, normalization, and route rejection.
- `/arc-orchestrator:setup` reports actionable recovery steps without handling secrets.

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

- A runner-side JSONL trace writer for delegated runs (default on; `ARC_ORCHESTRATOR_TRACE=0` disables, `ARC_ORCHESTRATOR_TRACE_DIR` relocates).
- Logged metadata for backend, route, explicit model, sandbox, opaque project/run identifiers, duration, exit code, structured status, changed-file count, token usage, and short error summaries.
- A redaction policy that excludes raw task text, absolute paths, file contents, secrets, and other sensitive payloads by default; runs are named only through an explicit, caller-provided `--label`.
- Bounded trace retention (default 1000 records, `ARC_ORCHESTRATOR_TRACE_LIMIT` configurable, `0` keeps all).
- A `runs` summary subcommand with `--json` and `--limit` for inspecting recent runs and per-model totals.
- A strictly opt-in Laminar export (`ARC_ORCHESTRATOR_LAMINAR=1` plus `LMNR_PROJECT_API_KEY`) that ships the same redacted metadata as scored evaluation datapoints over plain HTTPS, and never fails the run.

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
- Conflict prevention for write-capable workers sharing a checkout (delivered: per-project advisory write lock with stale-holder reclamation, optional `ARC_ORCHESTRATOR_LOCK_WAIT_MS` queueing, and `ARC_ORCHESTRATOR_WRITE_LOCK=0` opt-out).
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
- An `observability` skill and `arc-orchestrator observability` command that surface trace status, Laminar readiness, recent runs, and per-model totals inside the Claude Code TUI.
- A `pi-orchestrator` pack (skill plus `orchestrate` prompt) and a `copilot-orchestrator` pack (repository instructions plus `orchestrate`/`review` prompts), both defaulting to Codex 5.6 Terra as the parent and reusing the existing runner path or `ARC_ORCHESTRATOR_BIN`.
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

### Phase 10: Cursor Surface Parity and Distribution

**Status:** Implemented (tracked as GitHub issues W-000001 through W-000006).

**Goal:** Bring the Cursor plugin to feature parity with the Claude Code plugin, keep that parity enforced by tests, and harden Cursor packaging for distribution.

**Deliverables**

- Cursor prompt-factory skill backed by a new `cursor` surface in the shared `orchestrator-core` factory (W-000001).
- Cursor setup and observability skills mapped to real `arc-orchestrator` CLI subcommands (`doctor`, `runs`, `report`, `observability`) with the no-`sudo` warning and Laminar evaluations-not-traces boundaries (W-000002).
- Cursor direct-worker escape hatch covering Codex analyze/review/implement and Composer implement, with honest handling of Composer structured-result handshake failures (W-000003).
- A checked-in cross-surface feature matrix (`plugins/orchestrator-core/feature-matrix.ts`, rendered in `docs/orchestrator/feature-parity-matrix.md`) with tests that fail on missing parity, enforce Fable-first defaults for Claude/Cursor and Codex-first defaults for Pi/Copilot, and require rationales for intentional differences (W-000004).
- Documented update workflows for all four surfaces in the root README (W-000005).
- Hardened Cursor packaging: complete manifest at 0.2.0, conventional `rules/`/`skills/`/`commands/` component directories with slash commands, copy-first install guidance, and a documented distribution path (W-000006).

**Dependencies**

- The existing Cursor plugin scaffold and the shared `orchestrator-core` from Phase 9.

**Risks**

- The markdown parity matrix can drift from the TypeScript source of truth; a sync test asserts every required path and feature name appears in the document.
- Cursor plugin conventions (component directories, symlink validation) can change between Cursor releases; packaging tests only check the repository side.

**Acceptance criteria**

- Every Claude Code feature that should exist in Cursor has a matching artifact or a documented intentional difference, enforced by `test/feature-parity.test.ts`.
- All CLI commands referenced by Cursor skills map to real runner subcommands.
- The full Bun suite passes, including the six new test files added by this phase.

### Phase 11: Opus 4.8 Availability Fallback

**Status:** Implemented 2026-07-06 (drafted the same day after a live Codex usage-limit outage blocked a delegated run). Verified with 83 passing Bun tests, strict marketplace validation, a real-CLI smoke run of the `claude` backend, and a live end-to-end fallback test against the actual Codex outage (classified `usage_limit`, retried on the `claude` backend, linked via `fallback_of`).

**Goal:** Keep delegation available when the Codex backend is down by adding an explicit, auditable Opus 4.8 route — without weakening the no-silent-substitution safety contract.

**Design:** The fallback is a third runner backend, `claude`, that invokes the locally authenticated Claude Code CLI headlessly (`claude -p` with JSON output) with Opus 4.8 as the default model. A runner backend is chosen over direct Claude subagents so traces, `annotate`, `report`, budget thresholds, the write lock, and the non-Claude surfaces (Cursor, Pi, Copilot) all reuse the same path. Fallback is parent-driven by default: the runner classifies an outage and emits a machine-readable hint; the parent re-delegates explicitly and records the switch via `annotate --escalated-to`. An automatic retry exists only as an opt-in for unattended runs. This route is distinct from the `opus-review` taste-review worker, which remains content-triggered and review-only.

**Deliverables**

- A `claude` backend in `plugins/arc-orchestrator/bin/arc-orchestrator`: `--backend codex|composer|claude` validation, per-mode profiles (read-only tool restrictions for `analyze`/`review`, workspace-write for `implement`), shell-interpolation-free invocation, normalization into the shared JSON handoff contract, and `ARC_ORCHESTRATOR_CLAUDE_BIN` / `ARC_ORCHESTRATOR_CLAUDE_MODEL` (default Opus 4.8) overrides documented in the usage text alongside the existing environment variables.
- Availability classification in the Codex error path (`collectCodexErrors` and the `runCodex` failure handling): usage-limit, authentication, and missing-binary failures become a structured `backend_unavailable` result — distinct from task failure — carrying a machine-readable fallback hint (`fallback: { backend: "claude", model: <resolved> }`) in both the stderr detail and the redacted trace record.
- Opt-in automatic retry: `ARC_ORCHESTRATOR_FALLBACK=claude` (or `--fallback claude`) retries an availability-classified failure exactly once on the `claude` backend, links both trace records through a `fallback_of` run identifier, and reports the original outage alongside the fallback result. Task-level failures never trigger a retry.
- `doctor` extensions: an independent `claude` readiness block (binary, version, authentication) and degraded-mode `next_actions` guidance when Codex is unhealthy but the fallback is ready.
- Worker surface: thin `opus-explore`, `opus-check`, and `opus-implement` agents plus a `claude-runtime` skill mirroring `codex-runtime`; the `codex-runtime` contract is amended to require surfacing the fallback hint verbatim while continuing to prohibit worker-side substitution.
- Policy and documentation updates: a fallback section in `routing-policy.md`, the `orchestrate` skill roster and re-delegation step, the root `CLAUDE.md` and the project policy template, the README, and the `orchestrator-core` feature matrix, prompt factory, and Cursor/Pi/Copilot surface docs — including the explicit distinction from `opus-review`.
- Tests: fake `claude` executable contract tests (model, tool restrictions, normalization), classification fixtures including the captured 2026-07-06 usage-limit stderr, automatic-retry behavior, `doctor` output, and parity-matrix and surface tests.
- Distribution: plugin manifest version bump, strict marketplace and plugin validation, and documented upgrade guidance for stale installed plugin caches (the installed 0.1.5 predates even `opus-review`).

**Dependencies**

- An installed and authenticated Claude Code CLI (present by construction on the Claude Code surface; `doctor` must verify it for Cursor, Pi, and Copilot).
- The exact current headless flags for JSON output and per-tool restriction must be confirmed against Claude Code documentation at implementation time; treat the flag set as `unknown` until checked.

**Risks**

- Opus 4.8 shares the user's Claude subscription with the parent model (usage headroom 4), so fallback traffic can crowd out parent usage; budget thresholds and `report` visibility mitigate this.
- Read-only enforcement for `analyze`/`review` depends on Claude CLI permission flags rather than the OS-level sandbox Codex provides; the profile is weaker until verified.
- Automatic retry can double-spend tokens on work that would fail anyway, which is why it is opt-in and fires only on availability-classified failures.
- Opus 4.8 ranks below GPT-5.6 Terra on the intelligence heuristic (7 versus 8), so fallback output needs the same parent review bar, and `report` must keep fallback runs distinguishable so acceptance rates are compared honestly.

**Acceptance criteria**

- `run --backend claude` succeeds for all three modes, enforces read-only tools for `analyze`/`review` and workspace-write for `implement`, returns the shared JSON contract, and appears in `runs`, `observability`, and `report` with correct backend and model attribution.
- A Codex usage-limit, authentication, or missing-binary failure yields a structured `backend_unavailable` result with a fallback hint; ordinary task failures do not.
- With fallback disabled (the default), no run ever switches backends or models without a new parent-issued command.
- With the opt-in enabled, the retry produces two linked trace records and preserves the original failure detail.
- `doctor` reports Codex, Composer, and Claude readiness independently and prints degraded-mode guidance when Codex is down but the fallback is ready.
- The `codex-runtime` contract still forbids worker-side substitution, and worker agents surface the fallback hint without acting on it.
- Strict marketplace and plugin validation and the full Bun suite pass, including the new fake-`claude`, classification, retry, doctor, and parity tests.

### Phase 12: Story Queue Integration

**Status:** Implemented 2026-07-09 through 2026-07-10 (W-000007 / PR #33, W-000008, W-000009 / PR #34). Documented retroactively on 2026-07-24: `progress.txt` had carried 12.1 and 12.3 as open with stale blocker notes long after both merged. Verified by `test/handoff-parity.test.ts` and `test/trace-adapter.test.ts` (22 passing assertions) within a full suite of 597 passing tests.

**Goal:** Let a live Fable session work the arc-story-queue backlog end to end — pull a story, delegate bounded work through the existing runner, and complete it with a handoff and run records — without the queue daemon ever invoking a model.

**Design:** The daemon is deliberately passive. It owns queue state, worktrees, write locks, SSE updates, handoffs, and run records; it stores and serves, and it never plans, summarizes, or decides. Fable *pulls* work through HTTP MCP rather than the daemon pushing work at a model. This keeps the project's central invariant intact at a new boundary: judgment stays in the parent thread, and the queue is infrastructure rather than an orchestrator. Interoperability rests on a shared `arc-contracts` package consumed through Bun's link registry, so orchestrator and arc-story-queue adopt breaking contract changes together as semver-major bumps, with parity tests as the CI seam that catches drift.

**Deliverables**

- `arc-contracts` as a linked dependency (`package.json:13`, `"arc-contracts": "link:arc-contracts"`) with the one-time `bun link` setup and pinning policy documented in `README.md:126-136`.
- `test/handoff-parity.test.ts` validating orchestrator handoffs against both the exported `handoffSchema` and the raw `schema/handoff.schema.json`, so a contract change that the runtime tolerates still fails CI.
- The `story-queue-session` skill (`plugins/arc-orchestrator/skills/story-queue-session/SKILL.md`) documenting the full pull loop with authoritative argument shapes for every MCP tool: `git_repoId`, `session_register`, `project_attach`, `project_discover`, `queue_list`, `queue_next`, `stories_list`, `story_detail`, `story_update`, `story_complete`.
- A trace bridge in `plugins/orchestrator-core/trace-adapter.ts`: `traceRunToRunRecord`, `traceRunsToRunRecords`, and `resolveTraceRoute`, dual-reading legacy `TraceRecord` and `RoutingTraceV2` inputs through a `TraceRunInput` union so runs convert to `arc-contracts` RunRecords before `story.complete`.
- `test/trace-adapter.test.ts` asserting `validateRunRecord` conformance across every backend and mode, with unrated runs mapping to the explicit `"unrated"` outcome rather than null.

**Dependencies**

- A running arc-story-queue daemon on `http://127.0.0.1:7420/mcp`, configured in `.mcp.json` **before** the session starts; an unreachable URL leaves the tools unusable for that session.
- An arc-board checkout providing `arc-contracts` (currently `0.1.0`), linked globally per machine.
- The canonical `owner/name` repo slug from `git_repoId`. Registering a full git URL instead makes project-scoped queue reads silently return `[]`, because the daemon keys stories by slug.

**Risks**

- The link-registry dependency is machine-local, so a fresh checkout without `bun link` fails to resolve `arc-contracts`. The parity test is written to surface this as an explicit, actionable failure rather than an opaque import error.
- Silent-empty-result failure modes (the slug-versus-URL case above) are the sharp edge of this integration; they are documented in the skill because no schema catches them.
- Contract drift between the two repositories is only caught at CI time by the parity tests, not at runtime.

**Acceptance criteria**

- Handoffs validate against both the exported schema and the raw JSON schema. *Met.*
- Every backend and mode converts to a schema-valid RunRecord, and unrated runs map to `"unrated"`. *Met.*
- Both legacy trace records and `RoutingTraceV2` records convert through the same adapter entry point. *Met.*
- The skill documents every MCP tool in the loop with authoritative argument shapes. *Met.*
- The daemon invokes no model at any point in the loop. *Met by construction — the daemon exposes only state operations.*

### Phase 13: Capability-Rung Selection

**Status:** Planned. Contract recorded in `docs/adr/0010-capability-rung-selection.md` (Proposed, 2026-07-24; reconciled 2026-07-25 against PR #231). Nothing in this phase activates until it passes through the existing `rollout-gates.ts` stages.

**Interaction with PR #231:** #231 added Claude Opus 5 as the first-tier Claude worker and, separately, added an `effortFloor` field to `MODEL_RANKINGS` whose doc comment argues this phase's premise independently — effort degradation is model-specific, not a uniform discount. That narrows the gap without closing it: `effortFloor` is one editorial scalar per model, not a curve, carries no cost, and does not make a rung selectable. This phase subsumes it. #231 also demonstrates the volatility the snapshot is meant to make auditable, shifting `gpt-5.6-terra` 8 to 5 and `gpt-5.6-luna` 6 to 4 in a PR whose stated subject was adding Opus 5.

**Goal:** Make selection operate on rungs `(stableId, effort)` ordered by measured evidence and remaining budget, replacing hand-authored candidate stacks — without loosening any safety contract.

**Design:** Three changes that reinforce each other. First, `effort` becomes a registry field so a rung, not a model, is the selectable unit; public benchmark data shows a 12-point / 4.5×-cost spread inside a single `stableId` that a `candidates: string[]` stack cannot express. Second, hard eligibility (registry: sandbox, output contract, route, context, maturity, role) is separated from soft ranking (snapshot: benchmark scores, cost priors, quota pool), so a ranking change and a safety change stop being the same kind of edit; a snapshot with every score zeroed still yields only contract-satisfying dispatches. Third, `select()` is a pure function returning an ordered stack, which slots into the existing one-pass traversal as a drop-in replacement for `CandidateStack.candidates`, leaving ADR 0008 semantics untouched. Benchmark error margins (±2–6% over ~113 tasks) make raw score ordering noise, so scores are quantized into bands whose width is validated at `>= 2 x` the largest error margin, with dominated rungs pruned.

**Deliverables**

- `effort` as a first-class registry field with per-backend supported levels; the Codex-only restriction at `plugins/arc-orchestrator/lib/cli.ts:1458` replaced by registry-driven validation; a `RungId` type of the form `${stableId}@${Effort}`. *Met (13.1, 13.1b).*
- The claude transport forwarding the requested level, so the `opus-5` ladder this ADR is argued from is reachable rather than hypothetical. `CLAUDE_CODE_EFFORT_LEVEL` is used in preference to the CLI's `--effort` flag because the two fail differently: the flag warns on an unrecognised value and silently runs at the default, which would leave the trace attesting to an effort the run never spent. *Met (13.1b).*
- `capability-snapshot.json` plus a validator rejecting unknown `stableId`, unsupported effort, duplicate `rungId`, `bandWidth` outside its feasible window, `editorial` measurements without an approver, and any measurement past `expiresAt`. *Met (13.2), schema and validator only — no snapshot file ships yet, and absence stays a supported state because rollback is "delete the snapshot".* The validator takes `unknown` rather than a typed snapshot (its input is a hand-edited JSON file, not a compiler-shaped literal) and takes `nowMs` as an injected argument, so expiry is the only time-dependent rule and it inherits `select()`'s determinism requirement rather than undermining it.
- A `bandWidth` **ceiling** that ADR 0010 did not state, found while implementing the validator: `CapabilityBand` is a closed `0..4` and scores are normalized `0..1`, so `floor(score / bandWidth)` also requires `bandWidth > 0.2`. At the ±2–6% margins the ADR cites, that ceiling — not the `2 × errorMargin` noise floor — is the binding constraint, leaving a feasible window of roughly `(0.2, 0.25]` for all five bands to be usable. *Met (13.2).*
- A populated snapshot sourced from DeepSWE v1.1 and CursorBench 3.2 with per-measurement provenance, error margins, and expiry; `CostPrior` (observed consumption) kept distinct from decision 0001's `numericPricing` (provider unit rates).
- `select(inputs): SelectionDecision` — pure, no I/O, no clock — implementing the seven-step evaluation order, band quantization, dominance pruning, and explicit floor degradation toward `minimumFloor`. *Met (13.4) for steps 1–6; step 7 is 13.4a and its explanation fields are omitted rather than defaulted to `false`, so an absent field reads as "not evaluated" instead of attesting to a check that never ran.* Implementing it surfaced three things the ADR did not state: the returned stack is a **Pareto frontier** (within a band the cheapest priced rung dominates every costlier one, so at most one survives per band, and within-band cost ordering shows up in `pruned` rather than in the order); `SelectionExplanation` needs an `unranked` list, because a reader otherwise cannot tell "ranked last" from "never ranked"; and `effort-unsupported` is unreachable inside `select()`, since the candidate set is derived from `supportedEffortsFor` — it is produced at snapshot validation instead, and no dead branch is kept for it.
- A step 7 stack-level constraint stage enforcing lead-backend coherence, with `LeadPolicy`, `LeadRepair`, and the `leadBackend` / `leadRepair` / `leadDisplaced` / `leadDisplacedByAvailability` explanation fields. `incumbentLeadBackend` is derived from the existing stacks at migration rather than newly authored, so the constraint preserves current behavior by default. Lead displacement requires a strictly higher band; within-band cost ordering may reorder followers but never the lead. *Met (13.4a).* Implementing it corrected the ADR on four points. The stage must also see the **dominance-pruned** set: the ADR lists step 2 and step 6 as the ways an incumbent rung can disappear and omits step 4, which is the one that actually fires — an out-priced same-band incumbent is exactly what pruning drops, and both of the ADR's worked examples (`gpt-5.5` $2.05 and `opus-5` $3.91 against `grok-4.5` $1.51, all in band 2) land there, so without reinstatement the repair could never fire in either case it was written for. Only dominance-pruned rungs are reinstatable, never ones rejected for eligibility, floor, ceiling, or budget, so step 7 cannot become a route around `budget-limits/v1`. `leadPolicy` stays optional against the ADR's required field, because `incumbentLeadBackend: null` already means "no incumbent" and an unmigrated caller must not be told a check passed. The override path does not evaluate step 7 at all, since every rung of one `stableId` shares a transport and the stage could only answer "no repair". And the invariant was already contradicted in prose: `WORKER_DESCRIPTIONS` claimed grok-4.5 leads `medium-work`, from the same commit (#237) whose message says the lead stays with `gpt-5.5` — corrected, and now checked against `CANDIDATE_STACKS`.
- `AvailabilityView` including `quotaPools`, where quota is ordering input only; `BudgetDimension`, the reserve/reconcile math, and every `RoutingTraceV2` budget field are unchanged, and `budget-limits/v1` remains the sole admission authority.
- `SelectionExplanation` emitted on both selection and refusal, recording eligible, rejected, pruned, and budget-constrained rungs with bounded-cardinality labels. *Met (13.6): an optional `selection` block on `orchestrator-routing-trace/v2`, mapped by `selection-trace.ts`.* Three additions the ADR did not state. The block carries a required `executed` flag with no default, because under shadow mode it describes a decision no dispatch followed and every other field looks the same either way — and for the same reason `versions.policy` stays `candidate-stacks/v1` while shadow-running. Bounded cardinality covered label *values* but not list *length*, which is a live problem rather than a theoretical one: 61 rungs in the registry today, 55 rejected on `taste-review.read-only.v1`, 41 unranked on the implement route — so lists are clipped to 32 with the dropped count recorded, and `eligible` being among them means **13.10's shadow corpus must carry the unclipped explanation**. And absent / `null` / present are three distinct states on the `orchestrator_identity` precedent: no selector wired in, selector did not run, selector ran.
- Collapse of the three `MODEL_RANKINGS` copies (`plugins/orchestrator-core/routing-policy.ts:106`, `CLAUDE.md`, `README.md`) into rendering derived from the snapshot, extending the pattern `defaultCodexRouteDefaults()` already uses for docs.
- A `workload_class` to `capabilityFloor` mapping accepted alongside the existing classes during migration, with `workload_class` demoted to observability metadata.
- A companion decision naming authoritative benchmark versions, refresh cadence, and owner — the analogue of decision 0001 for price lists. `snapshotVersion` must pin the benchmark version, not only a retrieval date, because a benchmark's task set changes between versions. *Met (13.9): `decisions/0005-benchmark-authority-and-refresh-cadence.md`, `benchmark-policy/v1`. 90-day cadence and 180-day expiry, deliberately looser than 0001's 30/45 because a published benchmark result does not drift — what decays is relevance, so the event triggers do more work than the interval. The `snapshotVersion` rule is enforced against the suites the data draws on, not a hand-maintained list.*
- Resolution of the inter-suite conflict gap, which turns out not to be a precedence question. *Met (13.9).* Each suite is authoritative for exactly one axis (DeepSWE → `swe`, CursorBench → `agentic-edit`), so the cited `grok-4.5` figures are answers to different questions and **no suite precedence order is defined**. The two genuine cases are same-scope-key disagreement (fails safe to capability-unknown on decision 0001's precedent) and a suspected-anomalous row (excluded through an adjudication register kept in the policy document, not as a `Measurement` field, because 13.3 refreshes the snapshot mechanically and would drop the flag).
- An effort-tier identity rule: a measurement is authoritative only for the tier it was captured at, so a `max` leaderboard column may never characterize a rung dispatched at `high` or below. *Met (13.9). It immediately found three stale prose claims in `routing-policy.ts`, all written from the `max` column and all surviving #235's recalibration of the table beside them — corrected in 13.9a, with regression tests that read the asserted gap out of `MODEL_RANKINGS` so the next recalibration fails a test rather than leaving the prose behind. The affected constants are exported and imported nowhere, and the rendered surfaces already carried correct high-effort framing, so 13.7 should delete these restatements rather than re-derive them.*

**Dependencies**

- Decision 0001 (pricing authority) for unit rates; decision 0003 (`budget-limits/v1`) for admission limits. Both stay authoritative and unmodified.
- ADR 0004 stacks remain the control path throughout shadow comparison.
- Published DeepSWE and CursorBench results for the exact `(model, effort)` pairs in the registry. Coverage is partial today; rungs without a `CostPrior` are orderable by band but not by cost, and that gap must be recorded rather than estimated.

**Risks**

- Benchmark aggregates are not per-task priors. Band quantization is the guard; relaxing the `2 x errorMargin` width rule to fit more bands reintroduces exactly the noise it exists to absorb.
- `taste` has no public benchmark and stays `editorial` with a required approver and expiry, so taste-sensitive routing remains the least evidence-backed axis.
- Snapshot expiry is a hard refusal, so a neglected snapshot fails loudly in normal operation. This will fire in practice and needs an owned refresh cadence before default rollout.
- Derived stacks can reorder against operator intuition; the shadow disagreement set must be reviewed rather than assumed correct in either direction.

**Acceptance criteria**

- `select()` is deterministic for a fixed `(request, registry, snapshot, ledger, availability, policyVersion, nowMs)` and performs no I/O, environment reads, or clock calls.
- Hard eligibility is provably independent of scores: a snapshot with all scores zeroed still produces only dispatches satisfying the canonical route's sandbox, permissions, and output contract, and still honors role restrictions.
- Overrides may bypass ordering, banding, and price policy, and may never bypass the capability contract or role restrictions; an ineligible override refuses with `override-ineligible`.
- A snapshot whose `bandWidth` is below `2 x` the largest quantized error margin, or wide enough to put a perfect score above `CapabilityBand` 4, is rejected by validation.
- Snapshot validation is a total function on `unknown`: any JSON value, including hostile or half-edited ones, yields named errors rather than a thrown exception.
- An unaffordable requested floor either degrades toward `minimumFloor` with `floorLowered: true` recorded, or refuses with `floor-unreachable-in-budget`; it never silently proceeds.
- `quota-pool-exhausted` fires only on an observed `remainingFraction === 0`; a `null` remainder never rejects.
- The lead of every derived stack shares a `transportBackend` with the incumbent lead recorded at migration, unless displaced by a strictly higher band or by availability. Specifically: `grok-4.5` does not take the `medium-work` lead from `gpt-5.5` on its 8.3-point CursorBench margin, and does not take a lead from `opus-5` where the two tie at 66.7% — reproducing #237's decisions rather than reversing them. *Met (13.4a), both cases tested at the published `@high` figures.*
- A `select()` reorder never changes which caller model preferences are satisfiable without setting `leadDisplaced` or `leadDisplacedByAvailability`; a regression test asserts no preference that resolves today hard-fails with `provider-switch-not-authorized-without-rate-limit` after migration.
- Derived stacks preserve the registry's existing structural invariants, including "exactly one taste-review-eligible entry" — the invariant #231 protected by moving `opus-4.8` off `taste-review.read-only.v1` rather than weakening the test to admit two. Ranking must be structurally unable to violate it, because it is an eligibility property.
- Each `effortFloor` value carried by `MODEL_RANKINGS` at migration time is preserved as an explicit assertion against the derived lowest-eligible rung, so a measured ladder that contradicts an authored floor fails a test rather than silently reordering.
- Shadow mode changes no execution, and the `select()`-versus-authored-stack disagreement set is captured as a reviewable corpus before any promotion.
- ADR 0008 retry budget, sliding window, and price-band crossing guard behave identically on the derived stack.
- Rollback is deleting the snapshot and reverting to authored stacks, with no schema migration required.

### Phase 14: Task Lifecycle State Machine

**Status:** Planned. Contract recorded in `docs/adr/0011-task-lifecycle-state-machine.md` (Proposed, 2026-07-24). Depends on Phase 13 for `capabilityFloor` and `select()`.

**Goal:** Promote the task lifecycle from a post-hoc annotation vocabulary to an executed machine, so verification, escalation, and budget are enforced rather than remembered.

**Design:** The vocabulary already exists. `Outcome` at `plugins/arc-orchestrator/lib/cli.ts:58` is `accepted | rejected | blocked | verification-failed | escalated`, described in its own comment as the parent's judgment "recorded after the fact." `SchedulerNodeStatus` tracks whether a worker ran, never whether the work was correct. This phase executes the former without disturbing the latter: the machine sits above `DelegationScheduler` and issues effects to it. The central move is that lateral (availability) and vertical (quality) recovery consume **different input types** — `FailureDisposition` and `VerificationVerdict` respectively, neither reachable from the other — so the invariant currently repeated in prose across `routing-policy.ts` becomes a type error. Half is already enforced: `terminal-completed-low-quality` (`failure-classification.ts:34`) is a distinct kind and `shouldFallback` returns false for it. The missing half is that the vertical edge does not exist as code.

**Deliverables**

- The annotation vocabulary (`Outcome`, `AnnotationRecord`, `ANNOTATION_SCHEMA_VERSION`) lifted from `cli.ts` into a shared `lib/` module so the machine and CLI cannot drift. Mechanical, independently reviewable, and a prerequisite for everything below.
- `TaskState`, `TaskEvent`, `TaskEffect`, `TaskTransition`, and `TransitionRejection` types, plus the transition table.
- `step(input): TaskTransition` as a pure reducer — no I/O, no environment, no clock — following the same discipline as `select()`.
- `VerificationVerdict` distinguishing `pass`, `fail-quality` (weak rung, escalate), `fail-approach` (wrong plan, replan), and `fail-blocked`; `VerificationEvidence` recording mode, rung, criteria, and redacted commands; a `verification: "parent" | "dispatch" | "skip"` policy; and an independence rule forbidding a verify dispatch from reusing the `rungId` under review.
- `TaskBudgetPolicy` (`maxEscalations`, `maxReplans`, `escalationCostFraction`, `floorCeiling`) and `EscalationAuthorization` (`policy` / `parent` / `user`), enforced as transition guards.
- An `escalation_of` trace link for vertical steps, parallel to and distinct from the existing `fallback_of`.
- Event-sourced persistence via a `task-events.jsonl` sidecar, following the `routing-trace-v2.jsonl` precedent so schema-4 readers of `runs.jsonl` are untouched.
- A `cancelled` terminal wired to existing root cancellation propagation, additive to the `Outcome` union.
- Shadow replay of the machine against the recorded `annotations.jsonl` history, reporting both the transition diff and the observed `fail-quality` versus `fail-approach` ratio as a health metric.
- A prompt-hygiene test asserting worker prompts contain no state-machine vocabulary.

**Dependencies**

- Phase 13 supplies `capabilityFloor`, `CapabilityBand`, and `select()`; the machine's `select` effect has no other source.
- `DelegationScheduler` admission, cycle detection, worktree ownership, and cancellation propagation are consumed as-is and must remain unchanged.
- Enough annotated run history in `annotations.jsonl` for the backtest to be meaningful; existing next-step 2 (keep annotating real runs) is now a prerequisite rather than a nicety.

**Risks**

- The `fail-quality` versus `fail-approach` distinction is a judgment the machine cannot infer. If parents label everything `fail-quality`, the system degenerates into buying more expensive models to execute bad plans — the exact failure this phase exists to prevent. Shadow replay must report the ratio.
- Prose drift is the historical failure mode of this codebase: every prior policy started as code and ended up restated in skill markdown. The danger is not the machine breaking but the model being separately told a slightly different version of it.
- Tasks that today quietly succeed on a third manual escalation will terminate as `verification-failed` once `maxEscalations` binds. This is the intended trade; operators who want the old behavior raise the limit explicitly.
- Verification as a dispatch is a real budget draw. `verification: "skip"` must exist and be genuinely usable, or the phase becomes a tax on low-stakes work.

**Acceptance criteria**

- `step()` is pure and deterministic, and every task's history reconstructs exactly by folding it over `task-events.jsonl`.
- A retryable dispatch failure produces no task transition; it is consumed entirely by the traversal.
- The vertical edge is unreachable from a `FailureDisposition` and the lateral edge unreachable from a `VerificationVerdict`, enforced by types rather than tests alone.
- Escalation refuses with a recorded reason when any of `maxEscalations`, `floorCeiling`, `escalationCostFraction`, or authorization fails, transitioning to `verification-failed` rather than proceeding.
- A verify dispatch never reuses the `rungId` under review.
- `escalated` remains run-level only, and `report` acceptance arithmetic (`cli.ts:900`) is numerically identical before and after the migration on the same history.
- Child tasks at depth 1 cannot escalate; escalation remains a parent decision, consistent with the existing no-grandchild rule.
- `SchedulerNodeStatus` and every scheduler behavior are unchanged.
- Shadow replay over `annotations.jsonl` completes and produces a reviewable transition diff plus the `fail-quality`/`fail-approach` ratio.
- The prompt-hygiene test passes across all four surfaces.

## 5. Out of Scope / Deferred

- Replacing Claude Code's native subagent system.
- Sending repository contents to an intermediary service.
- Automatic Git commits, pushes, pull requests, merges, or deployments.
- Unrestricted shell execution.
- Provider-agnostic orchestration before the Fable-to-Codex workflow is validated.
- A web dashboard or persistent control plane.
- Centralized analytics or any always-on hosted observability backend. The sole exception is the strictly opt-in, redacted Laminar run export, which is disabled unless the user sets `ARC_ORCHESTRATOR_LAMINAR=1`.
- Parallel scheduling or computer-use delegation before Phase 6 acceptance criteria are met.
- Silent model substitution inside a worker or the runner: every fallback is either an explicit parent re-delegation or an opt-in, trace-linked automatic retry.
- Fallback on quality grounds. Availability fallback is never triggered by a completed-but-rejected run; `terminal-completed-low-quality` is structurally excluded from the traversal. Amended by Phase 14: quality escalation stops being *only* a manual `annotate --escalated-to` record and becomes an explicit `escalate` state — bounded by `maxEscalations` and `floorCeiling`, charged against `escalationCostFraction`, and gated by `EscalationAuthorization`. It remains a distinct mechanism from availability fallback, consumes a different input type, and is never silent. Until Phase 14 ships, escalation stays a parent decision recorded through `annotate`.
- Direct Anthropic API-key usage for the fallback route; the `claude` backend reuses only the locally authenticated Claude Code CLI.
- Composer-outage fallback: the Phase 11 classification layer is written backend-generically, but only the Codex-to-Opus mapping ships until routing data justifies more.

## 6. Immediate Next Steps

1. Update installed plugin copies to 0.2.0 so the Phase 11 fallback is live outside this repo, and investigate why Composer's structured-result envelope failed on all three long Phase 11 task contracts (2026-07-06) even though the implementations themselves landed correctly.
2. Keep annotating real delegated runs so acceptance rates accumulate beyond the matrix sample before any ranking change, and tighten budget thresholds per task class as `report` data accumulates. This is now a Phase 14 prerequisite: `annotations.jsonl` is the backtest corpus the task machine replays against, so annotation density directly bounds how well the machine can be validated before it controls anything.
3. Exercise parallel delegation on real work: read-only workers concurrently, and write-capable workers across separate worktrees, confirming the lock behavior under real contention.
4. Re-evaluate the computer-use route (8.3) when a provider ships a stable non-interactive interface.
5. Decide ADR 0010 and ADR 0011 (both Proposed, 2026-07-24). Neither authorizes work while Proposed. Phase 13 gates Phase 14, and the first landable slice is 13.1 — adding `effort` to the registry — which is additive and reversible.
6. Resolve the two open items the ADRs name rather than answer: the benchmark authority and refresh cadence companion decision (Phase 13), and the numeric `TaskBudgetPolicy` defaults plus the `workload_class` to `capabilityFloor` mapping table (Phase 14).
