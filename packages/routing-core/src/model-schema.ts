// Model registry schema: the hard-eligibility half of the registry/snapshot
// split (ADR 0010 section 2). The runtime's `MODEL_REGISTRY` literal is an
// array of `ModelDefinition`; the control plane consumes the same rows from the
// exported `model-registry.json`.

import type { CanonicalCapabilityRouteId, OutputContractId } from "./capability-routes";
import {
  EFFORT_LEVELS,
  type Backend,
  type Effort,
  type ModelMaturity,
  type PriceBand,
  type TraceSandbox,
  type TransportBackend,
} from "./vocabulary";

export const MODEL_REGISTRY_SCHEMA_VERSION = 3;

// ADR 0010 phase 13.1. A rung is `(stableId, effort)` — the unit selection
// operates on.
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
// the runtime's `spawn-adapter.ts`; none is inferred from a model's published
// capabilities.
//
//   codex     `-c model_reasoning_effort=<level>` is forwarded verbatim.
//   kimi      `CLAUDE_CODE_EFFORT_LEVEL` is forwarded; rungs are narrowed per entry.
//   claude    `CLAUDE_CODE_EFFORT_LEVEL` is forwarded from the requested effort.
//   minimax   Same claude-cli binary; ARC Delegate selects low/high/max rungs.
//   composer  `buildComposerCommand` exposes no effort flag.
//   opencode  `buildOpenCodeCommand` exposes no effort flag.
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

export const EVIDENCE_CLAIM_KEYS = [
  "providerAccountAvailability",
  "adapter",
  "route",
  "sandbox",
  "output",
  "cancellation",
  "errorNormalization",
] as const satisfies ReadonlyArray<keyof EvidenceClaims>;

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

export type ModelDefinition = {
  stableId: string;
  family: string | null;
  version: string | null;
  publisher: string | null;
  servingProvider: string | null;
  providerModelId: string | null;
  transportBackend: TransportBackend | null;
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

/** Historical name kept for runtime imports; `ModelDefinition` is the shared term. */
export type ModelRegistryEntry = ModelDefinition;

/** One dispatchable `(stableId, effort)` position, resolved from a registry entry. */
export type ModelRung = {
  rungId: RungId;
  stableId: string;
  effort: Effort;
  backend: Backend | null;
};

// Which `--effort` values are selectable for this entry. An empty result means
// none are; the entry still has exactly one rung, at `@none`.
export function supportedEffortsFor(
  entry: ModelDefinition,
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

/** Efforts a chain may name for this entry: the fixed profile, the ladder, or `none`. */
export function selectableEffortsFor(entry: ModelDefinition): readonly Effort[] {
  if (entry.fixedEffort) {
    return [entry.fixedEffort];
  }
  const supported = supportedEffortsFor(entry);
  return supported.length === 0 ? [NO_EFFORT_RUNG] : supported;
}

export function rungsFor(entry: ModelDefinition): RungId[] {
  if (entry.fixedEffort) {
    return [rungId(entry.stableId, entry.fixedEffort)];
  }
  const efforts = supportedEffortsFor(entry);
  if (efforts.length === 0) {
    return [rungId(entry.stableId, NO_EFFORT_RUNG)];
  }
  return efforts.map((effort) => rungId(entry.stableId, effort));
}

export function dispatchBackendFor(entry: ModelDefinition): Backend | null {
  const backend = entry.transportBackend;
  if (backend == null || backend === "claude-code-parent") {
    return null;
  }
  return backend;
}

export function modelRungsFor(entry: ModelDefinition): ModelRung[] {
  const backend = dispatchBackendFor(entry);
  return rungsFor(entry).map((id) => {
    const parsed = parseRungId(id)!;
    return { rungId: id, stableId: parsed.stableId, effort: parsed.effort, backend };
  });
}

// Backend-level pre-validation for the CLI, derived from the registry rather
// than hardcoded.
export function effortsSupportedOnBackend(
  backend: Backend,
  entries: readonly ModelDefinition[],
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

export function registryIndex(
  entries: readonly ModelDefinition[],
): Map<string, ModelDefinition> {
  return new Map(entries.map((entry) => [entry.stableId, entry] as const));
}

/** Case-insensitive lookup by stable id, display name, alias, or provider model id. */
export function registryLabelIndex(
  entries: readonly ModelDefinition[],
): Map<string, ModelDefinition> {
  const index = new Map<string, ModelDefinition>();
  for (const entry of entries) {
    for (const label of [entry.stableId, entry.displayName, ...entry.aliases]) {
      const normalized = label.trim().toLowerCase();
      if (normalized !== "") {
        index.set(normalized, entry);
      }
    }
    if (entry.providerModelId) {
      index.set(entry.providerModelId.trim().toLowerCase(), entry);
    }
  }
  return index;
}

export function findModel(
  entries: readonly ModelDefinition[],
  label: string,
): ModelDefinition | null {
  return registryLabelIndex(entries).get(label.trim().toLowerCase()) ?? null;
}

export function hasVerifiedEvidence(entry: ModelDefinition): boolean {
  if (entry.evidence == null) {
    return false;
  }
  // Account availability is learned at dispatch; unverified is not unavailable.
  return EVIDENCE_CLAIM_KEYS.every((key) =>
    key === "providerAccountAvailability" || entry.evidence?.[key].verified
  );
}

export function hasRunnableIdentityFields(entry: ModelDefinition): boolean {
  return (
    entry.providerModelId != null &&
    entry.adapterId != null &&
    entry.adapterVersion != null &&
    entry.authAccountScope != null
  );
}
