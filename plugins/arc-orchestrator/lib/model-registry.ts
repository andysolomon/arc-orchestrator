// Phase-1 model registry from docs/orchestrator/model-tier-routing-plan.md.
// Typed inventory, candidate stacks, and validation only; nothing here activates selection.

import {
  CAPABILITY_ROUTES,
  type CanonicalCapabilityRouteId,
  type OutputContractId,
  type PublicAlias,
} from "./capability-routes";
import {
  EFFORT_LEVELS,
  PUBLIC_ROUTE_MODEL_BINDINGS,
  PUBLIC_ROUTE_SUFFIXES,
  type Backend,
  type Effort,
  type TaskPhase,
  type TraceSandbox,
} from "./trace-schema";
import { MODEL_POLICY, MODEL_POLICY_SOURCE } from "./model-policy";

export const MODEL_REGISTRY_SCHEMA_VERSION = 3;


// ADR 0010 phase 13.1. A rung is `(stableId, effort)` — the unit selection will
// operate on once phase 13.4 lands. Nothing here changes selection yet.
export type RungId = string;

export const NO_EFFORT_RUNG: Effort = "none";

export function rungId(stableId: string, effort: Effort): RungId {
  return `${stableId}@${effort}`;
}

export function parseRungId(
  id: string,
): { stableId: string; effort: Effort } | null {
  const at = id.lastIndexOf("@");
  if (at <= 0 || at === id.length - 1) {
    return null;
  }
  const stableId = id.slice(0, at);
  const effort = id.slice(at + 1);
  if (!EFFORT_LEVELS.includes(effort as Effort)) {
    return null;
  }
  return { stableId, effort: effort as Effort };
}

// Effort control is a property of the transport adapter, not of the model, so it
// is keyed by backend and overridable per entry. Every claim below is read off
// `spawn-adapter.ts`; none is inferred from a model's published capabilities.
//
//   codex     `-c model_reasoning_effort=<level>` is forwarded verbatim, so the
//             whole ladder is selectable.
//   kimi      `CLAUDE_CODE_EFFORT_LEVEL` defaults to "max" in the worker env and
//             the transport would forward any level, but the rung is pinned here:
//             kimi-k3's only benchmark coverage is a max-effort row, so every
//             other level is an unmeasured claim. This is a data limit, not a
//             transport limit, and it lifts when the snapshot covers the ladder.
//   claude    `CLAUDE_CODE_EFFORT_LEVEL` is forwarded from the requested effort
//             (phase 13.1b). Verified against Claude CLI 2.1.220 on 2026-07-25:
//             the env var accepts all six levels and rejects anything else with a
//             hard execution error, so a bad level can never be silently downgraded
//             to the default.
//   minimax   Same claude-cli binary. ARC Delegate policy explicitly selects
//             low/high/max rungs and the adapter forwards them through
//             CLAUDE_CODE_EFFORT_LEVEL.
//   composer  `buildComposerCommand` exposes no effort flag.
//   opencode  `buildOpenCodeCommand` exposes no effort flag, for kimi-k3 and
//             every opencode-go/* identity alike; each has one `@none` rung.
//
// An empty list means no effort is selectable. Such a model still has exactly one
// rung, named `<stableId>@none`.
export const BACKEND_SUPPORTED_EFFORTS: Record<Backend, readonly Effort[]> = {
  codex: EFFORT_LEVELS,
  kimi: EFFORT_LEVELS,
  claude: EFFORT_LEVELS,
  minimax: EFFORT_LEVELS,
  composer: [],
  opencode: [],
};

export type ModelMaturity =
  "planned" | "experimental" | "available" | "deprecated" | "disabled";

// Ordered most to least expensive. Given a runtime form for the same reason
// EFFORT_LEVELS has one: the capability snapshot is JSON, so its validator needs
// to check a parsed string against the set rather than trust a type annotation.
export const PRICE_BANDS = ["premium", "$$$", "$$", "$", "very-cheap"] as const;

export type PriceBand = (typeof PRICE_BANDS)[number];

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
  // Overrides BACKEND_SUPPORTED_EFFORTS when a specific model's adapter path
  // differs from its transport's default. Omit to inherit the backend default.
  supportedEfforts?: readonly Effort[];
  // Composer exposes no generic effort flag. Cursor model profiles that bake
  // an effort into the model identity declare it here so a candidate rung can
  // still record the real profile effort without forwarding a fake flag.
  fixedEffort?: Effort;
};

