// SYNCED FILE — do not edit. Source: arc-pi scripts/model-policy.mjs.
// Regenerate with: npm run policy:sync (in the arc-pi repository).
// Deterministic parser for the normative `arc-model-policy` block in
// docs/arc-model-update-<date>.md, plus the renderers for every generated
// artifact that ARC Pi and the sibling arc-orchestrator runner consume.
//
// Pure functions only: no model, no network, no filesystem. The sync CLI in
// scripts/sync-model-policy.mjs owns file I/O.
//
// This file is synchronized verbatim into the sibling arc-orchestrator runner
// (scripts/model-policy.mjs) together with the policy document so the runner
// can re-parse its local Markdown and reject a stale or hand-edited generated
// copy without an arc-pi checkout. Edit it here only.

import { createHash } from "node:crypto";

export const POLICY_DOCUMENT = "docs/arc-model-update-08-30-26.md";
export const POLICY_FENCE = "arc-model-policy";

export const EFFORT_LEVELS = ["none", "low", "medium", "high", "xhigh", "max"];
export const BACKENDS = [
  "codex",
  "composer",
  "claude",
  "minimax",
  "opencode",
  "kimi",
];
export const LIFECYCLE_PHASES = [
  "explore",
  "analyze",
  "research",
  "plan",
  "implement",
  "verify",
  "deploy",
];
export const WORKER_PHASES = [
  "explore",
  "research",
  "plan",
  "verify",
  "deploy",
];
export const WORKLOAD_CLASSES = [
  "hard-heavy",
  "hard-medium",
  "hard-light",
  "medium-heavy",
  "medium-medium",
  "medium-light",
  "easy-heavy",
  "easy-medium",
  "easy-light",
];

const ID = /^[a-z0-9][a-z0-9.-]*$/;
const PROVIDER_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class ModelPolicyError extends Error {
  constructor(message, line) {
    super(line == null ? message : `${message} (line ${line})`);
    this.name = "ModelPolicyError";
  }
}

/** Extract the single fenced `arc-model-policy` block from a Markdown document. */
export function extractPolicyBlock(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let open = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (open == null) {
      if (line.trim() === `\`\`\`${POLICY_FENCE}`) {
        open = { start: index + 1, body: [] };
      }
      continue;
    }
    if (line.trim() === "```") {
      blocks.push(open);
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
  return { text: blocks[0].body.join("\n"), startLine: blocks[0].start + 1 };
}

function splitList(value, line) {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (items.length === 0) {
    throw new ModelPolicyError("expected a non-empty list", line);
  }
  return items;
}

function parseRung(token, line) {
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
  if (!EFFORT_LEVELS.includes(effort)) {
    throw new ModelPolicyError(
      `unknown effort "${effort}" in rung "${token}"`,
      line,
    );
  }
  return `${stableId}@${effort}`;
}

function parseParentDefault(value, line) {
  const match = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)@([a-z]+)$/.exec(value);
  if (!match) {
    throw new ModelPolicyError(
      `parent-default must be <provider>/<model>@<effort>, got "${value}"`,
      line,
    );
  }
  const [, provider, model, effort] = match;
  if (!EFFORT_LEVELS.includes(effort)) {
    throw new ModelPolicyError(`unknown effort "${effort}"`, line);
  }
  return { provider, model, effort };
}

function parseBinding(base, value, line) {
  const parts = value.split("|").map((part) => part.trim());
  if (parts.length < 4 || parts.length > 5) {
    throw new ModelPolicyError(
      `binding ${base} must be "Display Name | stable-id | provider-model-id | backend [| default-effort]"`,
      line,
    );
  }
  const [displayName, stableId, providerModelId, backend, defaultEffort] =
    parts;
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
  if (!BACKENDS.includes(backend)) {
    throw new ModelPolicyError(`unknown backend "${backend}"`, line);
  }
  if (defaultEffort != null && !EFFORT_LEVELS.includes(defaultEffort)) {
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
    backend,
    ...(defaultEffort != null ? { defaultEffort } : {}),
  };
}

