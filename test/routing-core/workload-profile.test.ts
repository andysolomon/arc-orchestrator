// Table-driven coverage of the Workload Profiler: the nine-class outcomes, the
// exact difficulty and volume boundaries, missing-evidence handling, and the
// evidence validator. Thresholds are read from the exported table so a
// deliberate retune updates these expectations in one place.

import { describe, expect, test } from "bun:test";
import {
  WORKLOAD_PROFILE_THRESHOLDS as T,
  hasSufficientEvidence,
  profileWorkload,
  validateWorkloadEvidence,
  type WorkloadEvidence,
} from "../../packages/routing-core/src/index";

describe("workload profiler: representative tasks", () => {
  const cases: Array<[string, WorkloadEvidence, string, string[]]> = [
    [
      "small isolated style change",
      { scope: { relevantFiles: 2, packages: 1 }, change: { estimatedFiles: 1, estimatedLines: 12 } },
      "easy-light",
      ["no difficulty signals observed"],
    ],
    [
      "single package implementation across many files",
      { scope: { relevantFiles: 18, packages: 1 }, change: { estimatedFiles: 15, estimatedLines: 600 } },
      "medium-heavy",
      ["estimated 15 files modified (>= 8 raises coordination risk)", "estimated 15 files modified (>= 12)"],
    ],
    [
      "authentication change across multiple packages",
      { scope: { relevantFiles: 9, packages: 2, crossPackage: true }, change: { estimatedFiles: 6, authBoundary: true } },
      "hard-medium",
      ["authentication boundary affected", "cross-package change", "2 packages affected (>= 2)"],
    ],
    [
      "schema migration + API boundary + multiple packages",
      { scope: { relevantFiles: 30, packages: 3, crossPackage: true }, change: { estimatedFiles: 12, schemaChange: true, apiBoundary: true } },
      "hard-heavy",
      ["schema change or migration flagged", "public API boundary affected", "3 packages affected (>= 3)"],
    ],
    [
      "two medium signals compound to hard",
      { scope: { crossPackage: true }, change: { estimatedFiles: 3, apiBoundary: true } },
      "hard-light",
      ["2 medium-difficulty signals compound to hard (>= 2)"],
    ],
    [
      "repeated failed attempts escalate difficulty",
      { change: { estimatedFiles: 2 }, execution: { attempts: 3, previousFailures: 2 } },
      "hard-light",
      ["2 previous failed implementation attempts"],
    ],
    [
      "broad exploration with many tool calls is heavy",
      { scope: { relevantFiles: 5 }, execution: { toolCalls: 45 } },
      "easy-heavy",
      ["45 tool calls so far (broad traversal) (>= 40)"],
    ],
    [
      "medium difficulty, medium volume",
      { scope: { relevantFiles: 10, dependencyDepth: 3 }, change: { estimatedFiles: 5 } },
      "medium-medium",
      ["dependency depth 3 (>= 3)", "10 relevant files (>= 8)", "estimated 5 files modified (>= 4)"],
    ],
    [
      "easy-medium: a few files, no risk flags",
      { change: { estimatedFiles: 4, estimatedLines: 90 } },
      "easy-medium",
      ["estimated 4 files modified (>= 4)"],
    ],
  ];

  test.each(cases)("%s → %s", (_label, evidence, expected, reasons) => {
    const profile = profileWorkload(evidence);
    expect(profile.workloadClass).toBe(expected as never);
    for (const reason of reasons) {
      expect(profile.reasons).toContain(reason);
    }
    expect(profile.version).toBe("workload-profile/v1");
  });

  test("every hard flag alone yields hard difficulty", () => {
    for (const flag of ["architectureChange", "schemaChange", "authBoundary", "securitySensitive", "concurrency", "distributedState", "crossLanguage"] as const) {
      const profile = profileWorkload({ change: { [flag]: true } });
      expect(profile.difficulty, flag).toBe("hard");
      expect(profile.volume, flag).toBe("light");
    }
  });
});