// Which `--effort` values are selectable for this entry. An empty result means
// none are; the entry still has exactly one rung, at `@none`.
export function supportedEffortsFor(
  entry: ModelRegistryEntry,
): readonly Effort[] {
  if (entry.supportedEfforts) {
    return entry.supportedEfforts;
  }
  if (
    entry.transportBackend == null ||
    entry.transportBackend === "claude-code-parent"
  ) {
    return [];
  }
  return BACKEND_SUPPORTED_EFFORTS[entry.transportBackend] ?? [];
}

export function rungsFor(entry: ModelRegistryEntry): RungId[] {
  if (entry.fixedEffort) {
    return [rungId(entry.stableId, entry.fixedEffort)];
  }
  const efforts = supportedEffortsFor(entry);
  if (efforts.length === 0) {
    return [rungId(entry.stableId, NO_EFFORT_RUNG)];
  }
  return efforts.map((effort) => rungId(entry.stableId, effort));
}

// Backend-level pre-validation for the CLI, derived from the registry rather
// than hardcoded. The precise per-model check belongs to select() in phase 13.4.
export function effortsSupportedOnBackend(
  backend: Backend,
  entries: readonly ModelRegistryEntry[] = MODEL_REGISTRY,
): Effort[] {
  const supported = new Set<Effort>();
  for (const entry of entries) {
    if (entry.transportBackend !== backend) {
      continue;
    }
    for (const effort of supportedEffortsFor(entry)) {
      supported.add(effort);
    }
  }
  return EFFORT_LEVELS.filter((effort) => supported.has(effort));
}

// One ordered position in a v4 candidate stack: `(stableId, effort)`. The same
// model may legitimately hold two rungs at different efforts (for example
// `opus-5@high` and `opus-5@low` in easy-heavy). Effort `none` means the
// transport exposes no generic effort flag (Composer/Cursor models); any fixed
// effort those models run at is carried by the model profile id itself and is
// never pretended to be a forwarded flag.
export type CandidateRung = { stableId: string; effort: Effort };
// Compatibility name for older internal imports. CandidateRung is the public
// v4 term and the authoritative identity is stableId+effort.
export type StackRung = CandidateRung;

export type CandidateStack = {
  route: CanonicalCapabilityRouteId;
  policyVersion: "runner-routing-v4";
  candidates: string[];
  phase?: TaskPhase;
  candidateEfforts?: Partial<Record<string, Effort>>;
  // Authoritative ordered traversal for runner-routing-v4. `candidates` and
  // `candidateEfforts` are stableId-keyed derived views kept for trace and
  // contract consumers; when `rungs` is present it owns order and efforts.
  rungs?: readonly CandidateRung[];
  automaticFallback: boolean;
  workloadClass?: string;
};

export function stackRungs(stack: CandidateStack): CandidateRung[] {
  if (stack.rungs) {
    return [...stack.rungs];
  }
  return stack.candidates.map((stableId) => ({
    stableId,
    effort: stack.candidateEfforts?.[stableId] ?? NO_EFFORT_RUNG,
  }));
}

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
  GLM_PROVIDER_BOUNDARY:
    "model-registry: glm provider boundary violated",
  UNKNOWN_EFFORT_LEVEL: "model-registry: unknown effort level",
  DUPLICATE_EFFORT_LEVEL: "model-registry: duplicate effort level",
  EFFORT_UNSUPPORTED_BY_BACKEND:
    "model-registry: effort override exceeds backend adapter support",
  DUPLICATE_RUNG: "model-registry: duplicate rung in stack",
} as const;

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

const KNOWN_ROUTE_IDS = new Set(CAPABILITY_ROUTES.map((route) => route.id));

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

