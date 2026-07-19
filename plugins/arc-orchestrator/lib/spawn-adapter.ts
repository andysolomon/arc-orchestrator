import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  BackendInvocationOutput,
  InvokeBackend,
} from "./engine";
import type { Mode } from "./trace-schema";
import { minimaxApiKey, minimaxBaseUrl } from "./minimax";
import { kimiApiKey, kimiBaseUrl } from "./kimi";

type BunChild = ReturnType<typeof Bun.spawn>;

export function buildComposerCommand(input: {
  cursorBinary: string;
  profile: { model: string };
  mode: Mode;
  cwd: string;
  prompt: string;
  forcePlanMode?: boolean;
}): string[] {
  const command = [
    input.cursorBinary,
    "--print",
    "--output-format",
    "json",
    "--model",
    input.profile.model,
    "--workspace",
    input.cwd,
  ];

  if (input.forcePlanMode || input.mode === "analyze" || input.mode === "review") {
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
): NodeJS.ProcessEnv {
  if (mode !== "analyze" && mode !== "review") {
    return { ...env };
  }
  return {
    ...env,
    OPENCODE_PERMISSION: JSON.stringify(OPENCODE_READ_ONLY_PERMISSION),
    OPENCODE_CONFIG_CONTENT: openCodeReadOnlyConfigContent(),
  };
}

export function buildOpenCodeCommand(input: {
  opencodeBinary: string;
  profile: { model: string };
  prompt: string;
  mode: Mode;
}): string[] {
  const command = [input.opencodeBinary, "--pure", "run"];
  if (input.mode === "analyze" || input.mode === "review") {
    command.push("--agent", OPENCODE_READ_ONLY_AGENT);
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

      const command = [
        codexBinary,
        "exec",
        "--ephemeral",
        "--json",
        "--model",
        input.profile.model,
        "--sandbox",
        input.profile.sandbox,
        "--cd",
        input.cwd,
        "--output-schema",
        schemaPath,
        "--output-last-message",
        resultPath,
      ];

      if (input.effort) {
        command.push("-c", `model_reasoning_effort=${input.effort}`);
      }

      if (!isGitRepository(input.cwd)) {
        command.push("--skip-git-repo-check");
      }

      command.push(input.prompt);

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
        cwd: input.cwd,
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
      });
      const child = Bun.spawn(command, {
        cwd: input.cwd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: openCodePermissionEnv(input.mode, env),
      });
      input.emitProgress?.("OpenCode Kimi worker process started; awaiting provider response");
      return collectWithDeadline(child, input.budget.maxDurationMs, "OpenCode Kimi K3");
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
    const command = [
      claudeBinary,
      "-p",
      input.prompt,
      "--output-format",
      "json",
      "--model",
      input.profile.model,
      "--json-schema",
      JSON.stringify(input.resultSchema),
    ];

    if (input.mode === "analyze" || input.mode === "review") {
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
