import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  BackendInvocationOutput,
  InvokeBackend,
} from "./engine";
import type { Mode, TaskPhase } from "./trace-schema";
import { workerArtifactCapability } from "./routes";
import { minimaxApiKey, minimaxBaseUrl } from "./minimax";
import { kimiApiKey, kimiBaseUrl } from "./kimi";

type BunChild = ReturnType<typeof Bun.spawn>;

export function buildCodexCommand(input: {
  codexBinary: string;
  profile: { model: string; sandbox: "read-only" | "workspace-write" };
  mode: Mode;
  phase?: TaskPhase;
  taskSlug?: string | null;
  cwd: string;
  schemaPath: string;
  resultPath: string;
  effort: string | null;
  isGitRepository: boolean;
  prompt: string;
}): string[] {
  const artifactCapability = workerArtifactCapability(
    "codex",
    input.mode,
    input.taskSlug,
    input.phase,
  );
  const command = [
    input.codexBinary,
    "exec",
    "--ephemeral",
    "--json",
    "--model",
    input.profile.model,
    "--sandbox",
    artifactCapability ? "workspace-write" : input.profile.sandbox,
    "--cd",
    input.cwd,
    "--output-schema",
    input.schemaPath,
    "--output-last-message",
    input.resultPath,
  ];
  if (input.effort) {
    command.push("-c", `model_reasoning_effort=${input.effort}`);
  }
  if (!input.isGitRepository) {
    command.push("--skip-git-repo-check");
  }
  command.push(input.prompt);
  return command;
}

export function buildClaudeCommand(input: {
  claudeBinary: string;
  profile: { model: string };
  mode: Mode;
  phase?: TaskPhase;
  taskSlug?: string | null;
  prompt: string;
  resultSchema: unknown;
}): string[] {
  const command = [
    input.claudeBinary,
    "-p",
    input.prompt,
    "--output-format",
    "json",
    "--model",
    input.profile.model,
    "--json-schema",
    JSON.stringify(input.resultSchema),
  ];
  const artifactCapability = workerArtifactCapability(
    "claude",
    input.mode,
    input.taskSlug,
    input.phase,
  );
  if (artifactCapability) {
    const scopedTools = `Edit(${artifactCapability.artifactDirectory}**),Write(${artifactCapability.artifactDirectory}**)`;
    command.push(
      "--tools",
      "Read,Grep,Glob,Edit,Write",
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      scopedTools,
    );
  } else if (input.mode === "analyze" || input.mode === "review") {
    command.push("--tools", "Read,Grep,Glob");
  } else {
    command.push(
      "--tools",
      "Read,Grep,Glob,Edit,Write,Bash",
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      "Bash",
    );
  }
  return command;
}

export function buildComposerCommand(input: {
  cursorBinary: string;
  profile: { model: string };
  mode: Mode;
  phase?: TaskPhase;
  cwd: string;
  prompt: string;
  forcePlanMode?: boolean;
  taskSlug?: string | null;
}): string[] {
  const command = [
    input.cursorBinary,
    "--trust",
    "--print",
    "--output-format",
    "json",
    "--model",
    input.profile.model,
    "--workspace",
    input.cwd,
  ];

  const artifactCapability = workerArtifactCapability(
    "composer",
    input.mode,
    input.taskSlug,
    input.phase,
  );
  if (
    input.forcePlanMode ||
    input.mode === "review" ||
    (input.mode === "analyze" && !artifactCapability)
  ) {
    // Read-only enforcement mirrors Claude's --tools Read,Grep,Glob pattern;
    // cursor-agent exposes plan mode instead of a --tools allowlist.
    command.push("--mode", "plan");
  } else {
    command.push("--force");
  }

  command.push(input.prompt);
  return command;
}

// OpenCode analyze/review must deny write/shell/subagent/web tools. Implement
// leaves permissions open so workspace writes remain available.
export const OPENCODE_READ_ONLY_AGENT = "arc-orchestrator-read-only";

