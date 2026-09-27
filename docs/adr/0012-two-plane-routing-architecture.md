# 0012 — Two-plane routing architecture: runtime plane and control plane

- Status: Accepted
- Date: 2026-09-26
- Work item: arc-two-plane-architecture
- Builds on: `0010-capability-rung-selection.md` (rungs, snapshot, `select()`),
  `0011-task-lifecycle-state-machine.md` (capability floors as state
  declarations), `docs/orchestrator/decisions/0002` (candidate stacks),
  `0003` (budgets), `0005` (benchmark authority)
- Implemented by: `packages/routing-core/` (shared contract),
  `plugins/arc-orchestrator/lib/routing-cli.ts` (runtime routing surface),
  `test/routing-core/` and `test/routing-cli.test.ts` (parity and E2E),
  `arc-router/scripts/sync-routing-core.mjs` and `arc-router/src/routing-core/`
  (control-plane consumption)

## Context

Routing policy and model metadata existed in two hand-maintained places. The
runtime (`arc-orchestrator`) held the authority: the synchronized
`arc-model-policy` block, the model registry, the capability snapshot, the
capability floor, `select()`, and the trace schemas. The UI (`arc-router`)
carried its own copies — `src/data/models.ts`, `src/data/policy.ts`,
`src/lib/validate.ts`, `src/lib/efforts.ts`, `src/lib/lookup.ts` — ported by
hand from a design reference. They had already drifted: the UI listed a Muse
Spark 1.3 binding that the runtime policy does not carry, its validation rules
were a subset of the parser's, and its effort rules restated registry facts.

Two further gaps motivated the change. The runtime's selection was deterministic
once a `workload_class` was known, but nothing produced that class from
observable evidence; it was a free-hand parent guess. And nothing outside the
runtime could answer "what would ARC do, and why" for a synthetic context or a
recorded trace, let alone for a candidate policy.

## Decision

### 1. Two planes with fixed responsibilities

| | `arc-orchestrator` — runtime / data plane | `arc-router` — control plane |
| --- | --- | --- |
| Question | Given this actual task, repository, runtime state, budget, availability, and session context, what should ARC execute right now? | What would ARC do, why, and how would routing change under a different policy? |
| Owns | routing execution, workload profiling, eligibility, capability floors, budgets, availability, fallback, selection, task lifecycle, delegation, retries, execution, verification, traces, outcomes | policy inspection and editing, model/capability/benchmark visualization, simulation, trace inspection, counterfactual replay, policy comparison, validation, change export |
| Never | — | model execution, worker spawning, provider authentication, runtime delegation, LLM calls, writes to the runtime repository |

### 2. One routing contract, owned by the runtime

`packages/routing-core/` inside arc-orchestrator is the single authoritative
representation of routing policy, model metadata, capability evidence,
selection, workload profiling, and trace records. It is:

- **deterministic and side-effect free**: no clock, environment, filesystem,
  network, or provider state is read; every time-dependent value is injected;
- **browser-safe by construction**: the barrel `src/index.ts` imports only
  other routing-core modules; the Node-only helpers (hashing, file loading)
  live in `src/runtime.ts` and are never vendored;
- **versioned**: `ROUTING_CORE_VERSION = "arc-routing-core/v1"` travels in
  every v2 trace (`versions.routing_core`) and in every exported artifact;
- **the runtime's own code**: the runtime modules under
  `plugins/arc-orchestrator/lib/` that used to define these contracts are now
  thin shims that bind the shared functions to the shipped data
  (`MODEL_REGISTRY`, the compiled stacks). Every historical import path keeps
  working.

Source-of-truth rules:

1. The `arc-model-policy` block (arc-pi `policy/arc-model-policy.md`, synchronized
   into `docs/arc-model-policy.md` and `model-policy.generated.ts`) remains the
   only authored policy input. Its SHA-256 digest is the policy identity.
2. `MODEL_REGISTRY` remains the only authored model inventory; the capability
   snapshot JSON remains the only capability evidence. Neither is edited in the
   control plane.
3. Candidate stacks are **derived**, never authored: `compileCandidateStacks`
   builds every automatic stack from the policy (chain plus tail) and every
   explicit alias stack from the bindings. The runtime's `CANDIDATE_STACKS` is
   this compilation; `test/routing-core/parity.test.ts` holds it byte-for-byte
   against the pre-migration stacks.
4. The control plane consumes exported artifacts only:
   `packages/routing-core/generated/{routing-policy,model-registry,capability-snapshot,manifest}.json`
   and the synchronized policy document, produced by
   `arc-orchestrator routing export` and proven fresh by an E2E test.

### 3. Routing data flow

```text
arc-pi policy/arc-model-policy.md ──sync──► docs/arc-model-policy.md + model-policy.generated.ts
                                                     │
MODEL_REGISTRY ──┐                                   ▼
capability-snapshot.json ──┤            packages/routing-core (contract + engine)
                           │                         │
                           ▼                         ▼
                 routing export  ─────► generated/*.json + arc-model-policy.md
                                                     │
                                            npm run sync:routing-core
                                                     ▼
                                       arc-router/src/routing-core (vendored, MANIFEST.json)
                                                     │
               ┌──────────────┬──────────────┬───────┴───────┬──────────────┐
          Policy Studio   Simulator     Trace Explorer     Replay      Diff & Export
                                                     │
                                       artifacts (JSON, block, Markdown, patch) ──► pull request ──► arc-pi
```

