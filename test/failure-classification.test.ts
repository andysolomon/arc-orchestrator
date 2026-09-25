import { describe, expect, test } from "bun:test";
import { normalizeBackendOutage } from "../plugins/arc-orchestrator/lib/failure-classification";

describe("failure-classification: normalizeBackendOutage", () => {
  test("auth with demonstrated transient maps to retryable transient_network_or_adapter", () => {
    expect(normalizeBackendOutage("auth", { demonstratedTransient: true })).toEqual({
      kind: "retryable",
      classification: "transient_network_or_adapter",
      detail: null,
    });
  });
});
