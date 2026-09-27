// Node/Bun-only helpers around the shared routing contract: hashing, file
// loading, and JSONL trace reading. Browser bundles must import `./index`
// instead; nothing from this module is safe there.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseCapabilitySnapshot, type CapabilitySnapshot } from "./capability-snapshot";
import type { ModelDefinition } from "./model-schema";
import { canonicalPolicyJson, type RoutingPolicy } from "./policy-schema";
import { parseTraceJsonl } from "./trace-schema";

export * from "./index";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** SHA-256 of the canonical policy JSON; identical to arc-pi's `policyDigest`. */
export function policyDigest(policy: RoutingPolicy): string {
  return sha256Hex(canonicalPolicyJson(policy));
}

export function loadCapabilitySnapshotFile(
  path: string,
  options: { entries: readonly ModelDefinition[]; nowMs: number },
): { ok: true; snapshot: CapabilitySnapshot } | { ok: false; errors: string[] } {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return parseCapabilitySnapshot(parsed, options);
}

export function readTraceJsonlFile(path: string): ReturnType<typeof parseTraceJsonl> {
  return parseTraceJsonl(readFileSync(path, "utf8"));
}
