import { describe, expect, test } from "bun:test";
import {
  normalizeBackendOutage,
  shouldFallback,
} from "../plugins/arc-orchestrator/lib/failure-classification";

describe("failure-classification: shouldFallback", () => {
  test("returns false for unknown strings", () => {
    for (const unknown of ["", "network_blip", "backend_unavailable"]) {
      expect(shouldFallback(unknown)).toBe(false);
    }
  });
});

describe("failure-classification: normalizeBackendOutage", () => {
  test("usage_limit maps to retryable quota_exhausted", () => {
    const disposition = normalizeBackendOutage("usage_limit");
    expect(disposition).toEqual({
      kind: "retryable",
      classification: "quota_exhausted",
      detail: null,
    });
  });

  test("missing_binary maps to retryable missing_binary", () => {
    const disposition = normalizeBackendOutage("missing_binary");
    expect(disposition).toEqual({
      kind: "retryable",
      classification: "missing_binary",
      detail: null,
    });
  });

  test("response_timeout maps to retryable timeout", () => {
    expect(normalizeBackendOutage("response_timeout")).toEqual({
      kind: "retryable",
      classification: "timeout",
      detail: null,
    });
  });

  test("process_failure maps to retryable provider_outage", () => {
    const disposition = normalizeBackendOutage("process_failure");
    expect(disposition).toEqual({
      kind: "retryable",
      classification: "provider_outage",
      detail: null,
    });
  });

  test("auth without demonstrated transient maps to terminal invalid_configuration", () => {
    expect(normalizeBackendOutage("auth")).toEqual({
      kind: "terminal",
      classification: "invalid_configuration",
      detail: null,
    });
    expect(normalizeBackendOutage("auth", { demonstratedTransient: false })).toEqual({
      kind: "terminal",
      classification: "invalid_configuration",
      detail: null,
    });
  });

  test("auth with demonstrated transient maps to retryable transient_network_or_adapter", () => {
    expect(normalizeBackendOutage("auth", { demonstratedTransient: true })).toEqual({
      kind: "retryable",
      classification: "transient_network_or_adapter",
      detail: null,
    });
  });
});
