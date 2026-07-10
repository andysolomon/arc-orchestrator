---
name: story-queue-session
description: Drive the arc-story-queue pull loop from a live Fable / Claude Code session — register the session, attach the project, pull the next queued story into its worktree, delegate bounded work to orchestrator workers, stream progress, and complete the story with a handoff and run records. Use when the operator asks this session to work the Story Queue, pull the next story, or run model-driven implementation through arc-story-queue. The daemon never runs a model; Fable pulls the work.
argument-hint: "[--path <repo>]"
allowed-tools: Agent Bash Read Write Edit mcp__story-queue__git_repoId mcp__story-queue__session_register mcp__story-queue__project_attach mcp__story-queue__project_discover mcp__story-queue__queue_list mcp__story-queue__queue_next mcp__story-queue__stories_list mcp__story-queue__story_detail mcp__story-queue__story_update mcp__story-queue__story_complete
---

# Fable Story Queue Session (Pull Loop)

Use this skill inside a live Fable / Claude Code session to work the arc-story-queue. Fable owns all judgment — planning, implementation routing, review, and completion decisions happen in this thread. The daemon is passive.

## Core invariant

**The daemon never invokes a model.** It only stores queue state, worktrees, write locks, SSE updates, handoffs, and run records. Fable *pulls* work through MCP; the daemon never pushes work to a model and never thinks on its own. Never ask the daemon to plan, summarize, or decide.

## Setup

### 1. Start the daemon (once, outside this session)

```bash
cd arc-story-queue
npm run daemon
# arc-story-queue daemon listening on http://127.0.0.1:7420/mcp
```

Keep it running. It owns queue state; it runs no model.

### 2. Configure the shared HTTP MCP server

Add the daemon as an HTTP MCP server before starting (or restarting) Claude Code. In `.mcp.json`:

```json
{
  "mcpServers": {
    "story-queue": {
      "type": "http",
      "url": "http://127.0.0.1:7420/mcp"
    }
  }
}
```

The story-queue tools then appear as `mcp__story-queue__*`. Start the daemon **before** connecting — an unreachable URL leaves the tools unusable for the session.

## Lifecycle — every MCP tool and its arguments

The full loop uses exactly these tools. Argument shapes are authoritative.

### A. Resolve the canonical repo slug (do this first)

```
mcp__story-queue__git_repoId({ path: "/abs/path/to/repo" })
  -> { remote, repoId }   // repoId is the "owner/name" GitHub slug
```

Use `repoId` (e.g. `andysolomon/arc-orchestrator`) as the `repo` in `session.register`. **Registering the full git URL instead of the slug makes project-scoped queue reads silently return `[]`** — the daemon keys stories by the slug.

### B. Register this session

```
mcp__story-queue__session_register({
  repo:   "owner/name",          // from git_repoId.repoId
  path:   "/abs/path/to/repo",
  branch: "main",
  model:  "<current-model-id>",  // e.g. claude-opus-4-8[1m]
  pid:    <process id>
})
  -> { id: "sess-...", ...status: "connected" }
```

### C. Attach the session as a project

```
mcp__story-queue__project_attach({ sessionId: "sess-..." })
  -> { id: "proj-...", worktreeRoot, ...status: "attached" }
```

Keep the returned `proj-...` id — every queue call is scoped by it. `mcp__story-queue__project_discover()` lists connected-but-unattached sessions if you need to find one.

### D. Inspect and pull the next story

```
mcp__story-queue__queue_list({ projectId: "proj-..." })   // ordered queue for this repo
mcp__story-queue__queue_next({ projectId: "proj-..." })
  -> Story | null
```

`queue.next` reserves the top queued story, creates its worktree, and moves it to `in_progress`. **It returns `null` when nothing is pullable — most often because the work-in-progress cap is already reached** (default 2 concurrent `in_progress` stories), not only when the queue is empty. If you get `null` with a non-empty `queue_list`, a WIP slot must free up first (complete or abandon an in-progress story). Use `mcp__story-queue__stories_list({ projectId })` to see every story and its column, and `mcp__story-queue__story_detail({ id })` for the full spec + persisted runs + handoff.

The returned story's `worktree` is the implementation working directory for this story.

### E. Stream progress (per route, throughout)

```
mcp__story-queue__story_update({
  id:    "<story-id>",
  route: "fable",                       // or the worker route, e.g. "codex-explore"
  line:  { kind: "out", text: "..." },  // kind: cmd | out | ok | lock | unlock
  lane:  { route: "codex-explore", status: "running" }   // status: running | done
})
  -> { ok: true }
```

Stream a line at phase boundaries and before/after delegated commands. Set `lane.status: "done"` on a worker's final line so the board drawer stops that lane's caret. Route `fable` for your own narration; the worker's route id for delegated work.

### F. Complete the story

```
mcp__story-queue__story_complete({
  id:      "<story-id>",
  pr:      "https://github.com/owner/repo/pull/123",  // required
  outcome: "accepted",                                // accepted | escalated
  handoff: { ... },                                   // object, see schema below
  runs:    [ { ... } ]                                // array of RunRecord, see schema
})
  -> { ok: true }
```

This validates the handoff and runs, moves the story to `review`, sets its annotation to `outcome`, persists the run records, and releases the worktree write lock.

## Work the story

After `queue.next` returns a story:

