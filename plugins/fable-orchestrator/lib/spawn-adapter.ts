import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  BackendInvocationOutput,
  InvokeBackend,
} from "./engine";
import type { Mode } from "./trace-schema";
import {
  MECHANICAL_OPS_POLICY_VERSION,
  executeMechanicalBroker,
  isMechanicalRouteAlias,
} from "./mechanical-ops-sandbox";

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

function compactOutput(label: string, value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact ? `${label}: ${compact.slice(0, 500)}` : `${label}: <empty>`;
}

function mechanicalResultEnvelope(execution: Awaited<ReturnType<typeof executeMechanicalBroker>>): string {
  const argvDisplay = execution.plan.commands
    .map((command) => command.argv.join(" "))
    .join(" && ");
  const result = {
    status: "completed",
    summary: `mechanical broker executed ${execution.commands.length}/${execution.plan.commands.length} command(s) with exit status ${execution.executorExitCode}`,
    changes: [],
    verification: [
      `model exit status: ${execution.modelExitCode}`,
      `broker operation plan accepted: ${argvDisplay}`,
      `executor commands run: ${execution.commands.length}`,
      `executor exit status: ${execution.executorExitCode}`,
      compactOutput("executor stdout", execution.executorStdout),
      compactOutput("executor stderr", execution.executorStderr),
    ],
    risks: [],
    next_actions: [],
  };

  return JSON.stringify({
    is_error: false,
    result: JSON.stringify(result),
  });
}

export function createSpawnBackendInvoker(
  env: NodeJS.ProcessEnv = process.env,
  options: { allowTestTrustedMechanicalBinaries?: boolean } = {},
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
      const mechanicalAlias = isMechanicalRouteAlias(input.requestedAlias)
        ? input.requestedAlias
        : null;
      const cursorBinary = mechanicalAlias
        ? resolveWorkerBinary(
            env.FABLE_ORCHESTRATOR_CURSOR_BIN?.trim() || "cursor-agent",
            "Cursor Agent",
          )
        : env.FABLE_ORCHESTRATOR_CURSOR_BIN?.trim() || "cursor-agent";
      const command = buildComposerCommand({
        cursorBinary,
        profile: input.profile,
        mode: input.mode,
        cwd: input.cwd,
        prompt: input.prompt,
        forcePlanMode: mechanicalAlias != null,
      });
      const child = Bun.spawn(command, {
        cwd: input.cwd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: mechanicalAlias
          ? {
              ...env,
              FABLE_ORCHESTRATOR_MECHANICAL_ROUTE: mechanicalAlias,
              FABLE_ORCHESTRATOR_MECHANICAL_POLICY: MECHANICAL_OPS_POLICY_VERSION,
            }
          : env,
      });

      const modelOutput = await collectWithDeadline(
        child,
        input.budget.maxDurationMs,
        "Cursor Composer",
      );

      if (!mechanicalAlias) {
        return modelOutput;
      }

      try {
        const execution = await executeMechanicalBroker({
          alias: mechanicalAlias,
          cwd: input.cwd,
          env,
          modelStdout: modelOutput.stdout,
          modelStderr: modelOutput.stderr,
          modelExitCode: modelOutput.exitCode,
          brokerTemporaryDirectory: input.temporaryDirectory,
          workspaceRoot: input.cwd,
          allowTestTrustedBinaries:
            options.allowTestTrustedMechanicalBinaries === true,
        });

        return {
          stdout: mechanicalResultEnvelope(execution),
          stderr: [
            compactOutput("model stdout", execution.modelStdout),
            compactOutput("model stderr", execution.modelStderr),
            compactOutput("executor stdout", execution.executorStdout),
            compactOutput("executor stderr", execution.executorStderr),
          ].join("\n"),
          exitCode: execution.executorExitCode,
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          stdout: modelOutput.stdout,
          stderr: [
            `fable-orchestrator: ${detail}`,
            compactOutput("model stdout", modelOutput.stdout),
            compactOutput("model stderr", modelOutput.stderr),
          ].join("\n"),
          exitCode: modelOutput.exitCode === 0 ? 126 : modelOutput.exitCode,
        };
      }
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
