# 0011 — Task lifecycle state machine

- Status: Accepted
- Date: 2026-07-24
- Accepted: 2026-07-26
- Work item: TBD
- Depends on: `0010-capability-rung-selection.md` (Accepted; supplies
  `capabilityFloor`, `CapabilityBand`, and `select()`)
- Preserves: `0008-retry-aware-fallback.md` (one-pass traversal, retry budget,
  price-band guard)

## Context

The unit of orchestration is currently the **dispatch**. The only state machine in
the runner is the candidate traversal inside one dispatch
(`fallback-engine.ts`, `model-tier-routing-plan.md:106-119`). Everything above a
dispatch — deciding what the task is, whether the result was any good, and what to
do when it wasn't — happens in the parent's head and is recorded, if at all, after
the fact.

**The task lifecycle already exists in the codebase, twice, in weak forms.**

1. `SchedulerNodeStatus` (`delegation-scheduler.ts:62`) is
   `queued | active | completed | cancelled`. This is a *dispatch* lifecycle: it
   tracks whether a worker ran, never whether the work was correct. A node reaches
   `completed` identically for an accepted diff and a rejected one.
2. `Outcome` (`cli.ts:58-63`) is
   `accepted | rejected | blocked | verification-failed | escalated`. The comment
   above it is exact: *"The parent model's judgment of a completed worker run,
   recorded after the fact and joined to the run by run_id."* This is the task
   lifecycle — as a retrospective label with no runtime authority.

So the vocabulary is right and already in production traces. What is missing is
that nothing **executes** it.

Three consequences follow.

**Verification is unmodeled.** `verification-failed` is an annotation value, but no
state produces it. The requirement lives in prose — *"Fable must inspect the
resulting diff and verification"* (`routing-policy.ts:515`) — and is therefore
enforced by the parent remembering to do it. Whether verification ran, what it
checked, and who checked it are not recorded.

**Escalation is a label, not a mechanism.** Quality escalation today is
`annotate --outcome escalated --escalated-to <model>` (`cli.ts:118`) — written
after a human decided to rerun something. It has no budget line, no authorization
gate, no bound on how many times it can happen, and no automatic path. A parent
that escalates three times spends three dispatches from the root pool with nothing
enforcing that the third was worth attempting.

**The central invariant is prose-only.** *"Availability fallback is not quality
escalation"* appears roughly six times across `routing-policy.ts` and the planning
contract. Half of it is structurally enforced —
`FailureDisposition.terminal-completed-low-quality`
(`failure-classification.ts:34`) is a distinct kind and `shouldFallback` returns
false for it, so the lateral edge genuinely cannot fire on a low-quality result.
The other half is not enforced at all, because the vertical edge does not exist as
code. There is nothing to keep separate from the thing it must stay separate from.

ADR 0010 introduced `capabilityFloor` as the typed successor to `workload_class`
but deliberately left it unsupplied. This ADR supplies it.

## Decision

### 1. The task is the unit of orchestration; the dispatch is a step within it

Introduce `TaskState`, an explicit machine driven by the runner. It sits **above**
`DelegationScheduler` and calls it. `SchedulerNodeStatus` is unchanged: node
lifecycle remains the scheduler's concern, task lifecycle becomes the machine's.

```
                                    ┌──────────── replan ◄─┐
                                    ▼                      │
intake → classify → plan → [decompose] → dispatch → verify ─┤
                             │                        ▲     ├─→ accepted → [ship]
                             │                        │     ├─→ escalate ─┐
                             └── child tasks ─────────┘     ├─→ blocked   │
                                                            └─→ verification-failed
                                          escalate ─────────────► dispatch
```

### 2. Every state declares its capability floor, budget slice, and sandbox

This is what makes budget an input to selection rather than an admission gate.
A state does not "call a model"; it declares what it needs and the machine resolves
a rung through `select()`.

