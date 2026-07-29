# Explore: ARC Delegate routing v3

The repository already has a typed model registry, canonical capability routes,
candidate stacks, trace schemas, CLI validation, generated cross-surface
documentation, and a broad Bun test suite. Automatic routing previously used
runner-routing-v2 with three execution modes and seven legacy implementation
workload classes.

Relevant implementation surfaces:

- `plugins/arc-orchestrator/lib/model-registry.ts`: models, transports, efforts,
  and ordered candidate stacks.
- `plugins/arc-orchestrator/lib/routes.ts`: public routes contract and
  mode/sandbox policy.
- `plugins/arc-orchestrator/lib/cli.ts`: fail-closed command-line validation.
- `plugins/arc-orchestrator/lib/engine.ts`: automatic selection, prompt
  construction, dispatch, and tracing.
- `plugins/orchestrator-core/`: generated cross-surface policy and Pi artifacts.
- `test/`: registry, route, engine, shadow, trace, and generated-surface tests.

Compatibility matters because external planners consume the routes JSON and
existing tests cover the seven legacy workload classes.
