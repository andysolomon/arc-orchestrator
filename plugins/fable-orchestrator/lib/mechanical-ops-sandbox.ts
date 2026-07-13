import { existsSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import type { Backend, Mode, RouteId, TraceSandbox } from "./trace-schema";

export const MECHANICAL_OPS_POLICY_VERSION = "mechanical-ops-sandbox/v1";
export const MECHANICAL_OPS_MODEL = "composer-2.5";
export const MECHANICAL_OPS_BACKEND: Backend = "composer";
export const MECHANICAL_OPS_MODE: Mode = "implement";
export const MECHANICAL_OPS_SANDBOX: TraceSandbox = "workspace-write";

export type MechanicalOperation =
  | "open-pr"
  | "post-github-comment"
  | "commit-push"
  | "merge";

export type MechanicalRouteAlias =
  | "mechanical-open-pr"
  | "mechanical-post-comment"
  | "mechanical-commit-push"
  | "mechanical-merge";

export type MechanicalCapabilityRouteId =
  | "mechanical-open-pr.workspace-write.v1"
  | "mechanical-post-comment.workspace-write.v1"
  | "mechanical-commit-push.workspace-write.v1"
  | "mechanical-merge.workspace-write.v1";

export type MechanicalOperationContractId =
  | "mechanical-open-pr.v1"
  | "mechanical-post-github-comment.v1"
  | "mechanical-commit-push.v1"
  | "mechanical-merge.v1";

export type MechanicalCommandPolicy = {
  executable: "git" | "gh";
  forms: string[];
};

export type MechanicalBrokerCommand = {
  argv: string[];
};

export type MechanicalOperationPlan = {
  commands: MechanicalBrokerCommand[];
};

export type MechanicalCommandExecution = {
  argv: string[];
  executablePath: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type MechanicalBrokerExecution = {
  plan: MechanicalOperationPlan;
  commands: MechanicalCommandExecution[];
  modelStdout: string;
  modelStderr: string;
  modelExitCode: number;
  executorStdout: string;
  executorStderr: string;
  executorExitCode: number;
};

export type MechanicalOperationContract = {
  alias: MechanicalRouteAlias;
  operation: MechanicalOperation;
  taskClass: MechanicalOperation;
  canonicalRoute: MechanicalCapabilityRouteId;
  operationContract: MechanicalOperationContractId;
  backend: typeof MECHANICAL_OPS_BACKEND;
  mode: typeof MECHANICAL_OPS_MODE;
  model: typeof MECHANICAL_OPS_MODEL;
  sandbox: typeof MECHANICAL_OPS_SANDBOX;
  policyVersion: typeof MECHANICAL_OPS_POLICY_VERSION;
  allowedCommands: MechanicalCommandPolicy[];
};

export const MECHANICAL_OPERATION_CONTRACTS: readonly MechanicalOperationContract[] = [
  {
    alias: "mechanical-open-pr",
    operation: "open-pr",
    taskClass: "open-pr",
    canonicalRoute: "mechanical-open-pr.workspace-write.v1",
    operationContract: "mechanical-open-pr.v1",
    backend: MECHANICAL_OPS_BACKEND,
    mode: MECHANICAL_OPS_MODE,
    model: MECHANICAL_OPS_MODEL,
    sandbox: MECHANICAL_OPS_SANDBOX,
    policyVersion: MECHANICAL_OPS_POLICY_VERSION,
    allowedCommands: [{ executable: "gh", forms: ["gh pr create"] }],
  },
  {
    alias: "mechanical-post-comment",
    operation: "post-github-comment",
    taskClass: "post-github-comment",
    canonicalRoute: "mechanical-post-comment.workspace-write.v1",
    operationContract: "mechanical-post-github-comment.v1",
    backend: MECHANICAL_OPS_BACKEND,
    mode: MECHANICAL_OPS_MODE,
    model: MECHANICAL_OPS_MODEL,
    sandbox: MECHANICAL_OPS_SANDBOX,
    policyVersion: MECHANICAL_OPS_POLICY_VERSION,
    allowedCommands: [
      { executable: "gh", forms: ["gh issue comment", "gh pr comment"] },
    ],
  },
  {
    alias: "mechanical-commit-push",
    operation: "commit-push",
    taskClass: "commit-push",
    canonicalRoute: "mechanical-commit-push.workspace-write.v1",
    operationContract: "mechanical-commit-push.v1",
    backend: MECHANICAL_OPS_BACKEND,
    mode: MECHANICAL_OPS_MODE,
    model: MECHANICAL_OPS_MODEL,
    sandbox: MECHANICAL_OPS_SANDBOX,
    policyVersion: MECHANICAL_OPS_POLICY_VERSION,
    allowedCommands: [
      { executable: "git", forms: ["git commit", "git push"] },
    ],
  },
  {
    alias: "mechanical-merge",
    operation: "merge",
    taskClass: "merge",
    canonicalRoute: "mechanical-merge.workspace-write.v1",
    operationContract: "mechanical-merge.v1",
    backend: MECHANICAL_OPS_BACKEND,
    mode: MECHANICAL_OPS_MODE,
    model: MECHANICAL_OPS_MODEL,
    sandbox: MECHANICAL_OPS_SANDBOX,
    policyVersion: MECHANICAL_OPS_POLICY_VERSION,
    allowedCommands: [{ executable: "gh", forms: ["gh pr merge"] }],
  },
];

const CONTRACT_BY_ALIAS = new Map(
  MECHANICAL_OPERATION_CONTRACTS.map((contract) => [contract.alias, contract]),
);
const CONTRACT_BY_ROUTE = new Map(
  MECHANICAL_OPERATION_CONTRACTS.map((contract) => [
    contract.canonicalRoute,
    contract,
  ]),
);

const SHELL_METACHARACTER_PATTERN = /[;&|`$<>\r\n]/;
const SAFE_GITHUB_NUMBER_PATTERN = /^\d+$/;
const SAFE_REF_PATTERN = /^[A-Za-z0-9._~/-]+$/;

function normalizedAlias(alias: string | null | undefined): string | null {
  const normalized = alias?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function canonicalMechanicalRouteAlias(
  alias: string | null | undefined,
): MechanicalRouteAlias | null {
  const normalized = normalizedAlias(alias);
  return normalized
    ? CONTRACT_BY_ALIAS.get(normalized as MechanicalRouteAlias)?.alias ?? null
    : null;
}

export function isMechanicalRouteAlias(alias: string | null | undefined): boolean {
  return canonicalMechanicalRouteAlias(alias) !== null;
}

export function mechanicalContractForAlias(
  alias: string | null | undefined,
): MechanicalOperationContract | null {
  const canonicalAlias = canonicalMechanicalRouteAlias(alias);
  return canonicalAlias
    ? CONTRACT_BY_ALIAS.get(canonicalAlias) ?? null
    : null;
}

export function mechanicalContractForCanonicalRoute(
  route: string | null | undefined,
): MechanicalOperationContract | null {
  const normalized = normalizedAlias(route);
  return normalized
    ? CONTRACT_BY_ROUTE.get(normalized as MechanicalCapabilityRouteId) ?? null
    : null;
}

export function mechanicalTaskClassForAlias(
  alias: string | null | undefined,
): MechanicalOperation | null {
  return mechanicalContractForAlias(alias)?.taskClass ?? null;
}

export function mechanicalInstructionForAlias(
  alias: string | null | undefined,
): string {
  const contract = mechanicalContractForAlias(alias);
  if (!contract) {
    throw new Error(`Unknown mechanical route: ${alias}`);
  }
  const allowed = contract.allowedCommands
    .flatMap((command) => command.forms)
    .join("; ");
  return [
    `Mechanical operation: ${contract.operation}.`,
    `Use only the bounded ${MECHANICAL_OPS_POLICY_VERSION} runtime for this route.`,
    `Allowed command forms: ${allowed}.`,
    "You are in non-writing plan mode: do not run git, gh, shell, file edits, deployments, or any mutation yourself.",
    contract.alias === "mechanical-commit-push"
      ? 'Return exactly one JSON object with exactly one key, "commands", whose value is exactly two command objects in order: first {"argv":["git","commit",...]}, then {"argv":["git","push",...]}.'
      : 'Return exactly one JSON object with exactly one key, "commands", whose value is an array containing exactly one command object: {"argv":[...]}.',
    'The first argv token must be exactly "git" or "gh"; never return an absolute executable path, shell string, wrapper path, multiple commands, command chaining, redirection, pipes, or command substitution.',
    "The runner will validate the operation plan, resolve trusted executables itself, and execute approved argv entries without a shell.",
  ].join(" ");
}

function hasShellMetacharacter(argv: readonly string[]): boolean {
  return argv.some((argument) => SHELL_METACHARACTER_PATTERN.test(argument));
}

function requireFlagValue(
  argv: readonly string[],
  index: number,
  flag: string,
): { ok: true; next: number } | { ok: false; reason: string } {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    return { ok: false, reason: `missing-value:${flag}` };
  }
  return { ok: true, next: index + 2 };
}

function validateGhFlags(
  argv: readonly string[],
  start: number,
  valueFlags: ReadonlySet<string>,
  booleanFlags: ReadonlySet<string>,
): { ok: true } | { ok: false; reason: string } {
  for (let index = start; index < argv.length;) {
    const argument = argv[index]!;
    if (!argument.startsWith("-")) {
      return { ok: false, reason: "unexpected-positional-argument" };
    }
    if (booleanFlags.has(argument)) {
      index += 1;
      continue;
    }
    if (valueFlags.has(argument)) {
      const value = requireFlagValue(argv, index, argument);
      if (!value.ok) {
        return value;
      }
      index = value.next;
      continue;
    }
    return { ok: false, reason: `unlisted-flag:${argument}` };
  }
  return { ok: true };
}

function validateGhPrCreate(argv: readonly string[]) {
  if (argv[0] !== "gh" || argv[1] !== "pr" || argv[2] !== "create") {
    return { ok: false as const, reason: "unlisted-command" };
  }
  return validateGhFlags(
    argv,
    3,
    new Set([
      "--title",
      "--body",
      "--base",
      "--head",
      "--reviewer",
      "--assignee",
      "--label",
      "--milestone",
      "--project",
    ]),
    new Set(["--draft", "--fill", "--fill-first", "--fill-verbose"]),
  );
}

function validateGhComment(argv: readonly string[]) {
  const command = `${argv[0] ?? ""} ${argv[1] ?? ""} ${argv[2] ?? ""}`;
  if (command !== "gh issue comment" && command !== "gh pr comment") {
    return { ok: false as const, reason: "unlisted-command" };
  }
  const target = argv[3];
  if (!target || !SAFE_GITHUB_NUMBER_PATTERN.test(target)) {
    return { ok: false as const, reason: "invalid-comment-target" };
  }
  return validateGhFlags(
    argv,
    4,
    new Set(["--body"]),
    new Set([]),
  );
}

function validateGhPrMerge(argv: readonly string[]) {
  if (argv[0] !== "gh" || argv[1] !== "pr" || argv[2] !== "merge") {
    return { ok: false as const, reason: "unlisted-command" };
  }
  const target = argv[3];
  const start = target && !target.startsWith("-") ? 4 : 3;
  if (target && !target.startsWith("-") && !SAFE_GITHUB_NUMBER_PATTERN.test(target)) {
    return { ok: false as const, reason: "invalid-pr-target" };
  }
  return validateGhFlags(
    argv,
    start,
    new Set(["--subject", "--body"]),
    new Set(["--merge", "--squash", "--rebase", "--auto", "--delete-branch"]),
  );
}

function validateGitPush(argv: readonly string[]) {
  const booleanFlags = new Set(["--set-upstream", "-u", "--follow-tags"]);
  const positionals: string[] = [];
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument.startsWith("-")) {
      if (!booleanFlags.has(argument)) {
        return { ok: false as const, reason: `unlisted-flag:${argument}` };
      }
      continue;
    }
    positionals.push(argument);
  }
  if (positionals.length < 1 || positionals.length > 2 || positionals[0] !== "origin") {
    return { ok: false as const, reason: "invalid-push-remote" };
  }
  if (positionals[1] && !SAFE_REF_PATTERN.test(positionals[1])) {
    return { ok: false as const, reason: "invalid-push-ref" };
  }
  return { ok: true as const };
}

function validateGitCommitPush(argv: readonly string[]) {
  if (argv[0] !== "git") {
    return { ok: false as const, reason: "unlisted-command" };
  }
  const subcommand = argv[1];
  if (subcommand === "commit") {
    return validateGhFlags(
      argv,
      2,
      new Set(["-m", "--message", "--author"]),
      new Set(["--signoff"]),
    );
  }
  if (subcommand === "push") {
    return validateGitPush(argv);
  }
  return { ok: false as const, reason: "unlisted-command" };
}

function validateExecutableToken(executable: string): { ok: true } | { ok: false; reason: string } {
  if (executable.includes("/") || executable.includes("\\")) {
    return { ok: false, reason: "path-executable-rejected" };
  }
  if (executable.trim() !== executable || executable.length === 0) {
    return { ok: false, reason: "invalid-executable" };
  }
  return { ok: true };
}

export function validateMechanicalArgv(
  alias: string | null | undefined,
  argv: readonly string[],
): { ok: true } | { ok: false; reason: string } {
  const contract = mechanicalContractForAlias(alias);
  if (!contract) {
    return { ok: false, reason: "unknown-mechanical-route" };
  }
  if (argv.length === 0) {
    return { ok: false, reason: "empty-command" };
  }
  const executable = validateExecutableToken(argv[0]!);
  if (!executable.ok) {
    return executable;
  }
  const normalized = argv;
  if (hasShellMetacharacter(normalized)) {
    return { ok: false, reason: "shell-metacharacter-rejected" };
  }
  if (!contract.allowedCommands.some((command) => command.executable === normalized[0])) {
    return { ok: false, reason: "unlisted-executable" };
  }
  if (contract.alias === "mechanical-open-pr") {
    return validateGhPrCreate(normalized);
  }
  if (contract.alias === "mechanical-post-comment") {
    return validateGhComment(normalized);
  }
  if (contract.alias === "mechanical-merge") {
    return validateGhPrMerge(normalized);
  }
  return validateGitCommitPush(normalized);
}

export function validateMechanicalOperationPlan(
  alias: string | null | undefined,
  plan: MechanicalOperationPlan,
): { ok: true } | { ok: false; reason: string } {
  const contract = mechanicalContractForAlias(alias);
  if (!contract) {
    return { ok: false, reason: "unknown-mechanical-route" };
  }
  const canonicalAlias = contract.alias;
  const expectedCommands = canonicalAlias === "mechanical-commit-push" ? 2 : 1;
  if (plan.commands.length !== expectedCommands) {
    return {
      ok: false,
      reason: `invalid-command-count:${plan.commands.length}:expected-${expectedCommands}`,
    };
  }

  if (canonicalAlias === "mechanical-commit-push") {
    const [commit, push] = plan.commands;
    const commitValidation = validateMechanicalArgv(canonicalAlias, commit.argv);
    if (!commitValidation.ok) {
      return commitValidation;
    }
    if (commit?.argv[0] !== "git" || commit.argv[1] !== "commit") {
      return { ok: false, reason: "invalid-command-order:expected-git-commit-first" };
    }
    const pushValidation = validateMechanicalArgv(canonicalAlias, push.argv);
    if (!pushValidation.ok) {
      return pushValidation;
    }
    if (push?.argv[0] !== "git" || push.argv[1] !== "push") {
      return { ok: false, reason: "invalid-command-order:expected-git-push-second" };
    }
    return { ok: true };
  }

  return validateMechanicalArgv(canonicalAlias, plan.commands[0]!.argv);
}

function stripCodeFences(text: string): string {
  const match = text.trim().match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/);
  return match ? match[1] : text;
}

function parseJsonCandidates(text: string): unknown[] {
  const trimmed = stripCodeFences(text).trim();
  if (!trimmed) {
    return [];
  }

  try {
    return [JSON.parse(trimmed)];
  } catch {
    // Continue with embedded-object extraction below.
  }

  const candidates: unknown[] = [];
  let objectStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      if (depth === 0) {
        objectStart = index;
      }
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        try {
          candidates.push(JSON.parse(trimmed.slice(objectStart, index + 1)));
        } catch {
          // Ignore this embedded object and keep scanning.
        }
        objectStart = -1;
      }
    }
  }

  return candidates;
}

function commandFromCandidate(value: unknown): MechanicalBrokerCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  if (keys.length !== 1 || keys[0] !== "argv" || !Array.isArray(object.argv)) {
    return null;
  }
  if (
    object.argv.length === 0 ||
    object.argv.some((argument) => typeof argument !== "string")
  ) {
    return null;
  }
  return { argv: [...(object.argv as string[])] };
}

function planFromCandidate(value: unknown): MechanicalOperationPlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  if (keys.length !== 1 || keys[0] !== "commands" || !Array.isArray(object.commands)) {
    return null;
  }
  const commands = object.commands.map(commandFromCandidate);
  if (commands.some((command) => command === null)) {
    return null;
  }
  return { commands: commands as MechanicalBrokerCommand[] };
}

export function parseMechanicalBrokerPlan(
  modelStdout: string,
): MechanicalOperationPlan {
  const topLevel = parseJsonCandidates(modelStdout);
  const candidates: unknown[] = [];

  for (const candidate of topLevel) {
    candidates.push(candidate);
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const envelope = candidate as Record<string, unknown>;
      if (envelope.is_error === true) {
        throw new Error(
          `${MECHANICAL_OPS_POLICY_VERSION}: Composer plan reported an error`,
        );
      }
      for (const key of ["result", "text", "message"] as const) {
        const nested = envelope[key];
        if (typeof nested === "string") {
          candidates.push(...parseJsonCandidates(nested));
        } else if (nested !== undefined) {
          candidates.push(nested);
        }
      }
    }
  }

  const plans = candidates
    .map(planFromCandidate)
    .filter((plan): plan is MechanicalOperationPlan => plan !== null);

  if (plans.length !== 1) {
    throw new Error(
      `${MECHANICAL_OPS_POLICY_VERSION}: expected exactly one structured operation plan, received ${plans.length}`,
    );
  }

  return plans[0]!;
}

export function parseMechanicalBrokerCommand(
  modelStdout: string,
): MechanicalBrokerCommand {
  const plan = parseMechanicalBrokerPlan(modelStdout);
  if (plan.commands.length !== 1) {
    throw new Error(
      `${MECHANICAL_OPS_POLICY_VERSION}: expected exactly one structured argv command, received ${plan.commands.length}`,
    );
  }
  return plan.commands[0]!;
}

type TrustedExecutableResolution = {
  env: NodeJS.ProcessEnv;
  cwd?: string;
  brokerTemporaryDirectory?: string;
  workspaceRoot?: string;
  allowTestTrustedBinaries?: boolean;
};

const TRUSTED_SYSTEM_BIN_DIRECTORIES = [
  "/usr/bin",
  "/bin",
  "/usr/local/bin",
  "/opt/homebrew/bin",
] as const;

function isPathInside(childPath: string, parentPath: string): boolean {
  const normalizedParent = parentPath.endsWith(sep) ? parentPath : `${parentPath}${sep}`;
  return childPath === parentPath || childPath.startsWith(normalizedParent);
}

function trustedEnvVarFor(name: "git" | "gh"): "FABLE_ORCHESTRATOR_TRUSTED_GIT_BIN" | "FABLE_ORCHESTRATOR_TRUSTED_GH_BIN" {
  return name === "git"
    ? "FABLE_ORCHESTRATOR_TRUSTED_GIT_BIN"
    : "FABLE_ORCHESTRATOR_TRUSTED_GH_BIN";
}

function configuredTrustedExecutableCandidates(
  name: "git" | "gh",
  env: NodeJS.ProcessEnv,
): string[] {
  const explicit = env[trustedEnvVarFor(name)]?.trim();
  if (explicit) {
    return [explicit];
  }
  return TRUSTED_SYSTEM_BIN_DIRECTORIES.map((directory) => resolve(directory, name));
}

function validateTrustedExecutableCandidate(
  name: "git" | "gh",
  candidate: string,
  options: TrustedExecutableResolution,
): string | null {
  if (!candidate.startsWith("/")) {
    throw new Error(
      `${MECHANICAL_OPS_POLICY_VERSION}: trusted ${name} binary must be an absolute path`,
    );
  }
  if (!existsSync(candidate)) {
    return null;
  }
  const realCandidate = realpathSync(candidate);
  const stat = statSync(realCandidate);
  if (!stat.isFile()) {
    throw new Error(
      `${MECHANICAL_OPS_POLICY_VERSION}: trusted ${name} candidate is not a regular executable file: ${realCandidate}`,
    );
  }
  if ((stat.mode & 0o111) === 0) {
    throw new Error(
      `${MECHANICAL_OPS_POLICY_VERSION}: trusted ${name} candidate is not executable: ${realCandidate}`,
    );
  }
  if ((stat.mode & 0o022) !== 0) {
    throw new Error(
      `${MECHANICAL_OPS_POLICY_VERSION}: trusted ${name} candidate is group/world writable: ${realCandidate}`,
    );
  }

  const boundaryRoots = [
    options.cwd,
    options.brokerTemporaryDirectory,
    options.workspaceRoot,
    options.env.TMPDIR,
    tmpdir(),
  ].filter((value): value is string => Boolean(value));
  const realBoundaryRoots = boundaryRoots
    .filter((root) => existsSync(root))
    .map((root) => realpathSync(root));
  const inUntrustedBoundary = realBoundaryRoots.some((root) =>
    isPathInside(realCandidate, root),
  );
  if (inUntrustedBoundary && !options.allowTestTrustedBinaries) {
    throw new Error(
      `${MECHANICAL_OPS_POLICY_VERSION}: trusted ${name} candidate is inside an untrusted workspace or temp boundary: ${realCandidate}`,
    );
  }

  return realCandidate;
}

export function resolveTrustedMechanicalExecutable(
  name: "git" | "gh",
  envOrOptions: NodeJS.ProcessEnv | TrustedExecutableResolution,
): string {
  const options: TrustedExecutableResolution =
    "env" in envOrOptions ? envOrOptions : { env: envOrOptions };
  for (const candidate of configuredTrustedExecutableCandidates(name, options.env)) {
    const resolved = validateTrustedExecutableCandidate(name, candidate, options);
    if (resolved) {
      return resolved;
    }
  }
  throw new Error(
    `${MECHANICAL_OPS_POLICY_VERSION}: trusted executable not found: ${name}`,
  );
}

export function mechanicalExecutorEnvironment(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => key !== "GH_REPO" && !key.startsWith("GIT_")),
  );
}

export async function executeMechanicalBroker(input: {
  alias: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  modelStdout: string;
  modelStderr: string;
  modelExitCode: number;
  brokerTemporaryDirectory?: string;
  workspaceRoot?: string;
  allowTestTrustedBinaries?: boolean;
}): Promise<MechanicalBrokerExecution> {
  const canonicalAlias = canonicalMechanicalRouteAlias(input.alias);
  if (!canonicalAlias) {
    throw new Error(
      `${MECHANICAL_OPS_POLICY_VERSION}: unknown-mechanical-route: ${input.alias}`,
    );
  }

  if (input.modelExitCode !== 0) {
    throw new Error(
      `${MECHANICAL_OPS_POLICY_VERSION}: Composer plan failed with status ${input.modelExitCode}`,
    );
  }

  const plan = parseMechanicalBrokerPlan(input.modelStdout);
  const validation = validateMechanicalOperationPlan(canonicalAlias, plan);
  if (!validation.ok) {
    throw new Error(
      `${MECHANICAL_OPS_POLICY_VERSION}: ${validation.reason}: ${canonicalAlias}`,
    );
  }

  const executions: MechanicalCommandExecution[] = [];

  for (const command of plan.commands) {
    const executable = command.argv[0] as "git" | "gh";
    const executablePath = resolveTrustedMechanicalExecutable(executable, {
      env: input.env,
      cwd: input.cwd,
      brokerTemporaryDirectory: input.brokerTemporaryDirectory,
      workspaceRoot: input.workspaceRoot,
      allowTestTrustedBinaries: input.allowTestTrustedBinaries,
    });
    const child = Bun.spawn([executablePath, ...command.argv.slice(1)], {
      cwd: input.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: mechanicalExecutorEnvironment(input.env),
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    executions.push({
      argv: command.argv,
      executablePath,
      stdout,
      stderr,
      exitCode,
    });
    if (exitCode !== 0) {
      break;
    }
  }

  return {
    plan,
    commands: executions,
    modelStdout: input.modelStdout,
    modelStderr: input.modelStderr,
    modelExitCode: input.modelExitCode,
    executorStdout: executions.map((execution) => execution.stdout).join(""),
    executorStderr: executions.map((execution) => execution.stderr).join(""),
    executorExitCode: executions.at(-1)?.exitCode ?? 1,
  };
}
