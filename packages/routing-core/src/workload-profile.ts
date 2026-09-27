// Workload Profiler: turns observable execution evidence into a difficulty x
// volume classification, i.e. one of the nine runner-routing-v4 workload
// classes, with an explanation a human can check against the thresholds.
//
// Design rules:
//   * Deterministic decision tables, not scores. Every signal names the
//     threshold that fired, and the classification is the max tier any signal
//     reached on its axis.
//   * Missing evidence is "not observed", never "zero". A field the caller did
//     not supply produces no signal; the coverage report says what was seen.
//     A caller that supplies neither scope nor change evidence has not
//     profiled anything, and `hasSufficientEvidence` says so.
//   * Nothing here reads a clock, the environment, the filesystem, or a model.
//     The profiler consumes facts the orchestrator already observed.

import {
  workloadClassFor,
  type Difficulty,
  type TaskPhase,
  type Volume,
  type WorkloadClass,
} from "./vocabulary";

export const WORKLOAD_PROFILE_VERSION = "workload-profile/v1" as const;

export type WorkloadScopeEvidence = {
  relevantFiles?: number;
  packages?: number;
  languages?: number;
  dependencyDepth?: number;
  crossPackage?: boolean;
};

export type WorkloadChangeEvidence = {
  estimatedFiles?: number;
  estimatedLines?: number;
  apiBoundary?: boolean;
  schemaChange?: boolean;
  architectureChange?: boolean;
  authBoundary?: boolean;
  securitySensitive?: boolean;
  concurrency?: boolean;
  distributedState?: boolean;
  unfamiliarFramework?: boolean;
  crossLanguage?: boolean;
  unclearOwnership?: boolean;
};

export type WorkloadExecutionEvidence = {
  attempts?: number;
  previousFailures?: number;
  failingTests?: number;
  toolCalls?: number;
  testSurface?: number;
  independentWorkstreams?: number;
};

export type WorkloadSessionEvidence = {
  tokens?: number;
  cachedTokens?: number;
  existingModel?: string | null;
};

export type WorkloadEvidence = {
  phase?: TaskPhase | null;
  scope?: WorkloadScopeEvidence | null;
  change?: WorkloadChangeEvidence | null;
  execution?: WorkloadExecutionEvidence | null;
  session?: WorkloadSessionEvidence | null;
};

export type WorkloadAxis = "difficulty" | "volume";

export type WorkloadSignal = {
  axis: WorkloadAxis;
  // Tier this single signal argues for on its axis.
  tier: Difficulty | Volume;
  code: string;
  // Human-readable reason in the form used by traces.
  reason: string;
  // The evidence field(s) the rule read, for UI highlighting.
  fields: string[];
};

export type WorkloadEvidenceCoverage = {
  scope: boolean;
  change: boolean;
  execution: boolean;
  session: boolean;
};

export type WorkloadProfile = {
  version: typeof WORKLOAD_PROFILE_VERSION;
  difficulty: Difficulty;
  volume: Volume;
  workloadClass: WorkloadClass;
  reasons: string[];
  signals: WorkloadSignal[];
  coverage: WorkloadEvidenceCoverage;
  notes: string[];
};

// Thresholds are exported so the control plane can render them next to the
// evidence form and so a test can probe each boundary exactly.
export const WORKLOAD_PROFILE_THRESHOLDS = {
  difficulty: {
    // Two or more medium signals compound into hard.
    mediumSignalsForHard: 2,
    previousFailuresHard: 2,
    previousFailuresMedium: 1,
    dependencyDepthMedium: 3,
    failingTestsMedium: 5,
    // A wide change footprint is itself a difficulty signal: coordination risk.
    estimatedFilesMedium: 8,
  },
  volume: {
    relevantFilesHeavy: 25,
    relevantFilesMedium: 8,
    estimatedFilesHeavy: 12,
    estimatedFilesMedium: 4,
    estimatedLinesHeavy: 800,
    estimatedLinesMedium: 200,
    packagesHeavy: 3,
    packagesMedium: 2,
    workstreamsHeavy: 3,
    workstreamsMedium: 2,
    toolCallsHeavy: 40,
    toolCallsMedium: 15,
    testSurfaceHeavy: 20,
    testSurfaceMedium: 6,
  },
} as const;