| State | Capability floor | Sandbox | Draws budget | Dispatches a worker |
| --- | --- | --- | --- | --- |
| `intake` | — | — | no | no |
| `classify` | low | read-only | small | optional |
| `plan` | high | read-only | small | no (parent) |
| `decompose` | high | — | no | no |
| `dispatch` | from `classify`, raised by `escalate` | route contract | **yes** | yes |
| `verify` | ≥ dispatch floor | read-only | **yes** | optional |
| `escalate` | dispatch floor + 1 band | route contract | **yes** | no (re-enters `dispatch`) |
| `replan` | high | read-only | small | no (parent) |
| `ship` | — | — | no | **never** |

`plan` and `replan` stay in the parent by design — they are the judgment the whole
architecture exists to protect. `ship` never dispatches: the shipping-authority
rule (`routing-policy.ts:304`, workers prohibited from git/GitHub mutation) becomes
a state precondition rather than a prohibition repeated in every worker prompt.

### 3. Two recovery edges, structurally distinct

| | **Lateral** (availability) | **Vertical** (quality) |
| --- | --- | --- |
| Triggered by | `FailureDisposition.kind === "retryable"` | `VerificationVerdict.kind === "fail-quality"` |
| Scope | within one dispatch | task-level, new dispatch |
| Capability floor | unchanged | raised one band |
| Automatic | yes, one-pass (ADR 0008/0010) | no — requires authorization |
| Budget | inside the existing dispatch reservation | **new reservation**, counted against `maxEscalations` |
| Trace link | `fallback_of` (existing) | `escalation_of` (new) |
| Bound | retry budget, stack exhaustion | `maxEscalations`, `floorCeiling`, `escalationCostFraction` |

The two edges take **different input types**. Lateral consumes a
`FailureDisposition`; vertical consumes a `VerificationVerdict`. Neither type is
reachable from the other, so the prose invariant becomes a type error. A completed
run cannot produce a `FailureDisposition`, and an availability failure cannot
produce a `VerificationVerdict`.

### 4. Escalation is budgeted, bounded, and authorized

```ts
export type TaskBudgetPolicy = {
  maxEscalations: number;           // vertical steps per task; default 1
  maxReplans: number;               // default 1
  escalationCostFraction: number;   // max share of remaining root cost; default 0.35
  floorCeiling: CapabilityBand;     // never raise the floor above this; default 4
};

/** Defaults accepted 2026-07-26 (conservative package). */
export const DEFAULT_TASK_BUDGET_POLICY: TaskBudgetPolicy = {
  maxEscalations: 1,
  maxReplans: 1,
  escalationCostFraction: 0.35,
  floorCeiling: 4,
};

export type EscalationAuthorization =
  | { kind: "policy"; maxBand: CapabilityBand }  // pre-authorized up to a band
  | { kind: "parent" }                           // parent decides in-loop
  | { kind: "user" };                            // requires explicit user approval
```

`floorCeiling` is what keeps escalation from walking to the most expensive rung
available. `escalationCostFraction` is what keeps a task from spending its root
budget on retries and leaving none for the work. Exceeding either is not a failure
of the task — it is a transition to `verification-failed` with the reason recorded,
which is a materially different and more honest outcome than a silent third attempt.

### 5. Verification distinguishes *weak worker* from *wrong plan*

```ts
export type VerificationVerdict =
  | { kind: "pass"; evidence: VerificationEvidence }
  | { kind: "fail-quality"; unmetCriteria: string[]; evidence: VerificationEvidence }
  | { kind: "fail-approach"; reason: string; evidence: VerificationEvidence }
  | { kind: "fail-blocked"; reason: string };
```

- `fail-quality` → `escalate`. The approach was right; the rung was too weak.
  Raising the floor is the correct response.
- `fail-approach` → `replan`. The plan was wrong. Escalating here buys a more
  expensive model to execute the same bad plan — the single most expensive mistake
  this machine exists to prevent.
