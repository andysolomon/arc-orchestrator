// ADR 0010 phases 13.2 and 13.9. Schema and validator for `capability-snapshot.json` — the
// soft-evidence half of the registry/snapshot split. The registry decides what a
// dispatch is *allowed* to do; nothing in this file grants authority. It only
// describes what a well-formed body of evidence looks like, so that `select()`
// (phase 13.4) has something honest to order rungs against.
//
// The shipped snapshot lives at `plugins/orchestrator-core/capability-snapshot.json`
// (phase 13.3). Absence remains a supported state for rollback: ADR 0010's plan is
// "delete the snapshot and revert to authored stacks", so nothing here may assume
// a snapshot exists at runtime until a caller loads one explicitly.
//
// Unlike `validateModelRegistry`, whose argument is a TypeScript literal the
// compiler has already shaped, this validator's argument is parsed JSON. A
// hand-edited file with a string where a number belongs has to produce a named
// error, not a crash inside a comparison, so the entry point takes `unknown` and
// checks structure before it checks meaning.
//
// The provenance rules — which suite is authoritative for which axis, that a
// benchmark row must carry a source URL, and that `snapshotVersion` pins every
// suite the data draws on — come from
// `docs/orchestrator/decisions/0005-benchmark-authority-and-refresh-cadence.md`
// (`benchmark-policy/v1`).

import {
  MODEL_REGISTRY,
  NO_EFFORT_RUNG,
  PRICE_BANDS,
  rungId,
  supportedEffortsFor,
  type ModelRegistryEntry,
  type PriceBand,
  type RungId,
} from "./model-registry";
import { EFFORT_LEVELS, type Effort } from "./trace-schema";

export const CAPABILITY_SNAPSHOT_SCHEMA_VERSION = 1;

// `CapabilityBand` is a closed union rather than an open integer because bands
// are used as bounded-cardinality trace labels. That closure is a constraint on
// `bandWidth`, not only on the band values — see BAND_WIDTH_EXCEEDS_BAND_RANGE.
export const MAX_CAPABILITY_BAND = 4;

export type CapabilityBand = 0 | 1 | 2 | 3 | 4;

export const BENCHMARK_IDS = ["deepswe.v1.1", "cursorbench.3.2"] as const;

export type BenchmarkId = (typeof BENCHMARK_IDS)[number];

export const MEASUREMENT_SOURCES = [...BENCHMARK_IDS, "editorial"] as const;

export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number];

export const CAPABILITY_AXES = [
  "swe", // end-to-end SWE task completion (DeepSWE)
  "agentic-edit", // in-IDE multi-file edit (CursorBench)
  "taste", // UI/UX, API design, copy — editorial only
  "long-context",
] as const;

export type CapabilityAxis = (typeof CAPABILITY_AXES)[number];

// decision 0005 (`benchmark-policy/v1`). Each suite is authoritative for exactly
// one axis and carries no authority on any other, because `swe` and
// `agentic-edit` are different questions rather than two readings of one. This
// map is the whole of that policy in machine-checkable form: everything below is
// derived from it rather than restated.
export const BENCHMARK_AXIS_AUTHORITY: Record<BenchmarkId, CapabilityAxis> = {
  "deepswe.v1.1": "swe",
  "cursorbench.3.2": "agentic-edit",
};

// Falls out of the map above: an axis no suite is bound to has no benchmark
// authority, so a claim on it can only be editorial, where the approver
// requirement is what keeps it accountable. Today that is `taste` (neither suite
// measures it) and `long-context` (neither suite covers it). The reverse
// direction stays allowed — an editorial measurement on a benchmarked axis is a
// legitimate, weaker claim.
const AXES_WITH_BENCHMARK_AUTHORITY: ReadonlySet<CapabilityAxis> = new Set(
  Object.values(BENCHMARK_AXIS_AUTHORITY),
);

export type Measurement = {
  axis: CapabilityAxis;
  source: MeasurementSource;
  score: number; // normalized 0..1
  errorMargin: number; // absolute, same units as score
  sampleSize: number | null; // null only for `editorial`
  sourceUrl: string | null;
  retrievedAt: string; // ISO 8601 date
  expiresAt: string; // ISO 8601 date
  approver: string | null; // required when source is `editorial`
};

