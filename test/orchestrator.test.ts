import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const runner = resolve(
  projectRoot,
  "plugins/fable-orchestrator/bin/fable-orchestrator",
);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createFakeCodex(exitCode = 0): {
  executable: string;
  argumentsPath: string;
  workspace: string;
  traceDirectory: string;
} {
  const directory = mkdtempSync(`${tmpdir()}/fake-codex-`);
  temporaryDirectories.push(directory);
  const executable = resolve(directory, "codex");
  const argumentsPath = resolve(directory, "arguments.json");
  const workspace = resolve(directory, "workspace");
  const traceDirectory = resolve(directory, "traces");

  Bun.spawnSync(["mkdir", "-p", workspace]);

  writeFileSync(
    executable,
    `#!/bin/sh
printf '%s\\n' "$@" | jq -R -s 'split("\\n")[:-1]' > "$FAKE_CODEX_ARGUMENTS"
output_file=""
previous=""
for argument in "$@"; do
  if [ "$previous" = "--output-last-message" ]; then
    output_file="$argument"
  fi
  previous="$argument"
done
if [ ${exitCode} -ne 0 ]; then
  printf '%s\\n' '{"type":"turn.failed","error":{"message":"simulated usage limit"}}'
  echo "simulated Codex failure" >&2
  exit ${exitCode}
fi
printf '%s\\n' '{"type":"thread.started","thread_id":"fake-thread"}'
printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":1200,"cached_input_tokens":200,"output_tokens":300}}'
printf '%s\\n' '{"status":"completed","summary":"done","changes":[],"verification":[],"risks":[],"next_actions":[]}' > "$output_file"
`,
  );
  chmodSync(executable, 0o755);

  return { executable, argumentsPath, workspace, traceDirectory };
}

function createFakeCursor(exitCode = 0): {
  executable: string;
  argumentsPath: string;
  workspace: string;
  traceDirectory: string;
} {
  const directory = mkdtempSync(`${tmpdir()}/fake-cursor-`);
  temporaryDirectories.push(directory);
  const executable = resolve(directory, "cursor-agent");
  const argumentsPath = resolve(directory, "arguments.json");
  const workspace = resolve(directory, "workspace");
  const traceDirectory = resolve(directory, "traces");

  Bun.spawnSync(["mkdir", "-p", workspace]);

  writeFileSync(
    executable,
    `#!/bin/sh
printf '%s\\n' "$@" | jq -R -s 'split("\\n")[:-1]' > "$FAKE_CURSOR_ARGUMENTS"
if [ ${exitCode} -ne 0 ]; then
  echo "simulated Cursor failure" >&2
  exit ${exitCode}
fi
printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"duration_ms":3554,"result":"\`\`\`json\\n{\\"status\\":\\"completed\\",\\"summary\\":\\"composer done\\",\\"changes\\":[\\"src/app.ts\\"],\\"verification\\":[],\\"risks\\":[],\\"next_actions\\":[]}\\n\`\`\`","session_id":"fake-session","usage":{"inputTokens":45,"outputTokens":67,"cacheReadTokens":10,"cacheWriteTokens":0}}'
`,
  );
  chmodSync(executable, 0o755);

  return { executable, argumentsPath, workspace, traceDirectory };
}

function createStatusExecutable(
  name: string,
  output: string,
  exitCode: number,
): string {
  const directory = mkdtempSync(`${tmpdir()}/fake-status-`);
  temporaryDirectories.push(directory);
  const executable = resolve(directory, name);

  writeFileSync(
    executable,
    `#!/bin/sh
printf '%s\\n' '${output}'
exit ${exitCode}
`,
  );
  chmodSync(executable, 0o755);
  return executable;
}

async function run(
  mode: "analyze" | "implement" | "review",
  fixture: ReturnType<typeof createFakeCodex>,
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  arguments: string[];
}> {
  const process = Bun.spawn(
    [
      runner,
      "run",
      "--mode",
      mode,
      "--task",
      "Complete the bounded task",
      "--cwd",
      fixture.workspace,
    ],
    {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...Bun.env,
        FABLE_ORCHESTRATOR_CODEX_BIN: fixture.executable,
        FAKE_CODEX_ARGUMENTS: fixture.argumentsPath,
        ...traceEnv(fixture),
      },
    },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  const argumentsList = readFileSync(fixture.argumentsPath, "utf8");

  return {
    exitCode,
    stdout,
    stderr,
    arguments: JSON.parse(argumentsList),
  };
}

function traceEnv(fixture: { traceDirectory: string }): Record<string, string> {
  return {
    FABLE_ORCHESTRATOR_TRACE: "1",
    FABLE_ORCHESTRATOR_TRACE_DIR: fixture.traceDirectory,
    FABLE_ORCHESTRATOR_LAMINAR: "0",
  };
}