// OpenCode Go provider-qualified identities (arc-pi
// docs/arc-model-update-08-30-26.md, 2026-08-31 expansion). Every entry rides
// the same `opencode` transport and adapter path already verified for
// `kimi-k3`: `buildOpenCodeCommand` forwards `--model <providerModelId>` and
// the mode-specific permission boundary, and exposes no effort flag, so each
// identity has exactly one `@none` rung. The stable id mirrors the provider
// id with `/` replaced by `-`, so the two can never drift apart. GLM, which
// model-tier-routing-plan.md excluded because Z.AI was not an integrated
// provider, is now reachable only through these OpenCode Go identities.
export const OPENCODE_GO_SERVING_PROVIDER = "OpenCode Go";

const APPROVED_GLM_PROVIDER_MODEL_ID_PATTERN = /^opencode-go\/glm-[\w.-]+$/;

function labelMatchesGlm(value: string): boolean {
  return /glm/i.test(value);
}

// Identity detection must not depend on cooperative labelling. An entry that
// keeps a non-GLM family, stable id, display name, and alias set still reaches
// GLM weights whenever its provider model id names a GLM model, so the
// provider id is part of the identity surface and triggers the same boundary.
export function isGlmIdentity(entry: ModelRegistryEntry): boolean {
  if (entry.family === "glm") {
    return true;
  }
  return [
    entry.stableId,
    entry.displayName,
    entry.providerModelId ?? "",
    ...entry.aliases,
  ].some(labelMatchesGlm);
}

function isPreservedNonRoutableGlm(entry: ModelRegistryEntry): boolean {
  return (
    isGlmIdentity(entry) &&
    (entry.maturity === "planned" || entry.maturity === "disabled") &&
    entry.routeEligibility.length === 0
  );
}

export function requiresGlmProviderBoundary(entry: ModelRegistryEntry): boolean {
  if (!isGlmIdentity(entry) || isPreservedNonRoutableGlm(entry)) {
    return false;
  }
  return (
    entry.routeEligibility.length > 0 || RUNNABLE_MATURITIES.has(entry.maturity)
  );
}

export function glmProviderBoundaryViolations(
  entry: ModelRegistryEntry,
): string[] {
  if (!requiresGlmProviderBoundary(entry)) {
    return [];
  }
  const violations: string[] = [];
  const prefix = `${MODEL_REGISTRY_ERROR.GLM_PROVIDER_BOUNDARY}: ${entry.stableId}`;
  const providerModelId = entry.providerModelId;
  if (
    providerModelId == null ||
    !APPROVED_GLM_PROVIDER_MODEL_ID_PATTERN.test(providerModelId)
  ) {
    violations.push(
      `${prefix} -> providerModelId must be opencode-go/glm-* (got ${String(providerModelId)})`,
    );
  } else {
    // The stable id mirrors the provider id so the OpenCode Go identity a
    // route pins cannot drift from the model the adapter actually dispatches.
    const expectedStableId = providerModelId.replace("/", "-");
    if (entry.stableId !== expectedStableId) {
      violations.push(
        `${prefix} -> stableId must be ${expectedStableId} for providerModelId ${providerModelId}`,
      );
    }
  }
  if (entry.transportBackend !== "opencode") {
    violations.push(
      `${prefix} -> transportBackend must be opencode (got ${String(entry.transportBackend)})`,
    );
  }
  if (entry.adapterId !== "opencode") {
    violations.push(
      `${prefix} -> adapterId must be opencode (got ${String(entry.adapterId)})`,
    );
  }
  if (entry.servingProvider !== OPENCODE_GO_SERVING_PROVIDER) {
    violations.push(
      `${prefix} -> servingProvider must be ${OPENCODE_GO_SERVING_PROVIDER} (got ${String(entry.servingProvider)})`,
    );
  }
  return violations;
}

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
    aliases: ["GPT-5.6 Luna"],
    displayName: "GPT-5.6 Luna",
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
    aliases: ["GPT-5.6 Sol"],
    displayName: "GPT-5.6 Sol",
    roleRestriction: null,
    evidence: fullEvidence(),
  },
  {
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
    // Taste review moved to opus-5, which supersedes 4.8 on the taste path.
    // 4.8 stays an ADR implement candidate one rung behind opus-5.
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
    // Grok 4.6 High served through Cursor on the Composer transport. Approved
    // runner-routing-v4 identity; obsolete Grok 4.5 identities are rejected
    // rather than silently remapped.
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
    provenance: verifiedProvenance(["cursor-agent models (2026-08-18)"]),
    priceBand: null,
    numericPricing: null,
    aliases: ["Cursor Grok 4.6 High", "grok-4.6", "Grok 4.6"],
    displayName: "Cursor Grok 4.6 High",
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
    // Direct OpenCode identity retained for --backend opencode. Public kimi-*
    // and kimi-k3-* aliases pin cursor-kimi-k3 instead, and this identity is
    // not in v4 automatic stacks.
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
    // Kimi K3 served through Cursor on the Composer transport. Approved
    // runner-routing-v4 emergency-tail identity (stableId cursor-kimi-k3,
    // provider model kimi-k3). Fixed-high behavior is a model-profile fact;
    // the Composer transport forwards no effort flag.
    stableId: "cursor-kimi-k3",
    family: "kimi",
    version: "K3",
    publisher: "Moonshot AI",
    servingProvider: "Cursor",
    providerModelId: "kimi-k3",
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
    provenance: verifiedProvenance(["cursor-agent models (2026-08-18)"]),
    priceBand: null,
    numericPricing: null,
    aliases: ["Cursor Kimi K3"],
    displayName: "Cursor Kimi K3",
    roleRestriction: null,
    evidence: fullEvidence(),
    fixedEffort: "high",
  },
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

