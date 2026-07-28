// Phase 14.9: pure, observational replay of post-hoc annotations against the
// task-machine transition vocabulary. This module performs no I/O and never
// consults the current capability registry for historical routing facts.

import {
  ANNOTATION_SCHEMA_VERSION,
  OUTCOMES,
  type AnnotationRecord,
  type Outcome,
} from "./annotation";
import type { RootBudgetLedger } from "./delegation-budget";
import {
  DEFAULT_TASK_BUDGET_POLICY,
  TASK_MACHINE_SCHEMA_VERSION,
  step,
  type TaskEvent,
  type TaskPolicy,
  type TaskState,
  type TaskStateName,
  type VerificationEvidence,
  type VerificationVerdict,
} from "./task-machine";
import type { TraceRecord } from "./trace-schema";

export const ANNOTATION_SHADOW_REPORT_CONTRACT =
  "annotation-shadow-report/v1" as const;
export const ANNOTATION_SHADOW_REPORT_SCHEMA_VERSION = 1 as const;

export type AnnotationShadowDiagnosticCode =
  | "annotations-unavailable"
  | "runs-unavailable"
  | "malformed-annotation"
  | "unknown-annotation"
  | "malformed-run"
  | "unknown-run"
  | "run-join-unavailable"
  | "escalation-child-unavailable"
  | "historical-capability-band-unavailable"
  | "invalid-escalation-lineage";

export type AnnotationShadowDiagnostic = {
  code: AnnotationShadowDiagnosticCode;
  source: "annotations" | "runs" | "join";
  line: number | null;
  runId: string | null;
  message: string;
};

export type AnnotationShadowClassification =
  | "agreement"
  | "divergence"
  | "indeterminate"
  | "unavailable";

export type AnnotationShadowTransition = {
  runId: string;
  escalationOf: string | null;
  annotationOutcome: Outcome;
  runStatus: TraceRecord["status"] | null;
  observed: {
    state: "accepted" | "rejected" | "blocked" | "verification-failed" | "dispatch" | null;
    escalationChildRunId: string | null;
  };
  shadow: {
    verdict: "pass" | "fail-quality" | "fail-approach" | "fail-blocked" | null;
    events: string[];
    projectedState:
      | "accepted"
      | "rejected"
      | "blocked"
      | "verification-failed"
      | "dispatch"
      | null;
    escalationDepth: number | null;
    impliedEscalationBand: "floor+1" | null;
  };
  classification: AnnotationShadowClassification;
  explanation: string;
};

export type AnnotationShadowReport = {
  contract: typeof ANNOTATION_SHADOW_REPORT_CONTRACT;
  schema: typeof ANNOTATION_SHADOW_REPORT_SCHEMA_VERSION;
  assumedPolicy: {
    source: "task-machine defaults";
    verification: "parent";
    authorization: "parent";
    budget: typeof DEFAULT_TASK_BUDGET_POLICY;
    syntheticCapabilityFloor: 1;
    syntheticRemainingBudgetCost: 10;
    explanation: string;
  };
  unavailableInputs: {
    historicalTaskPolicy: true;
    historicalBudgetLedger: true;
    historicalCapabilityBands: true;
    failApproachLabels: true;
  };
  inputs: {
    annotations: {
      available: boolean;
      lines: number;
      validRecords: number;
      latestRecords: number;
      supersededRecords: number;
      skippedRecords: number;
    };
    runs: {
      available: boolean;
      lines: number;
      validRecords: number;
      skippedRecords: number;
    };
    historicalCapabilityBands: {
      available: false;
      inferenceUsed: false;
    };
  };
  accounting: {
    total: number;
    agreements: number;
    divergences: number;
    indeterminate: number;
    unavailable: number;
  };
  verdictCounts: {
    pass: number;
    failQuality: number;
    failApproach: 0;
    failBlocked: number;
    terminalRejected: number;
    indeterminate: number;
    unavailable: number;
  };
  failureRatio: {
    failQuality: number;
    failApproach: 0;
    denominator: number;
    ratio: number | null;
    failApproachObservable: false;
    explanation: string;
  };
  transitionDiff: AnnotationShadowTransition[];
  diagnostics: AnnotationShadowDiagnostic[];
};