describe("workload profiler: exact boundaries", () => {
  test("difficulty: previous failures", () => {
    expect(profileWorkload({ change: { estimatedFiles: 1 }, execution: { previousFailures: 0 } }).difficulty).toBe("easy");
    expect(profileWorkload({ change: { estimatedFiles: 1 }, execution: { previousFailures: T.difficulty.previousFailuresMedium } }).difficulty).toBe("medium");
    expect(profileWorkload({ change: { estimatedFiles: 1 }, execution: { previousFailures: T.difficulty.previousFailuresHard } }).difficulty).toBe("hard");
  });

  test("difficulty: change footprint threshold", () => {
    expect(profileWorkload({ change: { estimatedFiles: T.difficulty.estimatedFilesMedium - 1 } }).difficulty).toBe("easy");
    expect(profileWorkload({ change: { estimatedFiles: T.difficulty.estimatedFilesMedium } }).difficulty).toBe("medium");
  });

  test("difficulty: dependency depth and failing tests", () => {
    expect(profileWorkload({ scope: { dependencyDepth: T.difficulty.dependencyDepthMedium - 1 } }).difficulty).toBe("easy");
    expect(profileWorkload({ scope: { dependencyDepth: T.difficulty.dependencyDepthMedium } }).difficulty).toBe("medium");
    expect(profileWorkload({ scope: { relevantFiles: 1 }, execution: { failingTests: T.difficulty.failingTestsMedium - 1 } }).difficulty).toBe("easy");
    expect(profileWorkload({ scope: { relevantFiles: 1 }, execution: { failingTests: T.difficulty.failingTestsMedium } }).difficulty).toBe("medium");
  });

  test("volume: relevant files, estimated files, packages", () => {
    const V = T.volume;
    expect(profileWorkload({ scope: { relevantFiles: V.relevantFilesMedium - 1 } }).volume).toBe("light");
    expect(profileWorkload({ scope: { relevantFiles: V.relevantFilesMedium } }).volume).toBe("medium");
    expect(profileWorkload({ scope: { relevantFiles: V.relevantFilesHeavy } }).volume).toBe("heavy");
    expect(profileWorkload({ change: { estimatedFiles: V.estimatedFilesMedium - 1 } }).volume).toBe("light");
    expect(profileWorkload({ change: { estimatedFiles: V.estimatedFilesMedium } }).volume).toBe("medium");
    expect(profileWorkload({ change: { estimatedFiles: V.estimatedFilesHeavy } }).volume).toBe("heavy");
    expect(profileWorkload({ scope: { packages: 1 } }).volume).toBe("light");
    expect(profileWorkload({ scope: { packages: V.packagesMedium } }).volume).toBe("medium");
    expect(profileWorkload({ scope: { packages: V.packagesHeavy } }).volume).toBe("heavy");
  });

  test("volume takes the maximum tier across signals", () => {
    const profile = profileWorkload({ scope: { relevantFiles: 9, packages: 3 }, change: { estimatedFiles: 2 } });
    expect(profile.volume).toBe("heavy");
    expect(profile.reasons[0]).toBe("no difficulty signals observed");
  });
});

describe("workload profiler: evidence handling", () => {
  test("missing evidence is not zero: an empty object is easy-light but insufficient", () => {
    const profile = profileWorkload({});
    expect(profile.workloadClass).toBe("easy-light");
    expect(hasSufficientEvidence({})).toBe(false);
    expect(profile.notes.some((note) => note.includes("insufficient evidence"))).toBe(true);
    expect(profile.reasons).toContain("no change or execution evidence: difficulty defaults to easy");
  });

  test("execution-only evidence is insufficient to route", () => {
    expect(hasSufficientEvidence({ execution: { previousFailures: 2 } })).toBe(false);
    expect(hasSufficientEvidence({ change: { estimatedFiles: 1 } })).toBe(true);
    expect(hasSufficientEvidence({ scope: { relevantFiles: 1 } })).toBe(true);
  });

  test("session evidence is recorded as a note and never changes the class", () => {
    const withSession = profileWorkload({ change: { estimatedFiles: 2 }, session: { tokens: 450_000, cachedTokens: 100_000, existingModel: "gpt-6-sol" } });
    const without = profileWorkload({ change: { estimatedFiles: 2 } });
    expect(withSession.workloadClass).toBe(without.workloadClass);
    expect(withSession.notes.join("\n")).toContain("450000 tokens");
    expect(withSession.notes.join("\n")).toContain("gpt-6-sol");
  });

  test("the profile is deterministic for equal evidence", () => {
    const evidence: WorkloadEvidence = { scope: { relevantFiles: 12, packages: 2 }, change: { estimatedFiles: 5, apiBoundary: true }, execution: { previousFailures: 1 } };
    expect(JSON.stringify(profileWorkload(evidence))).toBe(JSON.stringify(profileWorkload(JSON.parse(JSON.stringify(evidence)))));
  });

  test("validateWorkloadEvidence rejects wrong-typed and unknown fields with paths", () => {
    const bad = validateWorkloadEvidence({ scope: { relevantFiles: "many" }, change: { apiBoundary: "yes", bogus: 1 }, other: {} });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors).toContain("scope.relevantFiles must be a non-negative number");
      expect(bad.errors).toContain("change.apiBoundary must be a boolean");
      expect(bad.errors).toContain("unknown evidence field change.bogus");
      expect(bad.errors).toContain('unknown evidence section "other"');
    }
    expect(validateWorkloadEvidence([]).ok).toBe(false);
    const good = validateWorkloadEvidence({ scope: { relevantFiles: 3 }, change: { schemaChange: true } });
    expect(good.ok).toBe(true);
  });
});
