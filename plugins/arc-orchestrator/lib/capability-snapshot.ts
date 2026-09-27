// Runtime shim over the shared routing-core capability snapshot schema and
// validator. The shared validator takes the registry it joins against as a
// required argument; here it defaults to the shipped MODEL_REGISTRY so existing
// callers are unchanged.

import {
  parseCapabilitySnapshot as parseCapabilitySnapshotWith,
  validateCapabilitySnapshot as validateCapabilitySnapshotWith,
  type CapabilitySnapshot,
  type CapabilitySnapshotValidationOptions as SharedValidationOptions,
} from "../../../packages/routing-core/src/capability-snapshot";
import { MODEL_REGISTRY } from "./model-registry";

export * from "../../../packages/routing-core/src/capability-snapshot";

export type CapabilitySnapshotValidationOptions = Omit<
  SharedValidationOptions,
  "entries"
> & {
  entries?: SharedValidationOptions["entries"];
};

export function validateCapabilitySnapshot(
  value: unknown,
  options: CapabilitySnapshotValidationOptions,
): { ok: boolean; errors: string[] } {
  return validateCapabilitySnapshotWith(value, {
    ...options,
    entries: options.entries ?? MODEL_REGISTRY,
  });
}

export function parseCapabilitySnapshot(
  value: unknown,
  options: CapabilitySnapshotValidationOptions,
):
  | { ok: true; snapshot: CapabilitySnapshot }
  | { ok: false; errors: string[] } {
  return parseCapabilitySnapshotWith(value, {
    ...options,
    entries: options.entries ?? MODEL_REGISTRY,
  });
}
