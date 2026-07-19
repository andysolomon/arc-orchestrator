import { describe, expect, test } from "bun:test";
import {
  boundedLabel,
  boundedStructuredString,
  buildRoutingTraceV2,
  isSafeInternalId,
  normalizeCheckoutId,
  sanitizeFailureDetail,
  sanitizeLegacyForV2,
  type TraceRecord,
} from "../plugins/arc-orchestrator/lib/trace-schema";

function baselineLegacy(overrides: Partial<TraceRecord> = {}): TraceRecord {
  return {
    schema: 4,
    run_id: "run-redact",
    timestamp: "2026-07-11T00:00:00.000Z",
    backend: "codex",
    mode: "implement",
    model: "gpt-5.6-terra",
    sandbox: "read-only",
    project: "abc123def456",
    label: null,
    task_class: null,
    route_rationale: null,
    duration_ms: 0,
    status: "error",
    exit_code: 1,
    changed_files: null,
    tokens: null,
    budget: null,
    error: null,
    ...overrides,
  };
}

describe("sanitizeFailureDetail", () => {
  test("redacts bearer tokens, API keys, and absolute paths", () => {
    const detail =
      "Auth failed Bearer sk-proj-abcdefghijklmnopqrstuvwxyz at /Users/me/secret/project/file.ts";
    const sanitized = sanitizeFailureDetail(detail);
    expect(sanitized).not.toContain("sk-proj");
    expect(sanitized).not.toContain("/Users/me");
    expect(sanitized).toContain("<redacted>");
    expect(sanitized).toContain("<path>");
  });

  test("returns null for empty input and bounds long strings", () => {
    expect(sanitizeFailureDetail(null)).toBeNull();
    expect(sanitizeFailureDetail("   ")).toBeNull();
    const long = "x".repeat(300);
    expect(sanitizeFailureDetail(long)?.length).toBeLessThanOrEqual(240);
  });

  test("strips GitHub and Slack token prefixes", () => {
    const detail = "ghp_1234567890123456789012345678901234567890 leaked";
    const sanitized = sanitizeFailureDetail(detail);
    expect(sanitized).not.toContain("ghp_");
    expect(sanitized).toContain("<redacted>");
  });
});

describe("boundedLabel", () => {
  test("collapses whitespace and truncates unbounded labels", () => {
    expect(boundedLabel("  hello   world  ")).toBe("hello world");
    const long = "m".repeat(100);
    expect(boundedLabel(long)?.length).toBe(64);
    expect(boundedLabel("")).toBeNull();
    expect(boundedLabel(null)).toBeNull();
  });
});

describe("boundedStructuredString", () => {
  test("redacts secrets and paths before truncation", () => {
    const malicious =
      "Bearer sk-proj-abcdefghijklmnopqrstuvwxyz /Users/me/secret/model-override";
    const sanitized = boundedStructuredString(malicious);
    expect(sanitized).not.toContain("sk-proj");
    expect(sanitized).not.toContain("/Users/me");
    expect(sanitized).toContain("<redacted>");
    expect(sanitized).toContain("<path>");
    expect(sanitized!.length).toBeLessThanOrEqual(64);
  });

  test("preserves approved internal IDs when safe", () => {
    expect(isSafeInternalId("run-redact")).toBe(true);
    expect(isSafeInternalId("trav-test")).toBe(true);
    expect(isSafeInternalId("abc123def456")).toBe(true);
    expect(
      isSafeInternalId("a1b2c3d4-e5f6-7890-abcd-ef1234567890"),
    ).toBe(true);
    expect(boundedStructuredString("run-redact")).toBe("run-redact");
    expect(isSafeInternalId("/Users/me/run-evil")).toBe(false);
  });
});