export type AnnotationShadowRecordsInput = {
  annotations: readonly unknown[];
  runs: readonly unknown[];
  annotationsAvailable?: boolean;
  runsAvailable?: boolean;
};

export type AnnotationShadowJsonlInput = {
  annotationsJsonl: string | null;
  runsJsonl: string | null;
};

type LocatedValue = {
  value: unknown;
  line: number;
};

type ParsedJsonl = {
  values: LocatedValue[];
  nonEmptyLines: number;
  skipped: number;
  diagnostics: AnnotationShadowDiagnostic[];
};

type ValidAnnotation = {
  record: AnnotationRecord;
  line: number;
  order: number;
};

type ValidRun = {
  record: Pick<TraceRecord, "run_id" | "status" | "escalation_of">;
  line: number;
  order: number;
};

type ShadowProjection = {
  verdict: AnnotationShadowTransition["shadow"]["verdict"];
  events: string[];
  projectedState: AnnotationShadowTransition["shadow"]["projectedState"];
};

const OUTCOME_SET = new Set<string>(OUTCOMES);
const RUN_STATUSES = new Set<string>(["completed", "blocked", "error"]);
const SYNTHETIC_CAPABILITY_FLOOR = 1 as const;
const SYNTHETIC_ESCALATION_BAND = 2 as const;
const SYNTHETIC_REMAINING_BUDGET_COST = 10 as const;
const SYNTHETIC_NOW_MS = 0;

const ASSUMED_POLICY: TaskPolicy = {
  budget: { ...DEFAULT_TASK_BUDGET_POLICY },
  authorization: { kind: "parent" },
  verification: "parent",
};

const PARENT_EVIDENCE: VerificationEvidence = {
  mode: "parent",
  rungId: null,
  criteriaChecked: [],
  commandsRun: [],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function annotationFrom(value: unknown): AnnotationRecord | null {
  if (
    !isObject(value) ||
    value.schema !== ANNOTATION_SCHEMA_VERSION ||
    typeof value.run_id !== "string" ||
    value.run_id.trim() === "" ||
    typeof value.timestamp !== "string" ||
    !OUTCOME_SET.has(String(value.outcome)) ||
    !nullableString(value.escalated_to) ||
    !nullableString(value.note)
  ) {
    return null;
  }
  return value as AnnotationRecord;
}

function runFrom(
  value: unknown,
): Pick<TraceRecord, "run_id" | "status" | "escalation_of"> | null {
  if (
    !isObject(value) ||
    typeof value.run_id !== "string" ||
    value.run_id.trim() === "" ||
    typeof value.status !== "string" ||
    !RUN_STATUSES.has(value.status) ||
    (value.escalation_of !== undefined &&
      (typeof value.escalation_of !== "string" ||
        value.escalation_of.trim() === ""))
  ) {
    return null;
  }
  return {
    run_id: value.run_id,
    status: value.status as TraceRecord["status"],
    ...(typeof value.escalation_of === "string"
      ? { escalation_of: value.escalation_of }
      : {}),
  };
}

function parseJsonl(
  text: string | null,
  source: "annotations" | "runs",
): ParsedJsonl {
  if (text === null) {
    return {
      values: [],
      nonEmptyLines: 0,
      skipped: 0,
      diagnostics: [
        {
          code:
            source === "annotations"
              ? "annotations-unavailable"
              : "runs-unavailable",
          source,
          line: null,
          runId: null,
          message: `${source}.jsonl is unavailable`,
        },
      ],
    };
  }

  const values: LocatedValue[] = [];
  const diagnostics: AnnotationShadowDiagnostic[] = [];
  let nonEmptyLines = 0;
  let skipped = 0;
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") {
      continue;
    }
    nonEmptyLines += 1;
    try {
      values.push({ value: JSON.parse(line) as unknown, line: index + 1 });
    } catch {
      skipped += 1;
      diagnostics.push({
        code: source === "annotations" ? "malformed-annotation" : "malformed-run",
        source,
        line: index + 1,
        runId: null,
        message: `skipped malformed JSON in ${source}.jsonl`,
      });
    }
  }
  return { values, nonEmptyLines, skipped, diagnostics };
}

