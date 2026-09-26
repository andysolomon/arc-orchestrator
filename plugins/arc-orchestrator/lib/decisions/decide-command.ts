// CLI call sites for Jev decisions, behind USE_JEV_DECISIONS.
//
//   arc-orchestrator decide route|assess|complete ...  (parent-facing command)
//   arc-orchestrator run ... --task-json <file>        (fills --workload-class)
//
// off (default): no Jev calls; the parent's decision stands, as today.
// shadow: Jev runs and its gated decision is logged with agreement against
//   the parent's decision, but only the parent's decision is acted on.
// on: the confidence-gated Jev decision is acted on.
//
// Worker execution never changes here; only how decisions are made.

import { readFileSync } from "node:fs";
import { normalizeWorkloadClass, type EnvLike, type WorkloadClass } from "../routes";
import {
  jevDecisionMode,
  resolveJevThresholds,
  type JevDecisionMode,
  type JevThresholds,
} from "./config";
import {
  type CompletionOutcome,
  type FableVerdict,
  type Gate,
  gateAssessment,
  gateCompletion,
  gateRoute,
} from "./gating";
import {
  assessTask,
  checkCompletion,
  JEV_WORKERS,
  logJevRecord,
  newDecisionId,
  parseJevTaskInput,
  routeTask,
  type JevCallContext,
  type JevDecisionName,
  type JevDeps,
  type JevTaskInput,
  type JevWorker,
} from "./jev";

export type DecideDeps = JevDeps & {
  // Reads a file path, or stdin for "-". Injected in tests.
  readText?: (path: string) => string;
};

export type DecideResult =
  | { exitCode: 0; output: Record<string, unknown> }
  | { exitCode: 2; error: string };

const COMPLETION_OUTCOMES = ["accepted", "rejected"] as const;
const DECIDE_OPTIONS = [
  "--task-json",
  "--worker-output",
  "--diff",
  "--fable-decision",
  "--fable-confidence",
] as const;

export const DECIDE_USAGE = [
  "  arc-orchestrator decide route --task-json <path|-> [--fable-decision <composer|codex|fable> --fable-confidence <0-1>]",
  "  arc-orchestrator decide assess --task-json <path|-> [--fable-decision <workload class> --fable-confidence <0-1>]",
  "  arc-orchestrator decide complete --task-json <path|-> --worker-output <path> --diff <path> [--fable-decision <accepted|rejected> --fable-confidence <0-1>]",
  "  Task JSON: {title, description?, acceptanceCriteria?: string[], filesTouched?: string[], estimatedSize?: small|medium|large}",
];

function defaultReadText(path: string): string {
  return readFileSync(path === "-" ? 0 : path, "utf8");
}

function readTaskJson(
  path: string,
  readText: (path: string) => string,
): { ok: true; task: JevTaskInput } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(readText(path));
  } catch (error) {
    return {
      ok: false,
      error: `--task-json could not be read as JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  const parsed = parseJevTaskInput(raw);
  return parsed.ok ? parsed : { ok: false, error: `--task-json: ${parsed.error}` };
}

// What the orchestrator did before Jev: the parent's own decision, if it made
// one, and otherwise the decision is still the parent's to make.
function parentDecision<T>(fable: FableVerdict<T> | null, mode: JevDecisionMode): Gate<T> {
  if (fable) {
    return {
      action: "auto",
      value: fable.value,
      decidedBy: "fable",
      reasons: [`USE_JEV_DECISIONS=${mode}: the parent's decision stands`],
    };
  }
  return {
    action: "needs_fable",
    value: null,
    decidedBy: null,
    reasons: [`USE_JEV_DECISIONS=${mode}: the parent decides`],
  };
}

function agreement<T>(jev: Gate<T>, applied: T | null): boolean | null {
  return jev.value === null || applied === null ? null : jev.value === applied;
}

function logGate<T>(
  deps: JevDeps,
  context: JevCallContext,
  gate: Gate<T>,
  applied: Gate<T> | T | null,
  agrees: boolean | null,
): void {
  logJevRecord(deps, context, { kind: "gate", gate, applied, agrees });
}

// Dispatch hint for the parent, using the existing CLI contract.
function dispatchFor(worker: JevWorker | null, workloadClass: WorkloadClass | null): string | null {
  switch (worker) {
    case "composer":
      return "arc-orchestrator run --route composer-implement --mode implement --task <task>";
    case "codex":
      return workloadClass
        ? `arc-orchestrator run --routing-policy runner-routing-v4 --phase implement --mode implement --workload-class ${workloadClass} --task <task>`
        : null;
    case "fable":
      return "parent-local: keep the task in the Fable thread";
    default:
      return null;
  }
}

