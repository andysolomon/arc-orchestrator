// Deterministic parser for the normative `arc-model-policy` block. This is the
// TypeScript port of arc-pi's scripts/model-policy.mjs (synchronized into the
// runtime as scripts/model-policy.mjs). It is pure: no model, no network, no
// filesystem, no hashing — callers digest `canonicalPolicyJson` themselves.
// A parity test in the runtime holds this parser byte-for-byte against the
// synchronized .mjs parser over the shipped document.

import type {
  ParentDefault,
  PolicySurface,
  RouteBinding,
  RoutingPolicy,
  RungId,
} from "./policy-schema";
import {
  EFFORT_LEVELS,
  TASK_PHASES,
  WORKER_PHASES,
  WORKLOAD_CLASSES,
  type Backend,
  type Effort,
  type TaskPhase,
  type WorkerPhase,
  type WorkloadClass,
} from "./vocabulary";

export const POLICY_DOCUMENT = "policy/arc-model-policy.md";
export const POLICY_FENCE = "arc-model-policy";

// The parser accepts every backend the arc-pi grammar admits, including the
// `cursor` spelling arc-pi still recognizes for older documents.
const POLICY_BACKENDS = [
  "codex",
  "composer",
  "claude",
  "cursor",
  "minimax",
  "opencode",
  "kimi",
] as const;

const ID = /^[a-z0-9][a-z0-9.-]*$/;
// Provider model ids may carry one provider prefix (`opencode-go/glm-5.3`);
// stable ids never do, so a `/` can only appear in the provider column.
const PROVIDER_MODEL_ID =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/;

export class ModelPolicyError extends Error {
  readonly line: number | null;
  constructor(message: string, line: number | null = null) {
    super(line == null ? message : `${message} (line ${line})`);
    this.name = "ModelPolicyError";
    this.line = line;
  }
}

/** Extract the single fenced `arc-model-policy` block from a Markdown document. */
export function extractPolicyBlock(markdown: string): {
  text: string;
  startLine: number;
  // Zero-based line indexes of the fence lines, for patch generation.
  fenceOpenIndex: number;
  fenceCloseIndex: number;
} {
  const lines = markdown.split(/\r?\n/);
  const blocks: Array<{ start: number; body: string[]; close: number }> = [];
  let open: { start: number; body: string[] } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (open == null) {
      if (line.trim() === `\`\`\`${POLICY_FENCE}`) {
        open = { start: index + 1, body: [] };
      }
      continue;
    }
    if (line.trim() === "```") {
      blocks.push({ ...open, close: index });
      open = null;
      continue;
    }
    open.body.push(line);
  }
  if (open != null) {
    throw new ModelPolicyError(
      `unterminated ${POLICY_FENCE} block`,
      open.start,
    );
  }
  if (blocks.length !== 1) {
    throw new ModelPolicyError(
      `expected exactly one ${POLICY_FENCE} block, found ${blocks.length}`,
    );
  }
  const block = blocks[0]!;
  return {
    text: block.body.join("\n"),
    startLine: block.start + 1,
    fenceOpenIndex: block.start - 1,
    fenceCloseIndex: block.close,
  };
}

function splitList(value: string, line: number): string[] {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (items.length === 0) {
    throw new ModelPolicyError("expected a non-empty list", line);
  }
  return items;
}

function isEffort(value: string): value is Effort {
  return (EFFORT_LEVELS as readonly string[]).includes(value);
}

function parseRung(token: string, line: number): RungId {
  const at = token.lastIndexOf("@");
  if (at <= 0 || at === token.length - 1) {
    throw new ModelPolicyError(
      `rung "${token}" must be <stable-id>@<effort>`,
      line,
    );
  }
  const stableId = token.slice(0, at);
  const effort = token.slice(at + 1);
  if (!ID.test(stableId)) {
    throw new ModelPolicyError(`invalid stable id "${stableId}"`, line);
  }
  if (!isEffort(effort)) {
    throw new ModelPolicyError(
      `unknown effort "${effort}" in rung "${token}"`,
      line,
    );
  }
  return `${stableId}@${effort}`;
}

function parseParentDefault(value: string, line: number): ParentDefault {
  const match = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)@([a-z]+)$/.exec(value);
  if (!match) {
    throw new ModelPolicyError(
      `parent-default must be <provider>/<model>@<effort>, got "${value}"`,
      line,
    );
  }
  const [, provider, model, effort] = match;
  if (!isEffort(effort!)) {
    throw new ModelPolicyError(`unknown effort "${effort}"`, line);
  }
  return { provider: provider!, model: model!, effort };
}

