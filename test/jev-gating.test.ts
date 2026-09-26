import { describe, expect, test } from "bun:test";
import { DEFAULT_JEV_THRESHOLDS as T } from "../plugins/arc-orchestrator/lib/decisions/config";
import {
  gateAssessment,
  gateCompletion,
  gateRoute,
  workloadClassFor,
} from "../plugins/arc-orchestrator/lib/decisions/gating";
import type {
  Assessment,
  CompletionChecks,
  JevOutcome,
  RouteDecision,
} from "../plugins/arc-orchestrator/lib/decisions/jev";

const EPS = 1e-4;
const ok = <V>(value: V): JevOutcome<V> => ({ ok: true, value, model: "jev", latencyMs: 1 });
const down: JevOutcome<never> = { ok: false, errorKind: "timeout", error: "t", latencyMs: 1 };

const route = (confidence: number, worker: RouteDecision["worker"] = "codex") =>
  ok<RouteDecision>({ worker, confidence, probabilities: { composer: 0, codex: 0, fable: 0 } });

const assessment = (
  over: Partial<{ complexity: number; risk: number; clarity: number; confidence: number }> = {},
) => {
  const c = over.confidence ?? 0.9;
  return ok<Assessment>({
    complexity: { value: over.complexity ?? 2, confidence: c },
    risk: { value: over.risk ?? 1, confidence: c },
    specClarity: { value: over.clarity ?? 4, confidence: c },
  });
};

const completion = (over: Partial<CompletionChecks> = {}) =>
  ok<CompletionChecks>({
    criteriaSatisfied: 0.95,
    inScope: 0.95,
    testsUpdated: 0.95,
    needsHumanReview: 0.1,
    ...over,
  });

describe("gateRoute: ROUTE_MIN_CONFIDENCE", () => {
  test("at the threshold acts automatically on Jev's choice", () => {
    expect(gateRoute({ route: route(T.routeMinConfidence) }, T)).toMatchObject({
      action: "auto",
      value: "codex",
      decidedBy: "jev",
    });
  });

  test("above the threshold acts automatically", () => {
    expect(gateRoute({ route: route(T.routeMinConfidence + EPS) }, T).action).toBe("auto");
  });

  test("below the threshold escalates to Fable with Jev's proposal", () => {
    expect(gateRoute({ route: route(T.routeMinConfidence - EPS) }, T)).toMatchObject({
      action: "needs_fable",
      value: "codex",
      decidedBy: null,
    });
  });

  test("below the threshold, Fable at/above the threshold decides", () => {
    for (const confidence of [T.routeMinConfidence, T.routeMinConfidence + EPS]) {
      expect(
        gateRoute(
          { route: route(0.5), fable: { value: "composer", confidence } },
          T,
        ),
      ).toMatchObject({ action: "auto", value: "composer", decidedBy: "fable" });
    }
  });

  test("below the threshold, Fable below the threshold goes to a human", () => {
    expect(
      gateRoute(
        { route: route(0.5), fable: { value: "composer", confidence: T.routeMinConfidence - EPS } },
        T,
      ),
    ).toMatchObject({ action: "needs_human", value: "composer", decidedBy: null });
  });

  test("a Fable verdict does not override a confident Jev answer", () => {
    expect(
      gateRoute({ route: route(0.9), fable: { value: "fable", confidence: 0.99 } }, T),
    ).toMatchObject({ action: "auto", value: "codex", decidedBy: "jev" });
  });

  test("Jev failure falls back to Fable (current behavior)", () => {
    expect(gateRoute({ route: down }, T)).toMatchObject({
      action: "needs_fable",
      value: null,
      reasons: ["Jev unavailable (timeout)"],
    });
    expect(gateRoute({ route: null }, T).action).toBe("needs_fable");
    expect(
      gateRoute({ route: down, fable: { value: "codex", confidence: 0.8 } }, T),
    ).toMatchObject({ action: "auto", value: "codex", decidedBy: "fable" });
  });
});

