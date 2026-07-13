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
7. Ship the story through the delegated PR review loop (below) to produce the `pr` URL that `story.complete` requires.
8. Before `story.complete`, adapt orchestrator trace records into `RunRecord` objects with `plugins/orchestrator-core/trace-adapter.ts` (see below). Pass only validated run records to completion.

## Ship the story: PR + review loop

The parent owns scope and approval decisions. Opening a PR with `gh pr create` is a parent action; commit/push, GitHub comments, and merge stay on mechanical routes. Every mechanical mutation below is a bounded delegation scoped to `story.worktree`; review judgment remains on a read-only review model.

1. **Prepare the approved diff.** Inspect the implementation and verification evidence. Require the implementation worker to stage only the approved story-scoped files; neither the parent nor a mechanical worker broadens the staged set.
2. **Commit and push.** Delegate the already-staged conventional commit and branch push to `mechanical-commit-push`. This route may perform only the bounded commit followed by a normal push. Never request a force-push, force-with-lease, rebase, amend, reset, or other history rewrite.
3. **Open the PR without merging.** Open the pull request directly with `gh pr create`, using an approved conventional title and body that maps the plan and acceptance criteria and includes `Closes #<issue>` when applicable. Capture the returned PR number and URL. Opening a PR is not a mechanical route.
4. **Run the review loop.** Invoke `arc-pr-review-loop <PR#>` with the story plan, acceptance criteria, `story.worktree`, and the explicit round cap. The loop keeps judgment on `opus-review` for taste-sensitive surfaces or `codex-check` for correctness, security, regression, and acceptance validation. It delegates approved PR comment posting to `mechanical-post-comment`, review-finding fixes to an implementation worker, and every already-staged fix commit and normal push to `mechanical-commit-push`. The default cap remains 3 rounds; after that, escalate to a stronger implementation route or a human instead of silently extending the loop.
5. **Stream each round.** Emit one `story_update` line after the mechanical comment-post trace is captured and one after the mechanical commit-push trace is captured. Close each review and implementation lane with `lane.status: "done"`.
6. **Complete or merge on approval.** Without explicit merge authority, call `story.complete` with the approved PR URL and `outcome: "accepted"`; the story moves to `review` and the PR stays open. Only when the operator explicitly supplied `--merge-on-approve`, delegate the approved squash merge to `mechanical-merge`, capture its trace, then call `story.complete`. Never merge merely because the review verdict is approve.

### End-to-end traced workflow

For each **mechanical** delegation, record the returned runner id, stream the route boundary, and retain raw `fable-orchestrator runs --json` evidence. Preserve the separate review verdict artifact as judgment evidence: `codex-check` has a runner trace, while direct `opus-review` does not claim one. The ordered workflow is:

```text
implementation worker stages approved files
  -> mechanical-commit-push (initial commit + normal push)
  -> gh pr create (approved title/body; returns PR URL)
  -> opus-review | codex-check (read-only judgment, round 1)
  -> mechanical-post-comment (approved review result)
  -> implementation worker (review findings only; stages approved fixes)
  -> mechanical-commit-push (round fix commit + normal push)
  -> opus-review | codex-check (next round, up to the unchanged cap of 3)
  -> mechanical-post-comment (approved review result)
  -> approve: story.complete, or mechanical-merge first only with --merge-on-approve
```

After the loop, first retain the raw trace export for the recorded mechanical run ids. Its requested alias, task class, and model fields are the authoritative evidence that each dumb-model route ran:

```bash
fable-orchestrator runs --json --limit 20 > /tmp/mechanical-traces.json
```

Then adapt the selected runner records into the current Story Queue `RunRecord` contract:

```bash
cat /tmp/mechanical-traces.json | bun plugins/orchestrator-core/trace-adapter.ts --story <story-id> --repo owner/name --run <run-id> > /tmp/runs.json
```

The current adapter intentionally collapses Composer mechanical aliases to the contract-compatible `composer-implement` route, so `/tmp/runs.json` is not proof of the individual operation. Keep `/tmp/mechanical-traces.json` alongside the review verdict artifacts. Raw evidence must cover the initial `mechanical-commit-push`, every `mechanical-post-comment`, each fix `mechanical-commit-push`, and `mechanical-merge` when authorized; retain the `gh pr create` output (PR URL/number) as parent evidence for PR opening. Preserve each `opus-review` verdict artifact or `codex-check` trace separately. A missing or failed required mechanical trace blocks completion; it never authorizes the parent to perform the fallback itself.

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

The adapter maps annotate outcomes 1:1, defaults unrated runs (`outcome: null`) to `"unrated"`, maps trace `blocked`/`error` statuses to `status: "failed"`, and validates each output record against arc-contracts before printing. It currently maps mechanical Composer runs to `composer-implement`; retain raw runner traces whenever operation-level identity is required.

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
