import { describe, expect, test } from "bun:test";
import {
  completedLowQualityDisposition,
  dispositionFor,
  FAILURE_CLASSIFICATION_SCHEMA_VERSION,
  isRetryableDisposition,
  normalizeBackendOutage,
  RETRYABLE_FAILURE_CLASSES,
  shouldFallback,
  TERMINAL_FAILURE_CLASSES,
} from "../plugins/fable-orchestrator/lib/failure-classification";

describe("failure-classification: schema", () => {
  test("uses schema version 1", () => {
    expect(FAILURE_CLASSIFICATION_SCHEMA_VERSION).toBe(1);
  });

  test("retryable classes are exactly the six approved values", () => {
    expect([...RETRYABLE_FAILURE_CLASSES]).toEqual([
      "rate_limit",
      "quota_exhausted",
      "provider_outage",
      "timeout",
      "missing_binary",
      "transient_network_or_adapter",
    ]);
    expect(RETRYABLE_FAILURE_CLASSES.length).toBe(6);
  });

  test("terminal classes are exactly the four approved values", () => {
    expect([...TERMINAL_FAILURE_CLASSES]).toEqual([
      "policy_denial",
      "sandbox_incompatible",
      "invalid_configuration",
      "deterministic_validation_error",
    ]);
    expect(TERMINAL_FAILURE_CLASSES.length).toBe(4);
  });
});

describe("failure-classification: shouldFallback", () => {
  test("returns true for each retryable class", () => {
    for (const classification of RETRYABLE_FAILURE_CLASSES) {
      expect(shouldFallback(classification)).toBe(true);
    }
  });

  test("returns false for each terminal class", () => {
    for (const classification of TERMINAL_FAILURE_CLASSES) {
      expect(shouldFallback(classification)).toBe(false);
    }
  });

  test("returns false for unknown strings", () => {
    for (const unknown of ["", "network_blip", "backend_unavailable"]) {
      expect(shouldFallback(unknown)).toBe(false);
    }
  });
});

describe("failure-classification: dispositionFor", () => {
  test("maps retryable classes to kind retryable", () => {
    for (const classification of RETRYABLE_FAILURE_CLASSES) {
      const disposition = dispositionFor(classification, "detail");
      expect(disposition.kind).toBe("retryable");
      if (disposition.kind === "retryable") {
        expect(disposition.classification).toBe(classification);
        expect(disposition.detail).toBe("detail");
      }
    }
  });

  test("maps terminal classes to kind terminal", () => {
    for (const classification of TERMINAL_FAILURE_CLASSES) {
      const disposition = dispositionFor(classification);
      expect(disposition.kind).toBe("terminal");
      if (disposition.kind === "terminal") {
        expect(disposition.classification).toBe(classification);
      }
    }
  });

  test("maps unknown classifications to terminal-unclassified", () => {
    const disposition = dispositionFor("network_blip", "oops");
    expect(disposition).toEqual({ kind: "terminal-unclassified", detail: "oops" });
  });

  test("terminal, unclassified, and low-quality dispositions are not retryable", () => {
    expect(isRetryableDisposition(dispositionFor("policy_denial"))).toBe(false);
    expect(isRetryableDisposition(dispositionFor("unknown"))).toBe(false);
    expect(isRetryableDisposition(completedLowQualityDisposition())).toBe(false);
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

describe("failure-classification: completedLowQualityDisposition", () => {
  test("returns terminal-completed-low-quality and is not retryable", () => {
    const disposition = completedLowQualityDisposition();
    expect(disposition).toEqual({ kind: "terminal-completed-low-quality" });
    expect(isRetryableDisposition(disposition)).toBe(false);
  });
});
