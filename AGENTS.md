# Agent Instructions

## Testing

- Never write unit tests after you write code.
- Highly prefer E2E tests as the sole testing mechanism. Use them to verify complex features work. At the end of E2E tests, produce a verifiable and repeatable artifact.
- If you must test a system in isolation, first write down all the ways it could fail, then write the code.

In this repo, an E2E test runs a shipped entry point as a subprocess and asserts on what it observably does: the runner (`plugins/arc-orchestrator/bin/arc-orchestrator`) driven with fake provider CLIs, as in `test/orchestrator.test.ts`, the Pi wrapper, or the packed npm package.

A unit test earns its place only if it catches a real bug the E2E tests would miss. Do not add tests that restate constants, registry tables, or prose in docs and prompts; that assert an export exists or has a shape; or that only check a stub received what the test passed in.
