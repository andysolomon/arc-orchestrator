# Migration plan: one routing source of truth

Executed incrementally; every step left both repositories working. Status as
of 2026-09-26.

| # | Step | Where | Proof | Status |
| --- | --- | --- | --- | --- |
| 1 | Identify duplicated policy/model contracts | `docs/routing-core/architecture-assessment.md` | — | done |
| 2 | Capture pre-migration baselines | `test/fixtures/routing-core/*.baseline.json` | dumped before any module moved | done |
| 3 | Extract browser-safe routing types and data into `packages/routing-core` | `packages/routing-core/src` | `bun test` unchanged (688 pass; same 3 pre-existing E2E fallback-chain failures and 2 `arc-contracts` link errors as baseline) | done |
| 4 | Runtime modules become shims; stacks compile from policy | `plugins/arc-orchestrator/lib/*` | `test/routing-core/parity.test.ts` | done |
| 5 | Export canonical artifacts | `arc-orchestrator routing export` → `packages/routing-core/generated` | `test/routing-cli.test.ts` freshness | done |
| 6 | arc-router consumes canonical data | `scripts/sync-routing-core.mjs`, `src/canonical.ts` | `test/parity.test.ts`, `npm run check:routing-core` | done |
| 7 | Parity tests prove both planes see identical policy | orchestrator parity + router parity | digest equality, parser equality, validator equality | done |
| 8 | Workload Profiler | `packages/routing-core/src/workload-profile.ts` | `test/routing-core/workload-profile.test.ts` (table-driven) | done |
| 9 | Feed profiles into runtime routing | `cli.ts --workload-evidence`, `resolveWorkloadClass` | `test/routing-cli.test.ts` E2E through the bin | done |
| 10 | Workload evidence in traces | `trace-schema.ts` `workload_profile`, engine plumbing | E2E: block present with evidence, absent without | done |
| 11 | Simulator on the real engine | `evaluateRouting` + `SimulatorPage` | parity of `evaluateRouting` with shadow decisions; router tests | done |
| 12 | Trace Explorer | `TracesPage`, `readRoutingTrace`, `parseTraceJsonl` | router tests | done |
| 13 | Counterfactual Replay | `replay.ts`, `ReplayPage` | orchestrator + router tests | done |
| 14 | Policy Diff and Export | `diff-policy.ts`, `export-policy.ts`, `DiffPage` | orchestrator + router tests | done |
| 15 | Remove obsolete duplicated router data | deleted `src/data/models.ts`, `src/data/policy.ts`, `src/lib/{policy,validate,lookup,efforts}.ts` | router parity test asserts absence | done |

## Operating procedure after this migration

1. Change the fenced block in arc-pi `policy/arc-model-policy.md` (the
   control plane's Diff & Export tab produces the block and a patch).
2. `npm run policy:sync` in arc-pi; then in arc-orchestrator
   `bun run generate:surfaces`, `bun run routing-core:export`, `bun test`.
3. In arc-router `npm run sync:routing-core`, `npm test`, `npm run build`.
4. Commit all repositories together. A stale export or a stale vendored copy
   is a failing test, not a warning.

## Deliberately not migrated

- `routing-shadow.ts` remains the runtime's observational path (it now calls
  the shared functions through shims); promoting `select()` to executing is
  gated by rollout criteria and is out of scope here.
- `scripts/model-policy.mjs` (the synchronized arc-pi parser) is kept; the
  TypeScript port in routing-core is proven equal to it over the shipped
  document so arc-pi's sync flow is untouched.
