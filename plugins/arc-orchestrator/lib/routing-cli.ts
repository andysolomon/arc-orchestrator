// `arc-orchestrator routing <subcommand>`: the runtime plane's machine-readable
// routing surface. Every subcommand runs the shared routing-core functions over
// the shipped policy, registry, and capability snapshot, so what it prints is
// exactly what the arc-router control plane computes from the exported
// artifacts. Subcommands:
//
//   profile   --evidence <json|@file>                 workload profile for structured evidence
//   simulate  --context <json|@file> [--policy <file>] [--snapshot <file>|--no-snapshot] [--text]
//   validate  --policy <file>                          validate a candidate policy against the registry
//   diff      --policy <candidate> [--base <file>]     semantic diff against the shipped policy
//   replay    --traces <jsonl> --policy <candidate> [--base <file>] [--snapshot ...]
//   export    [--out <dir>]                            write the canonical routing artifacts
//   contract                                           print the routing bundle to stdout
//
// Policy files may be Markdown carrying the fenced `arc-model-policy` block or
// JSON (a routing-policy document or a bare policy object).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ROUTING_CORE_VERSION,
  buildRoutingBundle,
  diffPolicies,
  evaluateRouting,
  explainEvaluation,
  exportPolicyBundle,
  groupReplayableTraces,
  modelRegistryDocumentFor,
  parsePolicyDocument,
  parseTraceJsonl,
  policyDocumentFor,
  policyHasErrors,
  profileWorkload,
  renderExplanationText,
  replayTraces,
  validatePolicy,
  validateWorkloadEvidence,
  type CapabilitySnapshot,
  type RoutingContext,
  type RoutingPolicy,
  type RoutingPolicyDocument,
} from "../../../packages/routing-core/src/index";
import {
  loadCapabilitySnapshotFile,
  policyDigest,
  sha256Hex,
} from "../../../packages/routing-core/src/runtime";
import { MODEL_POLICY, MODEL_POLICY_SOURCE } from "./model-policy";
import { MODEL_REGISTRY } from "./model-registry";

export const ROUTING_ARTIFACTS_CONTRACT = "arc-routing-artifacts/v1" as const;
export const ROUTING_ARTIFACT_FILES = [
  "routing-policy.json",
  "model-registry.json",
  "capability-snapshot.json",
  "arc-model-policy.md",
] as const;
export const ROUTING_MANIFEST_FILE = "manifest.json";

const packageRoot = resolve(import.meta.dir, "../../..");
export const DEFAULT_ARTIFACT_DIRECTORY = resolve(
  packageRoot,
  "packages/routing-core/generated",
);
const SHIPPED_SNAPSHOT_PATH = resolve(
  packageRoot,
  "plugins/orchestrator-core/capability-snapshot.json",
);

class RoutingCliError extends Error {}

function fail(message: string): never {
  throw new RoutingCliError(message);
}

type ParsedOptions = { values: Map<string, string>; flags: Set<string> };

const FLAGS = new Set(["--text", "--json", "--no-snapshot"]);

function parseOptions(args: string[]): ParsedOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!argument.startsWith("--")) {
      fail(`unexpected argument: ${argument}`);
    }
    if (FLAGS.has(argument)) {
      flags.add(argument);
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`missing value for ${argument}`);
    }
    values.set(argument, value);
    index += 1;
  }
  return { values, flags };
}

