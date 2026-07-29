# Analyze: ARC Delegate routing v3

The requested directive changes two independent routing dimensions:

1. The orchestration lifecycle expands from generic analyze/implement/review
   modes to seven named phases with phase-specific ordered candidate stacks.
2. Implementation selection changes to a nine-cell difficulty-by-effort matrix.

The executable contract therefore needs phase-aware selection, candidate-level
effort defaults, model/transport entries for Cursor variants, and explicit
deployment authorization. Documentation must describe both the exact stacks and
the lifecycle artifact protocol.

Key safety decisions:

- Preserve the old workload vocabulary during migration while publishing the
  new matrix separately in schema v3.
- Keep explicit route/backend/model overrides higher priority than automatic
  phase routing.
- Keep Explore, Analyze, Research, and Plan read-only; keep Verify read-only
  review; allow writes only for Implement and explicitly authorized Deploy.
- Require `--deploy-authorized true` rather than inferring permission.
- Record Composer effort as transport-default because Cursor Composer exposes no
  independent effort control.
- Persist artifacts in the parent after read-only workers return evidence.

Research is not required: the local model inventory confirmed the executable
Cursor IDs and the requested policy fully specifies ordering.
