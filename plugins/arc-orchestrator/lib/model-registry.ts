// Shipped model registry: the typed inventory the runtime dispatches from.
// The registry *schema*, rung helpers, candidate-stack compiler, and every
// validator live in the shared routing-core package; this module owns the
// data (MODEL_REGISTRY) and binds the shared functions to it. Candidate stacks
// are compiled from the shipped policy through the same function the control
// plane uses, so the two planes cannot disagree about what a class means.

import {
  candidateStackForRouteIn,
  compileCandidateStacks,
  compilePublicAliasStacks,
  pinnedModelForAliasIn,
  type CandidateStack,
  type CompiledRoutingPolicy,
  type PublicAliasCandidateStack,
} from "../../../packages/routing-core/src/candidate-stacks";
import {
  effortsSupportedOnBackend as effortsSupportedOnBackendIn,
  type ModelDefinition,
  type Provenance,
  type EvidenceClaims,
} from "../../../packages/routing-core/src/model-schema";
import {
  OPENCODE_GO_SERVING_PROVIDER,
  registryPolicyDivergences as registryPolicyDivergencesIn,
  validateModelRegistry,
} from "../../../packages/routing-core/src/validate-registry";
import type { RoutingPolicy } from "../../../packages/routing-core/src/policy-schema";
import type { Backend, Effort } from "../../../packages/routing-core/src/vocabulary";
import type { PublicAlias } from "./capability-routes";
import type { CanonicalCapabilityRouteId } from "./capability-routes";
import type { TaskPhase } from "./trace-schema";
import { MODEL_POLICY, MODEL_POLICY_SOURCE } from "./model-policy";

export {
  BACKEND_SUPPORTED_EFFORTS,
  MODEL_REGISTRY_SCHEMA_VERSION,
  NO_EFFORT_RUNG,
  parseRungId,
  rungId,
  rungsFor,
  supportedEffortsFor,
  type EvidenceClaim,
  type EvidenceClaims,
  type ModelRegistryEntry,
  type NumericPricing,
  type Provenance,
  type RungId,
} from "../../../packages/routing-core/src/model-schema";
export {
  stackRungs,
  type CandidateRung,
  type CandidateStack,
  type PublicAliasCandidateStack,
  type StackRung,
} from "../../../packages/routing-core/src/candidate-stacks";
export {
  MODEL_REGISTRY_ERROR,
  OPENCODE_GO_SERVING_PROVIDER,
  glmProviderBoundaryViolations,
  isGlmIdentity,
  requiresGlmProviderBoundary,
  validateModelRegistry,
} from "../../../packages/routing-core/src/validate-registry";
export {
  PRICE_BANDS,
  type ModelMaturity,
  type PriceBand,
} from "../../../packages/routing-core/src/vocabulary";

type ModelRegistryEntry = ModelDefinition;

// Backend-level pre-validation for the CLI, derived from the registry rather
// than hardcoded. The precise per-model check belongs to select().
export function effortsSupportedOnBackend(
  backend: Backend,
  entries: readonly ModelRegistryEntry[] = MODEL_REGISTRY,
): Effort[] {
  return effortsSupportedOnBackendIn(backend, entries);
}

const VERIFIED_RUNNER_SOURCES = [
  "plugins/arc-orchestrator/lib/routes.ts",
  "plugins/arc-orchestrator/lib/spawn-adapter.ts",
  "CLAUDE.md",
] as const;

const SCREENSHOT_PLANNED_PROVENANCE: Provenance = {
  sources: ["model-tier-routing-plan screenshots"],
  capturedAt: "2026-07-11",
  verificationResult: "unverified",
  approver: null,
};

function verifiedProvenance(extraSources: string[] = []): Provenance {
  return {
    sources: [...VERIFIED_RUNNER_SOURCES, ...extraSources],
    capturedAt: "2026-07-11",
    verificationResult: "verified",
    approver: null,
  };
}

function fullEvidence(): EvidenceClaims {
  return {
    providerAccountAvailability: { verified: true },
    adapter: { verified: true },
    route: { verified: true },
    sandbox: { verified: true },
    output: { verified: true },
    cancellation: { verified: true },
    errorNormalization: { verified: true },
  };
}

