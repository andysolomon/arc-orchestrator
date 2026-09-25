import { describe, expect, test } from "bun:test";
import {
  CAPABILITY_SNAPSHOT_ERROR,
  CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
  validateCapabilitySnapshot,
  type CapabilitySnapshot,
} from "../plugins/arc-orchestrator/lib/capability-snapshot";

// Injected rather than read from a clock, matching the rule `select()` will be
// held to. Every expiry assertion below moves this value instead of the data,
// which is what makes the freshness rule testable at all.
const NOW_MS = Date.parse("2026-07-25T00:00:00Z");

function baseSnapshot(): CapabilitySnapshot {
  return {
    schemaVersion: CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
    // decision 0005: a retrieval date plus every suite the data draws on.
    snapshotVersion: "2026-07-25+cursorbench.3.2",
    // 0.25 is the coarsest width that still fills bands 0..4 and comfortably
    // clears 2x the +/-6% margins below.
    bandWidth: 0.25,
    rungs: [
      {
        rungId: "opus-5@high",
        stableId: "opus-5",
        effort: "high",
        measurements: [
          {
            axis: "agentic-edit",
            source: "cursorbench.3.2",
            score: 0.667,
            errorMargin: 0.03,
            sampleSize: 113,
            sourceUrl: "https://example.invalid/cursorbench",
            retrievedAt: "2026-07-20",
            expiresAt: "2026-10-20",
            approver: null,
          },
          {
            axis: "taste",
            source: "editorial",
            score: 0.9,
            errorMargin: 0.06,
            sampleSize: null,
            sourceUrl: null,
            retrievedAt: "2026-07-20",
            expiresAt: "2026-10-20",
            approver: "andrew",
          },
        ],
        costPrior: {
          source: "cursorbench.3.2",
          usdPerTask: 3.91,
          outputTokensPerTask: 42000,
          stepsPerTask: 18,
          retrievedAt: "2026-07-20",
        },
        quotaPool: "anthropic",
        priceBand: "$$$",
      },
      {
        // Cursor Grok carries fixed High in its model profile. Composer exposes
        // no generic effort flag, but the semantic rung is still `@high`.
        rungId: "cursor-grok-4.6-high@high",
        stableId: "cursor-grok-4.6-high",
        effort: "high",
        measurements: [
          {
            axis: "agentic-edit",
            source: "cursorbench.3.2",
            score: 0.667,
            errorMargin: 0.03,
            sampleSize: 113,
            sourceUrl: "https://example.invalid/cursorbench",
            retrievedAt: "2026-07-20",
            expiresAt: "2026-10-20",
            approver: null,
          },
        ],
        costPrior: null,
        quotaPool: "cursor",
        priceBand: "$",
      },
    ],
  };
}

function mutated(
  mutate: (snapshot: CapabilitySnapshot) => void,
): CapabilitySnapshot {
  const copy = JSON.parse(JSON.stringify(baseSnapshot())) as CapabilitySnapshot;
  mutate(copy);
  return copy;
}

function validate(value: unknown, nowMs: number = NOW_MS) {
  return validateCapabilitySnapshot(value, { nowMs });
}

function expectRuleError(
  result: { ok: boolean; errors: string[] },
  rule: string,
): void {
  expect(result.ok).toBe(false);
  expect(result.errors.some((error) => error.includes(rule))).toBe(true);
}