export const OPENCODE_READ_ONLY_PERMISSION = {
  edit: "deny",
  write: "deny",
  bash: "deny",
  task: "deny",
  webfetch: "deny",
  websearch: "deny",
} as const;

export function openCodeArtifactAgent(taskSlug: string): string {
  return `arc-orchestrator-artifact-${taskSlug}`;
}

export function openCodeArtifactPermission(taskSlug: string) {
  const pattern = `docs/${taskSlug}/**`;
  return {
    edit: { [pattern]: "allow", "*": "deny" },
    write: { [pattern]: "allow", "*": "deny" },
    bash: "deny",
    task: "deny",
    web: "deny",
    webfetch: "deny",
    websearch: "deny",
  } as const;
}

export function openCodeArtifactConfigContent(taskSlug: string): string {
  const agent = openCodeArtifactAgent(taskSlug);
  const permission = openCodeArtifactPermission(taskSlug);
  return JSON.stringify({
    default_agent: agent,
    permission,
    agent: {
      [agent]: {
        description:
          "ARC orchestrator configured worker-authored artifact boundary; workspace agents cannot override.",
        mode: "primary",
        permission,
      },
    },
  });
}

export function openCodeReadOnlyConfigContent(): string {
  return JSON.stringify({
    default_agent: OPENCODE_READ_ONLY_AGENT,
    permission: OPENCODE_READ_ONLY_PERMISSION,
    agent: {
      [OPENCODE_READ_ONLY_AGENT]: {
        description:
          "ARC orchestrator controlled read-only worker; workspace agents cannot override.",
        mode: "primary",
        permission: OPENCODE_READ_ONLY_PERMISSION,
      },
    },
  });
}

export function openCodePermissionEnv(
  mode: Mode,
  env: NodeJS.ProcessEnv = {},
  taskSlug?: string | null,
  phase?: TaskPhase,
): NodeJS.ProcessEnv {
  if (mode !== "analyze" && mode !== "review") {
    return { ...env };
  }
  const artifactCapability = workerArtifactCapability(
    "opencode",
    mode,
    taskSlug,
    phase,
  );
  if (artifactCapability && taskSlug) {
    const permission = openCodeArtifactPermission(taskSlug);
    return {
      ...env,
      OPENCODE_PERMISSION: JSON.stringify(permission),
      OPENCODE_CONFIG_CONTENT: openCodeArtifactConfigContent(taskSlug),
    };
  }
  return {
    ...env,
    OPENCODE_PERMISSION: JSON.stringify(OPENCODE_READ_ONLY_PERMISSION),
    OPENCODE_CONFIG_CONTENT: openCodeReadOnlyConfigContent(),
  };
}

// Human-readable label for an OpenCode dispatch. The transport is shared by
// the direct `moonshotai/kimi-k3` identity and every `opencode-go/*` model,
// so messages carry the provider model id instead of a hardcoded "Kimi K3".
export function safeOpenCodeModelLabel(model: string): string {
  const compact = model.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,79}$/.test(compact)
    ? compact
    : "configured-model";
}

export function openCodeWorkerLabel(model: string): string {
  return `OpenCode (${safeOpenCodeModelLabel(model)})`;
}

export function buildOpenCodeCommand(input: {
  opencodeBinary: string;
  profile: { model: string };
  prompt: string;
  mode: Mode;
  phase?: TaskPhase;
  taskSlug?: string | null;
}): string[] {
  const command = [input.opencodeBinary, "--pure", "run"];
  const artifactCapability = workerArtifactCapability(
    "opencode",
    input.mode,
    input.taskSlug,
    input.phase,
  );
  if (input.mode === "analyze" || input.mode === "review") {
    command.push(
      "--agent",
      artifactCapability && input.taskSlug
        ? openCodeArtifactAgent(input.taskSlug)
        : OPENCODE_READ_ONLY_AGENT,
    );
  }
  command.push("--format", "json", "--model", input.profile.model, input.prompt);
  return command;
}

