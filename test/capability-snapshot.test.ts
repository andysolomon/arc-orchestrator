import { describe, expect, test } from "bun:test";
import {
  bandFor,
  CAPABILITY_SNAPSHOT_ERROR,
  CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
  MAX_CAPABILITY_BAND,
  parseCapabilitySnapshot,
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
    snapshotVersion: "test-2026-07-25",
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
        // grok-4.5 rides the composer transport, which exposes no effort flag,
        // so its single rung is named `@none`.
        rungId: "grok-4.5@none",
        stableId: "grok-4.5",
        effort: "none",
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

  test("parse narrows a valid snapshot and reports errors otherwise", () => {
    const parsed = parseCapabilitySnapshot(baseSnapshot(), { nowMs: NOW_MS });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.snapshot.rungs[0]?.rungId).toBe("opus-5@high");
    }

    const rejected = parseCapabilitySnapshot(
      mutated((snapshot) => {
        snapshot.rungs[0]!.stableId = "no-such-model";
      }),
      { nowMs: NOW_MS },
    );
    expect(rejected.ok).toBe(false);
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

  test("rejects an effort the transport cannot forward", () => {
    // grok-4.5 is a composer entry; `buildComposerCommand` has no effort flag,
    // so a `@high` rung claims a dispatch that cannot be produced.
    const result = validate(
      mutated((snapshot) => {
        snapshot.rungs[1]!.effort = "high";
        snapshot.rungs[1]!.rungId = "grok-4.5@high";
      }),
    );
    expectRuleError(result, CAPABILITY_SNAPSHOT_ERROR.EFFORT_UNSUPPORTED);
  });

  test("`none` is accepted both as a real level and as the no-effort rung name", () => {
    // The same literal means two different things depending on the entry, and
    // both have to validate: for opus-5 it is a level the Claude CLI accepts,
    // for grok-4.5 it is the name of the single rung a model with no effort
    // control gets. The baseline covers grok; this covers opus-5.
    const result = validate(
      mutated((snapshot) => {
        snapshot.rungs[0]!.effort = "none";
        snapshot.rungs[0]!.rungId = "opus-5@none";
      }),
    );
    expect(result.errors).toEqual([]);
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

  test("does not reject a rung whose entry is planned or route-ineligible", () => {
    // Deliberate restraint. Maturity is a legitimate state for a measured model
    // to be in, and the hard filter in the evaluation order is what excludes it
    // from dispatch. Rejecting it here would make the snapshot a second
    // eligibility authority, which is the split ADR 0010 exists to prevent.
    const result = validate(
      mutated((snapshot) => {
        snapshot.rungs[1]!.stableId = "haiku-4.5";
        snapshot.rungs[1]!.rungId = "haiku-4.5@none";
      }),
    );
    expect(result.errors).toEqual([]);
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

  test("0.25 is the narrowest width that keeps a perfect score inside band 4", () => {
    expect(bandFor(1, 0.25)).toBe(MAX_CAPABILITY_BAND);
    expect(bandFor(1, 0.2)).toBe(MAX_CAPABILITY_BAND + 1);
    expect(bandFor(0.667, 0.25)).toBe(2);
    expect(bandFor(0, 0.25)).toBe(0);
  });

  test("rejects a non-positive width", () => {
    expectRuleError(
      validate(
        mutated((snapshot) => {
          snapshot.bandWidth = 0;
        }),
      ),
      CAPABILITY_SNAPSHOT_ERROR.MALFORMED,
    );
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

  test("rejects a benchmark source on an editorial-only axis", () => {
    // No published suite scores taste, so a row claiming one is claiming a
    // measurement that does not exist.
    expectRuleError(
      validate(
        mutated((snapshot) => {
          snapshot.rungs[0]!.measurements[1]!.source = "cursorbench.3.2";
          snapshot.rungs[0]!.measurements[1]!.sampleSize = 113;
        }),
      ),
      CAPABILITY_SNAPSHOT_ERROR.BENCHMARK_ON_EDITORIAL_ONLY_AXIS,
    );
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

  test("rejects an unknown price band", () => {
    expectRuleError(
      validate(
        mutated((snapshot) => {
          (snapshot.rungs[0] as { priceBand: string }).priceBand = "cheapish";
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

  test("the same bytes are valid before expiry and invalid after", () => {
    // Expiry is the one rule whose verdict depends on an input other than the
    // file, so this pins the dependency to the injected clock rather than to a
    // hidden one. A validator calling Date.now() would make one of these two
    // assertions fail with the passage of time.
    const snapshot = baseSnapshot();
    expect(validate(snapshot, Date.parse("2026-10-19T00:00:00Z")).ok).toBe(true);
    expect(validate(snapshot, Date.parse("2026-10-21T00:00:00Z")).ok).toBe(false);
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

describe("capability-snapshot: hostile input", () => {
  test("rejects a schema version it cannot read", () => {
    expectRuleError(
      validate(
        mutated((snapshot) => {
          (snapshot as { schemaVersion: number }).schemaVersion = 2;
        }),
      ),
      CAPABILITY_SNAPSHOT_ERROR.SCHEMA_VERSION_MISMATCH,
    );
  });

  test("rejects an empty snapshotVersion", () => {
    expectRuleError(
      validate(
        mutated((snapshot) => {
          snapshot.snapshotVersion = "   ";
        }),
      ),
      CAPABILITY_SNAPSHOT_ERROR.EMPTY_SNAPSHOT_VERSION,
    );
  });

  test.each([
    ["null", null],
    ["an array", []],
    ["a string", "capability-snapshot"],
    ["a number", 7],
  ])("reports rather than throws on %s", (_label, value) => {
    const result = validate(value);
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