function parseBinding(base: string, value: string, line: number): RouteBinding {
  const parts = value.split("|").map((part) => part.trim());
  if (parts.length < 4 || parts.length > 5) {
    throw new ModelPolicyError(
      `binding ${base} must be "Display Name | stable-id | provider-model-id | backend [| default-effort]"`,
      line,
    );
  }
  const [displayName, stableId, providerModelId, backend, defaultEffort] =
    parts as [string, string, string, string, string | undefined];
  if (!ID.test(base)) {
    throw new ModelPolicyError(`invalid binding base "${base}"`, line);
  }
  if (displayName.length === 0) {
    throw new ModelPolicyError(`binding ${base} needs a display name`, line);
  }
  if (!ID.test(stableId)) {
    throw new ModelPolicyError(`invalid stable id "${stableId}"`, line);
  }
  if (!PROVIDER_MODEL_ID.test(providerModelId)) {
    throw new ModelPolicyError(
      `invalid provider model id "${providerModelId}"`,
      line,
    );
  }
  if (!(POLICY_BACKENDS as readonly string[]).includes(backend)) {
    throw new ModelPolicyError(`unknown backend "${backend}"`, line);
  }
  if (defaultEffort != null && !isEffort(defaultEffort)) {
    throw new ModelPolicyError(
      `unknown default effort "${defaultEffort}"`,
      line,
    );
  }
  return {
    base,
    displayName,
    stableId,
    providerModelId,
    backend: backend as Backend,
    ...(defaultEffort != null ? { defaultEffort: defaultEffort as Effort } : {}),
  };
}

// `surface <stable-id>: Name [| fixed-effort <effort>]`.
function parseSurface(stableId: string, value: string, line: number): PolicySurface {
  const parts = value.split("|").map((part) => part.trim());
  if (parts.length < 1 || parts.length > 2) {
    throw new ModelPolicyError(
      `surface ${stableId} must be "Surface Name [| fixed-effort <effort>]"`,
      line,
    );
  }
  const [name, flag] = parts as [string, string | undefined];
  if (name.length === 0) {
    throw new ModelPolicyError(`surface ${stableId} needs a name`, line);
  }
  let fixedEffort: Effort | null = null;
  if (flag != null) {
    const match = /^fixed-effort\s+([a-z]+)$/.exec(flag);
    if (!match) {
      throw new ModelPolicyError(
        `surface ${stableId}: unknown flag "${flag}" (only "fixed-effort <effort>")`,
        line,
      );
    }
    const candidate = match[1]!;
    if (!isEffort(candidate) || candidate === "none") {
      throw new ModelPolicyError(
        `surface ${stableId}: unknown fixed effort "${candidate}"`,
        line,
      );
    }
    fixedEffort = candidate;
  }
  return { name, fixedEffort };
}