// `surface <stable-id>: Name [| fixed-effort <effort>]`. The name is the
// human-readable rung label on generated runner surfaces; `fixed-effort`
// records that the model is a fixed effort profile with no selectable effort
// control, and must agree with the shipped registry entry's fixedEffort.
function parseSurface(stableId, value, line) {
  const parts = value.split("|").map((part) => part.trim());
  if (parts.length < 1 || parts.length > 2) {
    throw new ModelPolicyError(
      `surface ${stableId} must be "Surface Name [| fixed-effort <effort>]"`,
      line,
    );
  }
  const [name, flag] = parts;
  if (name.length === 0) {
    throw new ModelPolicyError(`surface ${stableId} needs a name`, line);
  }
  let fixedEffort = null;
  if (flag != null) {
    const match = /^fixed-effort\s+([a-z]+)$/.exec(flag);
    if (!match) {
      throw new ModelPolicyError(
        `surface ${stableId}: unknown flag "${flag}" (only "fixed-effort <effort>")`,
        line,
      );
    }
    fixedEffort = match[1];
    if (!EFFORT_LEVELS.includes(fixedEffort) || fixedEffort === "none") {
      throw new ModelPolicyError(
        `surface ${stableId}: unknown fixed effort "${fixedEffort}"`,
        line,
      );
    }
  }
  return { name, fixedEffort };
}

