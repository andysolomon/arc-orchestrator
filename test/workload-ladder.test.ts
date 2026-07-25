import { describe, expect, it } from "bun:test";
import { CANDIDATE_STACKS } from "../plugins/arc-orchestrator/lib/model-registry";
import { MODEL_RANKINGS } from "../plugins/orchestrator-core/routing-policy";

// The workload ladder must not invert: a harder class may not lead with a model
// ranked below the lead of a lighter class. gpt-5.6-terra led medium-hard-work
// at intelligence 8 — a value taken from its 70% at max effort — while the
// lighter medium-work led with gpt-5.5 at 8. Once Terra was re-scored at the
// effort we actually dispatch it dropped to 5, and the inversion became visible.
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

function intelligenceFor(stableId: string): number | null {
  return (
    MODEL_RANKINGS.find((entry) => entry.model === stableId)?.intelligence ??
    null
  );
}

describe("workload ladder", () => {
  it("never lets a harder class lead with a weaker model than a lighter one", () => {
    const rungs = LADDER.map((workloadClass) => {
      const lead = leadFor(workloadClass);
      return { workloadClass, lead, intelligence: intelligenceFor(lead) };
    }).filter((rung) => rung.intelligence !== null);

    // Compare only the medium-and-up rungs: default and light-work are
    // deliberate cost floors pinned to a single candidate with no fallback.
    const ranked = rungs.filter(
      (rung) => !["default", "light-work"].includes(rung.workloadClass),
    );

    const inversions: string[] = [];
    for (let i = 1; i < ranked.length; i += 1) {
      const previous = ranked[i - 1];
      const current = ranked[i];
      if (current.intelligence! < previous.intelligence!) {
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
          `${current.workloadClass} leads with ${current.lead} (${current.intelligence}) ` +
            `but the lighter ${previous.workloadClass} leads with ${previous.lead} (${previous.intelligence})`,
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

  it("keeps every stack lead present in the rankings it is ordered by", () => {
    for (const workloadClass of LADDER) {
      const lead = leadFor(workloadClass);
      // grok-4.5 is intentionally unranked while the two suites disagree on it.
      if (lead === "grok-4.5") {
        continue;
      }
      expect({ workloadClass, ranked: intelligenceFor(lead) !== null }).toEqual({
        workloadClass,
        ranked: true,
      });
    }
  });
});
