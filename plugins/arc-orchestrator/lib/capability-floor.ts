// ADR 0010 phase 13.8. The `workload_class` → `capabilityFloor` seam.
//
// ADR 0011 leaves "the `workload_class` → `capabilityFloor` mapping table" as an
// open item. This supplies it — but not as a table. Three things about the
// vocabulary, all checkable against `CANDIDATE_STACKS` rather than argued from
// the class names, make a hand-authored column the wrong shape:
//
//   1. The floors are *derivable*. A class's honest floor is the band its
//      authored lead already occupies: "do not go below what this class leads
//      with today" is exactly the migration guarantee, and it is a fact about
//      the stack, not a judgment. Authoring the numbers instead would repeat
//      13.9a's failure — a hand-maintained scalar beside the data it claims to
//      summarize, free to drift from it.
//   2. `-light-` is not a difficulty, so the ladder is not monotone and was
//      never meant to be. `medium-light-work` and `medium-work` hold *identical*
//      candidate sets with the first two swapped, and so do `hard-light-work`
//      and `hard-work`; `test/workload-ladder.test.ts` already excuses the first
//      pair as a deliberate cost trade — small tasks can afford the dearer lead.
//      A derived table shows that trade as what it is: where the two leads sit in
//      different bands, the *lighter* class gets the higher floor. Meanwhile
//      `medium-hard-work` and `hard-work` both lead with `fable-5`, so no
//      snapshot can ever separate them. Seven class names, five leads, and one
//      sanctioned inversion — an authored column would have had to either
//      fabricate the missing distinctions or quietly drop the real one.
//   3. The class only means anything on one route. `candidateStackForRoute`
//      matches on `workloadClass` for `implement.workspace-write.v1` and ignores
//      it everywhere else. A route-free table would invent a floor on the three
//      routes that have never honored the class.
//
// So the mapping resolves the class through the same function routing already
// uses, and reads the floor off the resulting stack. Every property below falls
// out of that rather than being asserted beside it.
//
// Pure: no I/O, no environment, no clock. The snapshot arrives as an argument,
// including its absence.

import {
  type CapabilityAxis,
  type CapabilityBand,
  type CapabilitySnapshot,
  type RungSnapshotEntry,
} from "./capability-snapshot";
import { bandForSnapshotEntry } from "./capability-selection";
import type { CanonicalCapabilityRouteId } from "./capability-routes";
import {
  candidateStackForRoute,
  MODEL_REGISTRY,
  rungsFor,
  type CandidateStack,
  type ModelRegistryEntry,
  type RungId,
} from "./model-registry";
import {
  normalizeWorkloadClass,
  WORKLOAD_CLASSES,
  type WorkloadClass,
} from "./routes";

export const CAPABILITY_FLOOR_POLICY_VERSION = "capability-floor/v1";

export type CapabilityFloorInputs = {
  capabilityRoute: CanonicalCapabilityRouteId;
  axis: CapabilityAxis;
  // Absent is a supported state, not an error. ADR 0010's rollback is "delete
  // the snapshot" (13.2), and the whole of that rollback lives here: with no
  // snapshot nothing is ranked, so every derived floor is 0 and the mapping
  // makes no claim at all. See `deriveFloor` for why that is the only safe
  // direction.
  snapshot: CapabilitySnapshot | null;
  registry?: readonly ModelRegistryEntry[];
};

export type DerivedCapabilityFloor = {
  workloadClass: WorkloadClass;
  capabilityFloor: CapabilityBand;
  // `=== capabilityFloor` means "do not degrade", per ADR 0010 section 5.
  minimumFloor: CapabilityBand;
  bandCeiling: CapabilityBand | null;
  // The rung the floor was read off, or null when the class's lead is unranked.
  // Present so a reader can check the floor against the data instead of
  // trusting it, which is the property a hand-authored table cannot offer.
  derivedFrom: { stableId: string; rungId: RungId } | null;
};

export type CapabilityFloorSource = "explicit" | "workload-class";

export type ResolvedCapabilityFloor = {
  capabilityFloor: CapabilityBand;
  minimumFloor: CapabilityBand;
  bandCeiling: CapabilityBand | null;
  source: CapabilityFloorSource;
  // Recorded even when an explicit floor won. This is what "demoted to
  // observability metadata" means in code: past this boundary `workload_class`
  // is carried, never consulted — `capability-selection.ts` does not mention it,
  // and a test holds that line.
  workloadClass: WorkloadClass;
  derived: DerivedCapabilityFloor;
};

export type ExplicitCapabilityFloor = {
  capabilityFloor: CapabilityBand;
  minimumFloor: CapabilityBand;
  bandCeiling?: CapabilityBand | null;
};

function registryEntry(
  stableId: string,
  registry: readonly ModelRegistryEntry[],
): ModelRegistryEntry | null {
  return registry.find((entry) => entry.stableId === stableId) ?? null;
}

