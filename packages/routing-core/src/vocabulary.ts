// Closed vocabularies shared by the runtime plane (arc-orchestrator) and the
// control plane (arc-router). Everything here is a plain literal: no I/O, no
// environment, no provider SDK. The runtime re-exports these names from its
// historical module paths so existing imports keep working.

export const ROUTING_CORE_VERSION = "arc-routing-core/v1" as const;

export const BACKENDS = [
  "codex",
  "composer",
  "claude",
  "minimax",
  "opencode",
  "kimi",
] as const;
export type Backend = (typeof BACKENDS)[number];

/** A registry entry's transport: a dispatchable backend, the parent surface, or nothing. */
export type TransportBackend = Backend | "claude-code-parent";

export function isBackend(value: unknown): value is Backend {
  return typeof value === "string" && (BACKENDS as readonly string[]).includes(value);
}

export const EFFORT_LEVELS = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];

export function isEffort(value: unknown): value is Effort {
  return typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value);
}

export type Mode = "analyze" | "implement" | "review";
export const MODES: readonly Mode[] = ["analyze", "implement", "review"];

export const TASK_PHASES = [
  "explore",
  "analyze",
  "research",
  "plan",
  "implement",
  "verify",
  "deploy",
] as const;
export type TaskPhase = (typeof TASK_PHASES)[number];

/** Phases that may be delegated to a worker; `analyze` is parent-local under runner-routing-v4. */
export const WORKER_PHASES = [
  "explore",
  "research",
  "plan",
  "verify",
  "deploy",
] as const;
export type WorkerPhase = (typeof WORKER_PHASES)[number];

export const PHASE_MODE: Readonly<Record<TaskPhase, Mode>> = {
  explore: "analyze",
  analyze: "analyze",
  research: "analyze",
  plan: "analyze",
  implement: "implement",
  verify: "review",
  deploy: "implement",
};

export function normalizeTaskPhase(
  value: string | null | undefined,
  mode: Mode,
): TaskPhase | null {
  if (value == null || value.trim() === "") {
    return mode === "review" ? "verify" : mode;
  }
  const normalized = value.trim().toLowerCase();
  if (!TASK_PHASES.includes(normalized as TaskPhase)) {
    return null;
  }
  const phase = normalized as TaskPhase;
  return PHASE_MODE[phase] === mode ? phase : null;
}

export const DIFFICULTIES = ["hard", "medium", "easy"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const VOLUMES = ["heavy", "medium", "light"] as const;
export type Volume = (typeof VOLUMES)[number];

// runner-routing-v4 canonical workload classes in canonical declaration order
// (difficulty-major, volume-minor). The policy document must list its workload
// chains in exactly this order; `validatePolicy` holds that line.
export const WORKLOAD_CLASSES = [
  "hard-heavy",
  "hard-medium",
  "hard-light",
  "medium-heavy",
  "medium-medium",
  "medium-light",
  "easy-heavy",
  "easy-medium",
  "easy-light",
] as const;
export type WorkloadClass = (typeof WORKLOAD_CLASSES)[number];

export function workloadClassFor(
  difficulty: Difficulty,
  volume: Volume,
): WorkloadClass {
  return `${difficulty}-${volume}`;
}

export function splitWorkloadClass(
  workloadClass: WorkloadClass,
): { difficulty: Difficulty; volume: Volume } {
  const dash = workloadClass.indexOf("-");
  return {
    difficulty: workloadClass.slice(0, dash) as Difficulty,
    volume: workloadClass.slice(dash + 1) as Volume,
  };
}

// Missing/empty means "no class stated" and returns null, the same as an
// invalid class: v4 has no default implement class, so callers that need one
// must fail closed rather than inventing it.
export function normalizeWorkloadClass(
  value: string | null | undefined,
): WorkloadClass | null {
  if (value == null || value.trim() === "") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return (WORKLOAD_CLASSES as readonly string[]).includes(normalized)
    ? (normalized as WorkloadClass)
    : null;
}

export type TraceSandbox = "read-only" | "workspace-write";
export const TRACE_SANDBOXES: readonly TraceSandbox[] = [
  "read-only",
  "workspace-write",
];

export type ModelMaturity =
  | "planned"
  | "experimental"
  | "available"
  | "deprecated"
  | "disabled";

export const RUNNABLE_MATURITIES: ReadonlySet<ModelMaturity> = new Set<ModelMaturity>([
  "experimental",
  "available",
  "deprecated",
]);

// Ordered most to least expensive. Given a runtime form for the same reason
// EFFORT_LEVELS has one: the capability snapshot is JSON, so its validator needs
// to check a parsed string against the set rather than trust a type annotation.
export const PRICE_BANDS = ["premium", "$$$", "$$", "$", "very-cheap"] as const;
export type PriceBand = (typeof PRICE_BANDS)[number];

export type BackendOutageReason =
  | "usage_limit"
  | "auth"
  | "missing_binary"
  | "model_unavailable"
  | "response_timeout"
  | "process_failure";

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

export const ORCHESTRATOR_IDENTITIES = [
  "fable",
  "sol",
  "eco",
  "opus",
  "cursor-fable-high",
] as const;
export type OrchestratorIdentity = (typeof ORCHESTRATOR_IDENTITIES)[number];