- `fail-blocked` → `blocked`. Missing credential, absent dependency, ambiguous
  requirement. No rung fixes it.

Collapsing these three into one "it failed" is why escalation currently has no
principled stopping rule.

**Verification independence.** When `verify` runs as a dispatch, its `rungId` must
differ from the `rungId` under review. Self-review is not verification, and
`select()` already carries enough state to enforce it as a hard filter.

**Verification is not free.** A `verify` dispatch draws a real budget reservation.
The policy therefore allows skipping it (`verify: "parent" | "dispatch" | "skip"`)
so low-stakes work does not silently double in cost.

### 6. Terminal states preserve the existing annotation vocabulary

Task-level terminals are exactly `accepted | rejected | blocked |
verification-failed`, plus one new value:

- `cancelled` — reached by root cancellation propagation
  (`delegation-scheduler.ts:546`). It has no annotation analogue today and is
  additive.

`escalated` deliberately stays **run-level only**. It describes a dispatch that was
superseded, not a task that ended. A task that escalates once produces two runs:
the first annotated `escalated`, the second carrying the task's terminal outcome.
This keeps the acceptance-rate arithmetic in `report` (`cli.ts:900`, which already
counts `escalated` as its own bucket) numerically unchanged.

### 7. The machine lives in the runner, as a pure reducer

```ts
export function step(input: TaskStepInput): TaskTransition;
```

Pure: no I/O, no environment, no clock — the same discipline as `select()`, for the
same reason (shadow-mode determinism and replayability).

The machine is **not described to the model in prose.** The current failure mode is
that policy migrates into skill markdown and is then enforced by the model
remembering it; `surface-templates.ts` is 1043 lines of exactly that. Each state
asks the model one bounded question and consumes a typed answer. A worker prompt
should never contain the words "escalate" or "state machine."

### Types

```ts
export const TASK_MACHINE_SCHEMA_VERSION = 1;

export type TaskStateName =
  | "intake" | "classify" | "plan" | "decompose"
  | "dispatch" | "verify" | "escalate" | "replan"
  | "accepted" | "rejected" | "blocked" | "verification-failed" | "cancelled"
  | "ship";

export type TerminalStateName = Extract<
  TaskStateName,
  "accepted" | "rejected" | "blocked" | "verification-failed" | "cancelled"
>;

export type VerificationMode = "parent" | "dispatch" | "skip";

export type VerificationEvidence = {
  mode: VerificationMode;
  rungId: RungId | null;          // null when parent-executed
  criteriaChecked: string[];
  commandsRun: string[];          // redacted, bounded
};

export type TaskPolicy = {
  budget: TaskBudgetPolicy;
  authorization: EscalationAuthorization;
  verification: VerificationMode;
};

export type TaskState = {
  schemaVersion: typeof TASK_MACHINE_SCHEMA_VERSION;
  taskIdentity: string;           // scheduler-normalized, bounded (delegation-scheduler.ts:154)
  rootIdentity: string;
  depth: number;                  // 0..MAX_DELEGATION_DEPTH
  name: TaskStateName;
  axis: CapabilityAxis;
  capabilityRoute: CanonicalCapabilityRouteId;
  capabilityFloor: CapabilityBand;
  originalFloor: CapabilityBand;
  acceptanceCriteria: string[];
  escalationsUsed: number;
  replansUsed: number;
  runIds: string[];               // every dispatch this task has produced, in order
};

export type TaskEvent =
  | { kind: "classified"; axis: CapabilityAxis;
      capabilityRoute: CanonicalCapabilityRouteId; floor: CapabilityBand }
  | { kind: "planned"; acceptanceCriteria: string[] }
  | { kind: "decomposed"; childTaskKeys: string[] }
  | { kind: "dispatch-selected"; decision: SelectionDecision }
  | { kind: "dispatch-completed"; runId: string; disposition: FailureDisposition | null }
  | { kind: "verified"; verdict: VerificationVerdict }
  | { kind: "escalation-authorized"; toBand: CapabilityBand }
  | { kind: "escalation-denied"; reason: string }
  | { kind: "cancelled"; reason: string }
  | { kind: "ship-authorized" };

export type TaskStepInput = {
  state: TaskState;
  event: TaskEvent;
  policy: TaskPolicy;
  ledger: RootBudgetLedger;       // read-only
  nowMs: number;
};

export type TaskTransition =
  | { ok: true; next: TaskState; effects: TaskEffect[]; explanation: TransitionExplanation }
  | { ok: false; reason: TransitionRejection; explanation: TransitionExplanation };

export type TaskEffect =
  | { kind: "select"; request: SelectionRequest }
  | { kind: "reserve"; taskIdentity: string }
  | { kind: "dispatch"; stack: SelectedRung[] }
  | { kind: "request-authorization"; toBand: CapabilityBand; via: EscalationAuthorization }
  | { kind: "annotate"; runId: string; outcome: Outcome }
  | { kind: "emit-task-event" };

export type TransitionRejection =
  | "illegal-transition"
  | "escalation-limit-reached"
  | "escalation-budget-exhausted"
  | "escalation-above-floor-ceiling"
  | "escalation-unauthorized"
  | "replan-limit-reached"
  | "depth-limit-reached"
  | "root-cancelled";
```

