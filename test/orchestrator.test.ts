import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
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

// Network-restricted sandboxes cannot bind even an ephemeral localhost
// server; skip the fake-Laminar test there instead of failing validation.
function canBindLocalhost(): boolean {
  try {
    const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
    probe.stop(true);
    return true;
  } catch {
    return false;
  }
}

const localhostAvailable = canBindLocalhost();
if (!localhostAvailable) {
  console.warn(
    "Skipping Laminar integration test: this environment cannot bind a localhost test server.",
  );
}

function expectedProjectIdentifier(cwd: string): string {
  return new Bun.CryptoHasher("sha256").update(cwd).digest("hex").slice(0, 12);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createFakeCodex(
  exitCode = 0,
  sleepSeconds = 0,
): {
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
sleep ${sleepSeconds}
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
  last_argument=""
  for argument in "$@"; do last_argument="$argument"; done
  printf '%s\\n' "$last_argument" | tail -n 1 >&2
  echo "schema write failed at $FAKE_CODEX_ARGUMENTS" >&2
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

function createFakeCursor(
  exitCode = 0,
  resultFormat: "fenced" | "prose" | "prose-fenced" = "fenced",
): {
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

  const structuredResult = JSON.stringify({
    status: "completed",
    summary: "composer done",
    changes: ["src/app.ts"],
    verification: [],
    risks: [],
    next_actions: [],
  });
  const preamble =
    "Reviewing workspace artifacts to produce an accurate JSON summary.\n";
  const result =
    resultFormat === "prose"
      ? `${preamble}${structuredResult}`
      : `${resultFormat === "prose-fenced" ? preamble : ""}\`\`\`json\n${structuredResult}\n\`\`\``;
  const envelope = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 3554,
    result,
    session_id: "fake-session",
    usage: {
      inputTokens: 45,
      outputTokens: 67,
      cacheReadTokens: 10,
      cacheWriteTokens: 0,
    },
  });

  writeFileSync(
    executable,
    `#!/bin/sh
printf '%s\\n' "$@" | jq -R -s 'split("\\n")[:-1]' > "$FAKE_CURSOR_ARGUMENTS"
if [ ${exitCode} -ne 0 ]; then
  echo "simulated Cursor failure" >&2
  exit ${exitCode}
fi
printf '%s\\n' '${envelope}'
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
  extraArguments: string[] = [],
  extraEnv: Record<string, string> = {},
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
      ...extraArguments,
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
        ...extraEnv,
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

function lockPathFor(fixture: {
  traceDirectory: string;
  workspace: string;
}): string {
  return resolve(
    fixture.traceDirectory,
    "locks",
    `${expectedProjectIdentifier(fixture.workspace)}.lock`,
  );
}

function writeLock(
  fixture: { traceDirectory: string; workspace: string },
  pid: number,
): void {
  const path = lockPathFor(fixture);
  mkdirSync(resolve(fixture.traceDirectory, "locks"), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      pid,
      run_id: "test-holder",
      timestamp: "2026-07-05T00:00:00.000Z",
    }),
  );
}

function readAnnotationRecords(fixture: {
  traceDirectory: string;
}): Record<string, unknown>[] {
  return readFileSync(
    resolve(fixture.traceDirectory, "annotations.jsonl"),
    "utf8",
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function spawnCommand(
  fixture: { traceDirectory: string },
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const process = Bun.spawn([runner, ...args], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      FABLE_ORCHESTRATOR_TRACE_DIR: fixture.traceDirectory,
    },
  });

  return Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ exitCode, stdout, stderr }));
}

function annotate(
  fixture: { traceDirectory: string },
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return spawnCommand(fixture, ["annotate", ...args]);
}

function report(
  fixture: { traceDirectory: string },
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return spawnCommand(fixture, ["report", ...args]);
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
    // The parent still sees the full, actionable detail on stderr.
    expect(stderr).toContain("Fail predictably");
    expect(stderr).toContain(fixture.argumentsPath);

    const records = readTraceRecords(fixture);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("error");
    expect(records[0].exit_code).toBe(1);
    expect(records[0].tokens).toBeNull();
    expect(records[0].error).toContain("simulated Codex failure");
    expect(records[0].error).toContain("simulated usage limit");

    // The persisted summary redacts echoed task text and absolute paths.
    const persistedError = records[0].error as string;
    expect(persistedError).toContain("<task>");
    expect(persistedError).toContain("<path>");
    expect(persistedError).not.toContain("Fail predictably");
    expect(persistedError).not.toContain(fixture.argumentsPath);
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

  for (const resultFormat of ["prose", "prose-fenced"] as const) {
    test(`accepts Composer results with prose before ${resultFormat === "prose" ? "bare JSON" : "fenced JSON"}`, async () => {
      const fixture = createFakeCursor(0, resultFormat);
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
      expect(JSON.parse(stdout)).toEqual({
        status: "completed",
        summary: "composer done",
        changes: ["src/app.ts"],
        verification: [],
        risks: [],
        next_actions: [],
      });
    });
  }

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

  test("reports Composer structured-result failures with worktree inspection guidance", async () => {
    const fixture = createFakeCursor();
    writeFileSync(
      fixture.executable,
      `#!/bin/sh
printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"result":"not json"}'
`,
    );
    chmodSync(fixture.executable, 0o755);

    const process = Bun.spawn(
      [
        runner,
        "run",
        "--backend",
        "composer",
        "--mode",
        "implement",
        "--task",
        "Implement but fail structured response",
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
          ...traceEnv(fixture),
        },
      },
    );

    const stderr = await new Response(process.stderr).text();
    expect(await process.exited).toBe(1);
    expect(stderr).toContain("Cursor did not return the required structured result");
    expect(stderr).toContain("inspect the worktree");
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
    expect(record.schema).toBe(4);
    expect(record.budget).toBeNull();
    expect(record.backend).toBe("codex");
    expect(record.mode).toBe("analyze");
    expect(record.model).toBe("gpt-5.4-mini");
    expect(record.sandbox).toBe("read-only");
    expect(record.project).toBe(expectedProjectIdentifier(fixture.workspace));
    expect(record.label).toBeNull();
    expect(record.task_class).toBeNull();
    expect(record.route_rationale).toBeNull();
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

    // Default records carry neither task text nor filesystem paths.
    const raw = JSON.stringify(records);
    expect(record.cwd).toBeUndefined();
    expect(record.task_label).toBeUndefined();
    expect(raw).not.toContain(fixture.workspace);
    expect(raw).not.toContain("Complete the bounded task");
  });

  test("records and truncates an explicit safe label", async () => {
    const fixture = createFakeCodex();
    const explicitLabel = `validation ${"hardening ".repeat(20)}pass`;
    const result = await run("analyze", fixture, ["--label", explicitLabel]);

    expect(result.exitCode).toBe(0);

    const [record] = readTraceRecords(fixture);
    const label = record.label as string;
    expect(label.startsWith("validation hardening")).toBe(true);
    expect(label.length).toBeLessThanOrEqual(80);
    expect(label.endsWith("…")).toBe(true);
  });

  test("bounds trace retention to FABLE_ORCHESTRATOR_TRACE_LIMIT", async () => {
    const fixture = createFakeCodex();
    await run("analyze", fixture);
    await run("implement", fixture);
    await run("review", fixture, [], { FABLE_ORCHESTRATOR_TRACE_LIMIT: "2" });

    const records = readTraceRecords(fixture);
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.mode)).toEqual([
      "implement",
      "review",
    ]);
  });

  test("records an explicit task class and route rationale", async () => {
    const fixture = createFakeCodex();
    const result = await run("analyze", fixture, [
      "--task-class",
      "bugfix",
      "--route-rationale",
      "cheap read-only scan before a targeted edit",
    ]);

    expect(result.exitCode).toBe(0);

    const [record] = readTraceRecords(fixture);
    expect(record.task_class).toBe("bugfix");
    expect(record.route_rationale).toBe(
      "cheap read-only scan before a targeted edit",
    );

    // Redaction still holds: rationale is parent-authored, task text is not.
    const raw = JSON.stringify(readTraceRecords(fixture));
    expect(raw).not.toContain("Complete the bounded task");
  });

  test("annotate records the parent outcome and joins it to the run", async () => {
    const fixture = createFakeCodex();
    await run("analyze", fixture);

    const [before] = readTraceRecords(fixture);
    const runId = before.run_id as string;

    const annotation = await annotate(fixture, [
      "--run",
      "latest",
      "--outcome",
      "escalated",
      "--escalated-to",
      "gpt-5.5",
      "--note",
      "analysis missed the failing path",
    ]);
    expect(annotation.exitCode).toBe(0);
    expect(annotation.stdout).toContain("Recorded escalated");

    const [record] = readAnnotationRecords(fixture);
    expect(record.schema).toBe(1);
    expect(record.run_id).toBe(runId);
    expect(record.outcome).toBe("escalated");
    expect(record.escalated_to).toBe("gpt-5.5");
    expect(record.note).toBe("analysis missed the failing path");

    // runs --json now carries the joined outcome for downstream reporting.
    const runsProcess = Bun.spawn([runner, "runs", "--json"], {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...Bun.env, FABLE_ORCHESTRATOR_TRACE_DIR: fixture.traceDirectory },
    });
    const runsStdout = await new Response(runsProcess.stdout).text();
    expect(await runsProcess.exited).toBe(0);
    const joined = JSON.parse(runsStdout);
    expect(joined[0].run_id).toBe(runId);
    expect(joined[0].outcome).toBe("escalated");
  });

  test("annotate accepts an explicit run id and the latest wins", async () => {
    const fixture = createFakeCodex();
    await run("analyze", fixture);
    const [record] = readTraceRecords(fixture);
    const runId = record.run_id as string;

    await annotate(fixture, ["--run", runId, "--outcome", "rejected"]);
    await annotate(fixture, ["--run", runId, "--outcome", "accepted"]);

    const observability = Bun.spawn(
      [runner, "observability", "--json"],
      {
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          FABLE_ORCHESTRATOR_TRACE_DIR: fixture.traceDirectory,
        },
      },
    );
    const stdout = await new Response(observability.stdout).text();
    expect(await observability.exited).toBe(0);

    const summary = JSON.parse(stdout);
    // The later "accepted" supersedes the earlier "rejected".
    expect(summary.totals.by_outcome.accepted).toBe(1);
    expect(summary.totals.by_outcome.rejected).toBe(0);
    expect(summary.recent[0].outcome).toBe("accepted");
  });

  test("annotate rejects an invalid outcome", async () => {
    const fixture = createFakeCodex();
    await run("analyze", fixture);

    const annotation = await annotate(fixture, [
      "--run",
      "latest",
      "--outcome",
      "maybe",
    ]);
    expect(annotation.exitCode).toBe(2);
    expect(annotation.stderr).toContain("--outcome must be one of");
  });

  test("report aggregates completion, acceptance, tokens, and latency", async () => {
    const fixture = createFakeCodex();
    // Two analyze runs (gpt-5.4-mini): one accepted, one escalated.
    await run("analyze", fixture);
    await annotate(fixture, ["--run", "latest", "--outcome", "accepted"]);
    await run("analyze", fixture);
    await annotate(fixture, ["--run", "latest", "--outcome", "escalated"]);
    // One review run (gpt-5.5), left unrated.
    await run("review", fixture);

    const result = await report(fixture, ["--group-by", "model", "--json"]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.group_by).toBe("model");
    expect(parsed.runs).toBe(3);

    const mini = parsed.groups.find(
      (group: { key: string }) => group.key === "gpt-5.4-mini",
    );
    expect(mini.runs).toBe(2);
    expect(mini.completion_rate).toBe(1);
    expect(mini.rated).toBe(2);
    expect(mini.by_outcome.accepted).toBe(1);
    expect(mini.by_outcome.escalated).toBe(1);
    expect(mini.acceptance_rate).toBe(0.5);
    expect(mini.tokens_mean).toBe(1500);
    expect(mini.tokens_total).toBe(3000);
    expect(mini.duration_ms_mean).toBeGreaterThanOrEqual(0);

    const full = parsed.groups.find(
      (group: { key: string }) => group.key === "gpt-5.5",
    );
    expect(full.runs).toBe(1);
    expect(full.rated).toBe(0);
    // Acceptance rate is null when no run in the group was rated.
    expect(full.acceptance_rate).toBeNull();
  });

  test("report groups unclassified runs and honors --group-by task_class", async () => {
    const fixture = createFakeCodex();
    await run("analyze", fixture, ["--task-class", "recon"]);
    await run("review", fixture);

    const result = await report(fixture, [
      "--group-by",
      "task_class",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    const keys = parsed.groups.map((group: { key: string }) => group.key);
    expect(keys).toContain("recon");
    expect(keys).toContain("(unclassified)");
  });

  test("report rejects an invalid --group-by", async () => {
    const fixture = createFakeCodex();
    await run("analyze", fixture);

    const result = await report(fixture, ["--group-by", "nonsense"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--group-by must be one of");
  });

  test("duration budget kills the worker and records the violation", async () => {
    const fixture = createFakeCodex(0, 2);
    const result = await run("analyze", fixture, [], {
      FABLE_ORCHESTRATOR_MAX_DURATION_MS: "300",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("duration budget");

    const [record] = readTraceRecords(fixture);
    expect(record.status).toBe("error");
    expect(record.error).toContain("budget");
    expect(record.budget).toEqual({
      max_tokens: null,
      max_duration_ms: 300,
      tokens_exceeded: false,
      duration_exceeded: true,
    });
  });

  test("token budget flags a completed run without discarding the result", async () => {
    const fixture = createFakeCodex();
    // The fake reports 1500 total tokens.
    const result = await run("analyze", fixture, [], {
      FABLE_ORCHESTRATOR_MAX_TOKENS: "1000",
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).summary).toBe("done");
    expect(result.stderr).toContain("exceeding FABLE_ORCHESTRATOR_MAX_TOKENS");

    const [record] = readTraceRecords(fixture);
    expect(record.status).toBe("completed");
    expect(record.budget).toEqual({
      max_tokens: 1000,
      max_duration_ms: null,
      tokens_exceeded: true,
      duration_exceeded: false,
    });

    // The comparative report counts the violation for its group.
    const reported = await report(fixture, ["--group-by", "model", "--json"]);
    const group = JSON.parse(reported.stdout).groups[0];
    expect(group.budget_exceeded).toBe(1);
  });

  test("rejects invalid budget thresholds before spawning a worker", async () => {
    const fixture = createFakeCodex();
    const result = await run("analyze", fixture, [], {
      FABLE_ORCHESTRATOR_MAX_TOKENS: "not-a-number",
    }).catch(() => null);

    // The runner fails fast; the fake never runs, so arguments.json is
    // never written and run() throws reading it.
    expect(result).toBeNull();
    expect(existsSync(fixture.argumentsPath)).toBe(false);
  });

  test("write-capable runs fail fast when the project lock is held", async () => {
    const fixture = createFakeCodex();
    // The test process itself is the live holder.
    writeLock(fixture, process.pid);

    const result = await run("implement", fixture).catch(() => null);
    expect(result).toBeNull();

    const [record] = readTraceRecords(fixture);
    expect(record.status).toBe("error");
    expect(record.error).toContain("write lock");
    // The runner must not release a lock it never owned.
    expect(existsSync(lockPathFor(fixture))).toBe(true);
  });

  test("read-only runs ignore the write lock", async () => {
    const fixture = createFakeCodex();
    writeLock(fixture, process.pid);

    const result = await run("analyze", fixture);
    expect(result.exitCode).toBe(0);
  });

  test("stale write locks are reclaimed and released after the run", async () => {
    const fixture = createFakeCodex();
    const dead = Bun.spawn(["true"]);
    await dead.exited;
    writeLock(fixture, dead.pid);

    const result = await run("implement", fixture);
    expect(result.exitCode).toBe(0);
    // The lock is released once the run completes.
    expect(existsSync(lockPathFor(fixture))).toBe(false);
  });

  test("FABLE_ORCHESTRATOR_WRITE_LOCK=0 disables serialization", async () => {
    const fixture = createFakeCodex();
    writeLock(fixture, process.pid);

    const result = await run("implement", fixture, [], {
      FABLE_ORCHESTRATOR_WRITE_LOCK: "0",
    });
    expect(result.exitCode).toBe(0);
  });

  test("FABLE_ORCHESTRATOR_LOCK_WAIT_MS waits before giving up", async () => {
    const fixture = createFakeCodex();
    writeLock(fixture, process.pid);

    const startedAt = Date.now();
    const result = await run("implement", fixture, [], {
      FABLE_ORCHESTRATOR_LOCK_WAIT_MS: "400",
    }).catch(() => null);

    expect(result).toBeNull();
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(400);
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

  test("observability subcommand reports trace and Laminar readiness", async () => {
    const fixture = createFakeCodex();
    await run("analyze", fixture);

    const process = Bun.spawn(
      [runner, "observability", "--json", "--limit", "1"],
      {
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          FABLE_ORCHESTRATOR_TRACE_DIR: fixture.traceDirectory,
          FABLE_ORCHESTRATOR_LAMINAR: "1",
          LMNR_PROJECT_API_KEY: "test-key",
          LMNR_PROJECT_NAME: "arc-orchestrator",
        },
      },
    );
    const stdout = await new Response(process.stdout).text();
    expect(await process.exited).toBe(0);

    const summary = JSON.parse(stdout);
    expect(summary.trace.records).toBe(1);
    expect(summary.laminar.export_ready).toBe(true);
    expect(summary.laminar.group_name).toBe("arc-orchestrator");
    expect(summary.laminar).not.toHaveProperty("api_key");
    expect(summary.totals.by_model["gpt-5.4-mini"].runs).toBe(1);
    expect(summary.recent).toHaveLength(1);
  });

  test.skipIf(!localhostAvailable)(
    "exports run metadata to Laminar when explicitly enabled",
    async () => {
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
            // Pin the group name so a developer's shell LMNR_PROJECT_NAME
            // cannot leak into the assertion below.
            LMNR_PROJECT_NAME: "",
          },
        },
      );

      const stderr = await new Response(process.stderr).text();
      expect(await process.exited).toBe(0);
      expect(stderr).toContain(
        `laminar: http://127.0.0.1:${server.port}/project/project-1/evaluations/evaluation-1`,
      );
      expect(stderr).not.toContain("Laminar export failed");
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
    expect(received[1].body.points[0].data.project).toBe(
      expectedProjectIdentifier(fixture.workspace),
    );
    expect(received[1].body.points[0].data.label).toBeNull();

    expect(received[2].path).toStartWith("/v1/evals/evaluation-1/datapoints/");
    expect(received[2].body.scores.completed).toBe(1);
    expect(received[2].body.scores.total_tokens).toBe(1500);
    expect(received[2].body.scores.duration_ms).toBeGreaterThanOrEqual(0);
    expect(received[2].body.executorOutput.status).toBe("completed");

    // Redaction boundary: neither the worker prompt, the task text, nor
    // the absolute workspace path reaches the sink.
    const exported = JSON.stringify(received);
    expect(exported).not.toContain("You are a worker");
    expect(exported).not.toContain("Complete the bounded task");
    expect(exported).not.toContain(fixture.workspace);
    },
  );

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