export async function runDecide(args: string[], deps: DecideDeps): Promise<DecideResult> {
  const kind = args[0];
  if (kind !== "route" && kind !== "assess" && kind !== "complete") {
    return { exitCode: 2, error: "decide requires route, assess, or complete" };
  }
  const values = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index] ?? "";
    const value = args[index + 1];
    if (!(DECIDE_OPTIONS as readonly string[]).includes(flag)) {
      return { exitCode: 2, error: `unknown decide option: ${flag}` };
    }
    if (value === undefined || value.startsWith("--")) {
      return { exitCode: 2, error: `missing value for ${flag}` };
    }
    values.set(flag, value);
  }

  const readText = deps.readText ?? defaultReadText;
  const taskPath = values.get("--task-json");
  if (!taskPath) {
    return { exitCode: 2, error: "decide requires --task-json" };
  }
  const taskResult = readTaskJson(taskPath, readText);
  if (!taskResult.ok) {
    return { exitCode: 2, error: taskResult.error };
  }
  const task = taskResult.task;

  const fableRaw = values.get("--fable-decision")?.trim().toLowerCase();
  const fableConfidenceRaw = values.get("--fable-confidence")?.trim();
  if ((fableRaw === undefined) !== (fableConfidenceRaw === undefined)) {
    return {
      exitCode: 2,
      error: "--fable-decision and --fable-confidence must be passed together",
    };
  }
  let fableConfidence = 0;
  if (fableConfidenceRaw !== undefined) {
    fableConfidence = Number(fableConfidenceRaw);
    if (!Number.isFinite(fableConfidence) || fableConfidence < 0 || fableConfidence > 1) {
      return { exitCode: 2, error: "--fable-confidence must be a number from 0 to 1" };
    }
  }

  const mode = jevDecisionMode(deps.env);
  const { thresholds, warnings } = resolveJevThresholds(deps.env);
  for (const warning of warnings) {
    console.error(`arc-orchestrator: ${warning}`);
  }
  const decisionId = newDecisionId();
  const base = { mode, decision_id: decisionId, ...(mode === "shadow" ? { shadow: true } : {}) };

  if (kind === "route") {
    let fable: FableVerdict<JevWorker> | null = null;
    if (fableRaw !== undefined) {
      if (!(JEV_WORKERS as readonly string[]).includes(fableRaw)) {
        return { exitCode: 2, error: "--fable-decision for route must be composer, codex, or fable" };
      }
      fable = { value: fableRaw as JevWorker, confidence: fableConfidence };
    }
    return {
      exitCode: 0,
      output: {
        decision: "route",
        ...base,
        ...(await decideRoute(task, fable, mode, thresholds, decisionId, deps)),
      },
    };
  }

  if (kind === "assess") {
    let fable: FableVerdict<WorkloadClass> | null = null;
    if (fableRaw !== undefined) {
      const workloadClass = normalizeWorkloadClass(fableRaw);
      if (!workloadClass) {
        return {
          exitCode: 2,
          error: "--fable-decision for assess must be one of the nine workload classes",
        };
      }
      fable = { value: workloadClass, confidence: fableConfidence };
    }
    const context = jevContext("assess", decisionId, mode);
    const assessment = mode === "off" ? null : await assessTask(task, deps, context);
    const jevGate = gateAssessment(
      { assessment, estimatedSize: task.estimatedSize, fable },
      thresholds,
    );
    const applied = mode === "on" ? jevGate : parentDecision(fable, mode);
    if (mode !== "off") {
      const withoutFable = gateAssessment(
        { assessment, estimatedSize: task.estimatedSize },
        thresholds,
      );
      logGate(deps, context, jevGate, applied, agreement(withoutFable, fable?.value ?? null));
    }
    return {
      exitCode: 0,
      output: {
        decision: "assess",
        ...base,
        action: applied.action,
        workload_class: applied.value,
        decided_by: applied.decidedBy,
        reasons: applied.reasons,
        ...(mode === "on" && assessment?.ok
          ? {
              scores: {
                complexity: assessment.value.complexity,
                risk: assessment.value.risk,
                spec_clarity: assessment.value.specClarity,
              },
            }
          : {}),
      },
    };
  }

  // complete
  const outputPath = values.get("--worker-output");
  const diffPath = values.get("--diff");
  if (!outputPath || !diffPath) {
    return { exitCode: 2, error: "decide complete requires --worker-output and --diff" };
  }
  let workerOutput: unknown;
  let diff: string;
  try {
    const outputText = readText(outputPath);
    try {
      workerOutput = JSON.parse(outputText);
    } catch {
      workerOutput = outputText;
    }
    diff = readText(diffPath);
  } catch (error) {
    return {
      exitCode: 2,
      error: `could not read worker output or diff: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  let fable: FableVerdict<CompletionOutcome> | null = null;
  if (fableRaw !== undefined) {
    if (!(COMPLETION_OUTCOMES as readonly string[]).includes(fableRaw)) {
      return { exitCode: 2, error: "--fable-decision for complete must be accepted or rejected" };
    }
    fable = { value: fableRaw as CompletionOutcome, confidence: fableConfidence };
  }
  const context = jevContext("completion", decisionId, mode);
  const [completion, assessment] =
    mode === "off"
      ? [null, null]
      : await Promise.all([
          checkCompletion(task, workerOutput, diff, deps, context),
          assessTask(task, deps, jevContext("assess", decisionId, mode)),
        ]);
  const jevGate = gateCompletion({ completion, assessment, fable }, thresholds);
  const applied = mode === "on" ? jevGate : parentDecision(fable, mode);
  if (mode !== "off") {
    const withoutFable = gateCompletion({ completion, assessment }, thresholds);
    logGate(deps, context, jevGate, applied, agreement(withoutFable, fable?.value ?? null));
  }
  return {
    exitCode: 0,
    output: {
      decision: "complete",
      ...base,
      action: applied.action,
      outcome: applied.value,
      decided_by: applied.decidedBy,
      reasons: applied.reasons,
      ...(mode === "on" && completion?.ok
        ? {
            checks: {
              criteria_satisfied: completion.value.criteriaSatisfied,
              in_scope: completion.value.inScope,
              tests_updated: completion.value.testsUpdated,
              needs_human_review: completion.value.needsHumanReview,
            },
          }
        : {}),
    },
  };
}

function jevContext(
  decision: JevDecisionName,
  decisionId: string,
  mode: JevDecisionMode,
): JevCallContext {
  return { decision, decisionId, mode, source: "decide" };
}

async function decideRoute(
  task: JevTaskInput,
  fable: FableVerdict<JevWorker> | null,
  mode: JevDecisionMode,
  thresholds: JevThresholds,
  decisionId: string,
  deps: JevDeps,
): Promise<Record<string, unknown>> {
  const [route, assessment] =
    mode === "off"
      ? [null, null]
      : await Promise.all([
          routeTask(task, deps, jevContext("route", decisionId, mode)),
          assessTask(task, deps, jevContext("assess", decisionId, mode)),
        ]);
  const routeGate = gateRoute({ route, assessment, fable }, thresholds);
  const classGate = gateAssessment(
    { assessment, estimatedSize: task.estimatedSize },
    thresholds,
  );

  // Codex runs the automatic implement stack, which needs a workload class;
  // if Jev cannot supply one confidently, that part goes back to Fable (or a
  // human, when the class gate says so).
  const jevGate: Gate<JevWorker> =
    routeGate.action === "auto" && routeGate.value === "codex" && classGate.action !== "auto"
      ? {
          ...routeGate,
          action: classGate.action,
          reasons: [
            ...routeGate.reasons,
            ...classGate.reasons.map((reason) => `workload class: ${reason}`),
          ],
        }
      : routeGate;
  const workloadClass = classGate.action === "auto" ? classGate.value : null;

  const applied = mode === "on" ? jevGate : parentDecision(fable, mode);
  if (mode !== "off") {
    const withoutFable = gateRoute({ route, assessment }, thresholds);
    logGate(
      deps,
      jevContext("route", decisionId, mode),
      jevGate,
      applied,
      agreement(withoutFable, fable?.value ?? null),
    );
  }

  if (mode !== "on") {
    return {
      action: applied.action,
      worker: applied.value,
      workload_class: null,
      decided_by: applied.decidedBy,
      reasons: applied.reasons,
      dispatch: null,
    };
  }
  return {
    action: jevGate.action,
    worker: jevGate.value,
    workload_class: workloadClass,
    decided_by: jevGate.decidedBy,
    reasons: jevGate.reasons,
    dispatch: jevGate.action === "auto" ? dispatchFor(jevGate.value, workloadClass) : null,
    ...(route?.ok
      ? {
          jev: {
            worker: route.value.worker,
            confidence: route.value.confidence,
            probabilities: route.value.probabilities,
          },
        }
      : {}),
    ...(assessment?.ok
      ? {
          scores: {
            complexity: assessment.value.complexity,
            risk: assessment.value.risk,
            spec_clarity: assessment.value.specClarity,
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// run: fill --workload-class for automatic implement from assessTask.
// ---------------------------------------------------------------------------

export type JevRunPreparation = {
  argv: string[];
  // Shadow comparison still in flight; await it before the process exits.
  shadow: Promise<void> | null;
  error: string | null;
  notes: string[];
};

function optionValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function withoutOptions(argv: string[], flags: string[]): string[] {
  const kept: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (flags.includes(argv[index] ?? "")) {
      index += 1;
      continue;
    }
    kept.push(argv[index]!);
  }
  return kept;
}

// Runs before parseArguments. Strips --task-json and --human-approved (which
// the run parser does not know), and under USE_JEV_DECISIONS asks assessTask
// for automatic implement runs. Off leaves argv exactly as the parser saw it
// before this feature.
export async function prepareJevRun(
  argv: string[],
  deps: DecideDeps,
): Promise<JevRunPreparation> {
  const none = (args: string[], notes: string[] = []): JevRunPreparation => ({
    argv: args,
    shadow: null,
    error: null,
    notes,
  });
  if (argv[0] !== "run") {
    return none(argv);
  }
  const taskPath = optionValue(argv, "--task-json");
  const humanApprovedRaw = optionValue(argv, "--human-approved");
  const stripped = withoutOptions(argv, ["--task-json", "--human-approved"]);
  for (const [flag, value] of [
    ["--task-json", taskPath],
    ["--human-approved", humanApprovedRaw],
  ] as const) {
    if (argv.includes(flag) && (value === undefined || value.startsWith("--"))) {
      return { ...none(stripped), error: `missing value for ${flag}` };
    }
  }
  if (humanApprovedRaw !== undefined && humanApprovedRaw.trim().toLowerCase() !== "true") {
    return { ...none(stripped), error: "--human-approved must be true" };
  }
  const mode = jevDecisionMode(deps.env);
  if (mode === "off" || taskPath === undefined) {
    return none(stripped);
  }

  const automaticImplement =
    optionValue(argv, "--mode") === "implement" &&
    !argv.includes("--route") &&
    !argv.includes("--backend") &&
    !argv.includes("--worker-model") &&
    (optionValue(argv, "--orchestrator") ??
      deps.env.ARC_ORCHESTRATOR_ORCHESTRATOR ??
      "").trim().toLowerCase() !== "eco";
  if (!automaticImplement) {
    return none(stripped, [
      "jev: --task-json only informs automatic --mode implement runs; ignored",
    ]);
  }

  const taskResult = readTaskJson(taskPath, deps.readText ?? defaultReadText);
  if (!taskResult.ok) {
    return mode === "on"
      ? { ...none(stripped), error: taskResult.error }
      : none(stripped, [`jev shadow skipped: ${taskResult.error}`]);
  }
  const task = taskResult.task;
  const { thresholds } = resolveJevThresholds(deps.env);
  const parentClass = normalizeWorkloadClass(optionValue(argv, "--workload-class"));
  const decisionId = newDecisionId();
  const context: JevCallContext = { decision: "assess", decisionId, mode, source: "run" };

  const evaluate = async () => {
    const assessment = await assessTask(task, deps, context);
    const gate = gateAssessment({ assessment, estimatedSize: task.estimatedSize }, thresholds);
    return gate;
  };

  if (mode === "shadow") {
    const shadow = evaluate().then((gate) => {
      logGate(deps, context, gate, parentClass, agreement(gate, parentClass));
    });
    return { argv: stripped, shadow: shadow.catch(() => {}), error: null, notes: [] };
  }

  const gate = await evaluate();
  const notes: string[] = [];
  if (gate.action === "needs_human" && humanApprovedRaw === undefined) {
    logGate(deps, context, gate, null, agreement(gate, parentClass));
    return {
      argv: stripped,
      shadow: null,
      error: `jev: ${gate.reasons.join("; ")}. Rerun with --human-approved true after a human approves this task.`,
      notes,
    };
  }
  let finalArgv = stripped;
  let applied: WorkloadClass | null = parentClass;
  if (parentClass) {
    notes.push(`jev: keeping the parent's --workload-class ${parentClass}`);
  } else if (gate.action === "auto" && gate.value) {
    finalArgv = [...stripped, "--workload-class", gate.value];
    applied = gate.value;
    notes.push(`jev: --workload-class ${gate.value} (${gate.reasons.join("; ")})`);
  } else {
    notes.push(`jev: no confident workload class; the parent must pass one (${gate.reasons.join("; ")})`);
  }
  logGate(deps, context, gate, applied, agreement(gate, parentClass));
  return { argv: finalArgv, shadow: null, error: null, notes };
}
