// Phase-1 model registry from docs/orchestrator/model-tier-routing-plan.md.
// Typed inventory, candidate stacks, and validation only; nothing here activates selection.

import {
  CAPABILITY_ROUTES,
  type CanonicalCapabilityRouteId,
  type OutputContractId,
  type PublicAlias,
} from "./capability-routes";
import type { Backend, TraceSandbox } from "./trace-schema";

export const MODEL_REGISTRY_SCHEMA_VERSION = 2;

export type ModelMaturity =
  | "planned"
  | "experimental"
  | "available"
  | "deprecated"
  | "disabled";

export type PriceBand = "premium" | "$$$" | "$$" | "$" | "very-cheap";

export type EvidenceClaim = { verified: boolean };

export type EvidenceClaims = {
  providerAccountAvailability: EvidenceClaim;
  adapter: EvidenceClaim;
  route: EvidenceClaim;
  sandbox: EvidenceClaim;
  output: EvidenceClaim;
  cancellation: EvidenceClaim;
  errorNormalization: EvidenceClaim;
};

export type Provenance = {
  sources: string[];
  capturedAt: string | null;
  verificationResult: "verified" | "unverified";
  approver: string | null;
};

export type NumericPricing =
  | {
      kind: "usd-per-mtok";
      inputUsdPerMTok: number;
      outputUsdPerMTok: number;
      sourceUrl: string;
      sourceVersion: string;
      retrievedAt: string;
      expiresAt: string;
    }
  | {
      kind: "not-applicable-subscription";
      planId: string;
    };

export type ModelRegistryEntry = {
  stableId: string;
  family: string | null;
  version: string | null;
  publisher: string | null;
  servingProvider: string | null;
  providerModelId: string | null;
  transportBackend: Backend | "claude-code-parent" | null;
  adapterId: string | null;
  adapterVersion: string | null;
  endpoint: string | null;
  region: string | null;
  authAccountScope: string | null;
  runnerSupport: string[];
  routeEligibility: CanonicalCapabilityRouteId[];
  sandboxPermissionSupport: TraceSandbox[];
  outputContracts: OutputContractId[];
  maturity: ModelMaturity;
  provenance: Provenance;
  priceBand: PriceBand | null;
  numericPricing: NumericPricing | null;
  aliases: string[];
  displayName: string;
  roleRestriction: "parent-only" | "explicit-parent-authorization" | null;
  evidence: EvidenceClaims | null;
};

export type CandidateStack = {
  route: CanonicalCapabilityRouteId;
  policyVersion: "runner-routing-v2";
  candidates: string[];
  automaticFallback: boolean;
  workloadClass?: string;
};

export type PublicAliasCandidateStack = CandidateStack & {
  publicAlias: PublicAlias;
};

export const MODEL_REGISTRY_ERROR = {
  DUPLICATE_STABLE_ID: "model-registry: duplicate stableId",
  AMBIGUOUS_ALIAS: "model-registry: ambiguous alias",
  UNKNOWN_ROUTE_VERSION: "model-registry: unknown route version",
  UNKNOWN_OUTPUT_CONTRACT: "model-registry: unknown output-contract version",
  UNSUPPORTED_SANDBOX_CLAIM: "model-registry: unsupported sandbox claim",
  UNKNOWN_SANDBOX_VALUE: "model-registry: unknown sandbox value",
  FALLBACK_CYCLE: "model-registry: fallback cycle",
  STACK_CANDIDATE_NOT_ELIGIBLE:
    "model-registry: stack candidate not route-eligible",
  ROLE_RESTRICTED_AUTOMATIC_FALLBACK:
    "model-registry: role-restricted candidate in automatic-fallback stack",
  RUNNABLE_MISSING_EVIDENCE: "model-registry: runnable entry missing evidence",
  PLANNED_ROUTE_ELIGIBLE:
    "model-registry: planned or disabled entry is route-eligible",
  PARENT_ONLY_ROUTE_ELIGIBLE:
    "model-registry: parent-only entry has route eligibility",
  GLM_EXCLUSION: "model-registry: glm exclusion violated",
} as const;

const VERIFIED_RUNNER_SOURCES = [
  "plugins/fable-orchestrator/lib/routes.ts",
  "plugins/fable-orchestrator/lib/spawn-adapter.ts",
  "CLAUDE.md",
] as const;

