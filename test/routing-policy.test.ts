import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { capabilityRouteFor } from "../plugins/arc-orchestrator/lib/capability-routes";
import { resolveRoutingShadow } from "../plugins/arc-orchestrator/lib/routing-shadow";
import { renderCapabilitySnapshotRankingSection } from "../plugins/orchestrator-core/routing-policy";

const empty = {};
const root = new URL("..", import.meta.url);

function read(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

describe("routing-policy: override precedence", () => {
  test("accepts current Grok identities and rejects obsolete aliases", () => {
    for (const model of [
      "cursor-grok-4.7-high",
      "grok-4.7",
      "Cursor Grok 4.7 High",
    ]) {
      const report = resolveRoutingShadow({
        requestedAlias: "implement.workspace-write.v1",
        env: empty,
        workloadClass: "hard-medium",
        override: { model },
      });
      expect(report.overrideOutcome).toMatchObject({
        status: "applied",
        stableId: "cursor-grok-4.7-high",
      });
    }

    for (const model of [
      "grok-4.5",
      "cursor-grok-4.5-high",
      "Cursor Grok 4.5 High",
    ]) {
      const report = resolveRoutingShadow({
        requestedAlias: "implement.workspace-write.v1",
        env: empty,
        workloadClass: "hard-medium",
        override: { model },
      });
      expect(report.overrideOutcome).toEqual({
        status: "rejected",
        model,
        reasons: ["unknown-model"],
      });
    }

    const superseded = resolveRoutingShadow({
      requestedAlias: "implement.workspace-write.v1",
      env: empty,
      workloadClass: "hard-medium",
      override: { model: "grok-4.6" },
    });
    expect(superseded.overrideOutcome).toMatchObject({ status: "rejected" });
  });

  test("authorized valid override bypasses stack ordering", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "composer-implement",
      env: empty,
      override: { model: "gpt-5.5" },
    });

    expect(report.overrideOutcome).toMatchObject({
      status: "applied",
      stableId: "gpt-5.5",
    });
    expect(report.proposedSelection).toEqual({
      backend: "codex",
      model: "gpt-5.5",
    });
    expect(report.candidateEvaluations[0]?.stableId).toBe("composer-2.5");
    expect(report.proposedSelectionReason).toBe("explicit-override-applied");
  });

  test("override to a model lacking route eligibility is rejected with visible reasons", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "composer-implement",
      env: empty,
      override: { model: "sonnet-5" },
    });

    expect(report.overrideOutcome).toEqual({
      status: "rejected",
      model: "sonnet-5",
      reasons: ["missing-route-eligibility", "contract-incompatible"],
    });
    expect(report.proposedSelection).toBeNull();
    expect(report.proposedSelectionReason).toBe("override-rejected");
    expect(report.comparison?.matches).toBe(false);
    expect(report.comparison?.explanation).toContain("override-rejected");
  });
});

describe("routing-policy: fixed route contract immutability", () => {
  test("override cannot change fixed route contract fields in the report", () => {
    const baseline = resolveRoutingShadow({
      requestedAlias: "composer-implement",
      env: empty,
    });
    const overridden = resolveRoutingShadow({
      requestedAlias: "composer-implement",
      env: empty,
      override: { model: "gpt-5.5" },
    });

    const expected = capabilityRouteFor("implement.workspace-write.v1");
    expect(baseline.fixedContract).toEqual({
      mode: expected.mode,
      sandbox: expected.sandbox,
      outputContract: expected.outputContract,
    });
    expect(overridden.fixedContract).toEqual(baseline.fixedContract);
    expect(overridden.canonicalRouteId).toBe("implement.workspace-write.v1");
  });
});

describe("routing-policy: ranking prose is snapshot-derived", () => {
  test("checked-in human-readable ranking sections match the renderer", () => {
    const rendered = renderCapabilitySnapshotRankingSection();
    expect(read("CLAUDE.md")).toContain(rendered);
    expect(read("README.md")).toContain(rendered);
  });
});