describe("buildRoutingTraceV2 redaction boundary", () => {
  test("never carries prompts, task text, or raw secrets in failure detail", () => {
    const task = "Implement the secret feature with prompt injection";
    const promptSnippet = "You are a worker reporting to Claude Fable 5";
    const record = buildRoutingTraceV2({
      legacy: baselineLegacy({
        error: "failed",
      }),
      route: {},
      models: {},
      serving: {},
      traversal: {},
      lineage: { rootRunId: "run-redact", depth: 0 },
      failure: {
        detail: `${promptSnippet} ${task} Bearer ghp_1234567890123456789012345678901234567890 /tmp/secrets.env contents: SUPER_SECRET=1`,
        terminalReason: promptSnippet,
      },
    });

    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("SUPER_SECRET");
    expect(serialized).not.toContain("ghp_");
    expect(serialized).not.toContain("You are a worker");
    expect(record.failure.detail).toContain("<prompt>");
    expect(record.failure.terminal_reason).not.toContain("You are a worker");
  });

  test("model and provider strings are bounded-cardinality labels", () => {
    const longModel = "custom-model-" + "z".repeat(200);
    const record = buildRoutingTraceV2({
      legacy: baselineLegacy(),
      route: { requestedPublicAlias: longModel },
      models: { requested: longModel, candidate: longModel },
      serving: { provider: longModel, providerModelId: longModel },
      traversal: {},
      lineage: { rootRunId: "run-redact", depth: 0 },
    });

    expect(record.route.requested_public_alias?.length).toBeLessThanOrEqual(64);
    expect(record.models.requested?.length).toBeLessThanOrEqual(64);
    expect(record.serving.provider?.length).toBeLessThanOrEqual(64);
  });

  test("sanitized legacy and checkout identity exclude malicious strings from JSON", () => {
    const maliciousPath = "/Users/me/wt/secret-repo";
    const maliciousLabel =
      "Bearer sk-proj-abcdefghijklmnopqrstuvwxyz contents: TOP_SECRET=1";
    const legacy = baselineLegacy({
      project: maliciousPath,
      label: maliciousLabel,
      task_class: maliciousLabel,
      route_rationale: maliciousLabel,
      error: `failed at ${maliciousPath} Bearer ghp_1234567890123456789012345678901234567890`,
      fallback: { backend: "claude", model: maliciousLabel },
    });
    const record = buildRoutingTraceV2({
      legacy,
      route: {},
      models: {},
      serving: {},
      traversal: {},
      lineage: { rootRunId: "run-redact", depth: 0 },
    });

    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("sk-proj");
    expect(serialized).not.toContain("ghp_");
    expect(serialized).not.toContain("TOP_SECRET");
    expect(serialized).not.toContain("/Users/me");
    expect(serialized).not.toContain(maliciousPath);
    expect(record.worktree.checkout_id).toBe(normalizeCheckoutId(maliciousPath));
    expect(record.legacy.project).toBe(record.worktree.checkout_id);
    expect(record.legacy.label).not.toContain("Bearer");
    expect(sanitizeLegacyForV2(legacy).error).not.toContain("/Users/me");
  });

  test("malicious structured fields are redacted across route, models, serving, lineage, and versions", () => {
    const secretModel =
      "ghp_1234567890123456789012345678901234567890-at-/Users/me/models";
    const maliciousTraversal = "/Users/me/traversal Bearer sk-proj-abc";
    const maliciousTask = "API_KEY=supersecret /Users/me/tasks";
    const maliciousVersion = "policy/v1 /Users/me/policy Bearer ghp_leak";
    const record = buildRoutingTraceV2({
      legacy: baselineLegacy({ run_id: "run-redact" }),
      route: {
        requestedPublicAlias: secretModel,
        canonicalCapabilityRoute: secretModel,
      },
      models: {
        requested: secretModel,
        candidate: secretModel,
        attempted: secretModel,
        selected: secretModel,
      },
      serving: {
        provider: secretModel,
        providerModelId: secretModel,
        transportBackend: secretModel,
        adapterId: secretModel,
        adapterVersion: secretModel,
        stableId: secretModel,
      },
      traversal: { traversalId: maliciousTraversal },
      failure: {
        fallbackSource: secretModel,
        fallbackDestination: secretModel,
        fallbackReason: secretModel,
      },
      lineage: {
        rootRunId: "run-redact",
        parentRunId: "run-parent",
        taskId: maliciousTask,
        schedulerId: maliciousTask,
      },
      versions: { policy: maliciousVersion, budgetPolicy: maliciousVersion },
    });

    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("ghp_");
    expect(serialized).not.toContain("sk-proj");
    expect(serialized).not.toContain("supersecret");
    expect(serialized).not.toContain("/Users/me");
    expect(record.lineage.root_run_id).toBe("run-redact");
    expect(record.lineage.parent_run_id).toBe("run-parent");
    expect(record.traversal.traversal_id).not.toContain("/Users/me");
    expect(record.versions.policy).not.toContain("/Users/me");
  });
});