describe("gateRoute: RISK_HUMAN_THRESHOLD", () => {
  test("risk at the threshold always requires a human, even with confident Jev and Fable", () => {
    expect(
      gateRoute(
        {
          route: route(0.99),
          assessment: assessment({ risk: T.riskHuman }),
          fable: { value: "codex", confidence: 1 },
        },
        T,
      ),
    ).toMatchObject({ action: "needs_human", value: "codex" });
  });

  test("risk above the threshold requires a human", () => {
    expect(
      gateRoute({ route: route(0.99), assessment: assessment({ risk: T.riskHuman + EPS }) }, T)
        .action,
    ).toBe("needs_human");
  });

  test("risk below the threshold does not", () => {
    expect(
      gateRoute({ route: route(0.99), assessment: assessment({ risk: T.riskHuman - EPS }) }, T)
        .action,
    ).toBe("auto");
  });

  test("a failed assessment does not block a confident route", () => {
    expect(gateRoute({ route: route(0.99), assessment: down }, T).action).toBe("auto");
  });
});

describe("workloadClassFor", () => {
  test("maps complexity bands and stated size onto the nine classes", () => {
    expect(workloadClassFor(1, "small")).toBe("easy-light");
    expect(workloadClassFor(2.49, "medium")).toBe("easy-medium");
    expect(workloadClassFor(2.5, "medium")).toBe("medium-medium");
    expect(workloadClassFor(3.49, "large")).toBe("medium-heavy");
    expect(workloadClassFor(3.5, "small")).toBe("hard-light");
    expect(workloadClassFor(5, "large")).toBe("hard-heavy");
    expect(workloadClassFor(5, null)).toBeNull();
  });
});

describe("gateAssessment: ASSESS_MIN_CONFIDENCE", () => {
  const base = { estimatedSize: "medium" as const };

  test("every confidence at the threshold acts automatically with the derived class", () => {
    expect(
      gateAssessment(
        { ...base, assessment: assessment({ complexity: 4, confidence: T.assessMinConfidence }) },
        T,
      ),
    ).toMatchObject({ action: "auto", value: "hard-medium", decidedBy: "jev" });
  });

  test("above the threshold acts automatically", () => {
    expect(
      gateAssessment(
        { ...base, assessment: assessment({ confidence: T.assessMinConfidence + EPS }) },
        T,
      ).action,
    ).toBe("auto");
  });

  test("any score below the threshold escalates to Fable", () => {
    const low = assessment({ confidence: 0.9 });
    if (low.ok) low.value.specClarity.confidence = T.assessMinConfidence - EPS;
    const gate = gateAssessment({ ...base, assessment: low }, T);
    expect(gate).toMatchObject({ action: "needs_fable", value: "easy-medium" });
    expect(gate.reasons[0]).toContain("specClarity confidence");
  });

  test("Fable at the threshold decides; below it goes to a human", () => {
    const low = assessment({ confidence: 0.1 });
    expect(
      gateAssessment(
        { ...base, assessment: low, fable: { value: "medium-light", confidence: T.assessMinConfidence } },
        T,
      ),
    ).toMatchObject({ action: "auto", value: "medium-light", decidedBy: "fable" });
    expect(
      gateAssessment(
        {
          ...base,
          assessment: low,
          fable: { value: "medium-light", confidence: T.assessMinConfidence - EPS },
        },
        T,
      ).action,
    ).toBe("needs_human");
  });

  test("a missing estimatedSize cannot produce a class and escalates", () => {
    expect(
      gateAssessment({ estimatedSize: null, assessment: assessment() }, T),
    ).toMatchObject({ action: "needs_fable", value: null });
  });

  test("risk at the threshold requires a human; below it does not", () => {
    expect(
      gateAssessment({ ...base, assessment: assessment({ risk: T.riskHuman }) }, T).action,
    ).toBe("needs_human");
    expect(
      gateAssessment({ ...base, assessment: assessment({ risk: T.riskHuman - EPS }) }, T).action,
    ).toBe("auto");
  });

  test("Jev failure falls back to Fable", () => {
    expect(gateAssessment({ ...base, assessment: down }, T)).toMatchObject({
      action: "needs_fable",
      value: null,
    });
  });
});