1. Treat `story.worktree` as the working directory for all implementation.
2. Read the story title, description, acceptance criteria, scenarios, and any persisted plan (`story_detail`).
3. If no plan exists, create one **in this session** before coding. Do not ask the daemon to think.
4. Delegate bounded work to orchestrator workers, scoped to the worktree (`--cwd <story.worktree>`):
   - `fable-orchestrator:composer-implement` — default bulk implementation (write-capable).
   - `fable-orchestrator:codex-implement` — harder implementation or escalation after Composer misses the bar.
   - `fable-orchestrator:codex-explore` — verbose read-only repository exploration.
   - `fable-orchestrator:codex-check` — independent read-only review of the changes.
   - `fable-orchestrator:opus-review` — high-taste read-only review of UI/UX, API design, docs, and skill wording.
   - `fable-orchestrator:opus-explore` / `opus-check` / `opus-implement` — availability fallbacks when Codex is unavailable.
5. Stream a `story_update` line per route before/after each delegated command and at phase boundaries.
6. Inspect worker diffs and verification yourself. Workers return evidence, not ground truth.
7. Before `story.complete`, adapt orchestrator trace records into `RunRecord` objects with `plugins/orchestrator-core/trace-adapter.ts` (see below). Pass only validated run records to completion.

## Handoff schema (object, all fields required)

```json
{
  "status": "completed",            // completed | blocked | failed
  "summary": "What changed and why",
  "changes": ["file/path.ts — change made"],
  "verification": ["command run — result"],
  "risks": ["known risk, or 'none'"],
  "next_actions": ["follow-up, or 'none'"]
}
```

`additionalProperties` is **false** — extra keys are rejected. `changes`/`verification`/`risks`/`next_actions` are arrays of strings.

## Adapt orchestrator traces into RunRecords (before story.complete)

Pipe `fable-orchestrator runs --json` through the trace adapter before calling `story.complete`:

```bash
fable-orchestrator runs --json --limit 10 | bun plugins/orchestrator-core/trace-adapter.ts --story <story-id> --repo owner/name --run run-abc --run run-def > /tmp/runs.json
```

- `--story` — story id for every emitted `RunRecord.storyId`.
- `--repo` — `owner/name` slug for every emitted `RunRecord.repo`.
- `--run` — optional, repeatable filter: only adapt traces whose `run_id` matches (omit to adapt all stdin records).

The adapter maps annotate outcomes 1:1, defaults unrated runs (`outcome: null`) to `"unrated"`, maps trace `blocked`/`error` statuses to `status: "failed"`, and validates each output record against arc-contracts before printing.

## RunRecord schema (one per delegated run; all fields required)

```json
{
  "id": "run-<story>-<route>-<n>",   // unique, non-empty; a missing id fails as an opaque SQLite bind error
  "storyId": "<story-id>",
  "label": "Short human label",
  "repo": "owner/name",
  "route": "fable",                  // codex-explore | composer-explore | opus-explore | composer-implement | codex-implement | opus-implement | codex-check | composer-check | opus-check | fable
  "backend": "claude",               // claude | codex | cursor
  "model": "claude-opus-4-8[1m]",
  "access": "parent",                // read-only | write | parent
  "tokens": 0,                       // integer >= 0
  "durMs": 0,                        // integer >= 0  (NOTE: durMs, not durationMs)
  "status": "completed",             // completed | failed
  "changed": 0,                      // integer >= 0  (changed-file count)
  "outcome": "accepted"              // accepted | rejected | blocked | verification-failed | escalated | unrated
}
```

`additionalProperties` is **false**. Adapt real orchestrator trace/run records into this shape before `story.complete` (do not pass a stray `summary` or `durationMs`).

## Gotchas (hard-won)

- **Repo slug, not URL.** Register `owner/name` from `git_repoId`; the full `.git` URL yields empty project-scoped queues.
- **`queue.next` → `null` usually means the WIP cap is hit**, not an empty queue. Free a slot by completing an in-progress story.
- **`handoff` must arrive as a JSON object.** Some MCP clients stringify nested object arguments, which the daemon rejects with `Invalid Handoff: data must be object`. If the direct `story.complete` call fails this way, use the helper CLI (below), which reads the handoff/runs from files and sends real objects.
- **RunRecord needs every field, including `id` and `storyId`.** A missing `id` surfaces only as `Provided value cannot be bound to SQLite parameter 1`, and `additionalProperties: false` rejects extra keys.
- **`story.complete` `outcome` is `accepted` or `escalated` only** — the richer set (`rejected`, `blocked`, `verification-failed`, `unrated`) belongs to `RunRecord.outcome`, not the story outcome.
- **Never silently hold a worktree lock.** If a story blocks, stream the reason with `story_update`, then complete with `handoff.status: "blocked"` and `outcome: "escalated"`, or leave it in progress only while a human is actively investigating.

## Helper CLI (optional, avoids client object-serialization quirks)

```bash
cd arc-story-queue
npm run fable:pull -- --path /abs/path/to/repo --model "<current-model-id>"
npm run fable:update -- --id <story-id> --route codex-explore --kind out --line "Mapping files" --lane-status running
npm run fable:complete -- --id <story-id> \
  --pr https://github.com/owner/repo/pull/123 \
  --handoff /tmp/handoff.json --runs /tmp/runs.json --outcome accepted
```

The helper performs deterministic plumbing only (register → attach → queue.next → announce, or read handoff/runs from files and call `story.complete`). It runs no model.

## Blocked / failure path

If a story cannot proceed, stream the reason with `story_update`, then either complete with `handoff.status: "blocked"` and `outcome: "escalated"`, or leave it in progress only while a human is actively investigating. Never abandon a reserved worktree without a streamed explanation.