// Distinct from ModelRegistryEntry.numericPricing. Per decision 0001, the
// provider's published price list is the sole authority for *unit rates*
// (USD/MTok). A CostPrior is an *observed consumption* prior — how many units a
// rung tends to burn on a task of this shape — and its authority is the named
// benchmark run. Neither substitutes for the other: unit rate x consumption is
// what makes `estimatedUsd` meaningful, and a rung with numericPricing but no
// CostPrior is orderable by band but not by cost.
export type CostPrior = {
  source: BenchmarkId;
  usdPerTask: number;
  outputTokensPerTask: number;
  stepsPerTask: number;
  retrievedAt: string;
};

export type RungSnapshotEntry = {
  rungId: RungId;
  stableId: string; // joins ModelRegistryEntry.stableId
  effort: Effort;
  measurements: Measurement[];
  costPrior: CostPrior | null;
  quotaPool: string | null; // null for pay-per-token billing
  priceBand: PriceBand;
};

export type CapabilitySnapshot = {
  schemaVersion: typeof CAPABILITY_SNAPSHOT_SCHEMA_VERSION;
  snapshotVersion: string; // opaque, monotonic; recorded in every trace
  bandWidth: number; // >= 2 x max errorMargin, and coarse enough for 0..4
  rungs: RungSnapshotEntry[];
};

// Which measurement speaks for a rung on an axis. Decision 0005 binds each suite
// to exactly one axis, so at most one benchmark row can be authoritative here;
// where both a benchmark and an editorial claim exist, the benchmark wins and the
// editorial row remains the weaker fallback. Two rows at the same precedence are
// the policy's same-scope-key conflict, which resolves to capability-unknown.
export function measurementForSnapshotEntry(
  entry: RungSnapshotEntry,
  axis: CapabilityAxis,
): Measurement | null {
  const onAxis = entry.measurements.filter(
    (measurement) => measurement.axis === axis,
  );
  if (onAxis.length === 0) {
    return null;
  }
  const authoritative = onAxis.filter(
    (measurement) =>
      measurement.source !== "editorial" &&
      BENCHMARK_AXIS_AUTHORITY[measurement.source] === axis,
  );
  const tier = authoritative.length > 0 ? authoritative : onAxis;
  return tier.length === 1 ? tier[0]! : null;
}

// The single definition of banding, kept here rather than in `select()` because
// the validator has to check `bandWidth` against the same arithmetic that will
// later consume it. Callers are expected to pass a validated `bandWidth`; the
// result is deliberately unclamped so that an invalid width shows up as an
// out-of-range band rather than being silently folded back into 0..4.
export function bandFor(score: number, bandWidth: number): number {
  return Math.floor(score / bandWidth);
}

export const CAPABILITY_SNAPSHOT_ERROR = {
  MALFORMED: "capability-snapshot: malformed field",
  SCHEMA_VERSION_MISMATCH: "capability-snapshot: unsupported schema version",
  EMPTY_SNAPSHOT_VERSION: "capability-snapshot: empty snapshotVersion",
  UNKNOWN_STABLE_ID: "capability-snapshot: unknown stableId",
  EFFORT_UNSUPPORTED: "capability-snapshot: effort unsupported for stableId",
  DUPLICATE_RUNG_ID: "capability-snapshot: duplicate rungId",
  RUNG_ID_MISMATCH: "capability-snapshot: rungId disagrees with stableId/effort",
  BAND_WIDTH_BELOW_NOISE_FLOOR:
    "capability-snapshot: bandWidth below 2x the largest errorMargin",
  BAND_WIDTH_EXCEEDS_BAND_RANGE:
    "capability-snapshot: bandWidth admits a band above the CapabilityBand range",
  EDITORIAL_WITHOUT_APPROVER:
    "capability-snapshot: editorial measurement without approver",
  BENCHMARK_AXIS_MISMATCH:
    "capability-snapshot: benchmark source on an axis it is not authoritative for",
  AXIS_WITHOUT_BENCHMARK_AUTHORITY:
    "capability-snapshot: benchmark source on an axis no suite is authoritative for",
  BENCHMARK_WITHOUT_SOURCE_URL:
    "capability-snapshot: benchmark measurement without sourceUrl",
  SAMPLE_SIZE_REQUIRED:
    "capability-snapshot: benchmark measurement without sampleSize",
  SNAPSHOT_VERSION_MISSING_DATE:
    "capability-snapshot: snapshotVersion does not pin a retrieval date",
  SNAPSHOT_VERSION_UNPINNED_BENCHMARK:
    "capability-snapshot: snapshotVersion does not pin a benchmark the data uses",
  EXPIRY_NOT_AFTER_RETRIEVAL:
    "capability-snapshot: expiresAt is not after retrievedAt",
  MEASUREMENT_EXPIRED: "capability-snapshot: measurement past expiresAt",
} as const;

