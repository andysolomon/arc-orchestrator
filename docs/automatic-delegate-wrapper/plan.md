# Plan: Automatic Delegate Wrapper

1. Add regression assertions for a neutral Agent/runtime and default surface wording.
2. Add `arc-delegate` plus `delegate-runtime`, with phase/workload commands that omit backend, route, and model pins.
3. Update Claude skills and generated multi-harness templates.
4. Regenerate surfaces, run focused tests, then run `bun run validate`.
5. Commit and open a PR linked to issue #255. Do not merge or deploy without explicit authorization.