function readTraceRecords(fixture: {
  traceDirectory: string;
}): Record<string, unknown>[] {
  return readFileSync(resolve(fixture.traceDirectory, "runs.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("fable-orchestrator", () => {
  test("uses the fast read-only profile for analysis", async () => {
    const result = await run("analyze", createFakeCodex());

    expect(result.exitCode).toBe(0);
    expect(result.arguments).toContain("gpt-5.4-mini");
    expect(result.arguments).toContain("read-only");
    expect(result.arguments).toContain("--skip-git-repo-check");
    expect(JSON.parse(result.stdout).summary).toBe("done");
  });

  test("uses GPT-5.5 with workspace writes for implementation", async () => {
    const result = await run("implement", createFakeCodex());

    expect(result.exitCode).toBe(0);
    expect(result.arguments).toContain("gpt-5.5");
    expect(result.arguments).toContain("workspace-write");
  });

  test("uses GPT-5.5 read-only for review", async () => {
    const result = await run("review", createFakeCodex());

    expect(result.exitCode).toBe(0);
    expect(result.arguments).toContain("gpt-5.5");
    expect(result.arguments).toContain("read-only");
  });

  test("preserves Codex failures", async () => {
    const fixture = createFakeCodex(7);
    const process = Bun.spawn(
      [
        runner,
        "run",
        "--mode",
        "analyze",
        "--task",
        "Fail predictably",
        "--cwd",
        fixture.workspace,
      ],
      {
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          FABLE_ORCHESTRATOR_CODEX_BIN: fixture.executable,
          FAKE_CODEX_ARGUMENTS: fixture.argumentsPath,
          ...traceEnv(fixture),
        },
      },
    );

    const stderr = await new Response(process.stderr).text();
    expect(await process.exited).toBe(1);
    expect(stderr).toContain("simulated Codex failure");
    expect(stderr).toContain("simulated usage limit");

    const records = readTraceRecords(fixture);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("error");
    expect(records[0].exit_code).toBe(1);
    expect(records[0].tokens).toBeNull();
    expect(records[0].error).toContain("simulated Codex failure");
    expect(records[0].error).toContain("simulated usage limit");
  });

  test("uses Cursor Composer 2.5 for bounded implementation", async () => {
    const fixture = createFakeCursor();
    const process = Bun.spawn(
      [
        runner,
        "run",
        "--backend",
        "composer",
        "--mode",
        "implement",
        "--task",
        "Implement the bounded task",
        "--cwd",
        fixture.workspace,
      ],
      {
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          FABLE_ORCHESTRATOR_CURSOR_BIN: fixture.executable,
          FAKE_CURSOR_ARGUMENTS: fixture.argumentsPath,
          ...traceEnv(fixture),
        },
      },
    );

    const stdout = await new Response(process.stdout).text();
    const stderr = await new Response(process.stderr).text();
    expect(await process.exited).toBe(0);
    expect(stderr).toBe("");

    const argumentsList = JSON.parse(
      readFileSync(fixture.argumentsPath, "utf8"),
    ) as string[];
    expect(argumentsList).toContain("--force");
    expect(argumentsList).toContain("--output-format");
    expect(argumentsList).toContain("composer-2.5");
    expect(JSON.parse(stdout).summary).toBe("composer done");

    const records = readTraceRecords(fixture);
    expect(records).toHaveLength(1);
    expect(records[0].backend).toBe("composer");
    expect(records[0].model).toBe("composer-2.5");
    expect(records[0].sandbox).toBe("workspace-write");
    expect(records[0].status).toBe("completed");
    expect(records[0].changed_files).toBe(1);
    expect(records[0].tokens).toEqual({
      input_tokens: 45,
      cached_input_tokens: 10,
      output_tokens: 67,
      total_tokens: 112,
    });
  });

  test("rejects read-only routes on the Composer backend", async () => {
    const fixture = createFakeCursor();
    const process = Bun.spawn(
      [
        runner,
        "run",
        "--backend",
        "composer",
        "--mode",
        "review",
        "--task",
        "Review without edits",
        "--cwd",
        fixture.workspace,
      ],
      {
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          FABLE_ORCHESTRATOR_CURSOR_BIN: fixture.executable,
          FAKE_CURSOR_ARGUMENTS: fixture.argumentsPath,
          ...traceEnv(fixture),
        },
      },
    );

    const stderr = await new Response(process.stderr).text();
    expect(await process.exited).toBe(2);
    expect(stderr).toContain("only supports implement");
  });

  test("reports Cursor authentication failures with recovery guidance", async () => {
    const fixture = createFakeCursor(9);
    const process = Bun.spawn(
      [
        runner,
        "run",
        "--backend",
        "composer",
        "--mode",
        "implement",
        "--task",
        "Implement the bounded task",
        "--cwd",
        fixture.workspace,
      ],
      {
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          FABLE_ORCHESTRATOR_CURSOR_BIN: fixture.executable,
          FAKE_CURSOR_ARGUMENTS: fixture.argumentsPath,
          ...traceEnv(fixture),
        },
      },
    );

    const stderr = await new Response(process.stderr).text();
    expect(await process.exited).toBe(1);
    expect(stderr).toContain("simulated Cursor failure");
    expect(stderr).toContain("cursor-agent login");
    expect(stderr).toContain("keychain");
  });

  test("doctor reports backend readiness independently", async () => {
    const codex = createStatusExecutable("codex", "Logged in using ChatGPT", 0);
    const cursor = createStatusExecutable(
      "cursor-agent",
      "SecItemCopyMatching failed -50",
      1,
    );
    const process = Bun.spawn([runner, "doctor", "--json"], {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...Bun.env,
        FABLE_ORCHESTRATOR_CODEX_BIN: codex,
        FABLE_ORCHESTRATOR_CURSOR_BIN: cursor,
      },
    });

    const stdout = await new Response(process.stdout).text();
    expect(await process.exited).toBe(0);

    const report = JSON.parse(stdout);
    expect(report.status).toBe("attention_required");
    expect(report.codex.authenticated).toBe(true);
    expect(report.composer.authenticated).toBe(false);
    expect(report.next_actions.join(" ")).toContain("CURSOR_API_KEY");
    expect(report.next_actions.join(" ")).toContain("without sudo");
  });

  test("records a local trace with the resolved model and token usage", async () => {
    const fixture = createFakeCodex();
    const result = await run("analyze", fixture);

    expect(result.exitCode).toBe(0);
    expect(result.arguments).toContain("--json");

    const records = readTraceRecords(fixture);
    expect(records).toHaveLength(1);

    const record = records[0];
    expect(record.schema).toBe(1);
    expect(record.backend).toBe("codex");
    expect(record.mode).toBe("analyze");
    expect(record.model).toBe("gpt-5.4-mini");
    expect(record.sandbox).toBe("read-only");
    expect(record.cwd).toBe(fixture.workspace);
    expect(record.task_label).toBe("Complete the bounded task");
    expect(record.status).toBe("completed");
    expect(record.exit_code).toBe(0);
    expect(record.changed_files).toBe(0);
    expect(record.error).toBeNull();
    expect(record.tokens).toEqual({
      input_tokens: 1200,
      cached_input_tokens: 200,
      output_tokens: 300,
      total_tokens: 1500,
    });
  });

  test("truncates long task text in the trace label", async () => {
    const fixture = createFakeCodex();
    const task = `Refactor ${"the module ".repeat(20)}carefully`;
    const process = Bun.spawn(
      [runner, "run", "--mode", "analyze", "--task", task, "--cwd", fixture.workspace],
      {
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          FABLE_ORCHESTRATOR_CODEX_BIN: fixture.executable,
          FAKE_CODEX_ARGUMENTS: fixture.argumentsPath,
          ...traceEnv(fixture),
        },
      },
    );

    expect(await process.exited).toBe(0);

    const [record] = readTraceRecords(fixture);
    const label = record.task_label as string;
    expect(label.length).toBeLessThanOrEqual(80);
    expect(label.endsWith("…")).toBe(true);
  });

  test("FABLE_ORCHESTRATOR_TRACE=0 disables local tracing", async () => {
    const fixture = createFakeCodex();
    const process = Bun.spawn(
      [
        runner,
        "run",
        "--mode",
        "analyze",
        "--task",
        "Complete the bounded task",
        "--cwd",
        fixture.workspace,
      ],
      {
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          FABLE_ORCHESTRATOR_CODEX_BIN: fixture.executable,
          FAKE_CODEX_ARGUMENTS: fixture.argumentsPath,
          FABLE_ORCHESTRATOR_TRACE: "0",
          FABLE_ORCHESTRATOR_TRACE_DIR: fixture.traceDirectory,
          FABLE_ORCHESTRATOR_LAMINAR: "0",
        },
      },
    );

    expect(await process.exited).toBe(0);
    expect(existsSync(resolve(fixture.traceDirectory, "runs.jsonl"))).toBe(
      false,
    );
  });

  test("runs subcommand reports recorded runs", async () => {
    const fixture = createFakeCodex();
    await run("analyze", fixture);
    await run("review", fixture);

    const jsonProcess = Bun.spawn([runner, "runs", "--json", "--limit", "1"], {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...Bun.env, FABLE_ORCHESTRATOR_TRACE_DIR: fixture.traceDirectory },
    });
    const jsonStdout = await new Response(jsonProcess.stdout).text();
    expect(await jsonProcess.exited).toBe(0);

    const records = JSON.parse(jsonStdout);
    expect(records).toHaveLength(1);
    expect(records[0].mode).toBe("review");
    expect(records[0].model).toBe("gpt-5.5");

    const humanProcess = Bun.spawn([runner, "runs"], {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...Bun.env, FABLE_ORCHESTRATOR_TRACE_DIR: fixture.traceDirectory },
    });
    const humanStdout = await new Response(humanProcess.stdout).text();
    expect(await humanProcess.exited).toBe(0);
    expect(humanStdout).toContain("gpt-5.4-mini");
    expect(humanStdout).toContain("gpt-5.5");
    expect(humanStdout).toContain("runs by model");
  });

  test("exports run metadata to Laminar when explicitly enabled", async () => {
    const fixture = createFakeCodex();
    const received: {
      path: string;
      authorization: string | null;
      body: Record<string, any>;
    }[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        received.push({
          path: url.pathname,
          authorization: request.headers.get("authorization"),
          body: (await request.json()) as Record<string, any>,
        });
        if (url.pathname === "/v1/evals") {
          return Response.json({ id: "evaluation-1", projectId: "project-1" });
        }
        return Response.json({});
      },
    });

    try {
      const process = Bun.spawn(
        [
          runner,
          "run",
          "--mode",
          "analyze",
          "--task",
          "Complete the bounded task",
          "--cwd",
          fixture.workspace,
        ],
        {
          cwd: projectRoot,
          stdout: "pipe",
          stderr: "pipe",
          env: {
            ...Bun.env,
            FABLE_ORCHESTRATOR_CODEX_BIN: fixture.executable,
            FAKE_CODEX_ARGUMENTS: fixture.argumentsPath,
            FABLE_ORCHESTRATOR_TRACE: "1",
            FABLE_ORCHESTRATOR_TRACE_DIR: fixture.traceDirectory,
            FABLE_ORCHESTRATOR_LAMINAR: "1",
            LMNR_PROJECT_API_KEY: "test-key",
            LMNR_BASE_URL: `http://127.0.0.1:${server.port}`,
          },
        },
      );

      const stderr = await new Response(process.stderr).text();
      expect(await process.exited).toBe(0);
      expect(stderr).toBe("");
    } finally {
      server.stop(true);
    }

    expect(received).toHaveLength(3);

    expect(received[0].path).toBe("/v1/evals");
    expect(received[0].authorization).toBe("Bearer test-key");
    expect(received[0].body.groupName).toBe("fable-orchestrator");
    expect(received[0].body.metadata["gen_ai.request.model"]).toBe(
      "gpt-5.4-mini",
    );

    expect(received[1].path).toBe("/v1/evals/evaluation-1/datapoints");
    expect(received[1].body.points).toHaveLength(1);
    expect(received[1].body.points[0].data.model).toBe("gpt-5.4-mini");
    expect(received[1].body.points[0].data.backend).toBe("codex");

    expect(received[2].path).toStartWith("/v1/evals/evaluation-1/datapoints/");
    expect(received[2].body.scores.completed).toBe(1);
    expect(received[2].body.scores.total_tokens).toBe(1500);
    expect(received[2].body.scores.duration_ms).toBeGreaterThanOrEqual(0);
    expect(received[2].body.executorOutput.status).toBe("completed");

    // Redaction boundary: the worker prompt never reaches the sink.
    expect(JSON.stringify(received)).not.toContain("You are a worker");
  });

  test("Laminar export failures never break the run", async () => {
    const fixture = createFakeCodex();
    const process = Bun.spawn(
      [
        runner,
        "run",
        "--mode",
        "analyze",
        "--task",
        "Complete the bounded task",
        "--cwd",
        fixture.workspace,
      ],
      {
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          FABLE_ORCHESTRATOR_CODEX_BIN: fixture.executable,
          FAKE_CODEX_ARGUMENTS: fixture.argumentsPath,
          FABLE_ORCHESTRATOR_TRACE: "1",
          FABLE_ORCHESTRATOR_TRACE_DIR: fixture.traceDirectory,
          FABLE_ORCHESTRATOR_LAMINAR: "1",
          LMNR_PROJECT_API_KEY: "test-key",
          LMNR_BASE_URL: "http://127.0.0.1:1",
        },
      },
    );

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).summary).toBe("done");
    expect(stderr).toContain("Laminar export failed");
    expect(readTraceRecords(fixture)).toHaveLength(1);
  });
});
