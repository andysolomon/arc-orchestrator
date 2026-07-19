// Phase-6 staged rollout gates from docs/orchestrator/model-tier-routing-plan.md.
// Versioned telemetry thresholds, runtime projection, guardrail validation, and
// human-approval gates. Library-only; no automatic stage promotion.

import {
  CANDIDATE_STACKS,
  MODEL_REGISTRY,
  MODEL_REGISTRY_ERROR,
  validateShippedModelRegistry,
  type CandidateStack,
  type ModelRegistryEntry,
} from "./model-registry";
import {
  completedLowQualityDisposition,
  isRetryableDisposition,
} from "./failure-classification";
import {
  fallbackEngineStage,
  type FallbackEngineStage,
} from "./fallback-engine";
import type { EnvLike } from "./routes";
import {
  ROUTE_SELECTION_STAGE_ENV,
  routeSelectionStage,
  type RouteSelectionStage,
} from "./selection-activation";

export const ROLLOUT_GATES_SCHEMA_VERSION = 1;

export const ROLLOUT_STAGE_ENV = "FABLE_ORCHESTRATOR_ROLLOUT_STAGE";
export const ROLLOUT_OPT_IN_ENV = "FABLE_ORCHESTRATOR_ROLLOUT_OPT_IN";
export const ROLLOUT_COHORT_ID_ENV = "FABLE_ORCHESTRATOR_COHORT_ID";
export const ROLLOUT_COHORT_PERCENT_ENV =
  "FABLE_ORCHESTRATOR_ROLLOUT_COHORT_PERCENT";

export const ROLLOUT_SELECTION_DISABLE_ENV =
  "FABLE_ORCHESTRATOR_ROLLOUT_SELECTION";
export const ROLLOUT_FALLBACK_DISABLE_ENV =
  "FABLE_ORCHESTRATOR_ROLLOUT_FALLBACK";
export const ROLLOUT_TRACE_V2_DISABLE_ENV =
  "FABLE_ORCHESTRATOR_ROLLOUT_TRACE_V2";
export const ROLLOUT_DELEGATION_DISABLE_ENV =
  "FABLE_ORCHESTRATOR_ROLLOUT_DELEGATION";

export const ROLLOUT_HUMAN_APPROVED_ENV =
  "FABLE_ORCHESTRATOR_ROLLOUT_HUMAN_APPROVED";

export const LEGACY_TRACE_V2_ENV = "FABLE_ORCHESTRATOR_TRACE_V2";
export const LEGACY_FALLBACK_ENGINE_ENV = "FABLE_ORCHESTRATOR_FALLBACK_ENGINE";

export const ROLLOUT_OPT_IN_EXACT_VALUE = "1";
export const ROLLOUT_HUMAN_APPROVED_EXACT_VALUE = "1";
export const COHORT_IDENTITY_HASH_LENGTH = 12;
export const DEFAULT_COHORT_PERCENT = 10;
export const MAX_COHORT_PERCENT = 100;

const NORMALIZED_COHORT_IDENTITY_PATTERN = /^[a-f0-9]{12}$/;
const WHOLE_NUMERIC_PATTERN = /^\d+$/;

export type RolloutStage =
  | "fixture"
  | "shadow"
  | "opt-in"
  | "limited-cohort"
  | "default";

export type RolloutTransition =
  | "fixture-to-shadow"
  | "shadow-to-opt-in"
  | "opt-in-to-limited-cohort"
  | "limited-cohort-to-default";

export type RolloutTelemetrySnapshot = {
  sampleSize: number;
  selectionMatchRate: number;
  selectionCoverageRate: number;
  errorRate: number;
  availabilityFallbackRate: number;
  redactionViolations: number;
  schemaViolations: number;
  budgetResetViolations: number;
  guardrailViolations: number;
};

export type RolloutTransitionCriteria = {
  minSampleSize: number;
  minSelectionMatchRate: number;
  minSelectionCoverageRate: number;
  maxErrorRate: number;
  maxAvailabilityFallbackRate: number;
  maxRedactionViolations: number;
  maxSchemaViolations: number;
  maxBudgetResetViolations: number;
  maxGuardrailViolations: number;
};

export const ROLLOUT_TRANSITION_CRITERIA: Record<
  RolloutTransition,
  RolloutTransitionCriteria
