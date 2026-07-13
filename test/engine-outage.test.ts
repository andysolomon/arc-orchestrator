import { describe, expect, test } from "bun:test";
import {
  buildFallbackHint,
  classifyBackendOutage,
  collectCodexErrors,
} from "../plugins/fable-orchestrator/lib/outage";

describe("engine/outage: classifyBackendOutage", () => {
  test("classifies usage-limit language", () => {
    expect(classifyBackendOutage(["You've hit your usage limit."])).toBe(
      "usage_limit",
    );
    expect(classifyBackendOutage(["rate limit exceeded"])).toBe("usage_limit");
    expect(classifyBackendOutage(["hit your usage cap"])).toBe("usage_limit");
  });

  test("classifies authentication failures", () => {
    expect(classifyBackendOutage(["You are not logged in"])).toBe("auth");
    expect(classifyBackendOutage(["authentication required"])).toBe("auth");
    expect(classifyBackendOutage(["request failed with 401"])).toBe("auth");
  });

  test("classifies missing-binary failures", () => {
    expect(classifyBackendOutage(["spawn codex ENOENT"])).toBe(
      "missing_binary",
    );
    expect(classifyBackendOutage(["CLI not found: codex"])).toBe(
      "missing_binary",
    );
  });

  test("returns null for unmatched and empty input", () => {
    expect(classifyBackendOutage(["model produced an internal error"])).toBe(
      null,
    );
    expect(classifyBackendOutage([])).toBe(null);
  });

  test("usage-limit takes precedence over auth when both appear", () => {
    expect(
      classifyBackendOutage(["not logged in", "usage limit reached"]),
    ).toBe("usage_limit");
  });
});

describe("engine/outage: collectCodexErrors", () => {
  test("extracts error events and turn.failed nested messages", () => {
    const stream = [
      '{"type":"thread.started","thread_id":"t"}',
      '{"type":"error","message":"boom"}',
      '{"type":"turn.failed","error":{"message":"turn blew up"}}',
    ].join("\n");
    expect(collectCodexErrors(stream)).toEqual(["boom", "turn blew up"]);
  });

  test("deduplicates repeated messages and ignores non-JSON and other events", () => {
    const stream = [
      "not json at all",
      '{"type":"error","message":"dup"}',
      '{"type":"error","message":"dup"}',
      '{"type":"turn.completed","usage":{}}',
    ].join("\n");
    expect(collectCodexErrors(stream)).toEqual(["dup"]);
  });

  test("ignores malformed events without a usable message", () => {
    const stream = [
      '{"type":"error"}',
      '{"type":"turn.failed","error":{}}',
    ].join("\n");
    expect(collectCodexErrors(stream)).toEqual([]);
  });
});

describe("engine/outage: buildFallbackHint", () => {
  test("builds the fallback descriptor with the claude fallback model", () => {
    expect(
      buildFallbackHint("usage_limit", {
        backend: "claude",
        model: "claude-opus-4-8",
      }),
    ).toEqual({
      failure_class: "backend_unavailable",
      outage_reason: "usage_limit",
      fallback: { backend: "claude", model: "claude-opus-4-8" },
    });
  });

  test("builds the fallback descriptor with a composer Grok fallback model", () => {
    expect(
      buildFallbackHint("missing_binary", {
        backend: "composer",
        model: "grok-4.5",
      }),
    ).toEqual({
      failure_class: "backend_unavailable",
      outage_reason: "missing_binary",
      fallback: { backend: "composer", model: "grok-4.5" },
    });
  });

  test("serializes to the exact stderr hint contract with stable key order", () => {
    const hint = buildFallbackHint("auth", {
      backend: "claude",
      model: "claude-opus-4-8",
    });
    expect(JSON.stringify(hint)).toBe(
      JSON.stringify({
        failure_class: "backend_unavailable",
        outage_reason: "auth",
        fallback: { backend: "claude", model: "claude-opus-4-8" },
      }),
    );
  });

  test("round-trips a classified outage into the hint contract", () => {
    const reason = classifyBackendOutage(["hit your usage limit"]);
    expect(reason).not.toBeNull();
    expect(
      reason &&
        JSON.stringify(
          buildFallbackHint(reason, {
            backend: "claude",
            model: "claude-opus-4-8",
          }),
        ),
    ).toBe(
      '{"failure_class":"backend_unavailable","outage_reason":"usage_limit","fallback":{"backend":"claude","model":"claude-opus-4-8"}}',
    );
  });
});