// runner-routing-v4 shared emergency tail, appended to every automatic worker
// stack. Composer is terminal. Cursor Kimi K3 runs fixed-high as a model
// profile and MiniMax M3 runs pinned high through its effort-capable
// transport; Composer 2.5 runs at the transport default.
const V4_EMERGENCY_TAIL: ReadonlyArray<readonly [string, Effort]> =
  MODEL_POLICY.emergencyTail.map(policyRung);

// Every automatic rung is authored as `<stableId>@<effort>` in the generated
// policy copy; a malformed rung is a generation bug and fails at load time.
function policyRung(rung: string): readonly [string, Effort] {
  const parsed = parseRungId(rung);
  if (!parsed) {
    throw new Error(`model policy rung "${rung}" is not <stableId>@<effort>`);
  }
  return [parsed.stableId, parsed.effort];
}

function rungList(
  specs: ReadonlyArray<readonly [string, Effort]>,
): StackRung[] {
  return specs.map(([stableId, effort]) => ({ stableId, effort }));
}

function v4Stack(input: {
  route: CanonicalCapabilityRouteId;
  phase?: TaskPhase;
  workloadClass?: string;
  rungs: ReadonlyArray<readonly [string, Effort]>;
}): CandidateStack {
  const rungs = rungList([...input.rungs, ...V4_EMERGENCY_TAIL]);
  const candidates: string[] = [];
  const candidateEfforts: Partial<Record<string, Effort>> = {};
  for (const rung of rungs) {
    if (candidates.includes(rung.stableId)) {
      continue;
    }
    candidates.push(rung.stableId);
    if (rung.effort !== NO_EFFORT_RUNG) {
      candidateEfforts[rung.stableId] = rung.effort;
    }
  }
  return {
    route: input.route,
    policyVersion: "runner-routing-v4",
    ...(input.phase ? { phase: input.phase } : {}),
    ...(input.workloadClass ? { workloadClass: input.workloadClass } : {}),
    candidates,
    ...(Object.keys(candidateEfforts).length > 0 ? { candidateEfforts } : {}),
    rungs,
    automaticFallback: true,
  };
}

// runner-routing-v4 ordered candidate rungs, generated from the authoritative
// arc-model-policy block (arc-pi docs/arc-model-update-08-30-26.md). Canonical
// two-axis workload classes only (difficulty: hard/medium/easy, volume:
// heavy/medium/light). There is no analyze-phase worker stack: Analyze is
// parent-local under v4 and runs on the currently selected parent model
// (default gpt-5.6-sol@high).
const POLICY_PHASE_ROUTES: Readonly<
  Record<keyof typeof MODEL_POLICY.phaseChains, CanonicalCapabilityRouteId>
> = {
  explore: "explore.read-only.v1",
  research: "explore.read-only.v1",
  plan: "explore.read-only.v1",
  verify: "check.read-only.v1",
  deploy: "implement.workspace-write.v1",
};

