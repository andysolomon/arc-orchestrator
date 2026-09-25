// Advisory TypeSafe Jev (System One) sidecar for runner-routing-v4.
//
// Jev classifies a task into the phases, workload axes, and candidate workers
// the policy already uses, and returns structured suggestions with confidence.
// The runner never applies those suggestions. runner-routing-v4 remains the
// only authority for the worker that actually runs.

import type {
  ChoiceCriteria,
  EntryType,
  Fetch,
  JsonValue,
  Questions,
} from "@typesafe-ai/sdk";

type TypeSafeSdk = typeof import("@typesafe-ai/sdk");
import {
  CANDIDATE_STACKS,
  type CandidateStack,
} from "./model-registry";
import { MODEL_POLICY } from "./model-policy";
import type { RoutingIntent } from "./routing-intent";
import {
  normalizeWorkloadClass,
  PARENT_LOCAL_PHASES,
  ROUTING_POLICY_LABEL,
  type WorkloadClass,
} from "./routes";
import type { EnvLike } from "./routes";
import {
  sanitizeFailureDetail,
  TASK_PHASES,
  type Mode,
  type TaskPhase,
} from "./trace-schema";

export const JEV_ROUTING_SCHEMA_VERSION = 1;
export const JEV_ROUTING_FLAG = "ARC_JEV_ROUTING";
export const JEV_API_KEY_ENV = "TYPESAFE_API_KEY";
export const JEV_CONFIDENCE_THRESHOLD_ENV = "ARC_JEV_CONFIDENCE_THRESHOLD";
export const JEV_TIMEOUT_MS_ENV = "ARC_JEV_TIMEOUT_MS";
export const JEV_MODEL_ENV = "ARC_JEV_MODEL";
export const DEFAULT_JEV_CONFIDENCE_THRESHOLD = 0.6;
export const DEFAULT_JEV_TIMEOUT_MS = 4_000;
export const DEFAULT_JEV_MODEL = "jev-latest";

const DIFFICULTY_LEVELS = ["easy", "medium", "hard"] as const;
const VOLUME_LEVELS = ["light", "medium", "heavy"] as const;

const PHASE_DETAILS: Partial<Record<TaskPhase, string>> = {
  explore: "Optional context gathering before analysis.",
  research: "External evidence when local evidence is insufficient.",
  plan: "A plan for a change that is not simple and bounded.",
  implement: "Make the code change. Implementation uses a workload class.",
  verify: "Run unit, end-to-end, typecheck, lint, build, or performance checks.",
  deploy: "Human-in-the-loop deploy after explicit authorization.",
};

export type JevDisposition = "advisory" | "low_confidence";

export type JevChoiceSuggestion = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
  disposition: JevDisposition;
};

export type JevScoreSuggestion = {
  type: "score";
  score: number;
  level: string;
  confidence: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  disposition: JevDisposition;
};

export type JevNoulSuggestion = {
  type: "noul";
  noul: number;
  // Noul answers have no confidence field. This is max(noul, 1 - noul):
  // how sure the decided side is.
  confidence: number;
  disposition: JevDisposition;
};

export type JevSkipReason =
  | "phase-fixed"
  | "no-candidate-stack"
  | "policy-does-not-select-among-candidates";

export type JevSkipped = {
  skipped: JevSkipReason;
};

export type JevWorkloadSuggestion = {
  type: "workload-class";
  workloadClass: WorkloadClass;
  difficulty: JevScoreSuggestion;
  volume: JevScoreSuggestion;
  disposition: JevDisposition;
};

export type JevWorkerSuggestion = JevChoiceSuggestion & {
  candidateScope: "resolved-stack" | "automatic-union";
};

export type JevSuggestions = {
  phase: JevChoiceSuggestion | JevSkipped | null;
  workloadClass: JevWorkloadSuggestion | null;
  worker: JevWorkerSuggestion | JevSkipped | null;
  parentLocal: JevNoulSuggestion | null;
  hitl: JevNoulSuggestion | null;
};