function snapshotEntriesFor(
  stableId: string,
  registry: readonly ModelRegistryEntry[],
  snapshot: CapabilitySnapshot | null,
): Array<{ rungId: RungId; entry: RungSnapshotEntry }> {
  if (snapshot == null) {
    return [];
  }
  const entry = registryEntry(stableId, registry);
  if (entry == null) {
    // A stack naming a model the registry does not carry is a repo-level
    // contradiction, but it is `model-registry.ts`'s to report: raising it here
    // would make the floor mapping a second validation authority, which is the
    // registry/snapshot split this ADR exists to keep clean.
    return [];
  }
  const wanted = new Set<string>(rungsFor(entry));
  const found: Array<{ rungId: RungId; entry: RungSnapshotEntry }> = [];
  for (const rung of snapshot.rungs) {
    if (wanted.has(rung.rungId)) {
      found.push({ rungId: rung.rungId as RungId, entry: rung });
    }
  }
  return found;
}

type BandedRung = { rungId: RungId; band: CapabilityBand };

function bandedRungsFor(
  stableId: string,
  inputs: CapabilityFloorInputs,
  registry: readonly ModelRegistryEntry[],
): BandedRung[] {
  if (inputs.snapshot == null) {
    return [];
  }
  const bandWidth = inputs.snapshot.bandWidth;
  const banded: BandedRung[] = [];
  for (const { rungId, entry } of snapshotEntriesFor(
    stableId,
    registry,
    inputs.snapshot,
  )) {
    const band = bandForSnapshotEntry(entry, inputs.axis, bandWidth);
    if (band != null) {
      banded.push({ rungId, band });
    }
  }
  return banded;
}

/**
 * The floor a stack implies.
 *
 * Read off the *lowest* ranked rung of the lead, not the highest. A stableId
 * spans several rungs and today's dispatcher is free to run any of them, so the
 * lowest is the only band the current behavior actually guarantees. Taking the
 * highest would set a floor stricter than the thing being migrated, and a
 * migration that starts refusing work it used to do is not a migration.
 * (#231's `effortFloor` narrows which rungs really run; 13.12 subsumes it, and
 * the floor here rises on its own when it does.)
 *
 * With no snapshot every lead is unranked and the floor is 0 — the mapping
 * declines to make a claim rather than guessing one. That is load-bearing:
 * `select()` rejects an unranked rung against any floor above 0
 * (`below-capability-floor`), so a non-zero floor derived without data would
 * turn ADR 0010's stated rollback — delete the snapshot — into a total refusal
 * of every medium-and-up dispatch.
 */
function deriveFloor(
  stack: CandidateStack,
  workloadClass: WorkloadClass,
  inputs: CapabilityFloorInputs,
  registry: readonly ModelRegistryEntry[],
): DerivedCapabilityFloor {
  const lead = stack.candidates[0];
  const banded = lead == null ? [] : bandedRungsFor(lead, inputs, registry);
  const lowest = banded.reduce<BandedRung | null>(
    (best, rung) => (best == null || rung.band < best.band ? rung : best),
    null,
  );

  const capabilityFloor: CapabilityBand = lowest?.band ?? 0;

  // Degradation latitude is not invented here — it is already authored.
  // `automaticFallback: true` means the stack's tail is the fallback path, and
  // that tail runs all the way down to the weakest member (`composer-2.5` on
  // every automatic implement stack), so full latitude is the faithful
  // translation. `automaticFallback: false` pins one candidate with nowhere to
  // fall, which is `minimumFloor === capabilityFloor`. Neither is a new power
  // granted at migration; ADR 0011's `TaskBudgetPolicy` may widen or narrow it
  // later, deliberately, which is where that decision belongs.
  const minimumFloor: CapabilityBand = stack.automaticFallback
    ? 0
    : capabilityFloor;

  // A pinned stack is a *cost* statement — `default` pins `composer-2.5` and
  // `light-work` pins `grok-4.5`, both cheap, neither with a fallback. Carrying
  // only the floor would invert that: floor 0 admits everything, and `select()`
  // orders by band descending, so the cheapest-work classes would lead with the
  // most capable rung available — the precise opposite of what they ask for.
  // The ceiling is the band the pinned candidate reaches, so the class keeps its
  // cap in the vocabulary ADR 0010 already has for it (`bandCeiling`, eco mode).
  const highest = banded.reduce<BandedRung | null>(
    (best, rung) => (best == null || rung.band > best.band ? rung : best),
    null,
  );
  const bandCeiling: CapabilityBand | null = stack.automaticFallback
    ? null
    : (highest?.band ?? null);

  return {
    workloadClass,
    capabilityFloor,
    minimumFloor,
    bandCeiling,
    derivedFrom:
      lowest == null ? null : { stableId: lead!, rungId: lowest.rungId },
  };
}

