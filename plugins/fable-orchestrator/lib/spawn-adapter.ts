import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  BackendInvocationOutput,
  InvokeBackend,
} from "./engine";
import type { Mode } from "./trace-schema";

type BunChild = ReturnType<typeof Bun.spawn>;

export function buildComposerCommand(input: {
  cursorBinary: string;
  profile: { model: string };
  mode: Mode;
  cwd: string;
  prompt: string;
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

  if (input.mode === "analyze" || input.mode === "review") {
    // Read-only enforcement mirrors Claude's --tools Read,Grep,Glob pattern;
    // cursor-agent exposes plan mode instead of a --tools allowlist.
    command.push("--mode", "plan");
  } else {
    command.push("--force");
  }

  command.push(input.prompt);
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
): InvokeBackend {
  return async (input) => {
    if (input.backend === "codex") {
      const codexBinary = resolveWorkerBinary(
        env.FABLE_ORCHESTRATOR_CODEX_BIN?.trim() || "codex",
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
      const cursorBinary =
        env.FABLE_ORCHESTRATOR_CURSOR_BIN?.trim() || "cursor-agent";
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

      return collectWithDeadline(
        child,
        input.budget.maxDurationMs,
        "Cursor Composer",
      );
    }

    const claudeBinary = resolveWorkerBinary(
      env.FABLE_ORCHESTRATOR_CLAUDE_BIN?.trim() || "claude",
      "Claude CLI",
    );
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
      env,
    });

    return collectWithDeadline(child, input.budget.maxDurationMs, "Claude");
  };
}
