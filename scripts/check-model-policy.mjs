#!/usr/bin/env bun
// Standalone runner-side model policy check. Re-parses the synchronized
// Markdown copy (docs/arc-model-policy.md) with the synchronized parser
// (scripts/model-policy.mjs) and fails closed unless the generated runner
// copy (plugins/arc-orchestrator/lib/model-policy.generated.ts) is exactly
// what that document renders to. No arc-pi checkout is required.
//
//   bun scripts/check-model-policy.mjs        # exit 1 on drift
//
// Both synchronized inputs are written by `npm run policy:sync` in arc-pi;
// edit the fenced block in arc-pi docs/arc-model-update-<date>.md instead.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  POLICY_DOCUMENT,
  RUNNER_POLICY_DOCUMENT_PATH,
  RUNNER_POLICY_MODULE_PATH,
  parsePolicyDocument,
  policyDigest,
  renderRunnerPolicyModule,
} from "./model-policy.mjs";

/**
 * @param {string} rootDir runner repository root
 * @returns {{ ok: boolean; problems: string[]; digest: string | null; label: string | null }}
 */
export function checkRunnerModelPolicy(rootDir) {
  const problems = [];
  const documentPath = resolve(rootDir, RUNNER_POLICY_DOCUMENT_PATH);
  const modulePath = resolve(rootDir, RUNNER_POLICY_MODULE_PATH);
  if (!existsSync(documentPath)) {
    return {
      ok: false,
      problems: [`${RUNNER_POLICY_DOCUMENT_PATH} is missing`],
      digest: null,
      label: null,
    };
  }
  let policy;
  try {
    policy = parsePolicyDocument(readFileSync(documentPath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      problems: [`${RUNNER_POLICY_DOCUMENT_PATH}: ${error.message}`],
      digest: null,
      label: null,
    };
  }
  const digest = policyDigest(policy);
  const expected = renderRunnerPolicyModule(policy, POLICY_DOCUMENT);
  if (!existsSync(modulePath)) {
    problems.push(`${RUNNER_POLICY_MODULE_PATH} is missing`);
  } else {
    const actual = readFileSync(modulePath, "utf8");
    if (actual !== expected) {
      const embedded = /"digest": "([0-9a-f]+)"/.exec(actual)?.[1] ?? null;
      problems.push(
        embedded === digest
          ? `${RUNNER_POLICY_MODULE_PATH} content differs from what ${RUNNER_POLICY_DOCUMENT_PATH} renders to (embedded digest matches: the copy was edited by hand)`
          : `${RUNNER_POLICY_MODULE_PATH} is stale: embedded digest ${embedded ?? "(none)"} does not match ${RUNNER_POLICY_DOCUMENT_PATH} (${digest})`,
      );
    }
  }
  return { ok: problems.length === 0, problems, digest, label: policy.label };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const result = checkRunnerModelPolicy(rootDir);
  if (!result.ok) {
    console.error(
      `check-model-policy: runner policy copy rejected. Run npm run policy:sync in arc-pi and commit both repositories.\n  ${result.problems.join("\n  ")}`,
    );
    process.exit(1);
  }
  console.log(
    `check-model-policy: ${RUNNER_POLICY_MODULE_PATH} matches ${RUNNER_POLICY_DOCUMENT_PATH} (${result.label}, ${result.digest})`,
  );
}
