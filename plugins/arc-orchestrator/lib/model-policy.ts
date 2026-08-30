// Validated access to the generated model policy copy. The generated module
// embeds the SHA-256 digest of its own canonical JSON; re-deriving it here at
// load time means a partially regenerated or hand-edited copy is rejected
// before the registry, public bindings, or candidate stacks are derived from
// it. Every runner consumer imports the policy through this module.
//
// Whether the copy matches the synchronized Markdown source is a separate
// check: `bun scripts/check-model-policy.mjs` re-parses docs/arc-model-policy.md
// with the synchronized parser and compares the rendered module byte-for-byte.

import { createHash } from "node:crypto";
import {
  MODEL_POLICY,
  MODEL_POLICY_SOURCE,
} from "./model-policy.generated";

export class ModelPolicyIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelPolicyIntegrityError";
  }
}

export function modelPolicyContentDigest(policy: unknown): string {
  return createHash("sha256").update(JSON.stringify(policy)).digest("hex");
}

/**
 * Throws unless the generated copy's embedded digest matches its content and
 * its source metadata agrees with the policy body.
 */
export function assertModelPolicyIntegrity(
  policy: unknown = MODEL_POLICY,
  source: { document: string; updated: string; digest: string } = {
    ...MODEL_POLICY_SOURCE,
  },
): void {
  const actual = modelPolicyContentDigest(policy);
  if (actual !== source.digest) {
    throw new ModelPolicyIntegrityError(
      `model policy copy for ${source.document} is stale or was edited by hand: content digest ${actual} does not match embedded digest ${source.digest}; run npm run policy:sync in arc-pi`,
    );
  }
  const updated = (policy as { updated?: unknown })?.updated;
  if (updated !== source.updated) {
    throw new ModelPolicyIntegrityError(
      `model policy copy for ${source.document} has updated=${String(updated)} but its source records ${source.updated}; run npm run policy:sync in arc-pi`,
    );
  }
}

assertModelPolicyIntegrity();

export { MODEL_POLICY, MODEL_POLICY_SOURCE };
