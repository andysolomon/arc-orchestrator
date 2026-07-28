import { describe, expect, it } from "bun:test";
import {
  CANDIDATE_STACKS,
  MODEL_REGISTRY,
  rungsFor,
} from "../plugins/arc-orchestrator/lib/model-registry";
import { bandForSnapshotEntry } from "../plugins/arc-orchestrator/lib/capability-selection";
import type { CapabilityBand } from "../plugins/arc-orchestrator/lib/capability-snapshot";
import { DEFAULT_CAPABILITY_SNAPSHOT } from "../plugins/orchestrator-core/routing-policy";

// The workload ladder must not invert against the versioned snapshot: a harder
// class may not lead with a model in a lower capability band than the lead of a
// lighter class. The old test read MODEL_RANKINGS, which made the stale table a
// second ranking authority. This version reads the same snapshot banding as the
// selector/floor migration.
const LADDER = [
  "default",
  "light-work",
  "medium-light-work",
  "medium-work",
  "medium-hard-work",
  "hard-light-work",
  "hard-work",
] as const;

function leadFor(workloadClass: string): string {
  const stack = CANDIDATE_STACKS.find(
    (candidate) => candidate.workloadClass === workloadClass,
  );
  if (!stack) {
    throw new Error(`No candidate stack for workload class: ${workloadClass}`);
  }
  return stack.candidates[0];
}

function snapshotBandFor(stableId: string): CapabilityBand | null {
  const registryEntry = MODEL_REGISTRY.find((entry) => entry.stableId === stableId);
  if (!registryEntry) {
    return null;
  }
  const rungs = new Set(rungsFor(registryEntry));
  const bands = DEFAULT_CAPABILITY_SNAPSHOT.rungs
    .filter((rung) => rungs.has(rung.rungId))
    .map((rung) =>
      bandForSnapshotEntry(rung, "swe", DEFAULT_CAPABILITY_SNAPSHOT.bandWidth) ??
      bandForSnapshotEntry(
        rung,
        "agentic-edit",
        DEFAULT_CAPABILITY_SNAPSHOT.bandWidth,
      ),
    )
    .filter((band): band is CapabilityBand => band != null);
  return bands.length === 0
    ? null
    : (Math.max(...bands) as CapabilityBand);
}

describe("workload ladder", () => {
  it("never lets a harder class lead with a lower snapshot band than a lighter one", () => {
    const rungs = LADDER.map((workloadClass) => {
      const lead = leadFor(workloadClass);
      return { workloadClass, lead, band: snapshotBandFor(lead) };
    }).filter((rung) => rung.band !== null);

    // Compare only the medium-and-up rungs: default and light-work are
    // deliberate cost floors pinned to a single candidate with no fallback.
    const ranked = rungs.filter(
      (rung) => !["default", "light-work"].includes(rung.workloadClass),
    );

    const inversions: string[] = [];
    for (let i = 1; i < ranked.length; i += 1) {
      const previous = ranked[i - 1];
      const current = ranked[i];
      if (current.band! < previous.band!) {
        // Documented exception: medium-light-work and medium-work hold the same
        // candidates and differ only by swapping the first two. Leading the
        // lighter class with the dearer model is a deliberate cost trade — small
        // tasks can afford opus-5 (usageHeadroom 4), larger ones lead with the
        // usage-efficient gpt-5.5 (9). The exception is validated below rather
        // than assumed, so it lapses the moment the membership diverges.
        if (
          previous.workloadClass === "medium-light-work" &&
          current.workloadClass === "medium-work"
        ) {
          continue;
        }
        inversions.push(
          `${current.workloadClass} leads with ${current.lead} (band ${current.band}) ` +
            `but the lighter ${previous.workloadClass} leads with ${previous.lead} (band ${previous.band})`,
        );
      }
    }
    expect(inversions).toEqual([]);
  });

  it("only excuses the medium-light/medium inversion while they share candidates", () => {
    const stackFor = (workloadClass: string) =>
      CANDIDATE_STACKS.find(
        (candidate) => candidate.workloadClass === workloadClass,
      )!.candidates;
    const mediumLight = [...stackFor("medium-light-work")].sort();
    const medium = [...stackFor("medium-work")].sort();
    expect(mediumLight).toEqual(medium);
  });

  it("keeps every stack lead represented in the versioned snapshot it is ordered by", () => {
    for (const workloadClass of LADDER) {
      const lead = leadFor(workloadClass);
      expect({ workloadClass, ranked: snapshotBandFor(lead) !== null }).toEqual({
        workloadClass,
        ranked: true,
      });
    }
  });
});