describe("gateCompletion: HUMAN_REVIEW_THRESHOLD", () => {
  test("needs-human-review above the threshold always requires a human", () => {
    expect(
      gateCompletion(
        {
          completion: completion({ needsHumanReview: T.humanReviewNoul + EPS }),
          fable: { value: "accepted", confidence: 1 },
        },
        T,
      ).action,
    ).toBe("needs_human");
  });

  test("at the threshold does not (the rule is strictly greater)", () => {
    expect(
      gateCompletion({ completion: completion({ needsHumanReview: T.humanReviewNoul }) }, T),
    ).toMatchObject({ action: "auto", value: "accepted" });
  });

  test("below the threshold does not", () => {
    expect(
      gateCompletion({ completion: completion({ needsHumanReview: T.humanReviewNoul - EPS }) }, T)
        .action,
    ).toBe("auto");
  });

  test("risk at the threshold requires a human even when every check passes", () => {
    expect(
      gateCompletion({ completion: completion(), assessment: assessment({ risk: T.riskHuman }) }, T)
        .action,
    ).toBe("needs_human");
    expect(
      gateCompletion(
        { completion: completion(), assessment: assessment({ risk: T.riskHuman - EPS }) },
        T,
      ).action,
    ).toBe("auto");
  });
});

describe("gateCompletion: COMPLETION_YES_THRESHOLD / COMPLETION_NO_THRESHOLD", () => {
  const checks = ["criteriaSatisfied", "inScope", "testsUpdated"] as const;

  test("every check at the yes threshold accepts automatically", () => {
    expect(
      gateCompletion(
        {
          completion: completion({
            criteriaSatisfied: T.completionYes,
            inScope: T.completionYes,
            testsUpdated: T.completionYes,
          }),
        },
        T,
      ),
    ).toMatchObject({ action: "auto", value: "accepted", decidedBy: "jev" });
  });

  for (const name of checks) {
    test(`${name} at the no threshold rejects automatically`, () => {
      const gate = gateCompletion({ completion: completion({ [name]: T.completionNo }) }, T);
      expect(gate).toMatchObject({ action: "auto", value: "rejected", decidedBy: "jev" });
      expect(gate.reasons[0]).toContain(name);
    });

    test(`${name} just above the no threshold and below yes escalates to Fable`, () => {
      expect(
        gateCompletion({ completion: completion({ [name]: T.completionNo + EPS }) }, T).action,
      ).toBe("needs_fable");
      expect(
        gateCompletion({ completion: completion({ [name]: T.completionYes - EPS }) }, T).action,
      ).toBe("needs_fable");
    });
  }

  test("a failing check wins over an uncertain one", () => {
    expect(
      gateCompletion({ completion: completion({ inScope: 0.1, testsUpdated: 0.5 }) }, T),
    ).toMatchObject({ action: "auto", value: "rejected" });
  });
});

describe("gateCompletion: COMPLETION_MIN_CONFIDENCE for Fable", () => {
  const uncertain = completion({ testsUpdated: 0.5 });

  test("Fable at or above the threshold decides the uncertain case", () => {
    for (const confidence of [T.completionMinConfidence, T.completionMinConfidence + EPS]) {
      expect(
        gateCompletion({ completion: uncertain, fable: { value: "rejected", confidence } }, T),
      ).toMatchObject({ action: "auto", value: "rejected", decidedBy: "fable" });
    }
  });

  test("Fable below the threshold goes to a human", () => {
    expect(
      gateCompletion(
        {
          completion: uncertain,
          fable: { value: "accepted", confidence: T.completionMinConfidence - EPS },
        },
        T,
      ),
    ).toMatchObject({ action: "needs_human", value: "accepted" });
  });

  test("Jev failure falls back to Fable", () => {
    expect(gateCompletion({ completion: down }, T)).toMatchObject({
      action: "needs_fable",
      value: null,
      reasons: ["Jev unavailable (timeout)"],
    });
    expect(
      gateCompletion({ completion: down, fable: { value: "accepted", confidence: 0.9 } }, T),
    ).toMatchObject({ action: "auto", value: "accepted", decidedBy: "fable" });
  });
});

describe("custom thresholds", () => {
  test("configured values move each boundary", () => {
    const strict = { ...T, routeMinConfidence: 0.95, riskHuman: 3 };
    expect(gateRoute({ route: route(0.9) }, strict).action).toBe("needs_fable");
    expect(
      gateRoute({ route: route(0.99), assessment: assessment({ risk: 3 }) }, strict).action,
    ).toBe("needs_human");
  });
});