/** Parse the body of an `arc-model-policy` block into a canonical policy object. */
export function parsePolicyBlock(text: string, startLine = 1): RoutingPolicy {
  const scalars = new Map<string, string>();
  const parentDefaults = new Map<string, ParentDefault>();
  const bindings: RouteBinding[] = [];
  const phaseChains = new Map<string, RungId[]>();
  const workloadChains = new Map<string, RungId[]>();
  const surfaces = new Map<string, PolicySurface>();
  let parentLocal: string[] | null = null;
  let tail: RungId[] | null = null;
  let excludedModels: string[] | null = null;
  let excludedEfforts: string[] | null = null;

  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = startLine + index;
    const raw = lines[index]!;
    const content = raw.replace(/\s+#.*$/, "").trim();
    if (content.length === 0 || content.startsWith("#")) continue;
    const colon = content.indexOf(":");
    if (colon <= 0) {
      throw new ModelPolicyError(`expected "<directive>: <value>"`, lineNumber);
    }
    const head = content.slice(0, colon).trim();
    const value = content.slice(colon + 1).trim();
    if (value.length === 0) {
      throw new ModelPolicyError(
        `directive "${head}" has no value`,
        lineNumber,
      );
    }
    const [directive, ...rest] = head.split(/\s+/);
    const argument = rest.join(" ");

    switch (directive) {
      case "policy":
      case "updated":
      case "supersedes":
      case "fallback": {
        if (argument) {
          throw new ModelPolicyError(
            `${directive} takes no argument`,
            lineNumber,
          );
        }
        if (scalars.has(directive)) {
          throw new ModelPolicyError(`duplicate ${directive}`, lineNumber);
        }
        scalars.set(directive, value);
        break;
      }
      case "parent-local": {
        if (parentLocal != null) {
          throw new ModelPolicyError("duplicate parent-local", lineNumber);
        }
        parentLocal = splitList(value, lineNumber);
        for (const phase of parentLocal) {
          if (!(TASK_PHASES as readonly string[]).includes(phase)) {
            throw new ModelPolicyError(`unknown phase "${phase}"`, lineNumber);
          }
        }
        break;
      }
      case "parent-default": {
        if (!/^[a-z][a-z0-9-]*$/.test(argument)) {
          throw new ModelPolicyError(
            "parent-default needs a surface name",
            lineNumber,
          );
        }
        if (parentDefaults.has(argument)) {
          throw new ModelPolicyError(
            `duplicate parent-default ${argument}`,
            lineNumber,
          );
        }
        parentDefaults.set(argument, parseParentDefault(value, lineNumber));
        break;
      }
      case "binding": {
        if (!argument) {
          throw new ModelPolicyError("binding needs a base", lineNumber);
        }
        if (bindings.some((binding) => binding.base === argument)) {
          throw new ModelPolicyError(
            `duplicate binding ${argument}`,
            lineNumber,
          );
        }
        bindings.push(parseBinding(argument, value, lineNumber));
        break;
      }
      case "surface": {
        if (!ID.test(argument)) {
          throw new ModelPolicyError(
            "surface needs a stable id argument",
            lineNumber,
          );
        }
        if (surfaces.has(argument)) {
          throw new ModelPolicyError(
            `duplicate surface ${argument}`,
            lineNumber,
          );
        }
        surfaces.set(argument, parseSurface(argument, value, lineNumber));
        break;
      }
      case "tail": {
        if (tail != null) {
          throw new ModelPolicyError("duplicate tail", lineNumber);
        }
        tail = splitList(value, lineNumber).map((token) =>
          parseRung(token, lineNumber),
        );
        break;
      }
      case "phase": {
        if (!(WORKER_PHASES as readonly string[]).includes(argument)) {
          throw new ModelPolicyError(
            `"${argument}" is not a delegable worker phase`,
            lineNumber,
          );
        }
        if (phaseChains.has(argument)) {
          throw new ModelPolicyError(`duplicate phase ${argument}`, lineNumber);
        }
        phaseChains.set(
          argument,
          splitList(value, lineNumber).map((token) =>
            parseRung(token, lineNumber),
          ),
        );
        break;
      }
      case "workload": {
        if (!(WORKLOAD_CLASSES as readonly string[]).includes(argument)) {
          throw new ModelPolicyError(
            `"${argument}" is not a canonical workload class`,
            lineNumber,
          );
        }
        if (workloadChains.has(argument)) {
          throw new ModelPolicyError(
            `duplicate workload ${argument}`,
            lineNumber,
          );
        }
        workloadChains.set(
          argument,
          splitList(value, lineNumber).map((token) =>
            parseRung(token, lineNumber),
          ),
        );
        break;
      }
      case "exclude-models": {
        if (excludedModels != null) {
          throw new ModelPolicyError("duplicate exclude-models", lineNumber);
        }
        excludedModels = splitList(value, lineNumber);
        break;
      }
      case "exclude-efforts": {
        if (excludedEfforts != null) {
          throw new ModelPolicyError("duplicate exclude-efforts", lineNumber);
        }
        excludedEfforts = splitList(value, lineNumber);
        for (const effort of excludedEfforts) {
          if (!isEffort(effort)) {
            throw new ModelPolicyError(
              `unknown effort "${effort}"`,
              lineNumber,
            );
          }
        }
        break;
      }
      default:
        throw new ModelPolicyError(
          `unknown directive "${directive}"`,
          lineNumber,
        );
    }
  }

  for (const required of ["policy", "updated", "fallback"]) {
    if (!scalars.has(required)) {
      throw new ModelPolicyError(`missing ${required}`);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scalars.get("updated")!)) {
    throw new ModelPolicyError("updated must be YYYY-MM-DD");
  }
  if (scalars.get("fallback") !== "availability-only") {
    throw new ModelPolicyError("fallback must be availability-only");
  }
  if (parentLocal == null) throw new ModelPolicyError("missing parent-local");
  if (!parentDefaults.has("pi")) {
    throw new ModelPolicyError("missing parent-default pi");
  }
  if (bindings.length === 0) throw new ModelPolicyError("missing bindings");
  if (tail == null) throw new ModelPolicyError("missing tail");
  for (const phase of WORKER_PHASES) {
    if (parentLocal.includes(phase)) {
      throw new ModelPolicyError(
        `phase ${phase} cannot be both parent-local and a worker chain`,
      );
    }
    if (!phaseChains.has(phase)) {
      throw new ModelPolicyError(`missing phase ${phase}`);
    }
  }
  for (const phase of parentLocal) {
    if (phaseChains.has(phase)) {
      throw new ModelPolicyError(`parent-local phase ${phase} has a chain`);
    }
  }
  for (const workloadClass of WORKLOAD_CLASSES) {
    if (!workloadChains.has(workloadClass)) {
      throw new ModelPolicyError(`missing workload ${workloadClass}`);
    }
  }
  const observedWorkloadOrder = [...workloadChains.keys()];
  if (observedWorkloadOrder.join(",") !== WORKLOAD_CLASSES.join(",")) {
    throw new ModelPolicyError(
      "workload chains must be listed in canonical order",
    );
  }

  const models = excludedModels ?? [];
  const efforts = excludedEfforts ?? [];
  const knownStableIds = new Set(bindings.map((binding) => binding.stableId));
  const validateChain = (name: string, primary: readonly RungId[]) => {
    const full = [...primary, ...tail!];
    const seen = new Set<string>();
    for (const rung of full) {
      const at = rung.lastIndexOf("@");
      const stableId = rung.slice(0, at);
      const effort = rung.slice(at + 1);
      if (!knownStableIds.has(stableId)) {
        throw new ModelPolicyError(
          `${name} references unbound model "${stableId}"`,
        );
      }
      if (models.includes(stableId)) {
        throw new ModelPolicyError(`${name} uses excluded model "${stableId}"`);
      }
      if (efforts.includes(effort)) {
        throw new ModelPolicyError(`${name} uses excluded effort "${effort}"`);
      }
      if (seen.has(rung)) {
        throw new ModelPolicyError(`${name} repeats rung "${rung}"`);
      }
      seen.add(rung);
    }
  };
  validateChain("tail", []);
  for (const [phase, chain] of phaseChains)
    validateChain(`phase ${phase}`, chain);
  for (const [klass, chain] of workloadChains) {
    validateChain(`workload ${klass}`, chain);
  }
  for (const binding of bindings) {
    if (models.includes(binding.stableId)) {
      throw new ModelPolicyError(
        `binding ${binding.base} exposes excluded model "${binding.stableId}"`,
      );
    }
    if (binding.defaultEffort && efforts.includes(binding.defaultEffort)) {
      throw new ModelPolicyError(
        `binding ${binding.base} defaults to excluded effort "${binding.defaultEffort}"`,
      );
    }
  }
  for (const [surface, parent] of parentDefaults) {
    if (efforts.includes(parent.effort)) {
      throw new ModelPolicyError(
        `parent-default ${surface} uses excluded effort "${parent.effort}"`,
      );
    }
  }
  for (const stableId of knownStableIds) {
    if (!surfaces.has(stableId)) {
      throw new ModelPolicyError(`missing surface ${stableId}`);
    }
  }
  for (const [stableId, surface] of surfaces) {
    if (!knownStableIds.has(stableId)) {
      throw new ModelPolicyError(`surface ${stableId} has no binding`);
    }
    if (surface.fixedEffort == null) continue;
    const chains: Array<[string, readonly RungId[]]> = [
      ["tail", tail],
      ...[...phaseChains].map(([phase, chain]): [string, RungId[]] => [`phase ${phase}`, chain]),
      ...[...workloadChains].map(([klass, chain]): [string, RungId[]] => [
        `workload ${klass}`,
        chain,
      ]),
    ];
    for (const [name, chain] of chains) {
      for (const rung of chain) {
        if (
          rung.startsWith(`${stableId}@`) &&
          rung !== `${stableId}@${surface.fixedEffort}`
        ) {
          throw new ModelPolicyError(
            `${name} routes fixed-effort model ${stableId} at "${rung.slice(stableId.length + 1)}" (fixed ${surface.fixedEffort})`,
          );
        }
      }
    }
    for (const binding of bindings) {
      if (
        binding.stableId === stableId &&
        binding.defaultEffort != null &&
        binding.defaultEffort !== surface.fixedEffort
      ) {
        throw new ModelPolicyError(
          `binding ${binding.base} defaults fixed-effort model ${stableId} to "${binding.defaultEffort}"`,
        );
      }
    }
  }

  return {
    label: scalars.get("policy")!,
    updated: scalars.get("updated")!,
    supersedes: scalars.get("supersedes") ?? null,
    fallback: "availability-only",
    parentLocalPhases: parentLocal as TaskPhase[],
    parentDefaults: Object.fromEntries(parentDefaults),
    routeBindings: bindings,
    surfaces: Object.fromEntries(
      bindings
        .map((binding) => binding.stableId)
        .filter((stableId, index, all) => all.indexOf(stableId) === index)
        .map((stableId) => [stableId, surfaces.get(stableId)!]),
    ),
    emergencyTail: tail,
    phaseChains: Object.fromEntries(
      WORKER_PHASES.map((phase) => [phase, phaseChains.get(phase)!]),
    ) as Record<WorkerPhase, RungId[]>,
    workloadChains: Object.fromEntries(
      WORKLOAD_CLASSES.map((klass) => [klass, workloadChains.get(klass)!]),
    ) as Record<WorkloadClass, RungId[]>,
    excludedModels: models,
    excludedEfforts: efforts as Effort[],
  };
}

export function parsePolicyDocument(markdown: string): RoutingPolicy {
  const block = extractPolicyBlock(markdown);
  return parsePolicyBlock(block.text, block.startLine);
}