const SCREENSHOT_PLANNED_PROVENANCE: Provenance = {
  sources: ["model-tier-routing-plan screenshots"],
  capturedAt: "2026-07-11",
  verificationResult: "unverified",
  approver: null,
};

const KNOWN_ROUTE_IDS = new Set(
  CAPABILITY_ROUTES.map((route) => route.id),
);

const KNOWN_OUTPUT_CONTRACTS = new Set(
  CAPABILITY_ROUTES.map((route) => route.outputContract),
);

const ROUTE_BY_ID = Object.fromEntries(
  CAPABILITY_ROUTES.map((route) => [route.id, route]),
) as Record<CanonicalCapabilityRouteId, (typeof CAPABILITY_ROUTES)[number]>;

const KNOWN_SANDBOXES: ReadonlySet<string> = new Set([
  "read-only",
  "workspace-write",
]);

const RUNNABLE_MATURITIES = new Set<ModelMaturity>([
  "experimental",
  "available",
  "deprecated",
]);

const EVIDENCE_CLAIM_KEYS = [
  "providerAccountAvailability",
  "adapter",
  "route",
  "sandbox",
  "output",
  "cancellation",
  "errorNormalization",
] as const satisfies ReadonlyArray<keyof EvidenceClaims>;

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

// GLM is excluded per model-tier-routing-plan.md; no registry entry is authorized.
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
    runnerSupport: ["composer:analyze", "composer:implement", "composer:review"],
    routeEligibility: ["explore.read-only.v1", "implement.workspace-write.v1", "check.read-only.v1"],
    sandboxPermissionSupport: ["read-only", "workspace-write"],
    outputContracts: ["exploration-result.v1", "implementation-result.v1", "correctness-review-result.v1"],
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
    runnerSupport: ["codex:analyze"],
    routeEligibility: ["explore.read-only.v1"],
    sandboxPermissionSupport: ["read-only"],
    outputContracts: ["exploration-result.v1"],
    maturity: "available",
    provenance: verifiedProvenance(),
    priceBand: null,
    numericPricing: null,
    aliases: ["GPT-5.6 Luna"],
    displayName: "GPT-5.6 Luna",
    roleRestriction: null,
    evidence: fullEvidence(),
  },
  {
    stableId: "gpt-5.6-terra",
    family: "gpt",
    version: "5.6-terra",
    publisher: "OpenAI",
    servingProvider: "OpenAI (Codex)",
    providerModelId: "gpt-5.6-terra",
    transportBackend: "codex",
    adapterId: "codex-exec",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-subscription",
    runnerSupport: ["codex:analyze", "codex:implement", "codex:review"],
    routeEligibility: ["implement.workspace-write.v1"],
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
    aliases: ["GPT-5.6 Terra"],
    displayName: "GPT-5.6 Terra",
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
    routeEligibility: ["explore.read-only.v1", "implement.workspace-write.v1", "check.read-only.v1"],
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
    runnerSupport: ["codex:analyze", "codex:implement", "codex:review"],
    routeEligibility: ["explore.read-only.v1", "implement.workspace-write.v1", "check.read-only.v1"],
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
    aliases: ["GPT-5.6 Sol"],
    displayName: "GPT-5.6 Sol",
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
        "plugins/fable-orchestrator/agents/*.md",
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
    runnerSupport: ["claude:analyze", "claude:implement", "claude:review"],
    routeEligibility: ["explore.read-only.v1", "implement.workspace-write.v1", "check.read-only.v1"],
    sandboxPermissionSupport: ["read-only", "workspace-write"],
    outputContracts: ["exploration-result.v1", "implementation-result.v1", "correctness-review-result.v1"],
    maturity: "available",
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
    stableId: "grok-4.5",
    family: "grok",
    version: "4.5",
    publisher: "xAI",
    servingProvider: "Cursor",
    providerModelId: "grok-4.5",
    transportBackend: "composer",
    adapterId: "cursor-agent",
    adapterVersion: "1",
    endpoint: null,
    region: null,
    authAccountScope: "local-user-subscription",
    runnerSupport: ["composer:analyze", "composer:implement", "composer:review"],
    routeEligibility: [
      "explore.read-only.v1",
      "check.read-only.v1",
      "implement.workspace-write.v1",
    ],
    sandboxPermissionSupport: ["read-only", "workspace-write"],
    outputContracts: [
      "exploration-result.v1",
      "correctness-review-result.v1",
      "implementation-result.v1",
    ],
    maturity: "available",
    provenance: verifiedProvenance(),
    priceBand: null,
    numericPricing: null,
    aliases: ["Grok 4.5"],
    displayName: "Grok 4.5",
    roleRestriction: null,
    evidence: fullEvidence(),
  },
  plannedScreenshotEntry("haiku-4.5", "Haiku 4.5"),
  plannedScreenshotEntry("qwen-3-235b", "Qwen 3 235B"),
  {
    stableId: "cursor-fable-high", family: "claude", version: "5", publisher: "Anthropic", servingProvider: "Cursor", providerModelId: "claude-fable-5-thinking-high", transportBackend: "composer", adapterId: "cursor-agent", adapterVersion: "1", endpoint: null, region: null, authAccountScope: "local-user-subscription", runnerSupport: ["composer:analyze", "composer:implement", "composer:review"], routeEligibility: ["explore.read-only.v1", "implement.workspace-write.v1", "check.read-only.v1"], sandboxPermissionSupport: ["read-only", "workspace-write"], outputContracts: ["exploration-result.v1", "implementation-result.v1", "correctness-review-result.v1"], maturity: "available", provenance: verifiedProvenance(), priceBand: null, numericPricing: null, aliases: ["Cursor Fable"], displayName: "Cursor Fable", roleRestriction: null, evidence: fullEvidence(),
  },
  {
    stableId: "minimax-m3", family: "minimax", version: "M3", publisher: "MiniMax", servingProvider: "MiniMax", providerModelId: "MiniMax-M3", transportBackend: "minimax", adapterId: "claude-cli-anthropic-compatible", adapterVersion: "1", endpoint: null, region: null, authAccountScope: "configured-api-key", runnerSupport: ["minimax:analyze", "minimax:implement", "minimax:review"], routeEligibility: ["explore.read-only.v1", "implement.workspace-write.v1", "check.read-only.v1"], sandboxPermissionSupport: ["read-only", "workspace-write"], outputContracts: ["exploration-result.v1", "implementation-result.v1", "correctness-review-result.v1"], maturity: "available", provenance: verifiedProvenance(), priceBand: null, numericPricing: null, aliases: ["MiniMax M3"], displayName: "MiniMax M3", roleRestriction: null, evidence: fullEvidence(),
  },
  {
    stableId: "kimi-k3", family: "kimi", version: "K3", publisher: "Moonshot AI", servingProvider: "OpenCode", providerModelId: "moonshotai/kimi-k3", transportBackend: "opencode", adapterId: "opencode", adapterVersion: "1", endpoint: null, region: null, authAccountScope: "local-user-configuration", runnerSupport: ["opencode:analyze", "opencode:implement", "opencode:review"], routeEligibility: ["explore.read-only.v1", "implement.workspace-write.v1", "check.read-only.v1"], sandboxPermissionSupport: ["read-only", "workspace-write"], outputContracts: ["exploration-result.v1", "implementation-result.v1", "correctness-review-result.v1"], maturity: "available", provenance: verifiedProvenance(), priceBand: null, numericPricing: null, aliases: ["Kimi K3", "moonshotai/kimi-k3"], displayName: "Kimi K3", roleRestriction: null, evidence: fullEvidence(),
  },
  plannedScreenshotEntry("5.4-nano", "5.4 nano"),
  plannedScreenshotEntry("5.4-mini", "5.4 mini"),
  plannedScreenshotEntry("deepseek-v4-flash", "Deepseek v4 Flash"),
  plannedScreenshotEntry("deepseek-v4-pro", "Deepseek v4 Pro"),
];