function diagnostic(
  code: AnnotationShadowDiagnosticCode,
  source: AnnotationShadowDiagnostic["source"],
  message: string,
  line: number | null = null,
  runId: string | null = null,
): AnnotationShadowDiagnostic {
  return { code, source, line, runId, message };
}

function syntheticLedger(): RootBudgetLedger {
  const limits = {
    token: 2_000_000,
    wallTimeMs: 3_600_000,
    call: 25,
    cost: SYNTHETIC_REMAINING_BUDGET_COST,
    concurrency: 3,
  };
  return {
    rootIdentity: "annotation-shadow-root",
    limits: { ...limits },
    consumed: {
      token: 0,
      wallTimeMs: 0,
      call: 0,
      cost: 0,
      concurrency: 0,
    },
    remaining: { ...limits },
    reservations: new Map(),
    createdAtMs: SYNTHETIC_NOW_MS,
    clock: () => {
      throw new Error("annotation shadow replay must not read the ledger clock");
    },
  };
}

function syntheticState(
  runId: string,
  name: Extract<TaskStateName, "dispatch" | "verify">,
  escalationsUsed = 0,
): TaskState {
  return {
    schemaVersion: TASK_MACHINE_SCHEMA_VERSION,
    taskIdentity: `annotation-shadow:${runId}`,
    rootIdentity: "annotation-shadow-root",
    depth: 0,
    name,
    axis: "swe",
    capabilityRoute: "implement.workspace-write.v1",
    capabilityFloor: SYNTHETIC_CAPABILITY_FLOOR,
    originalFloor: SYNTHETIC_CAPABILITY_FLOOR,
    acceptanceCriteria: [],
    escalationsUsed,
    replansUsed: 0,
    runIds: name === "verify" ? [runId] : [],
    selectedRung: null,
  };
}

function projectEvents(
  initialState: TaskState,
  events: readonly { event: TaskEvent; label: string }[],
): { state: TaskStateName | null; labels: string[]; rejection: string | null } {
  let state = initialState;
  const labels: string[] = [];
  for (const entry of events) {
    const transition = step({
      state,
      event: entry.event,
      policy: ASSUMED_POLICY,
      ledger: syntheticLedger(),
      nowMs: SYNTHETIC_NOW_MS,
    });
    labels.push(entry.label);
    if (transition.ok === false) {
      return {
        state: null,
        labels,
        rejection: transition.reason,
      };
    }
    state = transition.next;
  }
  return { state: state.name, labels, rejection: null };
}

function verificationProjection(
  runId: string,
  verdict: VerificationVerdict,
  options: {
    escalationsUsed?: number;
    followup?: { event: TaskEvent; label: string };
  } = {},
): ShadowProjection & { rejection: string | null } {
  const label = `verified:${verdict.kind}`;
  const events = [{ event: { kind: "verified", verdict } as TaskEvent, label }];
  if (options.followup) {
    events.push(options.followup);
  }
  const projected = projectEvents(
    syntheticState(runId, "verify", options.escalationsUsed ?? 0),
    events,
  );
  return {
    verdict: verdict.kind,
    events: projected.labels,
    projectedState:
      projected.state === "accepted" ||
      projected.state === "rejected" ||
      projected.state === "blocked" ||
      projected.state === "verification-failed" ||
      projected.state === "dispatch"
        ? projected.state
        : null,
    rejection: projected.rejection,
  };
}