export function findExecutable(name: string): string | undefined {
  if (name.includes("/")) {
    return existsSync(name) ? name : undefined;
  }

  for (const directory of (process.env.PATH ?? "").split(":")) {
    const candidate = resolve(directory, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function resolveWorkerBinary(configured: string, label: string): string {
  if (configured.includes("/")) {
    if (!existsSync(configured)) {
      throw new Error(`${label} not found: ${configured}\nENOENT`);
    }
    return configured;
  }

  const resolved = findExecutable(configured);
  if (!resolved) {
    throw new Error(`${label} not found: ${configured}\nENOENT`);
  }
  return resolved;
}

async function collectWithDeadline(
  child: BunChild,
  maxDurationMs: number | null,
  workerName: string,
): Promise<BackendInvocationOutput> {
  let deadlineHit = false;
  const timer =
    maxDurationMs === null
      ? undefined
      : setTimeout(() => {
          deadlineHit = true;
          child.kill();
        }, maxDurationMs);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    if (deadlineHit) {
      throw new Error(
        `budget: ${workerName} exceeded the ${maxDurationMs}ms duration budget and was stopped`,
      );
    }

    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timer);
  }
}

function isGitRepository(cwd: string): boolean {
  const result = Bun.spawnSync(
    ["git", "-C", cwd, "rev-parse", "--is-inside-work-tree"],
    {
      stdout: "pipe",
      stderr: "ignore",
    },
  );

  return result.exitCode === 0;
}

export function createSpawnBackendInvoker(
  env: NodeJS.ProcessEnv = process.env,
  _options: Record<string, never> = {},
): InvokeBackend {
  return async (input) => {
    if (input.backend === "codex") {
      const codexBinary = resolveWorkerBinary(
        env.ARC_ORCHESTRATOR_CODEX_BIN?.trim() || "codex",
        "Codex CLI",
      );
      const schemaPath = resolve(input.temporaryDirectory, "result.schema.json");
      const resultPath = resolve(input.temporaryDirectory, "result.json");

      writeFileSync(schemaPath, JSON.stringify(input.resultSchema));

      const command = buildCodexCommand({
        codexBinary,
        profile: input.profile,
        mode: input.mode,
        phase: input.phase,
        taskSlug: input.taskSlug,
        cwd: input.cwd,
        schemaPath,
        resultPath,
        effort: input.effort,
        isGitRepository: isGitRepository(input.cwd),
        prompt: input.prompt,
      });

      const child = Bun.spawn(command, {
        cwd: input.cwd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      input.emitProgress?.("worker process started; awaiting provider response");
      const output = await collectWithDeadline(
        child,
        input.budget.maxDurationMs,
        "Codex",
      );

      return {
        ...output,
        ...(existsSync(resultPath)
          ? { resultText: readFileSync(resultPath, "utf8").trim() }
          : {}),
      };
    }

    if (input.backend === "composer") {
      const cursorBinary = env.ARC_ORCHESTRATOR_CURSOR_BIN?.trim() || "cursor-agent";
      const command = buildComposerCommand({
        cursorBinary,
        profile: input.profile,
        mode: input.mode,
        phase: input.phase,
        cwd: input.cwd,
        prompt: input.prompt,
        taskSlug: input.taskSlug,
      });
      const child = Bun.spawn(command, {
        cwd: input.cwd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      input.emitProgress?.("worker process started; awaiting provider response");

      const modelOutput = await collectWithDeadline(
        child,
        input.budget.maxDurationMs,
        "Cursor Composer",
      );

      return modelOutput;
    }

    if (input.backend === "opencode") {
      const opencodeBinary = resolveWorkerBinary(
        env.ARC_ORCHESTRATOR_OPENCODE_BIN?.trim() || "opencode",
        "OpenCode",
      );
      const command = buildOpenCodeCommand({
        opencodeBinary,
        profile: input.profile,
        prompt: input.prompt,
        mode: input.mode,
        phase: input.phase,
        taskSlug: input.taskSlug,
      });
      const child = Bun.spawn(command, {
        cwd: input.cwd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...openCodePermissionEnv(
            input.mode,
            env,
            input.taskSlug,
            input.phase,
          ),
          // OpenCode also consults PWD when resolving workspace-relative
          // paths, while Bun.spawn's cwd only changes the OS working directory.
          PWD: input.cwd,
        },
      });
      // The OpenCode transport serves several identities (moonshotai/kimi-k3
      // and the opencode-go/* models), so progress and deadline labels name
      // the dispatched model rather than assuming Kimi.
      input.emitProgress?.(
        `OpenCode worker process started (${safeOpenCodeModelLabel(input.profile.model)}); awaiting provider response`,
      );
      return collectWithDeadline(
        child,
        input.budget.maxDurationMs,
        openCodeWorkerLabel(input.profile.model),
      );
    }

    const isMinimax = input.backend === "minimax";
    const isKimi = input.backend === "kimi";
    const claudeBinary = resolveWorkerBinary(
      env.ARC_ORCHESTRATOR_CLAUDE_BIN?.trim() || "claude",
      "Claude CLI",
    );
    let workerEnv: NodeJS.ProcessEnv = env;
    if (isMinimax) {
      const apiKey = minimaxApiKey(env);
      if (!apiKey) {
        throw new Error(
          "MiniMax invocation failed\nauthentication is not configured: set ARC_ORCHESTRATOR_MINIMAX_API_KEY or MINIMAX_API_KEY",
        );
      }
      workerEnv = {
        ...env,
        ANTHROPIC_BASE_URL: minimaxBaseUrl(env),
        ANTHROPIC_API_KEY: apiKey,
      };
    } else if (isKimi) {
      const apiKey = kimiApiKey(env);
      if (!apiKey) {
        throw new Error(
          "Kimi invocation failed\nauthentication is not configured: set ARC_ORCHESTRATOR_KIMI_API_KEY, MOONSHOT_API_KEY, or KIMI_API_KEY",
        );
      }
      const { ANTHROPIC_API_KEY: _removed, ...rest } = env;
      workerEnv = {
        ...rest,
        ANTHROPIC_BASE_URL: kimiBaseUrl(env),
        ANTHROPIC_AUTH_TOKEN: apiKey,
        ENABLE_TOOL_SEARCH: "false",
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: "1048576",
        CLAUDE_CODE_EFFORT_LEVEL: "max",
      };
    }

    // The Claude CLI exposes two ways to set reasoning effort, and they fail
    // differently. `--effort <level>` warns on an unrecognised value and silently
    // runs at the default; `CLAUDE_CODE_EFFORT_LEVEL` rejects one outright. An
    // orchestrator that writes the dispatched effort into its trace cannot use the
    // flag: a silent downgrade would leave the trace claiming an effort the run
    // never spent. Verified against Claude CLI 2.1.220 on 2026-07-25.
    //
    // Applied after the kimi block so an explicit effort overrides kimi's default
    // pin rather than being shadowed by it. Which levels a caller may request is
    // the registry's decision (BACKEND_SUPPORTED_EFFORTS); the adapter forwards
    // whatever survives that gate and never substitutes a default of its own.
    if (input.effort) {
      workerEnv = { ...workerEnv, CLAUDE_CODE_EFFORT_LEVEL: input.effort };
    }

    const command = buildClaudeCommand({
      claudeBinary,
      profile: input.profile,
      mode: input.mode,
      phase: input.phase,
      taskSlug: input.taskSlug,
      prompt: input.prompt,
      resultSchema: input.resultSchema,
    });

    const child = Bun.spawn(command, {
      cwd: input.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: workerEnv,
    });
    input.emitProgress?.("worker process started; awaiting provider response");

    const claudeCliLabel = isMinimax
      ? "MiniMax (Claude CLI)"
      : isKimi
        ? "Kimi (Claude CLI)"
        : "Claude";
    return collectWithDeadline(
      child,
      input.budget.maxDurationMs,
      claudeCliLabel,
    );
  };
}