/** Parse the body of an `arc-model-policy` block into a canonical policy object. */
export function parsePolicyBlock(text, startLine = 1) {
  const scalars = new Map();
  const parentDefaults = new Map();
  const bindings = [];
  const phaseChains = new Map();
  const workloadChains = new Map();
  const surfaces = new Map();
  let parentLocal = null;
  let tail = null;
  let excludedModels = null;
  let excludedEfforts = null;

  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = startLine + index;
    const raw = lines[index];
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
          if (!LIFECYCLE_PHASES.includes(phase)) {
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
        if (!WORKER_PHASES.includes(argument)) {
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
        if (!WORKLOAD_CLASSES.includes(argument)) {
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
          if (!EFFORT_LEVELS.includes(effort)) {
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scalars.get("updated"))) {
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
  const validateChain = (name, primary) => {
    const full = [...primary, ...tail];
    const seen = new Set();
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
  // Every bound model needs exactly one surface entry, and a fixed-effort
  // profile may only be routed at its fixed effort (or as the model's
  // default alias effort).
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
    for (const [name, chain] of [
      ["tail", tail],
      ...[...phaseChains].map(([phase, chain]) => [`phase ${phase}`, chain]),
      ...[...workloadChains].map(([klass, chain]) => [
        `workload ${klass}`,
        chain,
      ]),
    ]) {
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
    label: scalars.get("policy"),
    updated: scalars.get("updated"),
    supersedes: scalars.get("supersedes") ?? null,
    fallback: scalars.get("fallback"),
    parentLocalPhases: parentLocal,
    parentDefaults: Object.fromEntries(parentDefaults),
    routeBindings: bindings,
    surfaces: Object.fromEntries(
      bindings
        .map((binding) => binding.stableId)
        .filter((stableId, index, all) => all.indexOf(stableId) === index)
        .map((stableId) => [stableId, surfaces.get(stableId)]),
    ),
    emergencyTail: tail,
    phaseChains: Object.fromEntries(
      WORKER_PHASES.map((phase) => [phase, phaseChains.get(phase)]),
    ),
    workloadChains: Object.fromEntries(
      WORKLOAD_CLASSES.map((klass) => [klass, workloadChains.get(klass)]),
    ),
    excludedModels: models,
    excludedEfforts: efforts,
  };
}

export function parsePolicyDocument(markdown) {
  const block = extractPolicyBlock(markdown);
  return parsePolicyBlock(block.text, block.startLine);
}

/** Canonical, whitespace-free serialization used for digests. */
export function canonicalPolicyJson(policy) {
  return JSON.stringify(policy);
}

export function policyDigest(policy) {
  return createHash("sha256").update(canonicalPolicyJson(policy)).digest("hex");
}

function header(sourcePath) {
  return [
    `// GENERATED FILE — do not edit.`,
    `// Source: ${sourcePath} (fenced ${POLICY_FENCE} block).`,
    `// Regenerate with: npm run policy:sync (in the arc-pi repository).`,
  ].join("\n");
}

/** TypeScript module consumed by ARC Pi extensions/arc-orchestrator/routes.ts. */
export function renderPiPolicyModule(policy, sourcePath = POLICY_DOCUMENT) {
  const digest = policyDigest(policy);
  return `${header(sourcePath)}

export const modelPolicySource = ${JSON.stringify(
    { document: sourcePath, updated: policy.updated, digest },
    null,
    2,
  )} as const;

export const modelPolicy = ${JSON.stringify(policy, null, 2)} as const;
`;
}

/** TypeScript module consumed by the sibling arc-orchestrator runner. */
export function renderRunnerPolicyModule(policy, sourcePath = POLICY_DOCUMENT) {
  const digest = policyDigest(policy);
  return `${header(`arc-pi ${sourcePath}`)}
// Runner copy of the ARC model policy. MODEL_POLICY_SOURCE.digest is the
// SHA-256 of JSON.stringify(MODEL_POLICY). scripts/check-model-policy.mjs
// re-parses the synchronized docs/arc-model-policy.md and fails closed when
// this copy is stale or hand-edited; test/model-policy-sync.test.ts proves the
// registry and public bindings match it.

export const MODEL_POLICY_SOURCE = ${JSON.stringify(
    { document: sourcePath, updated: policy.updated, digest },
    null,
    2,
  )} as const;

export const MODEL_POLICY = ${JSON.stringify(policy, null, 2)} as const;
`;
}

/** JSON copy read by bin/arc-pi for parent launcher defaults. */
export function renderLauncherPolicyJson(policy, sourcePath = POLICY_DOCUMENT) {
  return `${JSON.stringify(
    {
      source: { document: sourcePath, updated: policy.updated },
      digest: policyDigest(policy),
      label: policy.label,
      parentDefaults: policy.parentDefaults,
    },
    null,
    2,
  )}\n`;
}

export const PI_POLICY_MODULE_PATH =
  "extensions/arc-orchestrator/model-policy.generated.ts";
export const LAUNCHER_POLICY_JSON_PATH = "defaults/model-policy.json";
export const RUNNER_POLICY_MODULE_PATH =
  "plugins/arc-orchestrator/lib/model-policy.generated.ts";
// Runner-local copies of the source document and this parser, so the runner
// can re-derive the policy digest from Markdown without an arc-pi checkout.
export const RUNNER_POLICY_DOCUMENT_PATH = "docs/arc-model-policy.md";
export const RUNNER_POLICY_PARSER_PATH = "scripts/model-policy.mjs";

/** Verbatim copy of the policy document for the runner, with a sync banner. */
export function renderRunnerPolicyDocument(
  markdown,
  sourcePath = POLICY_DOCUMENT,
) {
  return `<!-- SYNCED FILE — do not edit. Source: arc-pi ${sourcePath}. Regenerate with: npm run policy:sync (in the arc-pi repository). -->\n${markdown}`;
}

/** Verbatim copy of this parser module for the runner, with a sync banner. */
export function renderRunnerPolicyParser(parserSource) {
  return `// SYNCED FILE — do not edit. Source: arc-pi ${RUNNER_POLICY_PARSER_PATH}.\n// Regenerate with: npm run policy:sync (in the arc-pi repository).\n${parserSource}`;
}

/**
 * Every artifact rendered from one parsed policy, keyed by repo-relative path.
 * `markdown` (the source document) and `parserSource` (this module's source)
 * are required to render the runner's synchronized document and parser copies.
 */
export function renderArtifacts(
  policy,
  sourcePath = POLICY_DOCUMENT,
  { markdown = null, parserSource = null } = {},
) {
  return {
    pi: {
      [PI_POLICY_MODULE_PATH]: renderPiPolicyModule(policy, sourcePath),
      [LAUNCHER_POLICY_JSON_PATH]: renderLauncherPolicyJson(policy, sourcePath),
    },
    runner: {
      [RUNNER_POLICY_MODULE_PATH]: renderRunnerPolicyModule(policy, sourcePath),
      ...(markdown != null
        ? {
            [RUNNER_POLICY_DOCUMENT_PATH]: renderRunnerPolicyDocument(
              markdown,
              sourcePath,
            ),
          }
        : {}),
      ...(parserSource != null
        ? {
            [RUNNER_POLICY_PARSER_PATH]: renderRunnerPolicyParser(parserSource),
          }
        : {}),
    },
  };
}