export const CANDIDATE_STACKS: readonly CandidateStack[] = [
  ...(
    Object.keys(
      MODEL_POLICY.workloadChains,
    ) as (keyof typeof MODEL_POLICY.workloadChains)[]
  ).map((workloadClass) =>
    v4Stack({
      route: "implement.workspace-write.v1",
      phase: "implement",
      workloadClass,
      rungs: MODEL_POLICY.workloadChains[workloadClass].map(policyRung),
    }),
  ),
  ...(
    Object.keys(
      MODEL_POLICY.phaseChains,
    ) as (keyof typeof MODEL_POLICY.phaseChains)[]
  ).map((phase) =>
    v4Stack({
      route: POLICY_PHASE_ROUTES[phase],
      phase,
      rungs: MODEL_POLICY.phaseChains[phase].map(policyRung),
    }),
  ),
  {
    route: "taste-review.read-only.v1",
    policyVersion: "runner-routing-v4",
    candidates: ["opus-5"],
    automaticFallback: false,
  },
];

// Explicit diagnostic aliases pin exactly one candidate: an explicit route
// executes its target once and never inherits the automatic workload/ADR
// chains. Automatic selection requests a canonical route alias for route-id
// resolution but passes a null alias here so the full ADR stack is used.
const SINGLE_CANDIDATE_ALIAS_STACKS: ReadonlyArray<
  [PublicAlias, CanonicalCapabilityRouteId, string, Effort?]
> = [
  ...PUBLIC_ROUTE_MODEL_BINDINGS.flatMap((binding) =>
    PUBLIC_ROUTE_SUFFIXES.map((suffix) => [
      `${binding.base}-${suffix}` as PublicAlias,
      suffix === "explore"
        ? "explore.read-only.v1"
        : suffix === "implement"
          ? "implement.workspace-write.v1"
          : "check.read-only.v1",
      binding.stableId,
      "defaultEffort" in binding ? binding.defaultEffort : undefined,
    ] as [PublicAlias, CanonicalCapabilityRouteId, string, Effort?]),
  ),
  ["opus-review", "taste-review.read-only.v1", "opus-5"],
];

export const PUBLIC_ALIAS_CANDIDATE_STACKS: readonly PublicAliasCandidateStack[] =
  SINGLE_CANDIDATE_ALIAS_STACKS.map(([publicAlias, route, candidate, aliasEffort]) => {
    const effort =
      aliasEffort ??
      MODEL_REGISTRY.find((entry) => entry.stableId === candidate)?.fixedEffort ??
      NO_EFFORT_RUNG;
    return {
      publicAlias,
      route,
      policyVersion: "runner-routing-v4",
      candidates: [candidate],
      ...(effort === NO_EFFORT_RUNG
        ? {}
        : { candidateEfforts: { [candidate]: effort } }),
      rungs: [{ stableId: candidate, effort }],
      automaticFallback: false,
    };
  });

/**
 * Resolve the single model an explicit public alias pins, straight from the
 * registry. Callers that would otherwise restate a model id next to an alias
 * should use this instead: the registry is the one place a stable id is bound
 * to a provider model id, and a second hand-maintained copy is how the eco
 * worker pins silently kept Opus 4.8 through the Opus 5 migration.
 */
export function pinnedModelForAlias(alias: PublicAlias): {
  stableId: string;
  providerModelId: string;
} {
  const stack = PUBLIC_ALIAS_CANDIDATE_STACKS.find(
    (candidate) => candidate.publicAlias === alias,
  );
  if (!stack) {
    throw new Error(`No pinned candidate stack for public alias: ${alias}`);
  }
  const [stableId] = stack.candidates;
  const entry = MODEL_REGISTRY.find((model) => model.stableId === stableId);
  if (!entry) {
    throw new Error(`Public alias ${alias} pins unknown model: ${stableId}`);
  }
  if (!entry.providerModelId) {
    throw new Error(
      `Public alias ${alias} pins ${stableId}, which has no providerModelId`,
    );
  }
  return { stableId, providerModelId: entry.providerModelId };
}