> = {
  "fixture-to-shadow": {
    minSampleSize: 100,
    minSelectionMatchRate: 0.95,
    minSelectionCoverageRate: 0.9,
    maxErrorRate: 0.02,
    maxAvailabilityFallbackRate: 0.15,
    maxRedactionViolations: 0,
    maxSchemaViolations: 0,
    maxBudgetResetViolations: 0,
    maxGuardrailViolations: 0,
  },
  "shadow-to-opt-in": {
    minSampleSize: 500,
    minSelectionMatchRate: 0.97,
    minSelectionCoverageRate: 0.95,
    maxErrorRate: 0.015,
    maxAvailabilityFallbackRate: 0.1,
    maxRedactionViolations: 0,
    maxSchemaViolations: 0,
    maxBudgetResetViolations: 0,
    maxGuardrailViolations: 0,
  },
  "opt-in-to-limited-cohort": {
    minSampleSize: 1_000,
    minSelectionMatchRate: 0.98,
    minSelectionCoverageRate: 0.97,
    maxErrorRate: 0.01,
    maxAvailabilityFallbackRate: 0.08,
    maxRedactionViolations: 0,
    maxSchemaViolations: 0,
    maxBudgetResetViolations: 0,
    maxGuardrailViolations: 0,
  },
  "limited-cohort-to-default": {
    minSampleSize: 2_500,
    minSelectionMatchRate: 0.99,
    minSelectionCoverageRate: 0.98,
    maxErrorRate: 0.008,
    maxAvailabilityFallbackRate: 0.05,
    maxRedactionViolations: 0,
    maxSchemaViolations: 0,
    maxBudgetResetViolations: 0,
    maxGuardrailViolations: 0,
  },
};

export type RolloutTransitionEvaluation = {
  transition: RolloutTransition;
  ready: boolean;
  unmetReasons: string[];
};

export type RolloutRuntimeProjection = {
  configuredStage: RolloutStage | null;
  effectiveStage: RolloutStage | "off";
  selectionStage: RouteSelectionStage;
  fallbackStage: FallbackEngineStage;
  traceV2Writing: boolean;
  delegationEnabled: boolean;
  cohortEligible: boolean | null;
  optInActive: boolean;
};

const VALID_ROLLOUT_STAGES = new Set<RolloutStage>([
  "fixture",
  "shadow",
  "opt-in",
  "limited-cohort",
  "default",
]);

const CONFIGURED_ACTIVATION_STAGES = new Set<RolloutStage>([
  "shadow",
  "opt-in",
  "limited-cohort",
  "default",
]);

function legacySelectionFallbackControlsAllowed(
  configuredStage: RolloutStage | null,
  humanApproved: boolean,
): boolean {
  return configuredStage == null || humanApproved;
}

function configuredStageRequiresApprovalBlock(
  configuredStage: RolloutStage | null,
  humanApproved: boolean,
): boolean {
  return (
    configuredStage != null &&
    CONFIGURED_ACTIVATION_STAGES.has(configuredStage) &&
    !humanApproved
  );
}

const FABLE_STABLE_ID = "fable-5";
const SOL_STABLE_ID = "gpt-5.6-sol";
const TASTE_REVIEW_ROUTE = "taste-review.read-only.v1";

function matchesGlm(value: string): boolean {
  return value.trim().toLowerCase().includes("glm");
}

function envExplicitlySet(env: EnvLike, key: string): boolean {
  return env[key]?.trim() !== undefined && env[key]?.trim() !== "";
}

function rolloutFeatureDisabled(env: EnvLike, key: string): boolean {
  return env[key]?.trim() === "0";
}

export function parseRolloutStage(env: EnvLike): RolloutStage | null {
  const value = env[ROLLOUT_STAGE_ENV]?.trim().toLowerCase();
  if (!value || !VALID_ROLLOUT_STAGES.has(value as RolloutStage)) {
    return null;
  }
  return value as RolloutStage;
}

export function boundedCohortIdentity(
  env: EnvLike,
  override?: string | null,
): string | null {
  const raw = override ?? env[ROLLOUT_COHORT_ID_ENV]?.trim();
  if (!raw) {
    return null;
  }
  if (NORMALIZED_COHORT_IDENTITY_PATTERN.test(raw)) {
    return raw;
  }
  return new Bun.CryptoHasher("sha256")
    .update(raw)
    .digest("hex")
    .slice(0, COHORT_IDENTITY_HASH_LENGTH);
}