export type JevRoutingStatus =
  | "disabled"
  | "ok"
  | "low_confidence"
  | "error";

export type JevRoutingAdvisory = {
  schema: typeof JEV_ROUTING_SCHEMA_VERSION;
  role: "advisory";
  authority: typeof ROUTING_POLICY_LABEL;
  applied: false;
  status: JevRoutingStatus;
  model: string | null;
  confidenceThreshold: number;
  durationMs: number;
  error: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
  stated: {
    phase: TaskPhase | null;
    workloadClass: string | null;
    routingIntent: RoutingIntent;
  };
  suggestions: JevSuggestions;
};

export type JevRoutingClient = {
  systemOne(
    request: {
      state: EntryType;
      model?: string;
      questions: Questions;
    },
    options?: { timeoutMs?: number },
  ): Promise<unknown>;
};

export type JevRoutingRequest = {
  env: EnvLike;
  task: string;
  phase: TaskPhase | null;
  workloadClass: string | null;
  mode: Mode;
  routingIntent: RoutingIntent;
  label: string | null;
  taskClass: string | null;
  routeRationale: string | null;
  requestedAlias: string | null;
};

export type JevRoutingOptions = {
  client?: JevRoutingClient;
  emitStderr?: (line: string) => void;
  fetch?: Fetch;
  nowMs?: () => number;
};

export function jevRoutingEnabled(env: EnvLike): boolean {
  return env[JEV_ROUTING_FLAG]?.trim() === "1";
}

export function jevRoutingObservability(env: EnvLike): {
  enabled: boolean;
  api_key_configured: boolean;
  advisory_ready: boolean;
  confidence_threshold: number;
  authority: typeof ROUTING_POLICY_LABEL;
} {
  const enabled = jevRoutingEnabled(env);
  const apiKeyConfigured = Boolean(env[JEV_API_KEY_ENV]?.trim());
  return {
    enabled,
    api_key_configured: apiKeyConfigured,
    advisory_ready: enabled && apiKeyConfigured,
    confidence_threshold: confidenceThreshold(env),
    authority: ROUTING_POLICY_LABEL,
  };
}

export function createTypeSafeJevClient(
  sdk: TypeSafeSdk,
  config: {
    apiKey: string;
    timeoutMs: number;
    model: string;
    fetch?: Fetch;
  },
): JevRoutingClient {
  const client = new sdk.TypeSafeClient({
    apiKey: config.apiKey,
    timeout: config.timeoutMs,
    defaultModel: config.model,
    logLevel: "error",
    retry: { maxRetries: 0 },
    ...(config.fetch ? { fetch: config.fetch } : {}),
  });
  return {
    async systemOne(request, options) {
      return await client.systemOne(
        {
          state: request.state,
          questions: request.questions,
          model: request.model ?? config.model,
        },
        {
          timeout: options?.timeoutMs ?? config.timeoutMs,
          retry: { maxRetries: 0 },
        },
      );
    },
  };
}