const DIFFICULTY_RANK: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 };
const VOLUME_RANK: Record<Volume, number> = { light: 0, medium: 1, heavy: 2 };

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function present(section: object | null | undefined): boolean {
  if (section == null || typeof section !== "object") {
    return false;
  }
  return Object.values(section).some((value) => value !== undefined && value !== null);
}

export function evidenceCoverage(evidence: WorkloadEvidence): WorkloadEvidenceCoverage {
  return {
    scope: present(evidence.scope),
    change: present(evidence.change),
    execution: present(evidence.execution),
    session: present(evidence.session),
  };
}

/** Scope or change evidence is required; execution and session alone describe nothing about the task. */
export function hasSufficientEvidence(evidence: WorkloadEvidence): boolean {
  const coverage = evidenceCoverage(evidence);
  return coverage.scope || coverage.change;
}

function difficultySignals(evidence: WorkloadEvidence): WorkloadSignal[] {
  const T = WORKLOAD_PROFILE_THRESHOLDS.difficulty;
  const scope = evidence.scope ?? {};
  const change = evidence.change ?? {};
  const execution = evidence.execution ?? {};
  const signals: WorkloadSignal[] = [];
  const hard = (code: string, reason: string, fields: string[]) =>
    signals.push({ axis: "difficulty", tier: "hard", code, reason, fields });
  const medium = (code: string, reason: string, fields: string[]) =>
    signals.push({ axis: "difficulty", tier: "medium", code, reason, fields });

  if (change.architectureChange === true) hard("architecture-change", "architecture change flagged", ["change.architectureChange"]);
  if (change.schemaChange === true) hard("schema-change", "schema change or migration flagged", ["change.schemaChange"]);
  if (change.authBoundary === true) hard("auth-boundary", "authentication boundary affected", ["change.authBoundary"]);
  if (change.securitySensitive === true) hard("security-sensitive", "security-sensitive change flagged", ["change.securitySensitive"]);
  if (change.concurrency === true) hard("concurrency", "concurrency behavior affected", ["change.concurrency"]);
  if (change.distributedState === true) hard("distributed-state", "distributed state affected", ["change.distributedState"]);
  if (change.crossLanguage === true) hard("cross-language", "cross-language change", ["change.crossLanguage"]);
  if (isCount(execution.previousFailures) && execution.previousFailures >= T.previousFailuresHard) {
    hard("repeated-failures", `${execution.previousFailures} previous failed implementation attempts`, ["execution.previousFailures"]);
  } else if (isCount(execution.previousFailures) && execution.previousFailures >= T.previousFailuresMedium) {
    medium("previous-failure", "1 previous failed implementation attempt", ["execution.previousFailures"]);
  }

  if (change.apiBoundary === true) medium("api-boundary", "public API boundary affected", ["change.apiBoundary"]);
  if (scope.crossPackage === true) medium("cross-package", "cross-package change", ["scope.crossPackage"]);
  if (change.unfamiliarFramework === true) medium("unfamiliar-framework", "unfamiliar framework boundary", ["change.unfamiliarFramework"]);
  if (change.unclearOwnership === true) medium("unclear-ownership", "unclear ownership boundaries", ["change.unclearOwnership"]);
  if (isCount(scope.dependencyDepth) && scope.dependencyDepth >= T.dependencyDepthMedium) {
    medium("dependency-depth", `dependency depth ${scope.dependencyDepth} (>= ${T.dependencyDepthMedium})`, ["scope.dependencyDepth"]);
  }
  if (isCount(execution.failingTests) && execution.failingTests >= T.failingTestsMedium) {
    medium("failing-tests", `${execution.failingTests} failing tests (>= ${T.failingTestsMedium})`, ["execution.failingTests"]);
  }
  if (isCount(change.estimatedFiles) && change.estimatedFiles >= T.estimatedFilesMedium) {
    medium("wide-footprint", `estimated ${change.estimatedFiles} files modified (>= ${T.estimatedFilesMedium} raises coordination risk)`, ["change.estimatedFiles"]);
  }
  return signals;
}