/** `@path`, a path to an existing file, or inline JSON text. */
function readJsonArgument(option: string, raw: string): unknown {
  const trimmed = raw.trim();
  let text = trimmed;
  if (trimmed.startsWith("@")) {
    text = readFileSync(resolve(trimmed.slice(1)), "utf8");
  } else if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    if (!existsSync(resolve(trimmed))) {
      fail(`${option}: ${trimmed} is neither inline JSON nor an existing file`);
    }
    text = readFileSync(resolve(trimmed), "utf8");
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${option}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

export function loadPolicyFile(path: string): RoutingPolicy {
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    fail(`policy file does not exist: ${absolute}`);
  }
  const text = readFileSync(absolute, "utf8");
  if (absolute.endsWith(".md")) {
    return parsePolicyDocument(text);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`policy file is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const record = parsed as Partial<RoutingPolicyDocument> & Partial<RoutingPolicy>;
  const policy = (record.policy ?? record) as RoutingPolicy;
  if (typeof policy !== "object" || policy === null || typeof policy.label !== "string") {
    fail("policy file does not contain a routing policy");
  }
  return policy;
}

function assertValidPolicy(policy: RoutingPolicy, label: string): void {
  const issues = validatePolicy(policy, { registry: MODEL_REGISTRY });
  if (policyHasErrors(issues)) {
    fail(
      `${label} is invalid:\n  ${issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("\n  ")}`,
    );
  }
}

function loadSnapshot(options: ParsedOptions, nowMs: number): CapabilitySnapshot | null {
  if (options.flags.has("--no-snapshot")) {
    return null;
  }
  const path = options.values.get("--snapshot") ?? SHIPPED_SNAPSHOT_PATH;
  const loaded = loadCapabilitySnapshotFile(resolve(path), { entries: MODEL_REGISTRY, nowMs });
  if (!loaded.ok) {
    fail(`capability snapshot rejected:\n  ${loaded.errors.join("\n  ")}`);
  }
  return loaded.snapshot;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function runProfile(options: ParsedOptions): void {
  const raw = options.values.get("--evidence");
  if (raw === undefined) {
    fail("routing profile requires --evidence <json|@file>");
  }
  const validated = validateWorkloadEvidence(readJsonArgument("--evidence", raw));
  if (!validated.ok) {
    fail(`workload evidence rejected:\n  ${validated.errors.join("\n  ")}`);
  }
  const profile = profileWorkload(validated.evidence);
  if (options.flags.has("--text")) {
    process.stdout.write(
      `${profile.workloadClass} (${profile.difficulty} x ${profile.volume})\n${profile.reasons.map((reason) => `- ${reason}`).join("\n")}\n${profile.notes.map((note) => `note: ${note}`).join("\n")}${profile.notes.length ? "\n" : ""}`,
    );
    return;
  }
  print(profile);
}

function contextFromArgument(raw: string, nowMs: number): RoutingContext {
  const value = readJsonArgument("--context", raw) as Partial<RoutingContext>;
  if (typeof value !== "object" || value === null || typeof value.phase !== "string") {
    fail("--context must be a JSON object with at least a phase");
  }
  if (value.evidence != null) {
    const validated = validateWorkloadEvidence(value.evidence);
    if (!validated.ok) {
      fail(`context.evidence rejected:\n  ${validated.errors.join("\n  ")}`);
    }
  }
  return { ...value, phase: value.phase, nowMs: typeof value.nowMs === "number" ? value.nowMs : nowMs } as RoutingContext;
}

function runSimulate(options: ParsedOptions, nowMs: number): void {
  const raw = options.values.get("--context");
  if (raw === undefined) {
    fail("routing simulate requires --context <json|@file>");
  }
  const context = contextFromArgument(raw, nowMs);
  const policyPath = options.values.get("--policy");
  const policy = policyPath ? loadPolicyFile(policyPath) : MODEL_POLICY;
  if (policyPath) {
    assertValidPolicy(policy, policyPath);
  }
  const snapshot = loadSnapshot(options, context.nowMs);
  const evaluation = evaluateRouting({ policy, registry: MODEL_REGISTRY, snapshot, context });
  const explanation = explainEvaluation(evaluation, MODEL_REGISTRY, policy);
  if (options.flags.has("--text")) {
    process.stdout.write(`${renderExplanationText(explanation)}\n`);
    return;
  }
  print({ routingCore: ROUTING_CORE_VERSION, evaluation, explanation });
}

function runValidate(options: ParsedOptions): void {
  const policyPath = options.values.get("--policy");
  if (!policyPath) {
    fail("routing validate requires --policy <file>");
  }
  const policy = loadPolicyFile(policyPath);
  const issues = validatePolicy(policy, { registry: MODEL_REGISTRY });
  print({ policy: policy.label, updated: policy.updated, digest: policyDigest(policy), valid: !policyHasErrors(issues), issues });
  if (policyHasErrors(issues)) {
    process.exitCode = 1;
  }
}

function runDiff(options: ParsedOptions): void {
  const candidatePath = options.values.get("--policy");
  if (!candidatePath) {
    fail("routing diff requires --policy <candidate>");
  }
  const candidate = loadPolicyFile(candidatePath);
  const basePath = options.values.get("--base");
  const base = basePath ? loadPolicyFile(basePath) : MODEL_POLICY;
  const diff = diffPolicies(base, candidate);
  const bundle = exportPolicyBundle({
    current: base,
    candidate,
    digest: policyDigest(candidate),
    registry: MODEL_REGISTRY,
    currentDocument: basePath ? null : readFileSync(resolve(packageRoot, "docs/arc-model-policy.md"), "utf8"),
  });
  if (options.flags.has("--text")) {
    process.stdout.write(bundle.markdown);
    return;
  }
  print({ base: base.label, candidate: candidate.label, digest: policyDigest(candidate), diff, valid: bundle.valid, issues: bundle.issues, patch: bundle.patch });
}

function runReplay(options: ParsedOptions, nowMs: number): void {
  const tracesPath = options.values.get("--traces");
  const candidatePath = options.values.get("--policy");
  if (!tracesPath || !candidatePath) {
    fail("routing replay requires --traces <jsonl> and --policy <candidate>");
  }
  const candidate = loadPolicyFile(candidatePath);
  assertValidPolicy(candidate, candidatePath);
  const basePath = options.values.get("--base");
  const base = basePath ? loadPolicyFile(basePath) : MODEL_POLICY;
  const parsed = parseTraceJsonl(readFileSync(resolve(tracesPath), "utf8"));
  const traces = groupReplayableTraces(parsed.records);
  const snapshot = loadSnapshot(options, nowMs);
  const report = replayTraces(traces, { current: base, candidate }, MODEL_REGISTRY, snapshot, { nowMs });
  print({ ...report, invalidLines: parsed.invalid });
}

export function routingArtifacts(): Record<string, string> {
  const nowMs = 0; // structural validation only; freshness is select()'s concern at dispatch time
  const loaded = loadCapabilitySnapshotFile(SHIPPED_SNAPSHOT_PATH, { entries: MODEL_REGISTRY, nowMs });
  if (!loaded.ok) {
    fail(`shipped capability snapshot rejected:\n  ${loaded.errors.join("\n  ")}`);
  }
  const policyDocument = policyDocumentFor(
    JSON.parse(JSON.stringify(MODEL_POLICY)) as RoutingPolicy,
    MODEL_POLICY_SOURCE.digest,
    MODEL_POLICY_SOURCE.document,
  );
  const files: Record<string, string> = {
    "routing-policy.json": `${JSON.stringify(policyDocument, null, 2)}\n`,
    "model-registry.json": `${JSON.stringify(modelRegistryDocumentFor(MODEL_REGISTRY), null, 2)}\n`,
    "capability-snapshot.json": `${JSON.stringify(loaded.snapshot, null, 2)}\n`,
    // The synchronized policy document itself, so a control plane can render a
    // patch against the arc-pi source without an arc-orchestrator checkout.
    "arc-model-policy.md": readFileSync(resolve(packageRoot, "docs/arc-model-policy.md"), "utf8"),
  };
  const manifest = {
    contract: ROUTING_ARTIFACTS_CONTRACT,
    routingCore: ROUTING_CORE_VERSION,
    policy: { label: MODEL_POLICY.label, updated: MODEL_POLICY.updated, digest: MODEL_POLICY_SOURCE.digest },
    snapshotVersion: loaded.snapshot.snapshotVersion,
    files: Object.fromEntries(
      Object.entries(files).map(([name, text]) => [name, sha256Hex(text)]),
    ),
  };
  files[ROUTING_MANIFEST_FILE] = `${JSON.stringify(manifest, null, 2)}\n`;
  return files;
}

function runExport(options: ParsedOptions): void {
  const outDir = resolve(options.values.get("--out") ?? DEFAULT_ARTIFACT_DIRECTORY);
  const files = routingArtifacts();
  mkdirSync(outDir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const target = resolve(outDir, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  print({ out: outDir, files: Object.keys(files) });
}

function runContract(): void {
  const loaded = loadCapabilitySnapshotFile(SHIPPED_SNAPSHOT_PATH, { entries: MODEL_REGISTRY, nowMs: 0 });
  if (!loaded.ok) {
    fail(`shipped capability snapshot rejected:\n  ${loaded.errors.join("\n  ")}`);
  }
  print(
    buildRoutingBundle({
      policy: policyDocumentFor(JSON.parse(JSON.stringify(MODEL_POLICY)) as RoutingPolicy, MODEL_POLICY_SOURCE.digest, MODEL_POLICY_SOURCE.document),
      registry: MODEL_REGISTRY,
      snapshot: loaded.snapshot,
    }),
  );
}

export const ROUTING_USAGE_LINES = [
  "  arc-orchestrator routing profile --evidence <json|@file> [--text]",
  "  arc-orchestrator routing simulate --context <json|@file> [--policy <file>] [--snapshot <file>|--no-snapshot] [--text]",
  "  arc-orchestrator routing validate --policy <file>",
  "  arc-orchestrator routing diff --policy <candidate> [--base <file>] [--text]",
  "  arc-orchestrator routing replay --traces <jsonl> --policy <candidate> [--base <file>]",
  "  arc-orchestrator routing export [--out <dir>]",
  "  arc-orchestrator routing contract",
];

export async function runRoutingCommand(
  args: string[],
  nowMs: number = Date.now(),
): Promise<void> {
  const [subcommand, ...rest] = args;
  try {
    const options = parseOptions(rest);
    switch (subcommand) {
      case "profile":
        return runProfile(options);
      case "simulate":
        return runSimulate(options, nowMs);
      case "validate":
        return runValidate(options);
      case "diff":
        return runDiff(options);
      case "replay":
        return runReplay(options, nowMs);
      case "export":
        return runExport(options);
      case "contract":
        return runContract();
      default:
        fail(`unknown routing subcommand: ${subcommand ?? "(none)"}\n${ROUTING_USAGE_LINES.join("\n")}`);
    }
  } catch (error) {
    if (error instanceof RoutingCliError) {
      console.error(`arc-orchestrator: ${error.message}`);
      process.exit(2);
    }
    throw error;
  }
}