function plannedScreenshotEntry(
  stableId: string,
  displayName: string,
): ModelRegistryEntry {
  return {
    stableId,
    family: null,
    version: null,
    publisher: null,
    servingProvider: null,
    providerModelId: null,
    transportBackend: null,
    adapterId: null,
    adapterVersion: null,
    endpoint: null,
    region: null,
    authAccountScope: null,
    runnerSupport: [],
    routeEligibility: [],
    sandboxPermissionSupport: [],
    outputContracts: [],
    maturity: "planned",
    provenance: SCREENSHOT_PLANNED_PROVENANCE,
    priceBand: null,
    numericPricing: null,
    aliases: [],
    displayName,
    roleRestriction: null,
    evidence: null,
  };
}

// OpenCode Go provider-qualified identities (arc-pi
// docs/arc-model-update-08-30-26.md, 2026-08-31 expansion). Every entry rides
// the same `opencode` transport and adapter path already verified for
// `kimi-k3`. The stable id mirrors the provider id with `/` replaced by `-`,
// so the two can never drift apart. The GLM provider boundary that guards
// these identities is enforced by routing-core's validate-registry.
function openCodeGoEntry(input: {
  providerModelId: `opencode-go/${string}`;
  family: string;
  version: string;
  publisher: string | null;
  displayName: string;
  aliases?: string[];
}): ModelRegistryEntry {
  return {
    stableId: input.providerModelId.replace("/", "-"),
    family: input.family,
    version: input.version,
    publisher: input.publisher,
    servingProvider: OPENCODE_GO_SERVING_PROVIDER,
    providerModelId: input.providerModelId,
    transportBackend: "opencode",
    adapterId: "opencode",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-configuration",
    runnerSupport: [
      "opencode:analyze",
      "opencode:implement",
      "opencode:review",
    ],
    routeEligibility: [
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
    ],
    sandboxPermissionSupport: ["read-only", "workspace-write"],
    outputContracts: [
      "exploration-result.v1",
      "implementation-result.v1",
      "correctness-review-result.v1",
    ],
    maturity: "available",
    provenance: {
      sources: [
        ...VERIFIED_RUNNER_SOURCES,
        "arc-pi docs/arc-model-update-08-30-26.md: OpenCode Go expansion (2026-08-31)",
        "same opencode adapter path as kimi-k3; adapter/sandbox/output/cancellation behavior is model-independent",
      ],
      capturedAt: "2026-08-31",
      verificationResult: "verified",
      approver: null,
    },
    priceBand: null,
    numericPricing: null,
    aliases: [input.providerModelId, ...(input.aliases ?? [])],
    displayName: input.displayName,
    roleRestriction: null,
    evidence: fullEvidence(),
  };
}

