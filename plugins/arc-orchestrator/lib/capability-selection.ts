// Runtime shim. `select()` and its contracts live in the shared routing-core
// package (packages/routing-core/src/selection.ts) so the arc-router control
// plane simulates with the identical function. Every historical import path
// into this module keeps working.

export * from "../../../packages/routing-core/src/selection";