export type CapabilitySnapshotValidationOptions = {
  entries?: readonly ModelRegistryEntry[];
  // Injected, never read from a clock here. Structural validity does not change
  // with time, but freshness does, and `select()` is required to be pure for a
  // fixed `nowMs`; a validator that called `Date.now()` would make the same
  // snapshot valid and invalid on different runs of the same test.
  nowMs: number;
};

function describeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformed(
  errors: string[],
  path: string,
  expected: string,
  value: unknown,
): false {
  errors.push(
    `${CAPABILITY_SNAPSHOT_ERROR.MALFORMED}: ${path} expected ${expected}, got ${describeValue(value)}`,
  );
  return false;
}

function requireFiniteNumber(
  errors: string[],
  path: string,
  value: unknown,
): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return malformed(errors, path, "a finite number", value);
  }
  return true;
}

function requireString(
  errors: string[],
  path: string,
  value: unknown,
): value is string {
  if (typeof value !== "string") {
    return malformed(errors, path, "a string", value);
  }
  return true;
}

function requireNullableString(
  errors: string[],
  path: string,
  value: unknown,
): value is string | null {
  if (value !== null && typeof value !== "string") {
    return malformed(errors, path, "a string or null", value);
  }
  return true;
}

function requireMember<T extends string>(
  errors: string[],
  path: string,
  value: unknown,
  allowed: readonly T[],
): value is T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return malformed(errors, path, `one of ${allowed.join(" | ")}`, value);
  }
  return true;
}

// Returns epoch milliseconds so callers can compare without re-parsing. `Date`
// is used only as a parser here; no current time is read from it.
function requireIsoDate(
  errors: string[],
  path: string,
  value: unknown,
): number | null {
  if (!requireString(errors, path, value)) {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    malformed(errors, path, "an ISO 8601 date", value);
    return null;
  }
  return parsed;
}