export const MODEL_REGISTRY: readonly ModelRegistryEntry[] = [
  {
    stableId: "composer-2.5",
    family: "composer",
    version: "2.5",
    publisher: "Anysphere",
    servingProvider: "Cursor",
    providerModelId: "composer-2.5",
    transportBackend: "composer",
    adapterId: "cursor-agent",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-subscription",
    runnerSupport: [
      "composer:analyze",
      "composer:implement",
      "composer:review",
    ],
    routeEligibility: [
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
    ],
    sandboxPermissionSupport: ["read-only", "workspace-write"],
    outputContracts: [
      "exploration-result.v1",
      "implementation-result.v1",
      "correctness-review-result.v1",
    ],
    maturity: "available",
    provenance: verifiedProvenance(),
    priceBand: null,
    numericPricing: null,
    aliases: ["Composer 2.5"],
    displayName: "Composer 2.5",
    roleRestriction: null,
    evidence: fullEvidence(),
  },
  {
    // Cursor Auto: Cursor's own model router, dispatched through the Composer
    // transport as `--model auto`. Explicit-only (cursor-auto-*) and the Eco
    // availability backup for every worker operation (analyze, implement, and
    // review); it holds no automatic runner-routing-v4 rung. Cursor picks the
    // concrete model per request, so no fixed effort and no benchmark rung is
    // claimed here.
    stableId: "cursor-auto",
    family: "cursor-auto",
    version: null,
    publisher: "Anysphere",
    servingProvider: "Cursor",
    providerModelId: "auto",
    transportBackend: "composer",
    adapterId: "cursor-agent",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-subscription",
    runnerSupport: [
      "composer:analyze",
      "composer:implement",
      "composer:review",
    ],
    routeEligibility: [
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
    ],
    sandboxPermissionSupport: ["read-only", "workspace-write"],
    outputContracts: [
      "exploration-result.v1",
      "implementation-result.v1",
      "correctness-review-result.v1",
    ],
    maturity: "available",
    provenance: verifiedProvenance(["cursor-agent models (2026-09-11)"]),
    priceBand: null,
    numericPricing: null,
    aliases: ["Cursor Auto", "auto"],
    displayName: "Cursor Auto",
    roleRestriction: null,
    evidence: fullEvidence(),
  },
  {
    // Historical benchmark identity retained only so the immutable 2026-07-25
    // capability snapshot remains auditable after Luna 6 replaced Luna 5.6.
    stableId: "gpt-5.6-luna",
    family: "gpt",
    version: "5.6-luna",
    publisher: "OpenAI",
    servingProvider: "OpenAI (Codex)",
    providerModelId: "gpt-5.6-luna",
    transportBackend: "codex",
    adapterId: "codex-exec",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-subscription",
    runnerSupport: [],
    routeEligibility: [],
    sandboxPermissionSupport: [],
    outputContracts: [],
    maturity: "disabled",
    provenance: verifiedProvenance(),
    priceBand: null,
    numericPricing: null,
    aliases: ["GPT-5.6 Luna"],
    displayName: "GPT-5.6 Luna",
    roleRestriction: null,
    evidence: fullEvidence(),
  },
  {
    stableId: "gpt-6-luna",
    family: "gpt",
    version: "6-luna",
    publisher: "OpenAI",
    servingProvider: "OpenAI (Codex)",
    providerModelId: "gpt-6-luna",
    transportBackend: "codex",
    adapterId: "codex-exec",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-subscription",
    runnerSupport: ["codex:analyze", "codex:implement", "codex:review"],
    routeEligibility: [
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
    ],
    sandboxPermissionSupport: ["read-only", "workspace-write"],
    outputContracts: [
      "exploration-result.v1",
      "implementation-result.v1",
      "correctness-review-result.v1",
    ],
    maturity: "available",
    provenance: verifiedProvenance([
      "docs/arc-model-policy.md: runner-routing-v4 Luna 6 binding",
    ]),
    priceBand: null,
    numericPricing: null,
    aliases: ["Luna 6", "GPT-6 Luna"],
    displayName: "GPT-6 Luna",
    roleRestriction: null,
    evidence: fullEvidence(),
  },
  {
    stableId: "gpt-5.5",
    family: "gpt",
    version: "5.5",
    publisher: "OpenAI",
    servingProvider: "OpenAI (Codex)",
    providerModelId: "gpt-5.5",
    transportBackend: "codex",
    adapterId: "codex-exec",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-subscription",
    runnerSupport: ["codex:analyze", "codex:implement", "codex:review"],
    routeEligibility: [
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
    ],
    sandboxPermissionSupport: ["read-only", "workspace-write"],
    outputContracts: [
      "exploration-result.v1",
      "implementation-result.v1",
      "correctness-review-result.v1",
    ],
    maturity: "available",
    provenance: verifiedProvenance(),
    priceBand: null,
    numericPricing: null,
    aliases: ["GPT-5.5"],
    displayName: "GPT-5.5",
    roleRestriction: null,
    evidence: fullEvidence(),
  },
  {
    // Historical benchmark identity retained only so the immutable 2026-07-25
    // capability snapshot remains auditable after Sol 6 replaced Sol 5.6.
    stableId: "gpt-5.6-sol",
    family: "gpt",
    version: "5.6-sol",
    publisher: "OpenAI",
    servingProvider: "OpenAI (Codex)",
    providerModelId: "gpt-5.6-sol",
    transportBackend: "codex",
    adapterId: "codex-exec",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-subscription",
    runnerSupport: [],
    routeEligibility: [],
    sandboxPermissionSupport: [],
    outputContracts: [],
    maturity: "disabled",
    provenance: verifiedProvenance(),
    priceBand: null,
    numericPricing: null,
    aliases: ["GPT-5.6 Sol"],
    displayName: "GPT-5.6 Sol",
    roleRestriction: null,
    evidence: fullEvidence(),
  },
  {
    stableId: "gpt-6-sol",
    family: "gpt",
    version: "6-sol",
    publisher: "OpenAI",
    servingProvider: "OpenAI (Codex)",
    providerModelId: "gpt-6-sol",
    transportBackend: "codex",
    adapterId: "codex-exec",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-subscription",
    runnerSupport: ["codex:analyze", "codex:implement", "codex:review"],
    routeEligibility: [
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
    ],
    sandboxPermissionSupport: ["read-only", "workspace-write"],
    outputContracts: [
      "exploration-result.v1",
      "implementation-result.v1",
      "correctness-review-result.v1",
    ],
    maturity: "available",
    provenance: verifiedProvenance([
      "docs/arc-model-policy.md: runner-routing-v4 Sol 6 binding",
    ]),
    priceBand: null,
    numericPricing: null,
    aliases: ["Sol 6", "GPT-6 Sol"],
    displayName: "GPT-6 Sol",
    roleRestriction: null,
    evidence: fullEvidence(),
  },
  {
    // Historical benchmark identity retained only so the immutable 2026-07-25
    // capability snapshot remains auditable after Opus 5.5 replaced Opus 5.
    stableId: "opus-5",
    family: "claude",
    version: "5",
    publisher: "Anthropic",
    servingProvider: "Anthropic",
    providerModelId: "claude-opus-5",
    transportBackend: "claude",
    adapterId: "claude-cli",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-subscription",
    runnerSupport: [],
    routeEligibility: [],
    sandboxPermissionSupport: [],
    outputContracts: [],
    maturity: "disabled",
    provenance: {
      sources: [
        ...VERIFIED_RUNNER_SOURCES,
        "claude CLI 2.1.220 accepts --model claude-opus-5 (verified 2026-07-24)",
        "same claude-cli adapter path as opus-4.8; adapter/sandbox/output/cancellation behavior is model-independent",
      ],
      capturedAt: "2026-07-24",
      verificationResult: "verified",
      approver: null,
    },
    priceBand: null,
    numericPricing: null,
    aliases: ["Opus 5"],
    displayName: "Opus 5",
    roleRestriction: null,
    evidence: fullEvidence(),
  },
  {
    stableId: "opus-5.5",
    family: "claude",
    version: "5.5",
    publisher: "Anthropic",
    servingProvider: "Anthropic",
    providerModelId: "claude-opus-5-5",
    transportBackend: "claude",
    adapterId: "claude-cli",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-subscription",
    runnerSupport: ["claude:analyze", "claude:implement", "claude:review"],
    routeEligibility: [
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
      "taste-review.read-only.v1",
    ],
    sandboxPermissionSupport: ["read-only", "workspace-write"],
    outputContracts: [
      "exploration-result.v1",
      "implementation-result.v1",
      "correctness-review-result.v1",
      "taste-review-result.v1",
    ],
    maturity: "available",
    provenance: verifiedProvenance([
      "docs/arc-model-policy.md: runner-routing-v4 Opus 5.5 binding",
    ]),
    priceBand: null,
    numericPricing: null,
    aliases: ["Opus 5.5"],
    displayName: "Opus 5.5",
    roleRestriction: null,
    evidence: fullEvidence(),
  },
  {
    stableId: "opus-4.8",
    family: "claude",
    version: "4.8",
    publisher: "Anthropic",
    servingProvider: "Anthropic",
    providerModelId: "claude-opus-4-8",
    transportBackend: "claude",
    adapterId: "claude-cli",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-subscription",
    runnerSupport: ["claude:analyze", "claude:implement", "claude:review"],
    // Taste review moved to opus-5.5, which supersedes 4.8 on the taste path.
    // 4.8 stays an ADR implement candidate one rung behind opus-5.5.
    routeEligibility: [
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
    ],
    sandboxPermissionSupport: ["read-only", "workspace-write"],
    outputContracts: [
      "exploration-result.v1",
      "implementation-result.v1",
      "correctness-review-result.v1",
    ],
    maturity: "available",
    provenance: verifiedProvenance(),
    priceBand: null,
    numericPricing: null,
    aliases: ["Opus 4.8"],
    displayName: "Opus 4.8",
    roleRestriction: null,
    evidence: fullEvidence(),
  },
  {
    stableId: "sonnet-5",
    family: "claude",
    version: "5",
    publisher: "Anthropic",
    servingProvider: "Anthropic",
    providerModelId: null,
    transportBackend: "claude",
    adapterId: null,
    adapterVersion: null,
    endpoint: null,
    region: null,
    authAccountScope: null,
    runnerSupport: [],
    routeEligibility: [],
    sandboxPermissionSupport: [],
    outputContracts: [],
    maturity: "available",
    provenance: {
      sources: [
        "plugins/arc-orchestrator/agents/*.md",
        "CLAUDE.md",
        "verified only as thin wrapper agents in Claude Code; no verified runner-route adapter, provider-id, or account evidence",
      ],
      capturedAt: "2026-07-11",
      verificationResult: "verified",
      approver: null,
    },
    priceBand: null,
    numericPricing: null,
    aliases: ["Sonnet 5"],
    displayName: "Sonnet 5",
    roleRestriction: null,
    evidence: null,
  },
  {
    stableId: "fable-5",
    family: "claude",
    version: "5",
    publisher: "Anthropic",
    servingProvider: "Anthropic",
    providerModelId: "claude-fable-5",
    transportBackend: "claude",
    adapterId: "claude-cli",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-subscription",
    runnerSupport: [],
    routeEligibility: [],
    sandboxPermissionSupport: [],
    outputContracts: [],
    maturity: "disabled",
    provenance: verifiedProvenance([
      "docs/orchestrator/decisions/0004-runner-routing-v2.md: legitimate worker at exact ADR automatic and explicit placements",
    ]),
    priceBand: null,
    numericPricing: null,
    aliases: ["Fable 5"],
    displayName: "Fable 5",
    roleRestriction: null,
    evidence: fullEvidence(),
  },
  {
    stableId: "fable-5.1",
    family: "claude",
    version: "5.1",
    publisher: "Anthropic",
    servingProvider: "Anthropic",
    providerModelId: "claude-fable-5-1",
    transportBackend: "claude",
    adapterId: "claude-cli",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-subscription",
    runnerSupport: ["claude:analyze", "claude:implement", "claude:review"],
    routeEligibility: [
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
    ],
    sandboxPermissionSupport: ["read-only", "workspace-write"],
    outputContracts: [
      "exploration-result.v1",
      "implementation-result.v1",
      "correctness-review-result.v1",
    ],
    maturity: "available",
    provenance: verifiedProvenance([
      "docs/arc-model-policy.md: runner-routing-v4 Fable 5.1 binding",
    ]),
    priceBand: null,
    numericPricing: null,
    aliases: ["Fable 5.1"],
    displayName: "Fable 5.1",
    roleRestriction: null,
    evidence: fullEvidence(),
  },
  {
    // Historical benchmark identity retained only so the immutable 2026-07-25
    // capability snapshot remains auditable after Grok 4.7 replaced Grok 4.6.
    stableId: "cursor-grok-4.6-high",
    family: "grok",
    version: "4.6",
    publisher: "xAI",
    servingProvider: "Cursor",
    providerModelId: "cursor-grok-4.6-high",
    transportBackend: "composer",
    adapterId: "cursor-agent",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-subscription",
    runnerSupport: [],
    routeEligibility: [],
    sandboxPermissionSupport: [],
    outputContracts: [],
    maturity: "disabled",
    provenance: verifiedProvenance(["cursor-agent models (2026-08-18)"]),
    priceBand: null,
    numericPricing: null,
    aliases: ["Cursor Grok 4.6 High", "grok-4.6", "Grok 4.6"],
    displayName: "Cursor Grok 4.6 High",
    roleRestriction: null,
    evidence: fullEvidence(),
    fixedEffort: "high",
  },
  {
    // Grok 4.7 High served through Cursor on the Composer transport. Approved
    // runner-routing-v4 identity; superseded public aliases are rejected rather
    // than silently remapped.
    stableId: "cursor-grok-4.7-high",
    family: "grok",
    version: "4.7",
    publisher: "xAI",
    servingProvider: "Cursor",
    providerModelId: "grok-4.7-high",
    transportBackend: "composer",
    adapterId: "cursor-agent",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-subscription",
    runnerSupport: [
      "composer:analyze",
      "composer:implement",
      "composer:review",
    ],
    routeEligibility: [
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
    ],
    sandboxPermissionSupport: ["read-only", "workspace-write"],
    outputContracts: [
      "exploration-result.v1",
      "implementation-result.v1",
      "correctness-review-result.v1",
    ],
    maturity: "available",
    provenance: verifiedProvenance([
      "docs/arc-model-policy.md: runner-routing-v4 Grok 4.7 binding",
    ]),
    priceBand: null,
    numericPricing: null,
    aliases: ["Cursor Grok 4.7 High", "grok-4.7", "Grok 4.7"],
    displayName: "Cursor Grok 4.7 High",
    roleRestriction: null,
    evidence: fullEvidence(),
    fixedEffort: "high",
  },
  plannedScreenshotEntry("haiku-4.5", "Haiku 4.5"),
  plannedScreenshotEntry("qwen-3-235b", "Qwen 3 235B"),
  {
    stableId: "cursor-fable-high",
    family: "claude",
    version: "5",
    publisher: "Anthropic",
    servingProvider: "Cursor",
    providerModelId: "claude-fable-5-thinking-high",
    transportBackend: "composer",
    adapterId: "cursor-agent",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-subscription",
    runnerSupport: [
      "composer:analyze",
      "composer:implement",
      "composer:review",
    ],
    routeEligibility: [
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
    ],
    sandboxPermissionSupport: ["read-only", "workspace-write"],
    outputContracts: [
      "exploration-result.v1",
      "implementation-result.v1",
      "correctness-review-result.v1",
    ],
    maturity: "available",
    provenance: verifiedProvenance(),
    priceBand: null,
    numericPricing: null,
    aliases: ["Cursor Fable"],
    displayName: "Cursor Fable",
    roleRestriction: null,
    evidence: fullEvidence(),
  },
  {
    stableId: "cursor-fable-medium",
    family: "claude",
    version: "5",
    publisher: "Anthropic",
    servingProvider: "Cursor",
    providerModelId: "claude-fable-5-thinking-medium",
    transportBackend: "composer",
    adapterId: "cursor-agent",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-subscription",
    runnerSupport: [
      "composer:analyze",
      "composer:implement",
      "composer:review",
    ],
    routeEligibility: [
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
    ],
    sandboxPermissionSupport: ["read-only", "workspace-write"],
    outputContracts: [
      "exploration-result.v1",
      "implementation-result.v1",
      "correctness-review-result.v1",
    ],
    maturity: "available",
    provenance: verifiedProvenance(["cursor-agent models (2026-07-28)"]),
    priceBand: null,
    numericPricing: null,
    aliases: ["Cursor Fable Medium"],
    displayName: "Cursor Fable Medium",
    roleRestriction: null,
    evidence: fullEvidence(),
  },
  {
    stableId: "cursor-sol-high",
    family: "gpt",
    version: "5.6-sol",
    publisher: "OpenAI",
    servingProvider: "Cursor",
    providerModelId: "gpt-5.6-sol-high",
    transportBackend: "composer",
    adapterId: "cursor-agent",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-subscription",
    runnerSupport: [
      "composer:analyze",
      "composer:implement",
      "composer:review",
    ],
    routeEligibility: [
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
    ],
    sandboxPermissionSupport: ["read-only", "workspace-write"],
    outputContracts: [
      "exploration-result.v1",
      "implementation-result.v1",
      "correctness-review-result.v1",
    ],
    maturity: "available",
    provenance: verifiedProvenance(["cursor-agent models (2026-07-28)"]),
    priceBand: null,
    numericPricing: null,
    aliases: ["Cursor Sol High"],
    displayName: "Cursor Sol High",
    roleRestriction: null,
    evidence: fullEvidence(),
  },
  {
    stableId: "minimax-m3",
    family: "minimax",
    version: "M3",
    publisher: "MiniMax",
    servingProvider: "MiniMax",
    providerModelId: "MiniMax-M3",
    transportBackend: "minimax",
    adapterId: "claude-cli-anthropic-compatible",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "configured-api-key",
    runnerSupport: ["minimax:analyze", "minimax:implement", "minimax:review"],
    routeEligibility: [
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
    ],
    sandboxPermissionSupport: ["read-only", "workspace-write"],
    outputContracts: [
      "exploration-result.v1",
      "implementation-result.v1",
      "correctness-review-result.v1",
    ],
    maturity: "available",
    provenance: verifiedProvenance(),
    priceBand: null,
    numericPricing: null,
    aliases: ["MiniMax M3"],
    displayName: "MiniMax M3",
    roleRestriction: null,
    evidence: fullEvidence(),
    supportedEfforts: ["low", "high", "max"],
  },
  plannedScreenshotEntry("kimi-2.6", "Kimi 2.6"),
  {
    // Direct OpenCode identity retained for --backend opencode. This identity
    // is not in v4 automatic stacks.
    stableId: "kimi-k3",
    family: "kimi",
    version: "K3",
    publisher: "Moonshot AI",
    servingProvider: "OpenCode",
    providerModelId: "moonshotai/kimi-k3",
    transportBackend: "opencode",
    adapterId: "opencode",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-configuration",
    runnerSupport: [
      "opencode:analyze",
      "opencode:implement",
      "opencode:review",
    ],
    routeEligibility: [
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
    ],
    sandboxPermissionSupport: ["read-only", "workspace-write"],
    outputContracts: [
      "exploration-result.v1",
      "implementation-result.v1",
      "correctness-review-result.v1",
    ],
    maturity: "available",
    provenance: verifiedProvenance(),
    priceBand: null,
    numericPricing: null,
    aliases: ["Kimi K3", "moonshotai/kimi-k3"],
    displayName: "Kimi K3",
    roleRestriction: null,
    evidence: fullEvidence(),
  },
  // OpenCode Go identities. The first three hold approved automatic rungs
  // (GLM 5.3 Flash leads medium-light/easy implement, GLM 5.3 trails the
  // read-only phases and hard/medium implement, DeepSeek V4 Pro is the third
  // Verify rung); the rest are explicit-only. The planned `deepseek-v4-*`
  // screenshot entries below stay planned: these are distinct, runnable,
  // provider-qualified identities, not promotions of that inventory.
  openCodeGoEntry({
    providerModelId: "opencode-go/glm-5.3-flash",
    family: "glm",
    version: "5.3-flash",
    publisher: "Zhipu AI",
    displayName: "OpenCode Go GLM 5.3 Flash",
    aliases: ["GLM 5.3 Flash"],
  }),
  openCodeGoEntry({
    providerModelId: "opencode-go/glm-5.3",
    family: "glm",
    version: "5.3",
    publisher: "Zhipu AI",
    displayName: "OpenCode Go GLM 5.3",
    aliases: ["GLM 5.3"],
  }),
  openCodeGoEntry({
    providerModelId: "opencode-go/deepseek-v4-pro",
    family: "deepseek",
    version: "V4 Pro",
    publisher: "DeepSeek",
    displayName: "OpenCode Go DeepSeek V4 Pro",
  }),
  openCodeGoEntry({
    providerModelId: "opencode-go/deepseek-v4-flash",
    family: "deepseek",
    version: "V4 Flash",
    publisher: "DeepSeek",
    displayName: "OpenCode Go DeepSeek V4 Flash",
  }),
  openCodeGoEntry({
    providerModelId: "opencode-go/kimi-k3",
    family: "kimi",
    version: "K3",
    publisher: "Moonshot AI",
    displayName: "OpenCode Go Kimi K3",
  }),
  openCodeGoEntry({
    providerModelId: "opencode-go/qwen3.8-max",
    family: "qwen",
    version: "3.8-max",
    publisher: "Alibaba",
    displayName: "OpenCode Go Qwen 3.8 Max",
    aliases: ["Qwen 3.8 Max"],
  }),
  openCodeGoEntry({
    providerModelId: "opencode-go/muse-spark-1.2-contributor",
    family: "muse-spark",
    version: "1.2-contributor",
    publisher: null,
    displayName: "OpenCode Go Muse Spark 1.2",
    aliases: ["Muse Spark 1.2"],
  }),
  openCodeGoEntry({
    providerModelId: "opencode-go/glm-5.2",
    family: "glm",
    version: "5.2",
    publisher: "Zhipu AI",
    displayName: "OpenCode Go GLM 5.2",
    aliases: ["GLM 5.2"],
  }),
  openCodeGoEntry({
    providerModelId: "opencode-go/kimi-k2.7-code",
    family: "kimi",
    version: "K2.7 Code",
    publisher: "Moonshot AI",
    displayName: "OpenCode Go Kimi K2.7 Code",
    aliases: ["Kimi K2.7 Code"],
  }),
  openCodeGoEntry({
    providerModelId: "opencode-go/grok-4.6",
    family: "grok",
    version: "4.6",
    publisher: "xAI",
    displayName: "OpenCode Go Grok 4.6",
  }),
  openCodeGoEntry({
    providerModelId: "opencode-go/gpt-5.6-luna",
    family: "gpt",
    version: "5.6-luna",
    publisher: "OpenAI",
    displayName: "OpenCode Go Luna 5.6",
  }),
  {
    // Direct Anthropic-compatible Moonshot identity for legacy --backend kimi
    // recovery (kimi-k3[1m] via Claude CLI). It is not in v4 automatic stacks.
    stableId: "kimi-k3-anthropic",
    family: "kimi",
    version: "k3",
    publisher: "Moonshot AI",
    servingProvider: "Moonshot",
    providerModelId: "kimi-k3[1m]",
    transportBackend: "kimi",
    adapterId: "claude-cli",
    adapterVersion: "1",
    endpoint: "https://api.moonshot.ai/anthropic",
    region: null,
    authAccountScope: "moonshot-api-key",
    runnerSupport: ["kimi:analyze", "kimi:implement", "kimi:review"],
    routeEligibility: [
      "explore.read-only.v1",
      "implement.workspace-write.v1",
      "check.read-only.v1",
    ],
    sandboxPermissionSupport: ["read-only", "workspace-write"],
    outputContracts: [
      "exploration-result.v1",
      "implementation-result.v1",
      "correctness-review-result.v1",
    ],
    maturity: "available",
    provenance: verifiedProvenance([
      "plugins/arc-orchestrator/lib/kimi.ts",
      "plugins/arc-orchestrator/lib/spawn-adapter.ts",
      "Moonshot Anthropic-compatible Claude Code endpoint; pay-as-you-go API key",
    ]),
    priceBand: null,
    numericPricing: null,
    aliases: ["kimi-k3[1m]", "Kimi K3 Anthropic"],
    displayName: "Kimi K3 Anthropic",
    roleRestriction: null,
    evidence: fullEvidence(),
    supportedEfforts: ["medium", "high", "max"],
  },
  plannedScreenshotEntry("5.4-nano", "5.4 nano"),
  plannedScreenshotEntry("5.4-mini", "5.4 mini"),
  plannedScreenshotEntry("deepseek-v4-flash", "Deepseek v4 Flash"),
  plannedScreenshotEntry("deepseek-v4-pro", "Deepseek v4 Pro"),
];