function volumeSignals(evidence: WorkloadEvidence): WorkloadSignal[] {
  const T = WORKLOAD_PROFILE_THRESHOLDS.volume;
  const scope = evidence.scope ?? {};
  const change = evidence.change ?? {};
  const execution = evidence.execution ?? {};
  const signals: WorkloadSignal[] = [];
  const push = (tier: Volume, code: string, reason: string, fields: string[]) =>
    signals.push({ axis: "volume", tier, code, reason, fields });
  const tiered = (
    value: number | undefined,
    heavyAt: number,
    mediumAt: number,
    code: string,
    describe: (n: number) => string,
    field: string,
  ) => {
    if (!isCount(value)) return;
    if (value >= heavyAt) push("heavy", code, `${describe(value)} (>= ${heavyAt})`, [field]);
    else if (value >= mediumAt) push("medium", code, `${describe(value)} (>= ${mediumAt})`, [field]);
  };

  tiered(scope.relevantFiles, T.relevantFilesHeavy, T.relevantFilesMedium, "relevant-files", (n) => `${n} relevant files`, "scope.relevantFiles");
  tiered(change.estimatedFiles, T.estimatedFilesHeavy, T.estimatedFilesMedium, "estimated-files", (n) => `estimated ${n} files modified`, "change.estimatedFiles");
  tiered(change.estimatedLines, T.estimatedLinesHeavy, T.estimatedLinesMedium, "estimated-lines", (n) => `estimated ${n} lines changed`, "change.estimatedLines");
  tiered(scope.packages, T.packagesHeavy, T.packagesMedium, "packages", (n) => `${n} packages affected`, "scope.packages");
  tiered(execution.independentWorkstreams, T.workstreamsHeavy, T.workstreamsMedium, "workstreams", (n) => `${n} independent workstreams`, "execution.independentWorkstreams");
  tiered(execution.toolCalls, T.toolCallsHeavy, T.toolCallsMedium, "tool-calls", (n) => `${n} tool calls so far (broad traversal)`, "execution.toolCalls");
  tiered(execution.testSurface, T.testSurfaceHeavy, T.testSurfaceMedium, "test-surface", (n) => `${n} tests in the affected surface`, "execution.testSurface");
  return signals;
}

/** Classify. Pure and total: any evidence object yields a profile; use `hasSufficientEvidence` to gate routing on it. */
export function profileWorkload(evidence: WorkloadEvidence): WorkloadProfile {
  const T = WORKLOAD_PROFILE_THRESHOLDS.difficulty;
  const coverage = evidenceCoverage(evidence);
  const difficultyFound = difficultySignals(evidence);
  const volumeFound = volumeSignals(evidence);

  let difficulty: Difficulty = "easy";
  const reasons: string[] = [];
  const notes: string[] = [];

  const hardSignals = difficultyFound.filter((signal) => signal.tier === "hard");
  const mediumSignals = difficultyFound.filter((signal) => signal.tier === "medium");
  if (hardSignals.length > 0) {
    difficulty = "hard";
    reasons.push(...hardSignals.map((signal) => signal.reason));
    if (mediumSignals.length > 0) {
      reasons.push(...mediumSignals.map((signal) => signal.reason));
    }
  } else if (mediumSignals.length >= T.mediumSignalsForHard) {
    difficulty = "hard";
    reasons.push(...mediumSignals.map((signal) => signal.reason));
    reasons.push(`${mediumSignals.length} medium-difficulty signals compound to hard (>= ${T.mediumSignalsForHard})`);
  } else if (mediumSignals.length === 1) {
    difficulty = "medium";
    reasons.push(mediumSignals[0]!.reason);
  } else {
    reasons.push(
      coverage.change || coverage.execution
        ? "no difficulty signals observed"
        : "no change or execution evidence: difficulty defaults to easy",
    );
  }

  let volume: Volume = "light";
  for (const signal of volumeFound) {
    if (VOLUME_RANK[signal.tier as Volume] > VOLUME_RANK[volume]) {
      volume = signal.tier as Volume;
    }
  }
  if (volumeFound.length > 0) {
    // Report the signals that reached the chosen tier first, then the rest.
    const atTier = volumeFound.filter((signal) => signal.tier === volume);
    const below = volumeFound.filter((signal) => signal.tier !== volume);
    reasons.push(...atTier.map((signal) => signal.reason));
    reasons.push(...below.map((signal) => signal.reason));
  } else {
    reasons.push(
      coverage.scope || coverage.change
        ? "no volume signals observed: volume is light"
        : "no scope or change evidence: volume defaults to light",
    );
  }

  const session = evidence.session ?? {};
  if (isCount(session.tokens)) {
    notes.push(`session context ${session.tokens} tokens${isCount(session.cachedTokens) ? ` (${session.cachedTokens} cached)` : ""}; recorded, no classification effect`);
  }
  if (session.existingModel) {
    notes.push(`session model ${session.existingModel}; recorded, no classification effect`);
  }
  if (evidence.phase && evidence.phase !== "implement") {
    notes.push(`phase ${evidence.phase}: workload class only selects implement stacks`);
  }
  if (!hasSufficientEvidence(evidence)) {
    notes.push("insufficient evidence: neither scope nor change evidence was supplied; this profile must not route");
  }

  return {
    version: WORKLOAD_PROFILE_VERSION,
    difficulty,
    volume,
    workloadClass: workloadClassFor(difficulty, volume),
    reasons: [...new Set(reasons)],
    signals: [...difficultyFound, ...volumeFound],
    coverage,
    notes,
  };
}