function validateMeasurement(
  errors: string[],
  path: string,
  value: unknown,
  nowMs: number,
  usedBenchmarks: Set<BenchmarkId>,
): { errorMargin: number | null } {
  if (!isRecord(value)) {
    malformed(errors, path, "an object", value);
    return { errorMargin: null };
  }

  const axisOk = requireMember(
    errors,
    `${path}.axis`,
    value.axis,
    CAPABILITY_AXES,
  );
  const sourceOk = requireMember(
    errors,
    `${path}.source`,
    value.source,
    MEASUREMENT_SOURCES,
  );
  requireNullableString(errors, `${path}.sourceUrl`, value.sourceUrl);
  requireNullableString(errors, `${path}.approver`, value.approver);

  if (requireFiniteNumber(errors, `${path}.score`, value.score)) {
    if (value.score < 0 || value.score > 1) {
      malformed(errors, `${path}.score`, "a normalized 0..1 score", value.score);
    }
  }

  let errorMargin: number | null = null;
  if (requireFiniteNumber(errors, `${path}.errorMargin`, value.errorMargin)) {
    if (value.errorMargin < 0 || value.errorMargin > 1) {
      malformed(
        errors,
        `${path}.errorMargin`,
        "a normalized 0..1 margin",
        value.errorMargin,
      );
    } else {
      errorMargin = value.errorMargin;
    }
  }

  if (value.sampleSize !== null) {
    requireFiniteNumber(errors, `${path}.sampleSize`, value.sampleSize);
  }

  const retrievedAtMs = requireIsoDate(
    errors,
    `${path}.retrievedAt`,
    value.retrievedAt,
  );
  const expiresAtMs = requireIsoDate(
    errors,
    `${path}.expiresAt`,
    value.expiresAt,
  );

  if (retrievedAtMs != null && expiresAtMs != null && expiresAtMs <= retrievedAtMs) {
    errors.push(
      `${CAPABILITY_SNAPSHOT_ERROR.EXPIRY_NOT_AFTER_RETRIEVAL}: ${path} (${String(value.retrievedAt)} -> ${String(value.expiresAt)})`,
    );
  }

  // A measurement that has outlived its own declared shelf life is reported here
  // so the reason is named at the point the data is read. `select()` maps this
  // code to the `snapshot-expired` refusal rather than treating it as a
  // structural defect: the file is well-formed, it is just no longer evidence.
  if (expiresAtMs != null && expiresAtMs < nowMs) {
    errors.push(
      `${CAPABILITY_SNAPSHOT_ERROR.MEASUREMENT_EXPIRED}: ${path} expired ${String(value.expiresAt)}`,
    );
  }

  if (sourceOk && value.source === "editorial") {
    if (value.approver == null || value.approver === "") {
      errors.push(
        `${CAPABILITY_SNAPSHOT_ERROR.EDITORIAL_WITHOUT_APPROVER}: ${path}`,
      );
    }
  } else if (sourceOk) {
    const benchmark = value.source as BenchmarkId;
    usedBenchmarks.add(benchmark);

    // `sampleSize` is null only for editorial claims. A benchmark row without one
    // cannot be checked against the suite it names.
    if (value.sampleSize === null) {
      errors.push(
        `${CAPABILITY_SNAPSHOT_ERROR.SAMPLE_SIZE_REQUIRED}: ${path} (${benchmark})`,
      );
    }

    // decision 0005: the nullable `sourceUrl` exists for editorial rows, which
    // carry an approver instead. A benchmark row has no such substitute, and an
    // unsourced figure is exactly what this policy declines to accept.
    if (value.sourceUrl == null || value.sourceUrl === "") {
      errors.push(
        `${CAPABILITY_SNAPSHOT_ERROR.BENCHMARK_WITHOUT_SOURCE_URL}: ${path} (${benchmark})`,
      );
    }

    if (axisOk) {
      const axis = value.axis as CapabilityAxis;
      const authoritativeAxis = BENCHMARK_AXIS_AUTHORITY[benchmark];
      if (!AXES_WITH_BENCHMARK_AUTHORITY.has(axis)) {
        errors.push(
          `${CAPABILITY_SNAPSHOT_ERROR.AXIS_WITHOUT_BENCHMARK_AUTHORITY}: ${path} (${axis} <- ${benchmark})`,
        );
      } else if (axis !== authoritativeAxis) {
        errors.push(
          `${CAPABILITY_SNAPSHOT_ERROR.BENCHMARK_AXIS_MISMATCH}: ${path} (${benchmark} is authoritative for ${authoritativeAxis}, not ${axis})`,
        );
      }
    }
  }

  return { errorMargin };
}

function validateCostPrior(
  errors: string[],
  path: string,
  value: unknown,
  usedBenchmarks: Set<BenchmarkId>,
): void {
  if (value === null) {
    return;
  }
  if (!isRecord(value)) {
    malformed(errors, path, "an object or null", value);
    return;
  }
  // Deliberately narrower than MeasurementSource: a cost prior is an observed
  // consumption figure from a named benchmark run, so `editorial` is not an
  // available provenance for it.
  if (requireMember(errors, `${path}.source`, value.source, BENCHMARK_IDS)) {
    usedBenchmarks.add(value.source as BenchmarkId);
  }
  requireFiniteNumber(errors, `${path}.usdPerTask`, value.usdPerTask);
  requireFiniteNumber(
    errors,
    `${path}.outputTokensPerTask`,
    value.outputTokensPerTask,
  );
  requireFiniteNumber(errors, `${path}.stepsPerTask`, value.stepsPerTask);
  requireIsoDate(errors, `${path}.retrievedAt`, value.retrievedAt);
}