export async function adviseJevRouting(
  request: JevRoutingRequest,
  options: JevRoutingOptions = {},
): Promise<JevRoutingAdvisory> {
  if (!jevRoutingEnabled(request.env)) {
    return disabledAdvisory(request);
  }

  const startedAt = (options.nowMs ?? Date.now)();
  const threshold = confidenceThreshold(request.env);
  const timeoutMs = timeoutMsFrom(request.env);
  const model = modelFrom(request.env);
  const apiKey = request.env[JEV_API_KEY_ENV]?.trim() ?? "";
  const emit = options.emitStderr ?? console.error;

  const finish = (advisory: JevRoutingAdvisory): JevRoutingAdvisory => {
    emit(`arc-orchestrator: ${formatAdvisory(advisory)}`);
    return advisory;
  };

  if (!apiKey) {
    return finish(
      errorAdvisory(
        request,
        threshold,
        0,
        `${JEV_ROUTING_FLAG}=1 requires ${JEV_API_KEY_ENV}; continuing with ${ROUTING_POLICY_LABEL} only`,
      ),
    );
  }

  try {
    const sdk = await loadTypeSafeSdk();
    const client =
      options.client ??
      createTypeSafeJevClient(sdk, {
        apiKey,
        timeoutMs,
        model,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
    const asked = buildQuestions(request, sdk);
    const response = await client.systemOne(
      {
        state: routingState(request, asked.workerScope),
        model,
        questions: asked.questions,
      },
      { timeoutMs },
    );
    const durationMs = Math.max(0, (options.nowMs ?? Date.now)() - startedAt);
    return finish(
      interpretResponse({
        request,
        response,
        threshold,
        durationMs,
        fallbackModel: model,
        asked,
        apiKey,
      }),
    );
  } catch (error) {
    const durationMs = Math.max(0, (options.nowMs ?? Date.now)() - startedAt);
    return finish(
      errorAdvisory(
        request,
        threshold,
        durationMs,
        `${publicError(error, apiKey)}; continuing with ${ROUTING_POLICY_LABEL} only`,
      ),
    );
  }
}

type WorkerPlan =
  | { ids: string[]; scope: "resolved-stack" | "automatic-union" }
  | { skipped: JevSkipReason };

type AskedQuestions = {
  questions: Questions;
  phaseOptions: readonly string[] | null;
  workerOptions: readonly string[] | null;
  workerScope: "resolved-stack" | "automatic-union" | null;
  workerSkip: JevSkipReason | null;
  phaseSkip: JevSkipReason | null;
};

function disabledAdvisory(request: JevRoutingRequest): JevRoutingAdvisory {
  return {
    schema: JEV_ROUTING_SCHEMA_VERSION,
    role: "advisory",
    authority: ROUTING_POLICY_LABEL,
    applied: false,
    status: "disabled",
    model: null,
    confidenceThreshold: DEFAULT_JEV_CONFIDENCE_THRESHOLD,
    durationMs: 0,
    error: null,
    usage: null,
    stated: statedFrom(request),
    suggestions: emptySuggestions(),
  };
}

function errorAdvisory(
  request: JevRoutingRequest,
  threshold: number,
  durationMs: number,
  error: string,
): JevRoutingAdvisory {
  return {
    schema: JEV_ROUTING_SCHEMA_VERSION,
    role: "advisory",
    authority: ROUTING_POLICY_LABEL,
    applied: false,
    status: "error",
    model: null,
    confidenceThreshold: threshold,
    durationMs,
    error,
    usage: null,
    stated: statedFrom(request),
    suggestions: emptySuggestions(),
  };
}

function emptySuggestions(): JevSuggestions {
  return {
    phase: null,
    workloadClass: null,
    worker: null,
    parentLocal: null,
    hitl: null,
  };
}

function statedFrom(request: JevRoutingRequest): JevRoutingAdvisory["stated"] {
  return {
    phase: request.phase,
    workloadClass: request.workloadClass,
    routingIntent: request.routingIntent,
  };
}

function delegablePhases(): TaskPhase[] {
  return TASK_PHASES.filter((phase) => !PARENT_LOCAL_PHASES.includes(phase));
}

async function loadTypeSafeSdk(): Promise<TypeSafeSdk> {
  return await import("@typesafe-ai/sdk");
}

function buildQuestions(
  request: JevRoutingRequest,
  sdk: TypeSafeSdk,
): AskedQuestions {
  const questions: Questions = {};
  const phaseSkip: JevSkipReason | null = request.phase ? "phase-fixed" : null;
  const phases = phaseSkip ? null : delegablePhases();
  if (phases) {
    const criteria: ChoiceCriteria = {};
    for (const phase of phases) {
      criteria[phase] = PHASE_DETAILS[phase] ?? phase;
    }
    questions.phase = sdk.choice(
      "Which runner-routing-v4 worker phase best fits `task`?",
      criteria,
    );
  }

  questions.difficulty = sdk.score(
    "Where does `task` sit on the runner-routing-v4 difficulty axis? 0 is easy, 1 is medium, and 2 is hard.",
    DIFFICULTY_LEVELS,
  );
  questions.volume = sdk.score(
    "Where does `task` sit on the runner-routing-v4 volume axis? 0 is light, 1 is medium, and 2 is heavy.",
    VOLUME_LEVELS,
  );

  const workerPlan = workerPlanFor(request);
  let workerScope: AskedQuestions["workerScope"] = null;
  let workerSkip: JevSkipReason | null = null;
  let workerOptions: string[] | null = null;
  if ("skipped" in workerPlan) {
    workerSkip = workerPlan.skipped;
  } else {
    workerScope = workerPlan.scope;
    workerOptions = workerPlan.ids;
    const criteria: ChoiceCriteria = {};
    for (const stableId of workerPlan.ids) {
      criteria[stableId] = workerDescription(stableId);
    }
    questions.worker = sdk.choice(
      workerPlan.scope === "resolved-stack"
        ? "Which candidate in the resolved runner-routing-v4 stack should lead `task`?"
        : "Which automatic runner-routing-v4 candidate should lead `task`?",
      criteria,
    );
  }

  questions.parent_local = sdk.noul(
    "Should `task` stay in the parent session instead of being delegated to a worker?",
    {
      true: "The work is Analyze, which runner-routing-v4 keeps parent-local, or it needs parent judgment rather than a worker.",
      false:
        "The work is a bounded worker phase: explore, research, plan, implement, verify, or deploy.",
    },
  );
  questions.hitl = sdk.noul(
    "Does `task` require explicit human authorization before deploy or shipping?",
    {
      true: "Deploy, or another shipping step that runner-routing-v4 treats as human-in-the-loop.",
      false: "No deploy or shipping authorization is required for this task.",
    },
  );

  return {
    questions,
    phaseOptions: phases,
    workerOptions,
    workerScope,
    workerSkip,
    phaseSkip,
  };
}

function workerPlanFor(request: JevRoutingRequest): WorkerPlan {
  if (request.routingIntent !== "automatic") {
    return { skipped: "policy-does-not-select-among-candidates" };
  }
  if (request.phase === "analyze") {
    return { skipped: "no-candidate-stack" };
  }
  if (request.phase && request.phase !== "implement") {
    const stack = stackForPhase(request.phase, null);
    if (!stack || stack.candidates.length < 2) {
      return { skipped: "no-candidate-stack" };
    }
    return { ids: [...stack.candidates], scope: "resolved-stack" };
  }
  if (request.phase === "implement") {
    const workload = normalizeWorkloadClass(request.workloadClass);
    if (workload) {
      const stack = stackForPhase("implement", workload);
      if (!stack || stack.candidates.length < 2) {
        return { skipped: "no-candidate-stack" };
      }
      return { ids: [...stack.candidates], scope: "resolved-stack" };
    }
    const ids = unionCandidates((stack) => stack.phase === "implement");
    if (ids.length < 2) {
      return { skipped: "no-candidate-stack" };
    }
    return { ids, scope: "automatic-union" };
  }
  const ids = unionCandidates((stack) => stack.automaticFallback);
  if (ids.length < 2) {
    return { skipped: "no-candidate-stack" };
  }
  return { ids, scope: "automatic-union" };
}

function stackForPhase(
  phase: TaskPhase,
  workloadClass: WorkloadClass | null,
): CandidateStack | null {
  return (
    CANDIDATE_STACKS.find((stack) => {
      if (!stack.automaticFallback || stack.phase !== phase) {
        return false;
      }
      if (phase === "implement") {
        return stack.workloadClass === workloadClass;
      }
      return true;
    }) ?? null
  );
}

function unionCandidates(
  predicate: (stack: CandidateStack) => boolean,
): string[] {
  const ids: string[] = [];
  for (const stack of CANDIDATE_STACKS) {
    if (!stack.automaticFallback || !predicate(stack)) {
      continue;
    }
    for (const stableId of stack.candidates) {
      if (!ids.includes(stableId)) {
        ids.push(stableId);
      }
    }
  }
  return ids;
}

function workerDescription(stableId: string): string {
  if (Object.prototype.hasOwnProperty.call(MODEL_POLICY.surfaces, stableId)) {
    const surface =
      MODEL_POLICY.surfaces[stableId as keyof typeof MODEL_POLICY.surfaces];
    return `${surface.name} (${stableId})`;
  }
  return stableId;
}

function routingState(
  request: JevRoutingRequest,
  workerScope: AskedQuestions["workerScope"],
): { [key: string]: JsonValue } {
  return {
    routing_policy: ROUTING_POLICY_LABEL,
    routing_intent: request.routingIntent,
    mode: request.mode,
    phase: request.phase,
    workload_class: request.workloadClass,
    task_class: request.taskClass,
    label: redactText(request.label, 80),
    route_rationale: redactText(request.routeRationale, 240),
    requested_alias: request.requestedAlias,
    worker_candidate_scope: workerScope,
    task: redactText(request.task, 4_000) ?? "",
  };
}

function redactText(
  value: string | null | undefined,
  limit: number,
): string | null {
  if (value == null) {
    return null;
  }
  return sanitizeFailureDetail(value, limit);
}

function interpretResponse(input: {
  request: JevRoutingRequest;
  response: unknown;
  threshold: number;
  durationMs: number;
  fallbackModel: string;
  asked: AskedQuestions;
  apiKey: string;
}): JevRoutingAdvisory {
  const parsed = parseEnvelope(input.response);
  if (!parsed.ok) {
    return errorAdvisory(
      input.request,
      input.threshold,
      input.durationMs,
      parsed.error,
    );
  }

  const problems: string[] = [];
  const suggestions = emptySuggestions();
  if (input.asked.phaseSkip) {
    suggestions.phase = { skipped: input.asked.phaseSkip };
  } else if (input.asked.phaseOptions) {
    const phase = parseChoice(
      parsed.answers.phase,
      input.asked.phaseOptions,
      input.threshold,
    );
    if (!phase.ok) {
      problems.push(`phase: ${phase.error}`);
    } else {
      suggestions.phase = phase.value;
    }
  }

  const difficulty = parseScore(
    parsed.answers.difficulty,
    DIFFICULTY_LEVELS,
    input.threshold,
  );
  const volume = parseScore(
    parsed.answers.volume,
    VOLUME_LEVELS,
    input.threshold,
  );
  if (!difficulty.ok) {
    problems.push(`difficulty: ${difficulty.error}`);
  }
  if (!volume.ok) {
    problems.push(`volume: ${volume.error}`);
  }
  if (difficulty.ok && volume.ok) {
    const workloadClass = normalizeWorkloadClass(
      `${difficulty.value.level}-${volume.value.level}`,
    );
    if (!workloadClass) {
      problems.push("workload class is outside the canonical nine classes");
    } else {
      suggestions.workloadClass = {
        type: "workload-class",
        workloadClass,
        difficulty: difficulty.value,
        volume: volume.value,
        disposition:
          difficulty.value.disposition === "low_confidence" ||
          volume.value.disposition === "low_confidence"
            ? "low_confidence"
            : "advisory",
      };
    }
  }

  if (input.asked.workerSkip) {
    suggestions.worker = { skipped: input.asked.workerSkip };
  } else if (input.asked.workerOptions && input.asked.workerScope) {
    const worker = parseChoice(
      parsed.answers.worker,
      input.asked.workerOptions,
      input.threshold,
    );
    if (!worker.ok) {
      problems.push(`worker: ${worker.error}`);
    } else {
      suggestions.worker = {
        ...worker.value,
        candidateScope: input.asked.workerScope,
      };
    }
  }

  const parentLocal = parseNoul(parsed.answers.parent_local, input.threshold);
  const hitl = parseNoul(parsed.answers.hitl, input.threshold);
  if (!parentLocal.ok) {
    problems.push(`parent_local: ${parentLocal.error}`);
  } else {
    suggestions.parentLocal = parentLocal.value;
  }
  if (!hitl.ok) {
    problems.push(`hitl: ${hitl.error}`);
  } else {
    suggestions.hitl = hitl.value;
  }

  if (problems.length > 0) {
    return {
      ...errorAdvisory(
        input.request,
        input.threshold,
        input.durationMs,
        publicError(problems.join("; "), input.apiKey),
      ),
      model: parsed.model ?? input.fallbackModel,
      usage: parsed.usage,
      suggestions,
    };
  }

  const lowConfidence = [
    suggestions.phase,
    suggestions.workloadClass,
    suggestions.worker,
    suggestions.parentLocal,
    suggestions.hitl,
  ].some(
    (suggestion) =>
      suggestion != null &&
      "disposition" in suggestion &&
      suggestion.disposition === "low_confidence",
  );

  return {
    schema: JEV_ROUTING_SCHEMA_VERSION,
    role: "advisory",
    authority: ROUTING_POLICY_LABEL,
    applied: false,
    status: lowConfidence ? "low_confidence" : "ok",
    model: parsed.model ?? input.fallbackModel,
    confidenceThreshold: input.threshold,
    durationMs: input.durationMs,
    error: null,
    usage: parsed.usage,
    stated: statedFrom(input.request),
    suggestions,
  };
}

type ParsedEnvelope = {
  ok: true;
  model: string | null;
  answers: Record<string, unknown>;
  usage: JevRoutingAdvisory["usage"];
};

function parseEnvelope(
  response: unknown,
): ParsedEnvelope | { ok: false; error: string } {
  if (!isRecord(response) || !isRecord(response.answers)) {
    return { ok: false, error: "jev response did not include answers" };
  }
  const model = typeof response.model === "string" ? response.model : null;
  const usage = isRecord(response.usage) ? parseUsage(response.usage) : null;
  return { ok: true, model, answers: response.answers, usage };
}

function parseUsage(
  usage: Record<string, unknown>,
): JevRoutingAdvisory["usage"] {
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  if (
    typeof inputTokens !== "number" ||
    typeof outputTokens !== "number" ||
    !Number.isFinite(inputTokens) ||
    !Number.isFinite(outputTokens)
  ) {
    return null;
  }
  return { input_tokens: inputTokens, output_tokens: outputTokens };
}

function parseChoice(
  value: unknown,
  options: readonly string[],
  threshold: number,
): { ok: true; value: JevChoiceSuggestion } | { ok: false; error: string } {
  if (!isRecord(value) || value.type !== "choice") {
    return { ok: false, error: "missing choice answer" };
  }
  const selected = value.choice;
  const confidence = value.confidence;
  if (typeof selected !== "string" || !options.includes(selected)) {
    return { ok: false, error: "choice is outside the supplied options" };
  }
  if (!isUnitInterval(confidence)) {
    return { ok: false, error: "choice confidence is missing" };
  }
  return {
    ok: true,
    value: {
      type: "choice",
      choice: selected,
      confidence,
      probabilities: numberRecord(value.probabilities, options),
      disposition: dispositionFor(confidence, threshold),
    },
  };
}

function parseScore(
  value: unknown,
  levels: readonly string[],
  threshold: number,
): { ok: true; value: JevScoreSuggestion } | { ok: false; error: string } {
  if (!isRecord(value) || value.type !== "score") {
    return { ok: false, error: "missing score answer" };
  }
  const rawScore = value.score;
  const confidence = value.confidence;
  if (typeof rawScore !== "number" || !Number.isFinite(rawScore)) {
    return { ok: false, error: "score is missing" };
  }
  if (!isUnitInterval(confidence)) {
    return { ok: false, error: "score confidence is missing" };
  }
  const index = Math.max(
    0,
    Math.min(levels.length - 1, Math.round(rawScore)),
  );
  const level = levels[index] ?? levels[0]!;
  const legend = stringRecord(value.legend);
  if (Object.keys(legend).length === 0) {
    for (const [levelIndex, description] of levels.entries()) {
      legend[String(levelIndex)] = description;
    }
  }
  return {
    ok: true,
    value: {
      type: "score",
      score: rawScore,
      level,
      confidence,
      legend,
      probabilities: numberRecord(
        value.probabilities,
        levels.map((_, levelIndex) => String(levelIndex)),
      ),
      disposition: dispositionFor(confidence, threshold),
    },
  };
}

function parseNoul(
  value: unknown,
  threshold: number,
): { ok: true; value: JevNoulSuggestion } | { ok: false; error: string } {
  if (!isRecord(value) || value.type !== "noul") {
    return { ok: false, error: "missing noul answer" };
  }
  const probability = value.noul;
  if (!isUnitInterval(probability)) {
    return { ok: false, error: "noul probability is missing" };
  }
  const confidence = Math.max(probability, 1 - probability);
  return {
    ok: true,
    value: {
      type: "noul",
      noul: probability,
      confidence,
      disposition: dispositionFor(confidence, threshold),
    },
  };
}

function dispositionFor(confidence: number, threshold: number): JevDisposition {
  return confidence < threshold ? "low_confidence" : "advisory";
}

function confidenceThreshold(env: EnvLike): number {
  const raw = env[JEV_CONFIDENCE_THRESHOLD_ENV]?.trim();
  if (!raw) {
    return DEFAULT_JEV_CONFIDENCE_THRESHOLD;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return DEFAULT_JEV_CONFIDENCE_THRESHOLD;
  }
  return parsed;
}

function timeoutMsFrom(env: EnvLike): number {
  const raw = env[JEV_TIMEOUT_MS_ENV]?.trim();
  if (!raw) {
    return DEFAULT_JEV_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    return DEFAULT_JEV_TIMEOUT_MS;
  }
  return Math.max(250, Math.min(15_000, parsed));
}

function modelFrom(env: EnvLike): string {
  const raw = env[JEV_MODEL_ENV]?.trim();
  if (!raw || !/^[A-Za-z0-9._-]{1,80}$/.test(raw)) {
    return DEFAULT_JEV_MODEL;
  }
  return raw;
}

function formatAdvisory(advisory: JevRoutingAdvisory): string {
  if (advisory.status === "error") {
    return `jev advisory status=error applied=false authority=${advisory.authority} error=${advisory.error ?? "jev request failed"}`;
  }
  return [
    `jev advisory status=${advisory.status}`,
    "applied=false",
    `authority=${advisory.authority}`,
    `phase=${formatSuggestion(advisory.suggestions.phase)}`,
    `workload=${formatWorkload(advisory.suggestions.workloadClass)}`,
    `worker=${formatSuggestion(advisory.suggestions.worker)}`,
    `parent_local=${formatNoul(advisory.suggestions.parentLocal)}`,
    `hitl=${formatNoul(advisory.suggestions.hitl)}`,
  ].join(" ");
}

function formatSuggestion(
  suggestion: JevChoiceSuggestion | JevSkipped | null,
): string {
  if (suggestion == null) {
    return "none";
  }
  if ("skipped" in suggestion) {
    return "skipped";
  }
  return `${suggestion.choice}:${suggestion.disposition}`;
}

function formatWorkload(suggestion: JevWorkloadSuggestion | null): string {
  if (suggestion == null) {
    return "none";
  }
  return `${suggestion.workloadClass}:${suggestion.disposition}`;
}

function formatNoul(suggestion: JevNoulSuggestion | null): string {
  if (suggestion == null) {
    return "none";
  }
  return `${suggestion.noul}:${suggestion.disposition}`;
}

function publicError(error: unknown, apiKey: string | undefined): string {
  const raw = error instanceof Error ? error.message : String(error);
  const scrubbed =
    apiKey && apiKey.length > 0 ? raw.split(apiKey).join("<redacted>") : raw;
  return sanitizeFailureDetail(scrubbed, 240) ?? "jev request failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function numberRecord(
  value: unknown,
  allowed: readonly string[],
): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }
  const copy: Record<string, number> = {};
  for (const key of allowed) {
    const entry = value[key];
    if (typeof entry === "number" && Number.isFinite(entry)) {
      copy[key] = entry;
    }
  }
  return copy;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  const copy: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      copy[key] = entry;
    }
  }
  return copy;
}