export function parseCohortPercent(env: EnvLike): number {
  const raw = env[ROLLOUT_COHORT_PERCENT_ENV]?.trim();
  if (!raw || !WHOLE_NUMERIC_PATTERN.test(raw)) {
    return DEFAULT_COHORT_PERCENT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (parsed < 0 || parsed > MAX_COHORT_PERCENT) {
    return DEFAULT_COHORT_PERCENT;
  }
  return parsed;
}

export function rolloutHumanApproved(env: EnvLike): boolean {
  return (
    env[ROLLOUT_HUMAN_APPROVED_ENV]?.trim() === ROLLOUT_HUMAN_APPROVED_EXACT_VALUE
  );
}

export function deterministicCohortBucket(identity: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % 100;
}

export function cohortInRolloutPercent(
  identity: string,
  percent: number,
): boolean {
  if (percent <= 0) {
    return false;
  }
  if (percent >= MAX_COHORT_PERCENT) {
    return true;
  }
  return deterministicCohortBucket(identity) < percent;
}

export function rolloutOptInActive(env: EnvLike): boolean {
  return env[ROLLOUT_OPT_IN_ENV]?.trim() === ROLLOUT_OPT_IN_EXACT_VALUE;
}

function projectedSelectionStage(
  stage: RolloutStage | null,
  env: EnvLike,
  cohortIdentity: string | null,
  humanApproved: boolean,
): RouteSelectionStage {
  if (!stage || stage === "fixture") {
    return "off";
  }
  if (!humanApproved) {
    return "off";
  }
  if (stage === "shadow") {
    return "shadow";
  }
  if (stage === "opt-in") {
    return rolloutOptInActive(env) ? "active" : "off";
  }
  if (stage === "limited-cohort") {
    const identity = cohortIdentity ?? boundedCohortIdentity(env);
    if (!identity) {
      return "off";
    }
    return cohortInRolloutPercent(identity, parseCohortPercent(env))
      ? "active"
      : "off";
  }
  return "active";
}

function projectedFallbackStage(
  stage: RolloutStage | null,
  env: EnvLike,
  cohortIdentity: string | null,
  humanApproved: boolean,
): FallbackEngineStage {
  if (!stage || stage === "fixture") {
    return "off";
  }
  if (!humanApproved) {
    return "off";
  }
  if (stage === "shadow") {
    return "shadow";
  }
  if (stage === "opt-in") {
    return rolloutOptInActive(env) ? "active" : "off";
  }
  if (stage === "limited-cohort") {
    const identity = cohortIdentity ?? boundedCohortIdentity(env);
    if (!identity) {
      return "off";
    }
    return cohortInRolloutPercent(identity, parseCohortPercent(env))
      ? "active"
      : "off";
  }
  return "active";
}

function projectedTraceV2Writing(): boolean {
  return true;
}

function projectedDelegationEnabled(
  stage: RolloutStage | null,
  humanApproved: boolean,
): boolean {
  return stage === "default" && humanApproved;
}

export function projectRolloutRuntime(
  env: EnvLike,
  cohortIdentity?: string | null,
): RolloutRuntimeProjection {
  const configuredStage = parseRolloutStage(env);
  const humanApproved = rolloutHumanApproved(env);
  const boundedIdentity = boundedCohortIdentity(env, cohortIdentity);
  const optInActive = rolloutOptInActive(env);
  const cohortPercent = parseCohortPercent(env);
  const cohortEligible =
    configuredStage === "limited-cohort"
      ? boundedIdentity != null &&
        cohortInRolloutPercent(boundedIdentity, cohortPercent)
      : null;

  let selectionStage = projectedSelectionStage(
    configuredStage,
    env,
    boundedIdentity,
    humanApproved,
  );
  let fallbackStage = projectedFallbackStage(
    configuredStage,
    env,
    boundedIdentity,
    humanApproved,
  );
  let traceV2Writing = projectedTraceV2Writing();
  let delegationEnabled = projectedDelegationEnabled(
    configuredStage,
    humanApproved,
  );

  if (
    legacySelectionFallbackControlsAllowed(configuredStage, humanApproved) &&
    envExplicitlySet(env, ROUTE_SELECTION_STAGE_ENV)
  ) {
    selectionStage = routeSelectionStage(env);
  }
  if (
    legacySelectionFallbackControlsAllowed(configuredStage, humanApproved) &&
    envExplicitlySet(env, LEGACY_FALLBACK_ENGINE_ENV)
  ) {
    fallbackStage = fallbackEngineStage(env);
  }
  if (envExplicitlySet(env, LEGACY_TRACE_V2_ENV)) {
    traceV2Writing = env[LEGACY_TRACE_V2_ENV]?.trim() !== "0";
  }

  if (configuredStageRequiresApprovalBlock(configuredStage, humanApproved)) {
    selectionStage = "off";
    fallbackStage = "off";
    delegationEnabled = false;
  }

  if (rolloutFeatureDisabled(env, ROLLOUT_SELECTION_DISABLE_ENV)) {
    selectionStage = "off";
  }
  if (rolloutFeatureDisabled(env, ROLLOUT_FALLBACK_DISABLE_ENV)) {
    fallbackStage = "off";
  }
  if (rolloutFeatureDisabled(env, ROLLOUT_TRACE_V2_DISABLE_ENV)) {
    traceV2Writing = false;
  }
  if (rolloutFeatureDisabled(env, ROLLOUT_DELEGATION_DISABLE_ENV)) {
    delegationEnabled = false;
  }

  const effectiveStage =
    configuredStage == null ? "off" : configuredStage;

  return {
    configuredStage,
    effectiveStage,
    selectionStage,
    fallbackStage,
    traceV2Writing,
    delegationEnabled,
    cohortEligible,
    optInActive,
  };
}

export function resolveSelectionStage(
  env: EnvLike,
  cohortIdentity?: string | null,
): RouteSelectionStage {
  return projectRolloutRuntime(env, cohortIdentity).selectionStage;
}

export function resolveFallbackStage(
  env: EnvLike,
  cohortIdentity?: string | null,
): FallbackEngineStage {
  return projectRolloutRuntime(env, cohortIdentity).fallbackStage;
}

export function resolveTraceV2Writing(
  env: EnvLike,
  cohortIdentity?: string | null,
): boolean {
  return projectRolloutRuntime(env, cohortIdentity).traceV2Writing;
}

export function resolveDelegationEnabled(
  env: EnvLike,
  cohortIdentity?: string | null,
): boolean {
  return projectRolloutRuntime(env, cohortIdentity).delegationEnabled;
}

function compareMinimum(
  label: string,
  actual: number,
  required: number,
  unmet: string[],
): void {
  if (actual < required) {
    unmet.push(`${label}: ${actual} < ${required} required`);
  }
}

function compareMaximum(
  label: string,
  actual: number,
  allowed: number,
  unmet: string[],
): void {
  if (actual > allowed) {
    unmet.push(`${label}: ${actual} > ${allowed} allowed`);
  }
}

function validateTelemetryValue(
  label: string,
  value: number,
  opts: { rate?: boolean; integral?: boolean },
  unmet: string[],
): void {
  if (!Number.isFinite(value)) {
    unmet.push(`${label}: ${value} is not finite`);
    return;
  }
  if (opts.integral && !Number.isInteger(value)) {
    unmet.push(`${label}: ${value} must be an integer`);
    return;
  }
  if (value < 0) {
    unmet.push(`${label}: ${value} is negative`);
    return;
  }
  if (opts.rate && value > 1) {
    unmet.push(`${label}: ${value} exceeds 1`);
  }
}

export function validateRolloutTelemetry(
  telemetry: RolloutTelemetrySnapshot,
): string[] {
  const unmetReasons: string[] = [];

  validateTelemetryValue(
    "sampleSize",
    telemetry.sampleSize,
    { integral: true },
    unmetReasons,
  );
  validateTelemetryValue(
    "selectionMatchRate",
    telemetry.selectionMatchRate,
    { rate: true },
    unmetReasons,
  );
  validateTelemetryValue(
    "selectionCoverageRate",
    telemetry.selectionCoverageRate,
    { rate: true },
    unmetReasons,
  );
  validateTelemetryValue(
    "errorRate",
    telemetry.errorRate,
    { rate: true },
    unmetReasons,
  );
  validateTelemetryValue(
    "availabilityFallbackRate",
    telemetry.availabilityFallbackRate,
    { rate: true },
    unmetReasons,
  );
  validateTelemetryValue(
    "redactionViolations",
    telemetry.redactionViolations,
    { integral: true },
    unmetReasons,
  );
  validateTelemetryValue(
    "schemaViolations",
    telemetry.schemaViolations,
    { integral: true },
    unmetReasons,
  );
  validateTelemetryValue(
    "budgetResetViolations",
    telemetry.budgetResetViolations,
    { integral: true },
    unmetReasons,
  );
  validateTelemetryValue(
    "guardrailViolations",
    telemetry.guardrailViolations,
    { integral: true },
    unmetReasons,
  );

  return unmetReasons;
}

export function evaluateRolloutTransition(
  transition: RolloutTransition,
  telemetry: RolloutTelemetrySnapshot,
  humanApproved: boolean,
): RolloutTransitionEvaluation {
  const criteria = ROLLOUT_TRANSITION_CRITERIA[transition];
  const unmetReasons = validateRolloutTelemetry(telemetry);

  if (unmetReasons.length === 0) {
    compareMinimum(
      "sampleSize",
      telemetry.sampleSize,
      criteria.minSampleSize,
      unmetReasons,
    );
    compareMinimum(
      "selectionMatchRate",
      telemetry.selectionMatchRate,
      criteria.minSelectionMatchRate,
      unmetReasons,
    );
    compareMinimum(
      "selectionCoverageRate",
      telemetry.selectionCoverageRate,
      criteria.minSelectionCoverageRate,
      unmetReasons,
    );
    compareMaximum(
      "errorRate",
      telemetry.errorRate,
      criteria.maxErrorRate,
      unmetReasons,
    );
    compareMaximum(
      "availabilityFallbackRate",
      telemetry.availabilityFallbackRate,
      criteria.maxAvailabilityFallbackRate,
      unmetReasons,
    );
    compareMaximum(
      "redactionViolations",
      telemetry.redactionViolations,
      criteria.maxRedactionViolations,
      unmetReasons,
    );
    compareMaximum(
      "schemaViolations",
      telemetry.schemaViolations,
      criteria.maxSchemaViolations,
      unmetReasons,
    );
    compareMaximum(
      "budgetResetViolations",
      telemetry.budgetResetViolations,
      criteria.maxBudgetResetViolations,
      unmetReasons,
    );
    compareMaximum(
      "guardrailViolations",
      telemetry.guardrailViolations,
      criteria.maxGuardrailViolations,
      unmetReasons,
    );
  }

  if (!humanApproved) {
    unmetReasons.push("humanApproved: explicit human approval required");
  }

  return {
    transition,
    ready: unmetReasons.length === 0,
    unmetReasons,
  };
}

function registryById(
  registry: readonly ModelRegistryEntry[],
): Map<string, ModelRegistryEntry> {
  return new Map(registry.map((entry) => [entry.stableId, entry]));
}

export function validateRolloutGuardrails(input?: {
  registry?: readonly ModelRegistryEntry[];
  stacks?: readonly CandidateStack[];
}): { ok: boolean; violations: string[] } {
  const registry = input?.registry ?? MODEL_REGISTRY;
  const stacks = input?.stacks ?? CANDIDATE_STACKS;
  const violations: string[] = [];

  const shipped = validateShippedModelRegistry();
  if (!shipped.ok) {
    violations.push(...shipped.errors);
  }

  for (const entry of registry) {
    if (
      (entry.maturity === "planned" || entry.maturity === "disabled") &&
      entry.routeEligibility.length > 0
    ) {
      violations.push(
        `${MODEL_REGISTRY_ERROR.PLANNED_ROUTE_ELIGIBLE}: ${entry.stableId}`,
      );
    }

    const glmFields = [entry.stableId, entry.displayName, ...entry.aliases];
    for (const field of glmFields) {
      if (matchesGlm(field)) {
        violations.push(`${MODEL_REGISTRY_ERROR.GLM_EXCLUSION}: ${field}`);
      }
    }

    if (
      entry.stableId === FABLE_STABLE_ID &&
      entry.roleRestriction != null
    ) {
      violations.push(
        "rollout-guardrail: fable-5 must remain an unrestricted ADR worker",
      );
    }

    if (
      entry.stableId === SOL_STABLE_ID &&
      entry.roleRestriction != null
    ) {
      violations.push(
        "rollout-guardrail: gpt-5.6-sol must remain an unrestricted ADR worker",
      );
    }
  }

  const byId = registryById(registry);
  for (const stack of stacks) {
    if (stack.route === TASTE_REVIEW_ROUTE && stack.automaticFallback) {
      violations.push(
        "rollout-guardrail: taste-review route must not enable automatic fallback",
      );
    }

    for (const candidate of stack.candidates) {
      if (matchesGlm(candidate)) {
        violations.push(`${MODEL_REGISTRY_ERROR.GLM_EXCLUSION}: ${candidate}`);
      }

      const entry = byId.get(candidate);
      if (!entry) {
        continue;
      }

      if (stack.automaticFallback && entry.roleRestriction != null) {
        violations.push(
          `${MODEL_REGISTRY_ERROR.ROLE_RESTRICTED_AUTOMATIC_FALLBACK}: ${entry.stableId}`,
        );
      }
    }
  }

  const completedLowQuality = completedLowQualityDisposition();
  if (completedLowQuality.kind !== "terminal-completed-low-quality") {
    violations.push(
      "rollout-guardrail: completed-low-quality disposition must be terminal",
    );
  }
  if (isRetryableDisposition(completedLowQuality)) {
    violations.push(
      "rollout-guardrail: completed-low-quality disposition must not be retryable or fallback-eligible",
    );
  }

  return { ok: violations.length === 0, violations };
}

export function assertRolloutGuardrailsForStage(
  stage: RolloutStage | null,
): { ok: boolean; violations: string[] } {
  void stage;
  return validateRolloutGuardrails();
}