`TaskEffect` keeps the reducer pure: `step()` decides *what* should happen and the
driver performs it. Effects are also what emit the existing per-run annotations, so
`annotate` records become a machine output rather than a manual afterthought —
while remaining manually writable for parent override.

`Outcome` is presently a module-local type in `cli.ts:58` alongside
`AnnotationRecord` and `ANNOTATION_SCHEMA_VERSION`. Landing this ADR requires
lifting the annotation vocabulary into a shared `lib/` module so the machine and
the CLI cannot drift — a mechanical, independently reviewable first PR.

### Transition table

| From | Event | To | Guard |
| --- | --- | --- | --- |
| `intake` | `classified` | `classify` → `plan` | — |
| `plan` | `planned` | `decompose` \| `dispatch` | `acceptanceCriteria` non-empty for implement routes |
| `decompose` | `decomposed` | `dispatch` | `depth < MAX_DELEGATION_DEPTH`, fan-out ≤ `MAX_DIRECT_FAN_OUT` |
| `dispatch` | `dispatch-completed` (retryable) | `dispatch` | handled inside traversal; no task transition |
| `dispatch` | `dispatch-completed` (terminal) | `rejected` | — |
| `dispatch` | `dispatch-completed` (null) | `verify` | — |
| `verify` | `verified` `pass` | `accepted` | — |
| `verify` | `verified` `fail-quality` | `escalate` | all four escalation guards pass |
| `verify` | `verified` `fail-quality` | `verification-failed` | any escalation guard fails |
| `verify` | `verified` `fail-approach` | `replan` | `replansUsed < maxReplans` |
| `verify` | `verified` `fail-blocked` | `blocked` | — |
| `escalate` | `escalation-authorized` | `dispatch` | floor + 1 ≤ `floorCeiling` |
| `escalate` | `escalation-denied` | `verification-failed` | — |
| `replan` | `planned` | `dispatch` | — |
| `accepted` | `ship-authorized` | `ship` | explicit user authorization; parent-executed |
| *any* | `cancelled` | `cancelled` | root cancellation propagation |

Retryable dispatch failures produce **no task transition** — they are consumed
entirely by the traversal. That is the lateral/vertical separation expressed as
table structure.

### Persistence

Event-sourced, no new mutable store. `TaskState` is derived by folding `step()`
over a `task-events.jsonl` sidecar, following the same pattern as
`routing-trace-v2.jsonl` (`cli.ts:77`): a separate file so existing schema-4
readers of `runs.jsonl` are untouched, and a replay that reconstructs any task's
history exactly.