// ---------------------------------------------------------------------------
// runner-routing-v4 candidate stacks, compiled from the shipped policy copy.
// ---------------------------------------------------------------------------
// Every automatic stack is a policy chain plus the shared emergency tail; every
// public alias pins exactly one candidate. `compileCandidateStacks` and
// `compilePublicAliasStacks` are the same functions the arc-router control
// plane runs, and test/routing-core-parity.test.ts holds the compiled output
// byte-for-byte against the pre-migration stacks.
export const CANDIDATE_STACKS: readonly CandidateStack[] =
  compileCandidateStacks(MODEL_POLICY);

export const PUBLIC_ALIAS_CANDIDATE_STACKS: readonly PublicAliasCandidateStack[] =
  compilePublicAliasStacks(MODEL_POLICY, MODEL_REGISTRY);

export const COMPILED_ROUTING_POLICY: CompiledRoutingPolicy = {
  policyVersion: MODEL_POLICY.label,
  stacks: CANDIDATE_STACKS,
  aliasStacks: PUBLIC_ALIAS_CANDIDATE_STACKS,
};

/**
 * Resolve the single model an explicit public alias pins, straight from the
 * registry. Callers that would otherwise restate a model id next to an alias
 * should use this instead: the registry is the one place a stable id is bound
 * to a provider model id.
 */