export const CANDIDATE_STACKS: readonly CandidateStack[] = [
  {
    route: "implement.workspace-write.v1",
    policyVersion: "runner-routing-v2", candidates: ["composer-2.5"], automaticFallback: false, workloadClass: "default",
  },
  {
    route: "implement.workspace-write.v1", policyVersion: "runner-routing-v2", candidates: ["grok-4.5"], automaticFallback: false, workloadClass: "light-work",
  },
  {
    route: "implement.workspace-write.v1", policyVersion: "runner-routing-v2", candidates: ["opus-4.8", "gpt-5.5", "kimi-k3", "grok-4.5", "minimax-m3", "composer-2.5"], automaticFallback: true, workloadClass: "medium-light-work",
  },
  {
    route: "implement.workspace-write.v1", policyVersion: "runner-routing-v2", candidates: ["gpt-5.5", "opus-4.8", "kimi-k3", "grok-4.5", "minimax-m3", "composer-2.5"], automaticFallback: true, workloadClass: "medium-work",
  },
  {
    route: "implement.workspace-write.v1", policyVersion: "runner-routing-v2", candidates: ["gpt-5.6-terra", "fable-5", "cursor-fable-high", "kimi-k3", "minimax-m3", "composer-2.5"], automaticFallback: true, workloadClass: "medium-hard-work",
  },
  {
    route: "implement.workspace-write.v1", policyVersion: "runner-routing-v2", candidates: ["gpt-5.6-sol", "fable-5", "cursor-fable-high", "kimi-k3", "minimax-m3", "composer-2.5"], automaticFallback: true, workloadClass: "hard-light-work",
  },
  {
    route: "implement.workspace-write.v1", policyVersion: "runner-routing-v2", candidates: ["fable-5", "gpt-5.6-sol", "cursor-fable-high", "kimi-k3", "minimax-m3", "composer-2.5"], automaticFallback: true, workloadClass: "hard-work",
  },
  {
    route: "explore.read-only.v1",
    policyVersion: "runner-routing-v2",
    candidates: ["fable-5", "gpt-5.6-sol", "kimi-k3", "cursor-fable-high", "grok-4.5", "minimax-m3", "composer-2.5"],
    automaticFallback: true,
  },
  {
    route: "check.read-only.v1",
    policyVersion: "runner-routing-v2",
    candidates: ["fable-5", "gpt-5.6-sol", "kimi-k3", "cursor-fable-high", "grok-4.5", "minimax-m3", "composer-2.5"],
    automaticFallback: true,
  },
  {
    route: "taste-review.read-only.v1",
    policyVersion: "runner-routing-v2",
    candidates: ["opus-4.8"],
    automaticFallback: false,
  },
];