function terminalDispatchProjection(runId: string): ShadowProjection & {
  rejection: string | null;
} {
  const projected = projectEvents(syntheticState(runId, "dispatch"), [
    {
      event: {
        kind: "dispatch-completed",
        runId,
        disposition: { kind: "terminal-unclassified", detail: null },
      },
      label: "dispatch-completed:terminal",
    },
  ]);
  return {
    verdict: null,
    events: projected.labels,
    projectedState: projected.state === "rejected" ? "rejected" : null,
    rejection: projected.rejection,
  };
}

function classificationFor(
  observed: AnnotationShadowTransition["observed"]["state"],
  projection: ShadowProjection & { rejection: string | null },
): AnnotationShadowClassification {
  if (observed === null || projection.projectedState === null) {
    return "unavailable";
  }
  return observed === projection.projectedState ? "agreement" : "divergence";
}

function classifyTransitions(
  annotations: readonly ValidAnnotation[],
  runs: readonly ValidRun[],
  diagnostics: AnnotationShadowDiagnostic[],
): AnnotationShadowTransition[] {
  const runsById = new Map<string, ValidRun>();
  const childrenByParent = new Map<string, ValidRun[]>();
  for (const run of runs) {
    runsById.set(run.record.run_id, run);
    const parent = run.record.escalation_of;
    if (parent) {
      const children = childrenByParent.get(parent) ?? [];
      children.push(run);
      childrenByParent.set(parent, children);
    }
  }

  const escalationDepth = (runId: string): number | null => {
    let depth = 0;
    let current = runsById.get(runId);
    const visited = new Set<string>();
    while (current?.record.escalation_of) {
      if (visited.has(current.record.run_id)) {
        diagnostics.push(
          diagnostic(
            "invalid-escalation-lineage",
            "join",
            "escalation_of lineage contains a cycle",
            current.line,
            runId,
          ),
        );
        return null;
      }
      visited.add(current.record.run_id);
      depth += 1;
      current = runsById.get(current.record.escalation_of);
      if (!current) {
        return depth;
      }
    }
    return depth;
  };

  return annotations.map(({ record: annotation, line }) => {
    const run = runsById.get(annotation.run_id);
    if (!run) {
      diagnostics.push(
        diagnostic(
          "run-join-unavailable",
          "join",
          "annotation has no matching runs.jsonl record",
          line,
          annotation.run_id,
        ),
      );
      return {
        runId: annotation.run_id,
        escalationOf: null,
        annotationOutcome: annotation.outcome,
        runStatus: null,
        observed: { state: null, escalationChildRunId: null },
        shadow: {
          verdict: null,
          events: [],
          projectedState: null,
          escalationDepth: null,
          impliedEscalationBand: null,
        },
        classification: "unavailable",
        explanation: "runs.jsonl join unavailable; no transition was inferred",
      };
    }

    const base = {
      runId: annotation.run_id,
      escalationOf: run.record.escalation_of ?? null,
      annotationOutcome: annotation.outcome,
      runStatus: run.record.status,
    };

    if (annotation.outcome === "accepted") {
      const projection = verificationProjection(annotation.run_id, {
        kind: "pass",
        evidence: PARENT_EVIDENCE,
      });
      return {
        ...base,
        observed: { state: "accepted" as const, escalationChildRunId: null },
        shadow: {
          verdict: projection.verdict,
          events: projection.events,
          projectedState: projection.projectedState,
          escalationDepth: escalationDepth(annotation.run_id),
          impliedEscalationBand: null,
        },
        classification: classificationFor("accepted", projection),
        explanation:
          projection.rejection === null
            ? "accepted agrees with the step()-projected passing verification"
            : `step() rejected the passing verification: ${projection.rejection}`,
      };
    }

    if (annotation.outcome === "blocked") {
      const projection = verificationProjection(annotation.run_id, {
        kind: "fail-blocked",
        reason: "post-hoc annotation reported blocked",
      });
      return {
        ...base,
        observed: { state: "blocked" as const, escalationChildRunId: null },
        shadow: {
          verdict: projection.verdict,
          events: projection.events,
          projectedState: projection.projectedState,
          escalationDepth: escalationDepth(annotation.run_id),
          impliedEscalationBand: null,
        },
        classification: classificationFor("blocked", projection),
        explanation:
          projection.rejection === null
            ? "blocked agrees with the step()-projected fail-blocked verification"
            : `step() rejected the fail-blocked verification: ${projection.rejection}`,
      };
    }

    if (annotation.outcome === "verification-failed") {
      const projection = verificationProjection(
        annotation.run_id,
        {
          kind: "fail-quality",
          unmetCriteria: [],
          evidence: PARENT_EVIDENCE,
        },
        {
          followup: {
            event: {
              kind: "escalation-denied",
              reason: "post-hoc annotation implies escalation denial",
            },
            label: "escalation-denied",
          },
        },
      );
      return {
        ...base,
        observed: {
          state: "verification-failed" as const,
          escalationChildRunId: null,
        },
        shadow: {
          verdict: projection.verdict,
          events: projection.events,
          projectedState: projection.projectedState,
          escalationDepth: escalationDepth(annotation.run_id),
          impliedEscalationBand: null,
        },
        classification: classificationFor("verification-failed", projection),
        explanation:
          projection.rejection === null
            ? "verification-failed agrees with step() after fail-quality and implied escalation denial"
            : `step() rejected the implied verification-failed path: ${projection.rejection}`,
      };
    }

    if (annotation.outcome === "rejected") {
      if (run.record.status === "completed") {
        return {
          ...base,
          observed: { state: "rejected" as const, escalationChildRunId: null },
          shadow: {
            verdict: null,
            events: [],
            projectedState: null,
            escalationDepth: escalationDepth(annotation.run_id),
            impliedEscalationBand: null,
          },
          classification: "indeterminate" as const,
          explanation:
            "a rejected completed run does not reveal fail-quality versus fail-approach",
        };
      }
      const projection = terminalDispatchProjection(annotation.run_id);
      return {
        ...base,
        observed: { state: "rejected" as const, escalationChildRunId: null },
        shadow: {
          verdict: projection.verdict,
          events: projection.events,
          projectedState: projection.projectedState,
          escalationDepth: escalationDepth(annotation.run_id),
          impliedEscalationBand: null,
        },
        classification: classificationFor("rejected", projection),
        explanation:
          projection.rejection === null
            ? `rejected ${run.record.status} run agrees with step() after terminal dispatch failure`
            : `step() rejected the terminal dispatch path: ${projection.rejection}`,
      };
    }

    const depth = escalationDepth(annotation.run_id);
    const child = childrenByParent.get(annotation.run_id)?.[0];
    diagnostics.push(
      diagnostic(
        "historical-capability-band-unavailable",
        "join",
        "historical capability floor is unavailable; escalation band remains symbolic floor+1",
        line,
        annotation.run_id,
      ),
    );
    if (!child) {
      diagnostics.push(
        diagnostic(
          "escalation-child-unavailable",
          "join",
          "escalated annotation has no escalation_of child in runs.jsonl",
          line,
          annotation.run_id,
        ),
      );
      const projection = verificationProjection(
        annotation.run_id,
        {
          kind: "fail-quality",
          unmetCriteria: [],
          evidence: PARENT_EVIDENCE,
        },
        {
          escalationsUsed: depth ?? 0,
          followup: {
            event: {
              kind: "escalation-authorized",
              toBand: SYNTHETIC_ESCALATION_BAND,
            },
            label: "escalation-authorized:floor+1",
          },
        },
      );
      return {
        ...base,
        observed: { state: null, escalationChildRunId: null },
        shadow: {
          verdict: projection.verdict,
          events: projection.events,
          projectedState: projection.projectedState,
          escalationDepth: depth,
          impliedEscalationBand: "floor+1" as const,
        },
        classification: "unavailable" as const,
        explanation:
          "the escalation transition cannot be confirmed without its child run",
      };
    }
    if (depth === null) {
      return {
        ...base,
        observed: {
          state: "dispatch" as const,
          escalationChildRunId: child.record.run_id,
        },
        shadow: {
          verdict: "fail-quality" as const,
          events: ["verified:fail-quality"],
          projectedState: null,
          escalationDepth: null,
          impliedEscalationBand: "floor+1" as const,
        },
        classification: "unavailable" as const,
        explanation: "invalid lineage prevents escalation-budget replay",
      };
    }
    const projection = verificationProjection(
      annotation.run_id,
      {
        kind: "fail-quality",
        unmetCriteria: [],
        evidence: PARENT_EVIDENCE,
      },
      {
        escalationsUsed: depth,
        ...(depth < ASSUMED_POLICY.budget.maxEscalations
          ? {
              followup: {
                event: {
                  kind: "escalation-authorized" as const,
                  toBand: SYNTHETIC_ESCALATION_BAND,
                },
                label: "escalation-authorized:floor+1",
              },
            }
          : {}),
      },
    );
    const classification = classificationFor("dispatch", projection);
    return {
      ...base,
      observed: {
        state: "dispatch" as const,
        escalationChildRunId: child.record.run_id,
      },
      shadow: {
        verdict: projection.verdict,
        events: projection.events,
        projectedState: projection.projectedState,
        escalationDepth: depth,
        impliedEscalationBand: "floor+1" as const,
      },
      classification,
      explanation:
        projection.rejection !== null
          ? `step() rejected the implied escalation path: ${projection.rejection}`
          : classification === "agreement"
            ? "observed escalation agrees with step() after fail-quality and symbolic floor+1 authorization"
            : "observed escalation diverges from step() under the assumed one-escalation policy",
    };
  });
}

