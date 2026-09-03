# Parallel Delegation Evaluation (Phase 8)

Dated decision record for Phase 8.1 (parallel scheduling), 8.2 (overlapping-write
prevention), and 8.3 (computer use). Written 2026-07-05.

## 8.1 — Where scheduling lives: the parent, not the plugin

Evaluated options:

1. **Runner-side task graph** — the CLI accepts multiple tasks, orders them, and
   dispatches workers itself.
2. **Parent-side dispatch and coordination** — the parent model (Fable or the
   selected Claude Code model) decides what can run concurrently and invokes
   workers only when their tasks are disjoint or their checkouts are isolated.

Decision: **option 2.** Judging task independence is exactly the kind of
contextual reasoning the orchestrator policy assigns to the parent — the
runner cannot know whether two prompts touch the same files. A runner-side
graph would duplicate the parent's judgment and grow a persistent control
surface the plan explicitly keeps out of scope. The parent already has a
concurrency primitive (multiple `Agent` invocations) and owns the decision.

Guidance encoded in the orchestrate skill and README:

- Read-only workers (`--backend codex` analyze/review, `opus-review`) may always
  run concurrently.
- Write-capable workers (`composer-implement`, `--backend codex --mode implement`)
  may run concurrently only when the parent has established that their tasks
  are disjoint. Use separate worktrees for concurrent writers.
- Sequential execution remains the default; parallel dispatch is an explicit
  parent decision.

## 8.2 — Concurrent-write coordination: parent-owned isolation

The runner starts write-capable workers immediately. It does not create, wait
on, inspect, reclaim, or remove coordination files, and it does not reject a
run because another writer is active. This keeps dispatch free of hidden
cross-process state.

- The parent must dispatch concurrent tasks only when their edit scopes are
  disjoint.
- Separate worktrees are the supported isolation boundary for concurrent
  writers.
- Existing coordination files from older runner versions have no effect on
  new runs.

Acceptance-criteria mapping: concurrency remains a deliberate parent decision;
sequential execution is the default, and separate worktrees provide isolation
when multiple writers must run at once.

## 8.3 — Computer use: evaluated, still deferred

Neither backend exposes a stable, non-interactive computer-use surface
suitable for a least-privilege worker route: Codex CLI has no browser/desktop
control mode, and Cursor Agent's headless mode is a code-editing surface.
Claude-side computer use remains an interactive capability rather than a
schedulable CLI contract. Re-evaluate when a provider ships a non-interactive
interface with explicit permissions; until then any computer-use delegation
would weaken the plugin's sandbox guarantees, so it stays deferred.