// Explicit diagnostic aliases pin exactly one candidate: an explicit route
// executes its target once and never inherits the automatic workload/ADR
// chains. Automatic selection requests a canonical route alias for route-id
// resolution but passes a null alias here so the full ADR stack is used.
const SINGLE_CANDIDATE_ALIAS_STACKS: ReadonlyArray<
  [PublicAlias, CanonicalCapabilityRouteId, string]
> = [
  ["codex-explore", "explore.read-only.v1", "gpt-5.6-luna"],
  ["codex-implement", "implement.workspace-write.v1", "gpt-5.5"],
  ["codex-check", "check.read-only.v1", "gpt-5.5"],
  ["opus-explore", "explore.read-only.v1", "opus-4.8"],
  ["opus-implement", "implement.workspace-write.v1", "opus-4.8"],
  ["opus-check", "check.read-only.v1", "opus-4.8"],
  ["composer-implement", "implement.workspace-write.v1", "composer-2.5"],
  ["composer-explore", "explore.read-only.v1", "composer-2.5"],
  ["composer-check", "check.read-only.v1", "composer-2.5"],
  ["grok-explore", "explore.read-only.v1", "grok-4.5"],
  ["grok-implement", "implement.workspace-write.v1", "grok-4.5"],
  ["grok-check", "check.read-only.v1", "grok-4.5"],
  ["kimi-explore", "explore.read-only.v1", "kimi-k3"],
  ["kimi-implement", "implement.workspace-write.v1", "kimi-k3"],
  ["kimi-check", "check.read-only.v1", "kimi-k3"],
  ["fable-explore", "explore.read-only.v1", "fable-5"],
  ["fable-implement", "implement.workspace-write.v1", "fable-5"],
  ["fable-check", "check.read-only.v1", "fable-5"],
  ["cursor-fable-explore", "explore.read-only.v1", "cursor-fable-high"],
  ["cursor-fable-implement", "implement.workspace-write.v1", "cursor-fable-high"],
  ["cursor-fable-check", "check.read-only.v1", "cursor-fable-high"],
  ["minimax-explore", "explore.read-only.v1", "minimax-m3"],
  ["minimax-implement", "implement.workspace-write.v1", "minimax-m3"],
  ["minimax-check", "check.read-only.v1", "minimax-m3"],
  ["terra-implement", "implement.workspace-write.v1", "gpt-5.6-terra"],
  ["sol-explore", "explore.read-only.v1", "gpt-5.6-sol"],
  ["sol-check", "check.read-only.v1", "gpt-5.6-sol"],
  ["sol-implement", "implement.workspace-write.v1", "gpt-5.6-sol"],
  ["opus-review", "taste-review.read-only.v1", "opus-4.8"],
];