export function pinnedModelForAlias(alias: PublicAlias): {
  stableId: string;
  providerModelId: string;
} {
  return pinnedModelForAliasIn(PUBLIC_ALIAS_CANDIDATE_STACKS, MODEL_REGISTRY, alias);
}

export function candidateStackForRoute(
  route: CanonicalCapabilityRouteId,
  requestedAlias: string | null | undefined,
  workloadClass?: string | null,
  phase?: TaskPhase | null,
): CandidateStack | null {
  return candidateStackForRouteIn(
    COMPILED_ROUTING_POLICY,
    route,
    requestedAlias,
    workloadClass,
    phase,
  );
}

// The current policy places Fable 5.1 and GPT-6 Sol as ordinary workers at
// exact stack and alias positions. They are not role-restricted; stack
// membership is the authorization boundary. Disabled superseded entries remain
// solely so historical benchmark snapshots retain their original identities.

export function validateShippedModelRegistry(): {
  ok: boolean;
  errors: string[];
} {
  return validateModelRegistry(MODEL_REGISTRY, [
    ...CANDIDATE_STACKS,
    ...PUBLIC_ALIAS_CANDIDATE_STACKS,
  ]);
}

/**
 * Shipped registry ↔ policy parity. Every public binding in the generated
 * policy copy must resolve to a registry entry with the same provider model
 * id and transport backend, the policy's fixed-effort surface metadata must
 * equal the entry's fixedEffort, an alias default effort must be selectable
 * on that entry, and excluded models must never carry an automatic rung.
 * Returns the divergences; an empty list means the registry matches.
 */
export function registryPolicyDivergences(
  entries: readonly ModelRegistryEntry[] = MODEL_REGISTRY,
  policy: RoutingPolicy = MODEL_POLICY,
): string[] {
  return registryPolicyDivergencesIn(entries, policy, CANDIDATE_STACKS);
}

export function assertRegistryMatchesPolicy(): void {
  const errors = registryPolicyDivergences();
  if (errors.length > 0) {
    throw new Error(
      `model registry diverges from the model policy copy (${MODEL_POLICY_SOURCE.document}); run npm run policy:sync in arc-pi or fix the registry:\n  ${errors.join("\n  ")}`,
    );
  }
}

// Fail closed at load: a runner whose shipped registry contradicts the policy
// it advertises must not dispatch.
assertRegistryMatchesPolicy();