export function compareDifficulty(a: Difficulty, b: Difficulty): number {
  return DIFFICULTY_RANK[a] - DIFFICULTY_RANK[b];
}

/** Structural check for evidence parsed from JSON: rejects wrong-typed fields with a message per path. */
export function validateWorkloadEvidence(value: unknown): { ok: true; evidence: WorkloadEvidence } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, errors: ["workload evidence must be a JSON object"] };
  }
  const record = value as Record<string, unknown>;
  const sections: Record<string, { counts: string[]; flags: string[] }> = {
    scope: { counts: ["relevantFiles", "packages", "languages", "dependencyDepth"], flags: ["crossPackage"] },
    change: { counts: ["estimatedFiles", "estimatedLines"], flags: ["apiBoundary", "schemaChange", "architectureChange", "authBoundary", "securitySensitive", "concurrency", "distributedState", "unfamiliarFramework", "crossLanguage", "unclearOwnership"] },
    execution: { counts: ["attempts", "previousFailures", "failingTests", "toolCalls", "testSurface", "independentWorkstreams"], flags: [] },
    session: { counts: ["tokens", "cachedTokens"], flags: [] },
  };
  for (const key of Object.keys(record)) {
    if (key !== "phase" && !(key in sections)) {
      errors.push(`unknown evidence section "${key}"`);
    }
  }
  if (record.phase != null && typeof record.phase !== "string") {
    errors.push("phase must be a string");
  }
  for (const [section, shape] of Object.entries(sections)) {
    const body = record[section];
    if (body == null) continue;
    if (typeof body !== "object" || Array.isArray(body)) {
      errors.push(`${section} must be an object`);
      continue;
    }
    for (const [field, fieldValue] of Object.entries(body as Record<string, unknown>)) {
      if (fieldValue == null) continue;
      if (shape.counts.includes(field)) {
        if (!isCount(fieldValue)) errors.push(`${section}.${field} must be a non-negative number`);
      } else if (shape.flags.includes(field)) {
        if (typeof fieldValue !== "boolean") errors.push(`${section}.${field} must be a boolean`);
      } else if (section === "session" && field === "existingModel") {
        if (typeof fieldValue !== "string") errors.push("session.existingModel must be a string");
      } else {
        errors.push(`unknown evidence field ${section}.${field}`);
      }
    }
  }
  return errors.length === 0 ? { ok: true, evidence: record as WorkloadEvidence } : { ok: false, errors };
}