/**
 * Resolve a workload class to a floor on one route.
 *
 * The class is resolved through `candidateStackForRoute`, the same function the
 * live router uses, so "which stack does this class mean here" has one answer in
 * the codebase rather than two. Off `implement.workspace-write.v1` that function
 * ignores the class outright, so every class returns the route's own floor —
 * which is the truth: those routes have never read it.
 */
export function floorForWorkloadClass(
  workloadClass: string | null | undefined,
  inputs: CapabilityFloorInputs,
): DerivedCapabilityFloor {
  const normalized = normalizeWorkloadClass(workloadClass);
  if (normalized == null) {
    // Throws rather than falling back to `default`, on 13.4a's `deriveLeadPolicy`
    // reasoning: `default` is a real class meaning "the caller said nothing", and
    // a typo silently becoming it would route a hard task on the cheapest pinned
    // stack while every record showed a class that was asked for and honored.
    throw new Error(
      `floorForWorkloadClass: unknown workload class: ${String(workloadClass)}`,
    );
  }
  const registry = inputs.registry ?? MODEL_REGISTRY;
  const stack = candidateStackForRoute(
    inputs.capabilityRoute,
    null,
    normalized,
  );
  if (stack == null) {
    throw new Error(
      `floorForWorkloadClass: no candidate stack for ${inputs.capabilityRoute} / ${normalized}`,
    );
  }
  return deriveFloor(stack, normalized, inputs, registry);
}

/**
 * Dual acceptance, per ADR 0010's migration consequence.
 *
 * An explicit floor wins, because it comes from the state that is dispatching
 * and `workload_class` is the freehand guess it replaces. The derived floor is
 * returned either way: during migration the interesting number is not which
 * floor ran but whether the two agree, and 13.10's shadow corpus cannot measure
 * that if the loser is discarded at the seam.
 */
export function resolveCapabilityFloor(input: {
  explicit?: ExplicitCapabilityFloor | null;
  workloadClass: string | null | undefined;
  inputs: CapabilityFloorInputs;
}): ResolvedCapabilityFloor {
  const derived = floorForWorkloadClass(input.workloadClass, input.inputs);
  if (input.explicit == null) {
    return {
      capabilityFloor: derived.capabilityFloor,
      minimumFloor: derived.minimumFloor,
      bandCeiling: derived.bandCeiling,
      source: "workload-class",
      workloadClass: derived.workloadClass,
      derived,
    };
  }
  return {
    capabilityFloor: input.explicit.capabilityFloor,
    minimumFloor: input.explicit.minimumFloor,
    // `bandCeiling` is optional on an explicit floor and absent means uncapped,
    // not "inherit the class's cap": a caller stating a floor has stated its
    // whole request, and quietly attaching a ceiling it did not ask for would
    // cap a dispatch on the strength of metadata that no longer selects.
    bandCeiling: input.explicit.bandCeiling ?? null,
    source: "explicit",
    workloadClass: derived.workloadClass,
    derived,
  };
}

/**
 * The disagreement between an explicit floor and the class it arrived with, or
 * `null` when there is none to report. Only an explicit floor can disagree;
 * a derived one is the class by construction.
 */
export function capabilityFloorDisagreement(
  resolved: ResolvedCapabilityFloor,
): { explicit: CapabilityBand; derived: CapabilityBand } | null {
  if (resolved.source !== "explicit") {
    return null;
  }
  if (resolved.capabilityFloor === resolved.derived.capabilityFloor) {
    return null;
  }
  return {
    explicit: resolved.capabilityFloor,
    derived: resolved.derived.capabilityFloor,
  };
}

/**
 * Every workload class's floor on one route, in ladder order.
 *
 * `WORKLOAD_CLASSES` is already declared in ascending difficulty and is the
 * order `test/workload-ladder.test.ts` checks the authored stacks against, so it
 * is reused rather than restated: a class added there arrives here with a
 * position already considered, and the monotonicity test below covers it
 * without an edit.
 *
 * Note what the derived floors cannot do. A floor is always the band of a rung
 * that exists, so it can never be unreachable — the failure a hand-authored
 * table invites, and not a theoretical one. Bands quantize a 0..1 score and the
 * validator holds `bandWidth > 0.2`, so band 4 needs a score above 0.8 that no
 * published suite result comes near; a table assigning `hard-work` a floor of 4
 * would refuse every dispatch while looking like a considered policy.
 */
export function workloadClassFloorTable(
  inputs: CapabilityFloorInputs,
  classes: readonly WorkloadClass[] = WORKLOAD_CLASSES,
): DerivedCapabilityFloor[] {
  return classes.map((workloadClass) =>
    floorForWorkloadClass(workloadClass, inputs),
  );
}
