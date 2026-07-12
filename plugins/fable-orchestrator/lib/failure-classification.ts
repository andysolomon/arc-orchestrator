// Phase-3 normalized failure classification from docs/orchestrator/model-tier-routing-plan.md.
// Typed retryable/terminal classes and disposition helpers only; not wired into execution.

import type { BackendOutageReason } from "./trace-schema";

export const FAILURE_CLASSIFICATION_SCHEMA_VERSION = 1;

export const RETRYABLE_FAILURE_CLASSES = [
  "rate_limit",
  "quota_exhausted",
  "provider_outage",
  "timeout",
  "missing_binary",
  "transient_network_or_adapter",
] as const;

export type RetryableFailureClass = (typeof RETRYABLE_FAILURE_CLASSES)[number];

export const TERMINAL_FAILURE_CLASSES = [
  "policy_denial",
  "sandbox_incompatible",
  "invalid_configuration",
  "deterministic_validation_error",
] as const;

export type TerminalFailureClass = (typeof TERMINAL_FAILURE_CLASSES)[number];

export type NormalizedFailureClass = RetryableFailureClass | TerminalFailureClass;

export type FailureDisposition =
  | { kind: "retryable"; classification: RetryableFailureClass; detail: string | null }
  | { kind: "terminal"; classification: TerminalFailureClass; detail: string | null }
  | { kind: "terminal-unclassified"; detail: string | null }
  | { kind: "terminal-completed-low-quality" };

const RETRYABLE_SET = new Set<string>(RETRYABLE_FAILURE_CLASSES);
const TERMINAL_SET = new Set<string>(TERMINAL_FAILURE_CLASSES);

export function shouldFallback(classification: string): boolean {
  return RETRYABLE_SET.has(classification);
}

export function dispositionFor(
  classification: string,
  detail?: string | null,
): FailureDisposition {
  if (RETRYABLE_SET.has(classification)) {
    return {
      kind: "retryable",
      classification: classification as RetryableFailureClass,
      detail: detail ?? null,
    };
  }
  if (TERMINAL_SET.has(classification)) {
    return {
      kind: "terminal",
      classification: classification as TerminalFailureClass,
      detail: detail ?? null,
    };
  }
  return { kind: "terminal-unclassified", detail: detail ?? null };
}

export function normalizeBackendOutage(
  reason: BackendOutageReason,
  opts?: { demonstratedTransient?: boolean },
): FailureDisposition {
  if (reason === "usage_limit") {
    return {
      kind: "retryable",
      classification: "quota_exhausted",
      detail: null,
    };
  }
  if (reason === "missing_binary") {
    return {
      kind: "retryable",
      classification: "missing_binary",
      detail: null,
    };
  }
  if (opts?.demonstratedTransient === true) {
    return {
      kind: "retryable",
      classification: "transient_network_or_adapter",
      detail: null,
    };
  }
  return {
    kind: "terminal",
    classification: "invalid_configuration",
    detail: null,
  };
}

export function completedLowQualityDisposition(): FailureDisposition {
  return { kind: "terminal-completed-low-quality" };
}

export function isRetryableDisposition(disposition: FailureDisposition): boolean {
  return disposition.kind === "retryable";
}