## Consequences

- **`annotations.jsonl` is a ready-made backtest corpus.** Every recorded
  `accepted` / `rejected` / `escalated` is a task outcome a human already judged.
  The machine can be replayed against that history in shadow mode — computing what
  it *would* have done and diffing against what the parent actually did — before it
  controls anything. This is stronger validation than the routing shadow gets,
  because the ground truth is real judgment rather than a competing heuristic.
- **Some tasks will now stop that previously succeeded.** A task that today quietly
  succeeds on a third manual escalation will hit `maxEscalations` and terminate as
  `verification-failed`. This is the intended trade: the third attempt was
  previously invisible and unbudgeted. Operators who want the old behavior raise
  `maxEscalations`, explicitly.
- **Verification cost is now visible, which means it is now attributable.** Teams
  will discover they were paying for verification all along in parent context and
  wall time; making it a budgeted dispatch does not create the cost, it names it.
  `verification: "skip"` exists so the naming does not become a tax on low-stakes
  work.
- **`escalated` keeps its exact current meaning.** Run-level, superseded-dispatch.
  `report` acceptance arithmetic is unchanged, so historical acceptance rates stay
  comparable across the migration.
- **One new terminal value.** `cancelled` has no annotation analogue and is
  additive to the `Outcome` union; readers must tolerate it.
- **Depth-2 stays intact.** Child tasks run their own machine but may not escalate
  — escalation raises a floor and spends root budget, which is a parent decision.
  This matches the existing rule that a child returns a structured recommendation
  and never spawns a grandchild (`model-tier-routing-plan.md:168`).
- **The scheduler is unchanged.** `SchedulerNodeStatus`, admission, cycle
  detection, worktree ownership, and cancellation propagation all keep working as
  they do now; the machine sits above them and issues `reserve` / `dispatch`
  effects.
- **ADR 0008 is untouched.** Retry budget, sliding window, and price-band crossing
  guard operate inside `dispatch` exactly as today. The machine cannot observe an
  individual candidate attempt, by construction.
- **The prose-drift risk is real and must be actively resisted.** Every prior
  policy in this system started as code and ended up restated in skill markdown.
  A test should assert that worker prompts contain no state-machine vocabulary,
  because the failure mode here is not that the machine breaks — it is that the
  machine is correct and the model is separately told a slightly different version
  of it.
- **`fail-quality` versus `fail-approach` is a judgment the parent must actually
  make.** The machine cannot infer it. If parents label everything `fail-quality`,
  the system degenerates into buying more expensive models to execute bad plans —
  the exact failure this ADR is designed to prevent. Shadow-mode replay should
  report the observed ratio as a health metric.
- **Decided at Accept (2026-07-26).** Concrete `TaskBudgetPolicy` defaults are the
  conservative package above: `maxEscalations: 1`, `maxReplans: 1`,
  `escalationCostFraction: 0.35`, `floorCeiling: 4`. Operators who want today's
  freer multi-escalation behavior raise the limits explicitly; the machine's
  intended trade is that a third silent escalation becomes `verification-failed`.
  `classify` is **parent-executed only in v1** — the machine does not dispatch a
  classify worker. A future opt-in classify dispatch would need its own decision;
  it is not authorized by this Accept. ~~The `workload_class` → `capabilityFloor`
  mapping table~~ was settled earlier by ADR 0010 phase 13.8
  (`capability-floor.ts`), and not as a table: the floors are derived from each
  class's authored stack lead, because the class vocabulary carries a sanctioned
  inversion and two classes that state a ceiling rather than a floor. It also took
  half of `TaskBudgetPolicy`'s migration question off the table — degradation
  latitude is read from `automaticFallback` rather than invented. Widening
  degradation latitude beyond what the authored stacks already grant remains an
  explicit `TaskBudgetPolicy` change, not a silent side effect of Accept.