function createReport(input: {
  annotations: readonly LocatedValue[];
  runs: readonly LocatedValue[];
  annotationsAvailable: boolean;
  runsAvailable: boolean;
  annotationLines: number;
  runLines: number;
  annotationParseSkipped: number;
  runParseSkipped: number;
  initialDiagnostics: readonly AnnotationShadowDiagnostic[];
}): AnnotationShadowReport {
  const diagnostics = [...input.initialDiagnostics];
  const annotations: ValidAnnotation[] = [];
  const runs: ValidRun[] = [];
  let invalidAnnotations = input.annotationParseSkipped;
  let invalidRuns = input.runParseSkipped;

  for (const [order, located] of input.annotations.entries()) {
    const record = annotationFrom(located.value);
    if (!record) {
      invalidAnnotations += 1;
      diagnostics.push(
        diagnostic(
          "unknown-annotation",
          "annotations",
          "skipped annotation with an unknown schema or invalid shape",
          located.line,
        ),
      );
      continue;
    }
    annotations.push({ record, line: located.line, order });
  }

  for (const [order, located] of input.runs.entries()) {
    const record = runFrom(located.value);
    if (!record) {
      invalidRuns += 1;
      diagnostics.push(
        diagnostic(
          "unknown-run",
          "runs",
          "skipped run with an unknown or invalid shape",
          located.line,
        ),
      );
      continue;
    }
    runs.push({ record, line: located.line, order });
  }

  const latestByRun = new Map<string, ValidAnnotation>();
  for (const annotation of annotations) {
    latestByRun.set(annotation.record.run_id, annotation);
  }
  const latest = [...latestByRun.values()].sort(
    (left, right) => left.order - right.order,
  );
  const transitions = classifyTransitions(latest, runs, diagnostics);
  const count = (classification: AnnotationShadowClassification): number =>
    transitions.filter((entry) => entry.classification === classification).length;
  const failQuality = transitions.filter(
    (entry) => entry.shadow.verdict === "fail-quality",
  ).length;
  const pass = transitions.filter(
    (entry) => entry.shadow.verdict === "pass",
  ).length;
  const failBlocked = transitions.filter(
    (entry) => entry.shadow.verdict === "fail-blocked",
  ).length;
  const terminalRejected = transitions.filter(
    (entry) =>
      entry.annotationOutcome === "rejected" &&
      entry.shadow.projectedState === "rejected",
  ).length;
  const denominator = failQuality;

  return {
    contract: ANNOTATION_SHADOW_REPORT_CONTRACT,
    schema: ANNOTATION_SHADOW_REPORT_SCHEMA_VERSION,
    assumedPolicy: {
      source: "task-machine defaults",
      verification: "parent",
      authorization: "parent",
      budget: { ...DEFAULT_TASK_BUDGET_POLICY },
      syntheticCapabilityFloor: SYNTHETIC_CAPABILITY_FLOOR,
      syntheticRemainingBudgetCost: SYNTHETIC_REMAINING_BUDGET_COST,
      explanation:
        "historical task policy, budget, and capability floors are absent from runs.jsonl; replay uses task-machine defaults with a synthetic affordable floor solely to exercise step()",
    },
    unavailableInputs: {
      historicalTaskPolicy: true,
      historicalBudgetLedger: true,
      historicalCapabilityBands: true,
      failApproachLabels: true,
    },
    inputs: {
      annotations: {
        available: input.annotationsAvailable,
        lines: input.annotationLines,
        validRecords: annotations.length,
        latestRecords: latest.length,
        supersededRecords: annotations.length - latest.length,
        skippedRecords: invalidAnnotations,
      },
      runs: {
        available: input.runsAvailable,
        lines: input.runLines,
        validRecords: runs.length,
        skippedRecords: invalidRuns,
      },
      historicalCapabilityBands: {
        available: false,
        inferenceUsed: false,
      },
    },
    accounting: {
      total: transitions.length,
      agreements: count("agreement"),
      divergences: count("divergence"),
      indeterminate: count("indeterminate"),
      unavailable: count("unavailable"),
    },
    verdictCounts: {
      pass,
      failQuality,
      failApproach: 0,
      failBlocked,
      terminalRejected,
      indeterminate: count("indeterminate"),
      unavailable: count("unavailable"),
    },
    failureRatio: {
      failQuality,
      failApproach: 0,
      denominator,
      ratio: denominator === 0 ? null : failQuality / denominator,
      failApproachObservable: false,
      explanation:
        "ratio = failQuality / (failQuality + failApproach); annotations have no fail-approach outcome, so failApproach is unobservable and counted as zero",
    },
    transitionDiff: transitions,
    diagnostics,
  };
}

