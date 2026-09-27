# Architecture assessment: routing across arc-orchestrator and arc-router

Date: 2026-09-26. Companion to ADR 0012 and `migration-plan.md`.

## What existed

### arc-orchestrator (runtime)

The runtime already had a mature, deterministic routing stack:

| Concern | Module | State before this change |
| --- | --- | --- |
| Policy input | `docs/arc-model-policy.md` → `model-policy.generated.ts` (digest-checked) | authoritative, synchronized from arc-pi |
| Model inventory | `model-registry.ts` (`MODEL_REGISTRY`, validation, GLM boundary) | authoritative; also *authored* the candidate stacks and alias stacks inline |
| Capability evidence | `capability-snapshot.ts` + `orchestrator-core/capability-snapshot.json` | authoritative, validated, banded |
| Selection | `capability-selection.ts` (`select()`), `capability-floor.ts`, `availability-view.ts`, `selection-trace.ts` | pure, tested, running observationally under `routing-shadow.ts` |
| Routes | `capability-routes.ts`, `routes.ts` | contract facts + env-driven profile resolution |
| Traces | `trace-schema.ts` (schema 4 + `orchestrator-routing-trace/v2`) | pure types and sanitizers, but one `Bun.CryptoHasher` call in the checkout hash |
| Rollout | `rollout-gates.ts`, `selection-activation.ts` | staged; `select()` never dispatches |

Missing: an evidence-driven producer of `workload_class`, a single callable
"evaluate this context under this policy" entry point, and any machine-readable
export the UI could consume.

### arc-router (UI)

A well-built static SPA (Vite, React 18, strict TS, Tailwind) with two surfaces:
a benchmark scatter over Artificial Analysis data and a policy editor. Its
routing knowledge was a hand port of the runtime's policy document
(`ORIG`, `BINDINGS`, `MODELS`, `RMAP`, `PHASES`, `WORKLOADS`), plus local
rules (`efforts()`, `rungIssue()`, `validate()`) that restated a subset of the
runtime's grammar and registry facts. Observed drift at assessment time:

- the UI bound `opencode-go-muse-spark-1.3-contributor`; the runtime policy and
  registry do not carry it;
- effort rules were per-model special cases (`gpt-6-luna` max, Grok fixed high)
  rather than registry-derived;
- validation covered exclusions, duplicates, and `cursor-auto`, but not unbound
  models, registry availability, fixed-effort mismatches, or canonical order.

## Duplication identified

| Runtime authority | UI copy | Resolution |
| --- | --- | --- |
| `MODEL_POLICY` (parsed block) | `src/data/policy.ts` `ORIG` + `BINDINGS` | replaced by `generated/routing-policy.json` |
| `MODEL_REGISTRY` bindings/efforts | `src/data/models.ts` `MODELS`, `RMAP`, `src/lib/efforts.ts` | replaced by `generated/model-registry.json` + `selectableEffortsFor` |
| parser validation rules | `src/lib/validate.ts` | replaced by routing-core `validatePolicy` / `validateChain` |
| block rendering + diff | `src/lib/policy.ts` | replaced by routing-core `renderPolicyLines`, `diffPolicies` |
| bench ↔ policy usage | `src/lib/lookup.ts` | replaced by `lib/bench-join.ts` over registry data |
| phase / workload vocabulary | `PHASES`, `WORKLOADS` | replaced by routing-core `WORKER_PHASES`, `WORKLOAD_CLASSES` |

## Decisions taken

1. **Shared contract lives in the runtime repository** as
   `packages/routing-core`, not in a third repository, and is shipped inside the
   npm package so the packed runner resolves it.
2. **Promote, do not parallel**: `select()`, the snapshot validator, the floor,
   the availability view, the selection-trace mapper, the capability routes, the
   registry validator, and the trace types moved verbatim (parametrized on the
   data they used to import). The runtime modules are shims.
3. **Stacks compile from policy** through one function both planes call.
4. **Build-time synchronization for the UI**: a vendoring script with a
   manifest, not a backend, not an npm dependency on an unpublished package.
5. **Profiler is a decision table** with exported thresholds and reasons; it
   feeds the existing selection and never replaces it.
6. **Two layers stay distinct in every explanation**: the executing
   availability-only traversal and the observational capability-rung
   `select()` are both reported, the latter always labelled a routing proxy.
7. **Leaderboard data stays editorial** in arc-router and is joined to the
   capability snapshot rather than replacing it.

## Risks and follow-ups

- The runtime shadow (`routing-shadow.ts`) still resolves the floor stack
  without a phase, so it skips the deploy stack; the control plane evaluates it.
  A later change can pass the phase through and re-run the parity fixture.
- `routing export` must be re-run when the policy, registry, or snapshot
  changes; `test/routing-cli.test.ts` fails otherwise. arc-router's
  `npm run check:routing-core` fails when its vendored copy is stale.
- Thresholds in `WORKLOAD_PROFILE_THRESHOLDS` are initial values chosen for
  explainability; tuning them is a routing-core change with table tests, not a
  prompt change.