export const PUBLIC_ALIAS_CANDIDATE_STACKS: readonly PublicAliasCandidateStack[] =
  SINGLE_CANDIDATE_ALIAS_STACKS.map(([publicAlias, route, candidate]) => ({
    publicAlias,
    route,
    policyVersion: "runner-routing-v2",
    candidates: [candidate],
    automaticFallback: false,
  }));

export function candidateStackForRoute(
  route: CanonicalCapabilityRouteId,
  requestedAlias: string | null | undefined,
  workloadClass?: string | null,
): CandidateStack | null {
  const normalizedAlias = requestedAlias?.trim().toLowerCase();
  // Explicit routes pin one candidate. Automatic policy passes null/undefined
  // so the ADR workload/read-only stacks are selected instead.
  const aliasStack = normalizedAlias
    ? PUBLIC_ALIAS_CANDIDATE_STACKS.find(
        (stack) => stack.publicAlias === normalizedAlias && stack.route === route,
      )
    : undefined;
  if (aliasStack) {
    return aliasStack;
  }
  const workload = workloadClass?.trim().toLowerCase() || "default";
  return (
    CANDIDATE_STACKS.find(
      (stack) =>
        stack.route === route &&
        (route !== "implement.workspace-write.v1" ||
          stack.workloadClass === workload),
    ) ?? null
  );
}

// docs/orchestrator/decisions/0004-runner-routing-v2.md places Fable 5 and
// GPT-5.6 Sol as ordinary workers at exact stack and alias positions. They are
// not role-restricted; stack membership is the authorization boundary.

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

function hasVerifiedEvidence(entry: ModelRegistryEntry): boolean {
  if (entry.evidence == null) {
    return false;
  }
  return EVIDENCE_CLAIM_KEYS.every((key) => entry.evidence?.[key].verified);
}

function hasRunnableIdentityFields(entry: ModelRegistryEntry): boolean {
  return (
    entry.providerModelId != null &&
    entry.adapterId != null &&
    entry.adapterVersion != null &&
    entry.authAccountScope != null
  );
}

function matchesGlm(value: string): boolean {
  return /glm/i.test(value);
}