/** Build a deterministic report from already parsed records. */
export function buildAnnotationShadowReport(
  input: AnnotationShadowRecordsInput,
): AnnotationShadowReport {
  return createReport({
    annotations: input.annotations.map((value, index) => ({
      value,
      line: index + 1,
    })),
    runs: input.runs.map((value, index) => ({ value, line: index + 1 })),
    annotationsAvailable: input.annotationsAvailable ?? true,
    runsAvailable: input.runsAvailable ?? true,
    annotationLines: input.annotations.length,
    runLines: input.runs.length,
    annotationParseSkipped: 0,
    runParseSkipped: 0,
    initialDiagnostics: [
      ...(input.annotationsAvailable === false
        ? [
            diagnostic(
              "annotations-unavailable",
              "annotations",
              "annotations.jsonl is unavailable",
            ),
          ]
        : []),
      ...(input.runsAvailable === false
        ? [
            diagnostic("runs-unavailable", "runs", "runs.jsonl is unavailable"),
          ]
        : []),
    ],
  });
}

/** Parse JSONL and build the report without reading files or ambient state. */
export function replayAnnotationShadowJsonl(
  input: AnnotationShadowJsonlInput,
): AnnotationShadowReport {
  const annotations = parseJsonl(input.annotationsJsonl, "annotations");
  const runs = parseJsonl(input.runsJsonl, "runs");
  return createReport({
    annotations: annotations.values,
    runs: runs.values,
    annotationsAvailable: input.annotationsJsonl !== null,
    runsAvailable: input.runsJsonl !== null,
    annotationLines: annotations.nonEmptyLines,
    runLines: runs.nonEmptyLines,
    annotationParseSkipped: annotations.skipped,
    runParseSkipped: runs.skipped,
    initialDiagnostics: [...annotations.diagnostics, ...runs.diagnostics],
  });
}
