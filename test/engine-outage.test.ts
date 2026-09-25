import { describe, expect, test } from "bun:test";
import {
  classifyBackendOutage,
  collectCodexErrors,
} from "../plugins/arc-orchestrator/lib/outage";

describe("engine/outage: classifyBackendOutage", () => {
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

  test("classifies provider response timeouts as availability outages", () => {
    expect(classifyBackendOutage(["provider response timed out"])).toBe(
      "response_timeout",
    );
    expect(classifyBackendOutage(["request deadline exceeded"])).toBe(
      "response_timeout",
    );
    expect(classifyBackendOutage(["budget: timeout after 30000ms"])).toBeNull();
  });

  test("classifies opaque backend process failures", () => {
    expect(classifyBackendOutage(["Claude invocation failed"])).toBe(
      "process_failure",
    );
    expect(classifyBackendOutage(["Claude exited with status 1"])).toBe(
      "process_failure",
    );
    expect(
      classifyBackendOutage([
        "Claude invocation failed",
        "Claude exited with status 1",
      ]),
    ).toBe("process_failure");
  });

  test("does not classify terminal envelope or validation failures as process failures", () => {
    expect(classifyBackendOutage(["Claude reported an error"])).toBe(null);
    expect(
      classifyBackendOutage([
        "Claude reported an error",
        "Claude exited with status 1",
      ]),
    ).toBe(null);
    expect(
      classifyBackendOutage([
        "Codex completed without writing a structured result",
      ]),
    ).toBe(null);
    expect(classifyBackendOutage(["result.status is invalid"])).toBe(null);
    expect(classifyBackendOutage(["Unexpected end of JSON input"])).toBe(null);
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
});
