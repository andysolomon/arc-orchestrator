# ARC Orchestrator Context

## Routing glossary

- **task_class** is free-form parent observability metadata. It does not select a model.
- **phase** is the ARC Delegate lifecycle key: `explore`, `analyze`, `research`, `plan`, `implement`, `verify`, or `deploy`.
- **workload_class** is the two-axis implementation complexity key: `hard-hard`, `hard-medium`, `hard-easy`, `medium-hard`, `medium-medium`, `medium-easy`, `easy-hard`, `easy-medium`, or `easy-easy`. The previous seven classes remain accepted during migration.
- **Availability-only fallback** advances only after a normalized availability failure. A completed result, quality concern, or validation failure never advances a stack.
- **Explicit route override** is a traced diagnostic/manual-recovery selection. It must not rewrite the configured fallback chain.
- **`ARC_ORCHESTRATOR_RETRY_POLICY`** selects the per-label retry budget: `shadow` (default when unset — records budget evidence on attempted steps but never blocks), `off` (explicit opt-out; the fallback traversal is byte-for-byte unchanged; empty or unrecognized values also resolve to `off`), or `active` (enforces a sliding-window attempt cap of 2 attempts per label per 60s and the never-cross-a-price-band-twice-without-a-downgrade rule). See `docs/adr/0008-retry-aware-fallback.md`.
- **Read-only route** means analyze or review. Cursor workers run in plan mode; Claude workers receive the read-only tool allowlist.

The runner-routing-v3 policy selects a distinct ordered stack for Explore,
Analyze, Research, Plan, Verify, and Deploy. Implementation uses the separate
nine-class `workload_class` matrix. The exact executable mapping lives in
`docs/orchestrator/arc-delegate.md`.

Analyze is the only mandatory pre-implementation artifact. Explore, Research,
Plan, Verify, and Deploy are conditional. Deploy is HITL-gated and the runner
requires `--deploy-authorized true`.

Mechanical post-comment, commit-push, and merge worker routes do not exist.
Workers remain prohibited from shipping mutations; an authorized parent performs
its own git/GitHub action directly.
