# @andysolomon/arc-routing-core

The shared ARC routing contract: the single representation of routing policy,
model metadata, capability evidence, selection, workload profiling, and trace
records consumed by the arc-orchestrator runtime plane and the arc-router
control plane (ADR 0012).

- `src/index.ts` — browser-safe barrel. No filesystem, environment, clock,
  network, or provider SDK access; every time-dependent value is injected.
- `src/runtime.ts` — Node/Bun-only helpers (SHA-256, file loading, JSONL).
- `generated/` — canonical artifacts written by `arc-orchestrator routing export`
  (`bun run routing-core:export`): `routing-policy.json`, `model-registry.json`,
  `capability-snapshot.json`, the synchronized `arc-model-policy.md`, and a
  `manifest.json` with a SHA-256 per file.

## Modules

| Module | Exports |
| --- | --- |
| `vocabulary` | backends, efforts, phases, modes, workload classes, price bands, failure classes |
| `policy-schema`, `parse-policy`, `render-policy`, `validate-policy`, `diff-policy`, `export-policy` | `RoutingPolicy`, the `arc-model-policy` parser/renderer (round-trips), typed validation issues, semantic diff, JSON/block/Markdown/patch export |
| `model-schema`, `validate-registry` | `ModelDefinition`, rungs and effort support, registry validation, registry ↔ policy divergences |
| `capability-routes`, `candidate-stacks`, `capability-floor` | route contracts, alias bindings, `compileCandidateStacks`, `candidateStackForRouteIn`, derived floors |
| `capability-snapshot`, `availability`, `budget`, `selection`, `selection-trace` | snapshot schema/validator, availability view, budget vectors, `select()` (ADR 0010), the v2 `selection` block |
| `workload-profile` | `profileWorkload`, `WORKLOAD_PROFILE_THRESHOLDS`, evidence validation |
| `routing-context`, `evaluate-policy`, `explain-decision` | `RoutingContext`, `evaluateRouting` (executing traversal + capability-rung proxy), human-readable explanation |
| `trace-schema`, `replay` | schema-4 and v2 record types, `readRoutingTrace`, `parseTraceJsonl`, counterfactual `replayTraces` |
| `bundle` | `buildRoutingBundle` (`arc-routing-bundle/v1`) |

## Rules

- The policy document, `MODEL_REGISTRY`, and the capability snapshot are the
  only authored inputs. Candidate stacks are compiled from the policy.
- Unknown capability is not low capability; unknown cost is not cheap.
- The executing selector is the availability-only traversal of the compiled
  stack. `select()` is a routing proxy until rollout promotes it.