Runtime dispatch, unchanged in behavior:

```text
task + --workload-class | --workload-evidence
   → Workload Profiler (deterministic decision tables) → difficulty × volume → class
   → compiled candidate stack (policy chain + tail)
   → capability floor (derived from the stack lead) → select() (observational, shadow)
   → availability-only fallback traversal → dispatch
   → schema-4 trace + orchestrator-routing-trace/v2 (+ workload_profile block)
```

### 4. Workload profiling

`profileWorkload(evidence)` turns structured, observable evidence (scope,
change, execution, session) into difficulty and volume through decision tables
with published thresholds (`WORKLOAD_PROFILE_THRESHOLDS`). Rules: hard flags
(architecture, schema, auth, security, concurrency, distributed state,
cross-language, repeated failures) make a task hard; two or more medium signals
compound to hard; volume is the highest tier any count reaches. Missing
evidence is *not observed*, never zero; evidence without scope or change facts
cannot derive a class and fails closed. The result always carries reasons.

The runtime accepts `--workload-evidence` on `run`. On automatic implement
without `--workload-class` the derived class routes; an explicit class always
wins and the disagreement is recorded. The profiler augments the existing
selection; `select()`, floors, availability, budgets, exclusions, lead-backend
coherence, and shadow rollout are unchanged.

### 5. Trace versioning

Trace records are extended additively, on the precedent of
`orchestrator_identity` and `selection`: schema-4 `TraceRecord` and
`orchestrator-routing-trace/v2` gain an optional `workload_profile` block
(`workload-profile/v1`) and v2 gains `versions.routing_core`. A record without
the key predates the profiler; `null` means no evidence was supplied. Schema
numbers do not change because no existing field changed meaning; a reader that
ignores unknown keys reads new records unchanged, and
`test/routing-cli.test.ts` proves a run without evidence writes byte-identical
records. `readRoutingTrace` reads v2 and legacy records for the control plane.

### 6. Policy versioning

A policy is identified by its label (`runner-routing-v4`), its `updated`
date, and the SHA-256 of its canonical JSON. Exported artifacts carry all
three; the control plane keys drafts to the canonical digest they were edited
from and discards a draft whose base changed. Candidate policies are exported
as artifacts (canonical JSON, generated block, Markdown, unified patch against
the policy document) for a pull request to arc-pi; the control plane never
writes to a runtime repository.

### 7. Browser / runtime boundary

- `packages/routing-core/src/index.ts` is the only entry the control plane
  imports; `arc-router/scripts/sync-routing-core.mjs` refuses to vendor a file
  that imports Node built-ins, references `Bun`, reads `process.env`, or
  calls `Date.now()`, and `arc-router/test/browser-safe.test.ts` holds that line.
- `packages/routing-core/src/runtime.ts` (hashing, file loading) and everything
  under `plugins/arc-orchestrator/lib/` stay runtime-only.

## Migration strategy (as executed)

1. Baselines: candidate stacks, alias stacks, the `routes --json` contract,
   derived floors, and every shadow `select()` decision were dumped from the
   pre-migration runtime into `test/fixtures/routing-core/`.
2. Extraction: pure modules moved into routing-core; runtime modules became
   shims; the parity test proves the compiled stacks, contract, floors, and
   decisions are unchanged.
3. Control-plane consumption: arc-router vendors routing-core and the exported
   artifacts, deletes its hand-authored copies, and re-validates on load.
4. Profiler, evaluation, explanation, diff, export, and replay were added to
   routing-core with table-driven tests; the runtime gained
   `--workload-evidence` and the `routing` subcommands, exercised end to end
   through the runner binary.
5. Traces gained the additive profile block.
6. Every step left both repositories building and testing green; no production
   routing behavior changed (`select()` remains observational, executing
   traversal unchanged, `versions.policy` unchanged).

## Consequences

- One representation of policy and models; drift between the planes is a test
  failure (`routing export` freshness, vendored manifest, parity) rather than a
  discovery.
- The simulator and replay use the identical functions the runtime executes
  and shadows, so a control-plane answer is an answer about the runtime.
- The Muse Spark 1.3 rung the old UI carried is no longer offered: it is not
  in the policy or registry. Adding it is a runtime change (policy document +
  registry entry), then a sync, which is the intended direction.
- Leaderboard data (Artificial Analysis) remains editorial visualization data
  in arc-router, clearly separated from the capability snapshot the runtime
  routes on; unknown capability and unknown cost stay unknown in both.
- The runtime's `routing-shadow.ts` still resolves stacks without a phase for
  the floor, so the deploy stack is skipped by the shadow while the control
  plane evaluates it (its floor is read off the stack, `source: "stack"`). This
  is recorded, not hidden; promoting the shadow to pass the phase is a
  separate, tested change.