export function candidateStackForRoute(
  route: CanonicalCapabilityRouteId,
  requestedAlias: string | null | undefined,
  workloadClass?: string | null,
  phase?: TaskPhase | null,
): CandidateStack | null {
  const normalizedAlias = requestedAlias?.trim().toLowerCase();
  // Explicit routes pin one candidate. Automatic policy passes null/undefined
  // so the ADR workload/read-only stacks are selected instead.
  const aliasStack = normalizedAlias
    ? PUBLIC_ALIAS_CANDIDATE_STACKS.find(
        (stack) =>
          stack.publicAlias === normalizedAlias && stack.route === route,
      )
    : undefined;
  if (aliasStack) {
    return aliasStack;
  }
  // v4 has no default implement class: automatic implement selection without a
  // canonical workload class resolves to no stack and the caller fails closed.
  const workload = workloadClass?.trim().toLowerCase() || null;
  const resolvedPhase =
    phase ??
    (route === "check.read-only.v1"
      ? "verify"
      : route === "implement.workspace-write.v1"
        ? "implement"
        : "explore");
  return (
    CANDIDATE_STACKS.find(
      (stack) =>
        stack.route === route &&
        (stack.phase === resolvedPhase || stack.phase == null) &&
        (resolvedPhase !== "implement" || stack.workloadClass === workload),
    ) ?? null
  );
}