export function validateCapabilitySnapshot(
  value: unknown,
  options: CapabilitySnapshotValidationOptions,
): { ok: boolean; errors: string[] } {
  const entries = options.entries ?? MODEL_REGISTRY;
  const errors: string[] = [];

  if (!isRecord(value)) {
    malformed(errors, "snapshot", "an object", value);
    return { ok: false, errors };
  }

  if (value.schemaVersion !== CAPABILITY_SNAPSHOT_SCHEMA_VERSION) {
    errors.push(
      `${CAPABILITY_SNAPSHOT_ERROR.SCHEMA_VERSION_MISMATCH}: expected ${CAPABILITY_SNAPSHOT_SCHEMA_VERSION}, got ${JSON.stringify(value.schemaVersion)}`,
    );
  }

  const rawSnapshotVersion = value.snapshotVersion;
  let snapshotVersion: string | null = null;
  if (requireString(errors, "snapshot.snapshotVersion", rawSnapshotVersion)) {
    // Every trace records this string, so an empty one makes a run
    // unattributable to the evidence that produced it.
    if (rawSnapshotVersion.trim() === "") {
      errors.push(CAPABILITY_SNAPSHOT_ERROR.EMPTY_SNAPSHOT_VERSION);
    } else {
      snapshotVersion = rawSnapshotVersion;
    }
  }

  const rawBandWidth = value.bandWidth;
  let bandWidth: number | null = null;
  if (requireFiniteNumber(errors, "snapshot.bandWidth", rawBandWidth)) {
    if (rawBandWidth <= 0) {
      malformed(errors, "snapshot.bandWidth", "a positive number", rawBandWidth);
    } else {
      bandWidth = rawBandWidth;
    }
  }

  if (!Array.isArray(value.rungs)) {
    malformed(errors, "snapshot.rungs", "an array", value.rungs);
    return { ok: false, errors };
  }

  const entryByStableId = new Map(
    entries.map((entry) => [entry.stableId, entry] as const),
  );
  const seenRungIds = new Set<string>();
  const usedBenchmarks = new Set<BenchmarkId>();
  let largestErrorMargin = 0;

  value.rungs.forEach((rung, index) => {
    const path = `snapshot.rungs[${index}]`;
    if (!isRecord(rung)) {
      malformed(errors, path, "an object", rung);
      return;
    }

    const stableIdOk = requireString(errors, `${path}.stableId`, rung.stableId);
    const effortOk = requireMember(
      errors,
      `${path}.effort`,
      rung.effort,
      EFFORT_LEVELS,
    );
    const declaredRungIdOk = requireString(errors, `${path}.rungId`, rung.rungId);
    requireNullableString(errors, `${path}.quotaPool`, rung.quotaPool);
    requireMember(errors, `${path}.priceBand`, rung.priceBand, PRICE_BANDS);

    // The three identity fields are redundant by construction, so they can
    // disagree. Checking them against each other keeps `rungId` usable as the
    // join key it is meant to be.
    if (stableIdOk && effortOk && declaredRungIdOk) {
      const expected = rungId(rung.stableId as string, rung.effort as Effort);
      if (rung.rungId !== expected) {
        errors.push(
          `${CAPABILITY_SNAPSHOT_ERROR.RUNG_ID_MISMATCH}: ${String(rung.rungId)} != ${expected}`,
        );
      }
    }

    if (declaredRungIdOk) {
      if (seenRungIds.has(rung.rungId as string)) {
        errors.push(
          `${CAPABILITY_SNAPSHOT_ERROR.DUPLICATE_RUNG_ID}: ${String(rung.rungId)}`,
        );
      }
      seenRungIds.add(rung.rungId as string);
    }

    if (stableIdOk) {
      const entry = entryByStableId.get(rung.stableId as string);
      if (!entry) {
        errors.push(
          `${CAPABILITY_SNAPSHOT_ERROR.UNKNOWN_STABLE_ID}: ${String(rung.stableId)}`,
        );
      } else if (effortOk) {
        // A rung the runner cannot dispatch is not evidence, it is a claim about
        // a configuration that does not exist. Note what is *not* rejected: a
        // rung whose entry is `planned`, `disabled`, or route-ineligible stays
        // valid. Maturity is a legitimate state for a measured model to be in,
        // and step 2 of the evaluation order filters on it; an unknown stableId
        // or an unforwardable effort, by contrast, can never join anything.
        const supported = supportedEffortsFor(entry);
        const allowed: readonly Effort[] =
          supported.length === 0 ? [NO_EFFORT_RUNG] : supported;
        if (!allowed.includes(rung.effort as Effort)) {
          errors.push(
            `${CAPABILITY_SNAPSHOT_ERROR.EFFORT_UNSUPPORTED}: ${String(rung.stableId)} -> ${String(rung.effort)}`,
          );
        }
      }
    }

    validateCostPrior(errors, `${path}.costPrior`, rung.costPrior, usedBenchmarks);

    if (!Array.isArray(rung.measurements)) {
      malformed(errors, `${path}.measurements`, "an array", rung.measurements);
      return;
    }
    rung.measurements.forEach((measurement, measurementIndex) => {
      const { errorMargin } = validateMeasurement(
        errors,
        `${path}.measurements[${measurementIndex}]`,
        measurement,
        options.nowMs,
        usedBenchmarks,
      );
      if (errorMargin != null && errorMargin > largestErrorMargin) {
        largestErrorMargin = errorMargin;
      }
    });
  });

  if (bandWidth != null) {
    // ADR 0010 section 3: two rungs closer together than the measurement noise
    // are not distinguishable, so a band narrower than the noise it quantizes
    // is ordering on error.
    const noiseFloor = 2 * largestErrorMargin;
    if (bandWidth < noiseFloor) {
      errors.push(
        `${CAPABILITY_SNAPSHOT_ERROR.BAND_WIDTH_BELOW_NOISE_FLOOR}: ${bandWidth} < ${noiseFloor}`,
      );
    }

    // The other end of the window, which ADR 0010 does not state. `CapabilityBand`
    // is closed at 4, and scores are normalized to 0..1, so a width that puts a
    // perfect score above band 4 produces a band the type cannot hold. This is
    // checked against 1.0 rather than the highest score present: the constraint
    // belongs to the type, and a snapshot whose scores merely happen to stay low
    // today would otherwise become invalid the day a better result lands.
    //
    // Worth knowing which of the two rules actually binds. At the +/-2-6% margins
    // ADR 0010 cites, the noise floor asks for >= 0.12 while this rule asks for
    // > 0.2, so in practice the band range is the binding constraint and the
    // noise floor never fires. It is kept because it is the one that scales with
    // the data: a suite reporting +/-15% would push the floor to 0.3 and start
    // rejecting widths this rule accepts.
    if (bandFor(1, bandWidth) > MAX_CAPABILITY_BAND) {
      errors.push(
        `${CAPABILITY_SNAPSHOT_ERROR.BAND_WIDTH_EXCEEDS_BAND_RANGE}: ${bandWidth} yields band ${bandFor(1, bandWidth)} at score 1`,
      );
    }
  }

  // decision 0005. ADR 0010 requires `snapshotVersion` to pin the benchmark
  // version and not only a retrieval date, because a suite's task set changes
  // between versions and a score does not survive the change. The pinned set is
  // checked against the sources the data actually uses rather than a
  // hand-maintained list, so a refresh onto a new suite version fails validation
  // instead of shipping a version string that quietly means something else.
  if (snapshotVersion != null) {
    if (!/\d{4}-\d{2}-\d{2}/.test(snapshotVersion)) {
      errors.push(
        `${CAPABILITY_SNAPSHOT_ERROR.SNAPSHOT_VERSION_MISSING_DATE}: ${snapshotVersion}`,
      );
    }
    for (const benchmark of BENCHMARK_IDS) {
      if (usedBenchmarks.has(benchmark) && !snapshotVersion.includes(benchmark)) {
        errors.push(
          `${CAPABILITY_SNAPSHOT_ERROR.SNAPSHOT_VERSION_UNPINNED_BENCHMARK}: ${benchmark} not named in ${snapshotVersion}`,
        );
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// Validate-and-narrow, for callers that want a typed snapshot out of parsed JSON
// rather than a boolean about one. Phase 13.3 reads the file; this keeps the
// module free of I/O so it stays testable without a fixture on disk.
export function parseCapabilitySnapshot(
  value: unknown,
  options: CapabilitySnapshotValidationOptions,
):
  | { ok: true; snapshot: CapabilitySnapshot }
  | { ok: false; errors: string[] } {
  const result = validateCapabilitySnapshot(value, options);
  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }
  return { ok: true, snapshot: value as CapabilitySnapshot };
}
