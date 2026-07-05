# Parallel Delegation Evaluation (Phase 8)

Dated decision record for Phase 8.1 (parallel scheduling), 8.2 (overlapping-write
prevention), and 8.3 (computer use). Written 2026-07-05.

## 8.1 — Where scheduling lives: the parent, not the plugin

Evaluated options:

1. **Runner-side task graph** — the CLI accepts multiple tasks, orders them, and
   dispatches workers itself.
2. **Parent-side dispatch, runner-side safety** — the parent model (Fable or the
   selected Claude Code model) decides what can run concurrently and simply
   invokes multiple workers; the runner only guarantees that unsafe overlap
   cannot corrupt a checkout.

Decision: **option 2.** Judging task independence is exactly the kind of
contextual reasoning the orchestrator policy assigns to the parent — the
runner cannot know whether two prompts touch the same files. A runner-side
graph would duplicate the parent's judgment, grow a persistent control
surface the plan explicitly keeps out of scope, and still need the same
overlap guard underneath. The parent already has a concurrency primitive
(multiple `Agent` invocations); what was missing was a floor that makes a
bad parallel decision fail loudly instead of corrupting work.

Guidance encoded in the orchestrate skill and README:

- Read-only workers (`codex-explore`, `codex-check`, `opus-review`) may always
  run concurrently.
- Write-capable workers (`composer-implement`, `codex-implement`) run
  sequentially in one checkout, or concurrently only in separate worktrees.
- Sequential execution remains the default; parallel dispatch is an explicit
  parent decision.

## 8.2 — Overlapping-write prevention: per-project advisory lock

Implemented in the runner:

- A write-capable run (`--mode implement` on either backend) claims
  `<trace-dir>/locks/<project>.lock` (atomic create-exclusive write) before the
  worker spawns; `<project>` is the same opaque cwd hash used in traces, so
  separate worktrees get separate locks by construction.
- The lock records its holder (`pid`, `run_id`, timestamp). Contention fails
  fast with an actionable error naming the remedies (wait, worktree,
  `FABLE_ORCHESTRATOR_LOCK_WAIT_MS`, `FABLE_ORCHESTRATOR_WRITE_LOCK=0`), and
  the failed attempt leaves a normal error trace record.
- `FABLE_ORCHESTRATOR_LOCK_WAIT_MS` turns contention into bounded queueing
  (250ms polls until the deadline), which is enough to make naive parallel
  dispatch of write tasks serialize instead of die.
- Locks whose recorded holder is no longer alive are reclaimed automatically;
  every lock is released in the runner's `finally`.
- Read-only runs never touch the lock path.

Acceptance-criteria mapping: parallel execution is limited to safe cases
(read-only, or distinct projects); overlapping writes are prevented by
default; sequential execution remains the safe default because contention
fails closed.

## 8.3 — Computer use: evaluated, still deferred

Neither backend exposes a stable, non-interactive computer-use surface
suitable for a least-privilege worker route: Codex CLI has no browser/desktop
control mode, and Cursor Agent's headless mode is a code-editing surface.
Claude-side computer use remains an interactive capability rather than a
schedulable CLI contract. Re-evaluate when a provider ships a non-interactive
interface with explicit permissions; until then any computer-use delegation
would weaken the plugin's sandbox guarantees, so it stays deferred.
