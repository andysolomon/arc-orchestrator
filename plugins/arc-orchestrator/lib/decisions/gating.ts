// Confidence-gated rules that turn Jev answers into actions.
//
// Pure functions with no model calls, so every rule is testable at, above,
// and below its threshold. The rules run in a fixed order:
//
//   1. Human-required conditions always win: risk >= RISK_HUMAN_THRESHOLD,
//      or a "needs human review" Noul above HUMAN_REVIEW_THRESHOLD.
//   2. A Jev answer at or above its confidence threshold acts automatically.
//   3. Otherwise Fable decides. A Fable verdict at or above the same threshold
//      acts; a Fable verdict below it goes to a human.
//   4. With no Fable verdict yet, the decision escalates to Fable.
//
// A Jev failure (timeout, error, bad answer) skips steps 1-2, which leaves the
// decision with Fable exactly as it is today.

import type { WorkloadClass } from "../routes";
import type { JevThresholds } from "./config";
import type {
  Assessment,
  CompletionChecks,
  EstimatedSize,
  JevOutcome,
  JevWorker,
  RouteDecision,
} from "./jev";

export type GateAction = "auto" | "needs_fable" | "needs_human";
export type DecidedBy = "jev" | "fable" | null;

// A decision Fable (the parent) made itself, with the confidence it states.
export type FableVerdict<T> = { value: T; confidence: number };

export type Gate<T> = {
  action: GateAction;
  // The value to act on when action is "auto"; otherwise the best proposal
  // for Fable or the human to confirm (null when nothing was proposed).
  value: T | null;
  decidedBy: DecidedBy;
  reasons: string[];
};

export type CompletionOutcome = "accepted" | "rejected";

const fmt = (value: number) => String(Math.round(value * 1000) / 1000);

function riskFrom(
  assessment: JevOutcome<Assessment> | null | undefined,
): number | null {
  return assessment?.ok ? assessment.value.risk.value : null;
}

function riskGate<T>(
  risk: number | null,
  thresholds: JevThresholds,
  proposal: T | null,
): Gate<T> | null {
  if (risk !== null && risk >= thresholds.riskHuman) {
    return {
      action: "needs_human",
      value: proposal,
      decidedBy: null,
      reasons: [`risk ${fmt(risk)} >= ${fmt(thresholds.riskHuman)} requires human approval`],
    };
  }
  return null;
}

function unavailable(outcome: JevOutcome<unknown> | null | undefined): string {
  if (!outcome) {
    return "Jev was not asked";
  }
  return outcome.ok ? "" : `Jev unavailable (${outcome.errorKind})`;
}

// Steps 3-4: hand the decision to Fable, and to a human when Fable is unsure.
function fableOrEscalate<T>(
  fable: FableVerdict<T> | null | undefined,
  minConfidence: number,
  proposal: T | null,
  reasons: string[],
): Gate<T> {
  if (!fable) {
    return { action: "needs_fable", value: proposal, decidedBy: null, reasons };
  }
  if (fable.confidence >= minConfidence) {
    return {
      action: "auto",
      value: fable.value,
      decidedBy: "fable",
      reasons: [...reasons, `Fable confidence ${fmt(fable.confidence)} >= ${fmt(minConfidence)}`],
    };
  }
  return {
    action: "needs_human",
    value: fable.value,
    decidedBy: null,
    reasons: [...reasons, `Fable confidence ${fmt(fable.confidence)} < ${fmt(minConfidence)}`],
  };
}

// Maps the 1-5 complexity score and the stated size onto the nine
// runner-routing-v4 workload classes. Size comes from the task, not Jev.
export function workloadClassFor(
  complexity: number,
  size: EstimatedSize | null,
): WorkloadClass | null {
  if (!size) {
    return null;
  }
  const difficulty = complexity >= 3.5 ? "hard" : complexity >= 2.5 ? "medium" : "easy";
  const volume = size === "large" ? "heavy" : size === "medium" ? "medium" : "light";
  return `${difficulty}-${volume}` as WorkloadClass;
}