export function validateModelRegistry(
  entries: readonly ModelRegistryEntry[],
  stacks: readonly CandidateStack[],
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  const stableIds = new Map<string, number>();
  for (const entry of entries) {
    stableIds.set(entry.stableId, (stableIds.get(entry.stableId) ?? 0) + 1);
  }
  for (const [stableId, count] of stableIds) {
    if (count > 1) {
      errors.push(
        `${MODEL_REGISTRY_ERROR.DUPLICATE_STABLE_ID}: ${stableId}`,
      );
    }
  }

  const labelOwners = new Map<string, string>();
  for (const entry of entries) {
    const labels = [
      entry.stableId,
      entry.displayName,
      ...entry.aliases,
    ];
    for (const label of labels) {
      const normalized = normalizeLabel(label);
      if (normalized === "") {
        continue;
      }
      const owner = labelOwners.get(normalized);
      if (owner != null && owner !== entry.stableId) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.AMBIGUOUS_ALIAS}: ${label}`,
        );
      } else {
        labelOwners.set(normalized, entry.stableId);
      }
    }
  }

  for (const entry of entries) {
    for (const routeId of entry.routeEligibility) {
      if (!KNOWN_ROUTE_IDS.has(routeId)) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.UNKNOWN_ROUTE_VERSION}: ${entry.stableId} -> ${routeId}`,
        );
      }
    }
    for (const contractId of entry.outputContracts) {
      if (!KNOWN_OUTPUT_CONTRACTS.has(contractId)) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.UNKNOWN_OUTPUT_CONTRACT}: ${entry.stableId} -> ${contractId}`,
        );
      }
    }
  }

  for (const stack of stacks) {
    if (!KNOWN_ROUTE_IDS.has(stack.route)) {
      errors.push(
        `${MODEL_REGISTRY_ERROR.UNKNOWN_ROUTE_VERSION}: stack -> ${stack.route}`,
      );
    }
  }

  for (const entry of entries) {
    for (const sandbox of entry.sandboxPermissionSupport) {
      if (!KNOWN_SANDBOXES.has(sandbox)) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.UNKNOWN_SANDBOX_VALUE}: ${entry.stableId} -> ${sandbox}`,
        );
      }
    }
    for (const routeId of entry.routeEligibility) {
      const route = ROUTE_BY_ID[routeId];
      if (!route) {
        continue;
      }
      if (!entry.sandboxPermissionSupport.includes(route.sandbox)) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.UNSUPPORTED_SANDBOX_CLAIM}: ${entry.stableId} missing sandbox ${route.sandbox} for ${routeId}`,
        );
      }
      if (!entry.outputContracts.includes(route.outputContract)) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.UNSUPPORTED_SANDBOX_CLAIM}: ${entry.stableId} missing output contract ${route.outputContract} for ${routeId}`,
        );
      }
    }
  }

  const entryById = new Map(entries.map((entry) => [entry.stableId, entry]));
  for (const stack of stacks) {
    const seen = new Set<string>();
    for (const candidate of stack.candidates) {
      const candidateEntry = entryById.get(candidate);
      if (!candidateEntry) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.FALLBACK_CYCLE}: unknown candidate ${candidate} in ${stack.route}`,
        );
      } else {
        // Eligibility is a registry claim, distinct from runnability:
        // conditional (not-yet-evidenced) candidates may hold stack positions,
        // but never a model that is not eligible for the route at all. Any
        // remaining role-restricted model is banned from automatic-fallback
        // stacks (Fable/Sol are ordinary workers under ADR 0004).
        if (!candidateEntry.routeEligibility.includes(stack.route)) {
          errors.push(
            `${MODEL_REGISTRY_ERROR.STACK_CANDIDATE_NOT_ELIGIBLE}: ${candidate} in ${stack.route}`,
          );
        }
        if (
          stack.automaticFallback &&
          candidateEntry.roleRestriction != null
        ) {
          errors.push(
            `${MODEL_REGISTRY_ERROR.ROLE_RESTRICTED_AUTOMATIC_FALLBACK}: ${candidate} in ${stack.route}`,
          );
        }
      }
      if (seen.has(candidate)) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.FALLBACK_CYCLE}: duplicate candidate ${candidate} in ${stack.route}`,
        );
      }
      seen.add(candidate);
    }
  }

  for (const entry of entries) {
    if (
      RUNNABLE_MATURITIES.has(entry.maturity) &&
      entry.routeEligibility.length > 0 &&
      (!hasVerifiedEvidence(entry) || !hasRunnableIdentityFields(entry))
    ) {
      errors.push(
        `${MODEL_REGISTRY_ERROR.RUNNABLE_MISSING_EVIDENCE}: ${entry.stableId}`,
      );
    }
  }

  for (const entry of entries) {
    if (
      (entry.maturity === "planned" || entry.maturity === "disabled") &&
      entry.routeEligibility.length > 0
    ) {
      errors.push(
        `${MODEL_REGISTRY_ERROR.PLANNED_ROUTE_ELIGIBLE}: ${entry.stableId}`,
      );
    }
  }

  for (const entry of entries) {
    // Parent-only models are never workers: any route eligibility is rejected.
    if (
      entry.roleRestriction === "parent-only" &&
      entry.routeEligibility.length > 0
    ) {
      errors.push(
        `${MODEL_REGISTRY_ERROR.PARENT_ONLY_ROUTE_ELIGIBLE}: ${entry.stableId}`,
      );
    }
  }

  for (const entry of entries) {
    const glmFields = [
      entry.stableId,
      entry.displayName,
      ...entry.aliases,
    ];
    for (const field of glmFields) {
      if (matchesGlm(field)) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.GLM_EXCLUSION}: ${field}`,
        );
      }
    }
  }
  for (const stack of stacks) {
    for (const candidate of stack.candidates) {
      if (matchesGlm(candidate)) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.GLM_EXCLUSION}: ${candidate}`,
        );
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateShippedModelRegistry(): {
  ok: boolean;
  errors: string[];
} {
  return validateModelRegistry(MODEL_REGISTRY, [
    ...CANDIDATE_STACKS,
    ...PUBLIC_ALIAS_CANDIDATE_STACKS,
  ]);
}