describe("capability-snapshot: baseline", () => {
  test("a well-formed snapshot passes with no errors", () => {
    const result = validate(baseSnapshot());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("capability-snapshot: rung identity", () => {
  test("rejects a stableId the registry does not know", () => {
    const result = validate(
      mutated((snapshot) => {
        snapshot.rungs[0]!.stableId = "no-such-model";
        snapshot.rungs[0]!.rungId = "no-such-model@high";
      }),
    );
    expectRuleError(result, CAPABILITY_SNAPSHOT_ERROR.UNKNOWN_STABLE_ID);
  });

  test("rejects an effort outside a fixed model profile", () => {
    const result = validate(
      mutated((snapshot) => {
        snapshot.rungs[1]!.effort = "medium";
        snapshot.rungs[1]!.rungId = "cursor-grok-4.6-high@medium";
      }),
    );
    expectRuleError(result, CAPABILITY_SNAPSHOT_ERROR.EFFORT_UNSUPPORTED);
  });

  test("rejects a duplicate rungId", () => {
    const result = validate(
      mutated((snapshot) => {
        snapshot.rungs[1] = JSON.parse(
          JSON.stringify(snapshot.rungs[0]),
        ) as CapabilitySnapshot["rungs"][number];
      }),
    );
    expectRuleError(result, CAPABILITY_SNAPSHOT_ERROR.DUPLICATE_RUNG_ID);
  });

  test("rejects a rungId that disagrees with its own stableId and effort", () => {
    const result = validate(
      mutated((snapshot) => {
        snapshot.rungs[0]!.rungId = "opus-5@low";
      }),
    );
    expectRuleError(result, CAPABILITY_SNAPSHOT_ERROR.RUNG_ID_MISMATCH);
  });
});

describe("capability-snapshot: band width", () => {
  test("rejects a width narrower than twice the largest error margin", () => {
    const result = validate(
      mutated((snapshot) => {
        snapshot.bandWidth = 0.21;
        snapshot.rungs[0]!.measurements[0]!.errorMargin = 0.2;
      }),
    );
    expectRuleError(
      result,
      CAPABILITY_SNAPSHOT_ERROR.BAND_WIDTH_BELOW_NOISE_FLOOR,
    );
  });

  test("rejects a width that admits a band above the CapabilityBand range", () => {
    // 0.2 satisfies the noise floor at these margins and is still invalid:
    // floor(1 / 0.2) is 5, one past the closed 0..4 union. This is the rule the
    // ADR does not state, and at the margins it cites it is the binding one.
    const result = validate(
      mutated((snapshot) => {
        snapshot.bandWidth = 0.2;
      }),
    );
    expectRuleError(
      result,
      CAPABILITY_SNAPSHOT_ERROR.BAND_WIDTH_EXCEEDS_BAND_RANGE,
    );
    expect(
      result.errors.some((error) =>
        error.includes(CAPABILITY_SNAPSHOT_ERROR.BAND_WIDTH_BELOW_NOISE_FLOOR),
      ),
    ).toBe(false);
  });
});

describe("capability-snapshot: measurement provenance", () => {
  test("rejects an editorial measurement with no approver", () => {
    expectRuleError(
      validate(
        mutated((snapshot) => {
          snapshot.rungs[0]!.measurements[1]!.approver = null;
        }),
      ),
      CAPABILITY_SNAPSHOT_ERROR.EDITORIAL_WITHOUT_APPROVER,
    );
  });

  test("rejects a benchmark source on an axis no suite is authoritative for", () => {
    // No published suite scores taste, so a row claiming one is claiming a
    // measurement that does not exist. Derived from BENCHMARK_AXIS_AUTHORITY
    // rather than asserted separately: taste is editorial-only precisely because
    // nothing is bound to it.
    expectRuleError(
      validate(
        mutated((snapshot) => {
          snapshot.rungs[0]!.measurements[1]!.source = "cursorbench.3.2";
          snapshot.rungs[0]!.measurements[1]!.sampleSize = 113;
          snapshot.rungs[0]!.measurements[1]!.sourceUrl =
            "https://example.invalid/cursorbench";
        }),
      ),
      CAPABILITY_SNAPSHOT_ERROR.AXIS_WITHOUT_BENCHMARK_AUTHORITY,
    );
  });

  test("rejects a suite scoring an axis another suite owns", () => {
    // decision 0005's one-to-one binding. `swe` and `agentic-edit` are different
    // questions, so DeepSWE carries no authority on CursorBench's axis even
    // though both are real suites measuring real coding ability.
    const result = validate(
      mutated((snapshot) => {
        snapshot.rungs[0]!.measurements[0]!.source = "deepswe.v1.1";
        snapshot.snapshotVersion = "2026-07-25+deepswe.v1.1+cursorbench.3.2";
      }),
    );
    expectRuleError(result, CAPABILITY_SNAPSHOT_ERROR.BENCHMARK_AXIS_MISMATCH);
  });

  test("rejects a benchmark measurement with no sourceUrl", () => {
    // The field is nullable for editorial rows, which carry an approver instead.
    // A benchmark row has no such substitute — this is the rule that keeps an
    // unsourced figure from being filed as a measurement.
    expectRuleError(
      validate(
        mutated((snapshot) => {
          snapshot.rungs[0]!.measurements[0]!.sourceUrl = null;
        }),
      ),
      CAPABILITY_SNAPSHOT_ERROR.BENCHMARK_WITHOUT_SOURCE_URL,
    );
    // The editorial row in the baseline already carries `sourceUrl: null` and
    // passes, so both directions are covered.
  });

  test("requires sampleSize on a benchmark row but not on an editorial one", () => {
    expectRuleError(
      validate(
        mutated((snapshot) => {
          snapshot.rungs[0]!.measurements[0]!.sampleSize = null;
        }),
      ),
      CAPABILITY_SNAPSHOT_ERROR.SAMPLE_SIZE_REQUIRED,
    );
    // The editorial row in the baseline already carries `sampleSize: null` and
    // passes, so the asymmetry is covered from both sides.
  });

  test("rejects a cost prior whose provenance is editorial", () => {
    expectRuleError(
      validate(
        mutated((snapshot) => {
          (snapshot.rungs[0]!.costPrior as { source: string }).source =
            "editorial";
        }),
      ),
      CAPABILITY_SNAPSHOT_ERROR.MALFORMED,
    );
  });
});

describe("capability-snapshot: freshness", () => {
  test("rejects a measurement past its own expiresAt", () => {
    expectRuleError(
      validate(baseSnapshot(), Date.parse("2026-11-01T00:00:00Z")),
      CAPABILITY_SNAPSHOT_ERROR.MEASUREMENT_EXPIRED,
    );
  });

  test("rejects an expiry that is not after its retrieval", () => {
    expectRuleError(
      validate(
        mutated((snapshot) => {
          snapshot.rungs[0]!.measurements[0]!.expiresAt = "2026-07-19";
        }),
      ),
      CAPABILITY_SNAPSHOT_ERROR.EXPIRY_NOT_AFTER_RETRIEVAL,
    );
  });

  test("rejects an unparseable date", () => {
    expectRuleError(
      validate(
        mutated((snapshot) => {
          snapshot.rungs[0]!.measurements[0]!.retrievedAt = "last tuesday";
        }),
      ),
      CAPABILITY_SNAPSHOT_ERROR.MALFORMED,
    );
  });
});

describe("capability-snapshot: snapshotVersion pinning", () => {
  test("rejects a version string with no retrieval date", () => {
    expectRuleError(
      validate(
        mutated((snapshot) => {
          snapshot.snapshotVersion = "cursorbench.3.2";
        }),
      ),
      CAPABILITY_SNAPSHOT_ERROR.SNAPSHOT_VERSION_MISSING_DATE,
    );
  });

  test("rejects a version string that does not name a suite the data uses", () => {
    // A date alone is what ADR 0010 explicitly rules out: a suite's task set
    // changes between versions, so a refresh onto a new version would otherwise
    // ship a version string that quietly means something else.
    expectRuleError(
      validate(
        mutated((snapshot) => {
          snapshot.snapshotVersion = "2026-07-25";
        }),
      ),
      CAPABILITY_SNAPSHOT_ERROR.SNAPSHOT_VERSION_UNPINNED_BENCHMARK,
    );
  });

  test("a suite reached only through a costPrior still has to be pinned", () => {
    // The cost axis draws on a benchmark run just as the score axis does, so a
    // snapshot can depend on a suite without any measurement naming it.
    expectRuleError(
      validate(
        mutated((snapshot) => {
          snapshot.rungs[0]!.costPrior!.source = "deepswe.v1.1";
        }),
      ),
      CAPABILITY_SNAPSHOT_ERROR.SNAPSHOT_VERSION_UNPINNED_BENCHMARK,
    );
  });
});

describe("capability-snapshot: hostile input", () => {
  test("reports rather than throws on null", () => {
    const result = validate(null);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("reports rather than throws when field types are wrong throughout", () => {
    // The input is a hand-edited JSON file, not a typechecked literal, so every
    // comparison in the validator has to survive the wrong primitive arriving.
    const result = validate({
      schemaVersion: "1",
      snapshotVersion: 42,
      bandWidth: "wide",
      rungs: [
        "not-a-rung",
        {
          rungId: 1,
          stableId: null,
          effort: "enormous",
          measurements: "several",
          costPrior: 3,
          quotaPool: [],
          priceBand: false,
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(
      result.errors.filter((error) =>
        error.includes(CAPABILITY_SNAPSHOT_ERROR.MALFORMED),
      ).length,
    ).toBeGreaterThan(5);
  });

  test("reports rather than throws when rungs is not an array", () => {
    const result = validate({
      schemaVersion: CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
      snapshotVersion: "v1",
      bandWidth: 0.25,
      rungs: { "opus-5@high": {} },
    });
    expectRuleError(result, CAPABILITY_SNAPSHOT_ERROR.MALFORMED);
  });
});