export function gateRoute(
  input: {
    route: JevOutcome<RouteDecision> | null;
    assessment?: JevOutcome<Assessment> | null;
    fable?: FableVerdict<JevWorker> | null;
  },
  thresholds: JevThresholds,
): Gate<JevWorker> {
  const proposal = input.route?.ok ? input.route.value.worker : null;
  const human = riskGate(riskFrom(input.assessment), thresholds, proposal);
  if (human) {
    return human;
  }
  const reasons: string[] = [];
  if (input.route?.ok) {
    const { worker, confidence } = input.route.value;
    if (confidence >= thresholds.routeMinConfidence) {
      return {
        action: "auto",
        value: worker,
        decidedBy: "jev",
        reasons: [`route confidence ${fmt(confidence)} >= ${fmt(thresholds.routeMinConfidence)}`],
      };
    }
    reasons.push(`route confidence ${fmt(confidence)} < ${fmt(thresholds.routeMinConfidence)}`);
  } else {
    reasons.push(unavailable(input.route));
  }
  return fableOrEscalate(input.fable, thresholds.routeMinConfidence, proposal, reasons);
}

export function gateAssessment(
  input: {
    assessment: JevOutcome<Assessment> | null;
    estimatedSize: EstimatedSize | null;
    fable?: FableVerdict<WorkloadClass> | null;
  },
  thresholds: JevThresholds,
): Gate<WorkloadClass> {
  const { assessment } = input;
  const proposal = assessment?.ok
    ? workloadClassFor(assessment.value.complexity.value, input.estimatedSize)
    : null;
  const human = riskGate(riskFrom(assessment), thresholds, proposal);
  if (human) {
    return human;
  }
  const reasons: string[] = [];
  if (assessment?.ok) {
    for (const [name, score] of Object.entries(assessment.value)) {
      if (score.confidence < thresholds.assessMinConfidence) {
        reasons.push(
          `${name} confidence ${fmt(score.confidence)} < ${fmt(thresholds.assessMinConfidence)}`,
        );
      }
    }
    if (!proposal) {
      reasons.push("estimatedSize is not stated, so no workload class can be derived");
    }
    if (reasons.length === 0 && proposal) {
      return {
        action: "auto",
        value: proposal,
        decidedBy: "jev",
        reasons: [
          `all assessment confidences >= ${fmt(thresholds.assessMinConfidence)}`,
          `complexity ${fmt(assessment.value.complexity.value)} with size ${input.estimatedSize} -> ${proposal}`,
        ],
      };
    }
  } else {
    reasons.push(unavailable(assessment));
  }
  return fableOrEscalate(input.fable, thresholds.assessMinConfidence, proposal, reasons);
}

export function gateCompletion(
  input: {
    completion: JevOutcome<CompletionChecks> | null;
    assessment?: JevOutcome<Assessment> | null;
    fable?: FableVerdict<CompletionOutcome> | null;
  },
  thresholds: JevThresholds,
): Gate<CompletionOutcome> {
  const { completion } = input;
  if (completion?.ok && completion.value.needsHumanReview > thresholds.humanReviewNoul) {
    return {
      action: "needs_human",
      value: null,
      decidedBy: null,
      reasons: [
        `needs-human-review ${fmt(completion.value.needsHumanReview)} > ${fmt(thresholds.humanReviewNoul)}`,
      ],
    };
  }
  const human = riskGate<CompletionOutcome>(riskFrom(input.assessment), thresholds, null);
  if (human) {
    return human;
  }
  const reasons: string[] = [];
  if (completion?.ok) {
    const checks = {
      criteriaSatisfied: completion.value.criteriaSatisfied,
      inScope: completion.value.inScope,
      testsUpdated: completion.value.testsUpdated,
    };
    const failing = Object.entries(checks).filter(([, p]) => p <= thresholds.completionNo);
    if (failing.length > 0) {
      return {
        action: "auto",
        value: "rejected",
        decidedBy: "jev",
        reasons: failing.map(
          ([name, p]) => `${name} ${fmt(p)} <= ${fmt(thresholds.completionNo)}`,
        ),
      };
    }
    const uncertain = Object.entries(checks).filter(([, p]) => p < thresholds.completionYes);
    if (uncertain.length === 0) {
      return {
        action: "auto",
        value: "accepted",
        decidedBy: "jev",
        reasons: [`every completion check >= ${fmt(thresholds.completionYes)}`],
      };
    }
    for (const [name, p] of uncertain) {
      reasons.push(
        `${name} ${fmt(p)} is between ${fmt(thresholds.completionNo)} and ${fmt(thresholds.completionYes)}`,
      );
    }
  } else {
    reasons.push(unavailable(completion));
  }
  return fableOrEscalate(input.fable, thresholds.completionMinConfidence, null, reasons);
}