// The current policy places Fable 5.1 and GPT-5.6 Sol as ordinary workers at
// exact stack and alias positions. They are not role-restricted; stack
// membership is the authorization boundary. The disabled Fable 5 entry remains
// solely so historical benchmark snapshots retain their original identity.

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
      errors.push(`${MODEL_REGISTRY_ERROR.DUPLICATE_STABLE_ID}: ${stableId}`);
    }
  }

  const labelOwners = new Map<string, string>();
  for (const entry of entries) {
    const labels = [entry.stableId, entry.displayName, ...entry.aliases];
    for (const label of labels) {
      const normalized = normalizeLabel(label);
      if (normalized === "") {
        continue;
      }
      const owner = labelOwners.get(normalized);
      if (owner != null && owner !== entry.stableId) {
        errors.push(`${MODEL_REGISTRY_ERROR.AMBIGUOUS_ALIAS}: ${label}`);
      } else {
        labelOwners.set(normalized, entry.stableId);
      }
    }
  }

  for (const entry of entries) {
    const declared = entry.supportedEfforts;
    if (declared) {
      const seen = new Set<Effort>();
      for (const effort of declared) {
        if (!EFFORT_LEVELS.includes(effort)) {
          errors.push(
            `${MODEL_REGISTRY_ERROR.UNKNOWN_EFFORT_LEVEL}: ${entry.stableId} -> ${effort}`,
          );
          continue;
        }
        if (seen.has(effort)) {
          errors.push(
            `${MODEL_REGISTRY_ERROR.DUPLICATE_EFFORT_LEVEL}: ${entry.stableId} -> ${effort}`,
          );
        }
        seen.add(effort);
      }
      // An override may narrow what the adapter can do, never widen it: the
      // runner cannot forward a level its transport has no flag for.
      const backend = entry.transportBackend;
      const adapterSupport =
        backend == null || backend === "claude-code-parent"
          ? []
          : (BACKEND_SUPPORTED_EFFORTS[backend] ?? []);
      for (const effort of declared) {
        if (
          EFFORT_LEVELS.includes(effort) &&
          !adapterSupport.includes(effort)
        ) {
          errors.push(
            `${MODEL_REGISTRY_ERROR.EFFORT_UNSUPPORTED_BY_BACKEND}: ${entry.stableId} -> ${effort}`,
          );
        }
      }
    }

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
    if (stack.rungs) {
      const seenRungs = new Set<string>();
      const candidateSet = new Set(stack.candidates);
      for (const rung of stack.rungs) {
        const key = rungId(rung.stableId, rung.effort);
        if (seenRungs.has(key)) {
          errors.push(
            `${MODEL_REGISTRY_ERROR.DUPLICATE_RUNG}: ${key} in ${stack.route}/${stack.phase ?? "unphased"}`,
          );
        }
        seenRungs.add(key);
        if (!candidateSet.has(rung.stableId)) {
          errors.push(
            `${MODEL_REGISTRY_ERROR.FALLBACK_CYCLE}: rung ${key} names a model missing from candidates in ${stack.route}`,
          );
        }
        if (!EFFORT_LEVELS.includes(rung.effort)) {
          errors.push(
            `${MODEL_REGISTRY_ERROR.UNKNOWN_EFFORT_LEVEL}: ${key} in ${stack.route}`,
          );
          continue;
        }
        const rungEntry = entryById.get(rung.stableId);
        if (
          rungEntry &&
          rung.effort !== NO_EFFORT_RUNG &&
          rungEntry.fixedEffort !== rung.effort &&
          !supportedEffortsFor(rungEntry).includes(rung.effort)
        ) {
          errors.push(
            `${MODEL_REGISTRY_ERROR.EFFORT_UNSUPPORTED_BY_BACKEND}: ${key}`,
          );
        }
      }
    }
    const seen = new Set<string>();
    for (const [candidate, effort] of Object.entries(
      stack.candidateEfforts ?? {},
    )) {
      if (!stack.candidates.includes(candidate)) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.UNKNOWN_EFFORT_LEVEL}: ${candidate} is not in ${stack.route}/${stack.phase ?? "unphased"}`,
        );
        continue;
      }
      const candidateEntry = entryById.get(candidate);
      if (
        candidateEntry &&
        candidateEntry.fixedEffort !== effort &&
        !supportedEffortsFor(candidateEntry).includes(effort)
      ) {
        errors.push(
          `${MODEL_REGISTRY_ERROR.EFFORT_UNSUPPORTED_BY_BACKEND}: ${candidate} -> ${effort}`,
        );
      }
    }
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
        if (stack.automaticFallback && candidateEntry.roleRestriction != null) {
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
    errors.push(...glmProviderBoundaryViolations(entry));
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
  policy: typeof MODEL_POLICY = MODEL_POLICY,
): string[] {
  const errors: string[] = [];
  const byStableId = new Map(entries.map((entry) => [entry.stableId, entry]));
  for (const binding of policy.routeBindings) {
    const entry = byStableId.get(binding.stableId);
    if (!entry) {
      errors.push(
        `policy binding ${binding.base} pins ${binding.stableId}, which is not in the registry`,
      );
      continue;
    }
    if (entry.providerModelId !== binding.providerModelId) {
      errors.push(
        `policy binding ${binding.base}: registry providerModelId ${String(entry.providerModelId)} != policy ${binding.providerModelId}`,
      );
    }
    if (entry.transportBackend !== binding.backend) {
      errors.push(
        `policy binding ${binding.base}: registry backend ${String(entry.transportBackend)} != policy ${binding.backend}`,
      );
    }
    if (entry.maturity !== "available") {
      errors.push(
        `policy binding ${binding.base}: ${binding.stableId} is ${entry.maturity}, not available`,
      );
    }
    const surface = (
      policy.surfaces as Record<
        string,
        { name: string; fixedEffort: string | null } | undefined
      >
    )[binding.stableId];
    if (!surface) {
      errors.push(`policy binding ${binding.base}: no surface for ${binding.stableId}`);
    } else if ((entry.fixedEffort ?? null) !== surface.fixedEffort) {
      errors.push(
        `policy surface ${binding.stableId}: registry fixedEffort ${String(entry.fixedEffort ?? null)} != policy ${String(surface.fixedEffort)}`,
      );
    }
    if ("defaultEffort" in binding) {
      const selectable = entry.fixedEffort
        ? [entry.fixedEffort]
        : supportedEffortsFor(entry);
      if (!selectable.includes(binding.defaultEffort as Effort)) {
        errors.push(
          `policy binding ${binding.base}: default effort ${binding.defaultEffort} is not selectable on ${binding.stableId}`,
        );
      }
    }
  }
  for (const stableId of Object.keys(policy.surfaces)) {
    if (!policy.routeBindings.some((binding) => binding.stableId === stableId)) {
      errors.push(`policy surface ${stableId} has no binding`);
    }
  }
  for (const stableId of policy.excludedModels) {
    for (const stack of CANDIDATE_STACKS) {
      if (stack.automaticFallback && stack.candidates.includes(stableId)) {
        errors.push(
          `excluded model ${stableId} appears in automatic stack ${stack.route}/${stack.phase ?? "-"}/${stack.workloadClass ?? "-"}`,
        );
      }
    }
  }
  return errors;
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
