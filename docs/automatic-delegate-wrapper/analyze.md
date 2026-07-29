# Analyze: Automatic Delegate Wrapper

The defect is a surface-to-runner handoff mismatch, not a selector defect. Normal orchestration says to omit backend and route arguments, but its allowed execution mechanism cannot do so.

The smallest compatible repair is a thin `arc-delegate` Agent backed by a non-user-invocable runtime skill. It accepts the parent-classified phase and optional Implement workload class, invokes the runner once without provider pins, and returns normalized output unchanged. Existing named agents remain explicit single-candidate overrides.

