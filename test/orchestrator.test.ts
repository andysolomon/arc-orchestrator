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
const tasteSensitiveTaskClasses = [
  "taste-sensitive",
  "ui",
  "copy",
  "api-design",
] as const;

function expectedTasteSensitiveVariants(model: string) {
  return tasteSensitiveTaskClasses.map((task_class) => ({
    task_class,
    case_sensitive: false,
    trim_whitespace: true,
    model,
  }));
}

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
  failureMessage = "simulated task failure",
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

  const shellSafeFailureMessage = failureMessage.replace(/'/g, `'\\''`);

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
  printf '%s\\n' '{"type":"turn.failed","error":{"message":"${shellSafeFailureMessage}"}}'
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
  failureMessage = "simulated Cursor failure",
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
  echo '${failureMessage.replace(/'/g, `'\\''`)}' >&2
  exit ${exitCode}
fi
printf '%s\\n' '${envelope}'
`,
  );
  chmodSync(executable, 0o755);

  return { executable, argumentsPath, workspace, traceDirectory };
}

function createFakeClaude(
  exitCode = 0,
  options: {
    structuredField?: "result" | "structured_output";
    model?: string;
    failureMessage?: string;
    failWithoutBaseUrl?: boolean;
  } = {},
): {
  executable: string;
  argumentsPath: string;
  envPath: string;
  workspace: string;
  traceDirectory: string;
} {
  const directory = mkdtempSync(`${tmpdir()}/fake-claude-`);
  temporaryDirectories.push(directory);
  const executable = resolve(directory, "claude");
  const argumentsPath = resolve(directory, "arguments.json");
  const envPath = resolve(directory, "env.jsonl");
  const workspace = resolve(directory, "workspace");
  const traceDirectory = resolve(directory, "traces");

  Bun.spawnSync(["mkdir", "-p", workspace]);

  const structuredResult = JSON.stringify({
    status: "completed",
    summary: "claude done",
    changes: ["src/main.ts"],
    verification: [],
    risks: [],
    next_actions: [],
  });
  const structuredField = options.structuredField ?? "result";
  const shellSafeFailureMessage = (options.failureMessage ?? "simulated Claude failure").replace(
    /'/g,
    `'\\''`,
  );
  const envelope =
    structuredField === "structured_output"
      ? JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          structured_output: JSON.parse(structuredResult),
          usage: { input_tokens: 10, output_tokens: 20 },
        })
      : JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          result: structuredResult,
          usage: { input_tokens: 10, output_tokens: 20 },
        });

  writeFileSync(
    executable,
    `#!/bin/sh
printf '%s\\n' "$@" | jq -R -s 'split("\\n")[:-1]' > "$FAKE_CLAUDE_ARGUMENTS"
if [ -n "$FAKE_CLAUDE_ENV" ]; then
  printf '{"base_url":"%s","api_key":"%s"}\\n' "$ANTHROPIC_BASE_URL" "$ANTHROPIC_API_KEY" >> "$FAKE_CLAUDE_ENV"
fi
if [ ${options.failWithoutBaseUrl ? 1 : 0} -eq 1 ] && [ -z "$ANTHROPIC_BASE_URL" ]; then
  echo '${shellSafeFailureMessage}' >&2
  exit 1
fi
if [ ${exitCode} -ne 0 ]; then
  echo '${shellSafeFailureMessage}' >&2
  exit ${exitCode}
fi
printf '%s\\n' '${envelope}'
`,
  );
  chmodSync(executable, 0o755);

  return { executable, argumentsPath, envPath, workspace, traceDirectory };
}

async function runClaude(
  mode: "analyze" | "implement" | "review",
  fixture: ReturnType<typeof createFakeClaude>,
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
      "--backend",
      "claude",
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
        FABLE_ORCHESTRATOR_CLAUDE_BIN: fixture.executable,
        FAKE_CLAUDE_ARGUMENTS: fixture.argumentsPath,
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
      "--backend",
      "codex",
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

function createFakeClaudeAuth(
  loggedIn: boolean,
  authMethod = "chatgpt",
): string {
  const directory = mkdtempSync(`${tmpdir()}/fake-claude-auth-`);
  temporaryDirectories.push(directory);
  const executable = resolve(directory, "claude");
  const output = JSON.stringify({
    loggedIn,
    authMethod,
    email: "user@example.com",
  });

  writeFileSync(
    executable,
    `#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s\\n' '${output}'
  exit 0
fi
echo "unexpected claude invocation: $@" >&2
exit 1
`,
  );
  chmodSync(executable, 0o755);
  return executable;
}

async function runWithBackends(
  mode: "analyze" | "implement" | "review",
  codexFixture: ReturnType<typeof createFakeCodex>,
  claudeFixture: ReturnType<typeof createFakeClaude>,
  extraArguments: string[] = [],
  extraEnv: Record<string, string> = {},
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  codexInvoked: boolean;
  claudeInvoked: boolean;
}> {
  const process = Bun.spawn(
    [
      runner,
      "run",
      "--backend",
      "codex",
      "--mode",
      mode,
      "--task",
      "Complete the bounded task",
      "--cwd",
      codexFixture.workspace,
      ...extraArguments,
    ],
    {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...Bun.env,
        FABLE_ORCHESTRATOR_CODEX_BIN: codexFixture.executable,
        FABLE_ORCHESTRATOR_CLAUDE_BIN: claudeFixture.executable,
        FAKE_CODEX_ARGUMENTS: codexFixture.argumentsPath,
        FAKE_CLAUDE_ARGUMENTS: claudeFixture.argumentsPath,
        ...traceEnv(codexFixture),
        ...extraEnv,
      },
    },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  return {
    exitCode,
    stdout,
    stderr,
    codexInvoked: existsSync(codexFixture.argumentsPath),
    claudeInvoked: existsSync(claudeFixture.argumentsPath),
  };
}

async function runWithCodexClaudeComposer(
  mode: "analyze" | "implement" | "review",
  codexFixture: ReturnType<typeof createFakeCodex>,
  claudeFixture: ReturnType<typeof createFakeClaude>,
  cursorFixture: ReturnType<typeof createFakeCursor>,
  extraEnv: Record<string, string> = {},
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  codexInvoked: boolean;
  claudeInvoked: boolean;
  cursorInvoked: boolean;
}> {
  const process = Bun.spawn(
    [
      runner,
      "run",
      "--backend",
      "codex",
      "--mode",
      mode,
      "--task",
      "Complete the bounded task",
      "--cwd",
      codexFixture.workspace,
    ],
    {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...Bun.env,
        FABLE_ORCHESTRATOR_CODEX_BIN: codexFixture.executable,
        FABLE_ORCHESTRATOR_CLAUDE_BIN: claudeFixture.executable,
        FABLE_ORCHESTRATOR_CURSOR_BIN: cursorFixture.executable,
        FAKE_CODEX_ARGUMENTS: codexFixture.argumentsPath,
        FAKE_CLAUDE_ARGUMENTS: claudeFixture.argumentsPath,
        FAKE_CURSOR_ARGUMENTS: cursorFixture.argumentsPath,
        ...traceEnv(codexFixture),
        ...extraEnv,
      },
    },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  return {
    exitCode,
    stdout,
    stderr,
    codexInvoked: existsSync(codexFixture.argumentsPath),
    claudeInvoked: existsSync(claudeFixture.argumentsPath),
    cursorInvoked: existsSync(cursorFixture.argumentsPath),
  };
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

function routes(
  args: string[] = ["--json"],
  extraEnv: Record<string, string> = {},
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  traceDirectory: string;
}> {
  const traceDirectory = mkdtempSync(`${tmpdir()}/routes-traces-`);
  temporaryDirectories.push(traceDirectory);
  const process = Bun.spawn([runner, "routes", ...args], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      FABLE_ORCHESTRATOR_TRACE_DIR: traceDirectory,
      ...extraEnv,
    },
  });

  return Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]).then(([stdout, stderr, exitCode]) => ({
    exitCode,
    stdout,
    stderr,
    traceDirectory,
  }));
}

describe("fable-orchestrator", () => {
  test.each(["fable", "sol", "opus", "cursor-fable-high"])(
    "accepts %s as an explicit public orchestrator identity",
    async (identity) => {
      const fixture = createFakeCodex();
      const result = await run("analyze", fixture, ["--orchestrator", identity]);

      expect(result.exitCode).toBe(0);
      const [record] = readTraceRecords(fixture);
      expect(record.orchestrator_identity).toBe(identity);
      expect(record.backend).toBe("codex");
      expect(record.model).toBe("gpt-5.6-luna");
    },
  );

  test("Composer identity activates opus-explore for analyze and records the parent identity", async () => {
    const fixture = createFakeClaude();
    const result = await runClaude("analyze", fixture, [
      "--orchestrator",
      "composer",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.arguments).toContain("claude-opus-4-8");
    const [record] = readTraceRecords(fixture);
    expect(record).toMatchObject({
      orchestrator_identity: "composer",
      backend: "claude",
      mode: "analyze",
      model: "claude-opus-4-8",
      sandbox: "read-only",
    });
  });

  test("Composer identity visibly rejects a conflicting explicit backend", async () => {
    const process = Bun.spawn(
      [
        runner,
        "run",
        "--orchestrator",
        "composer",
        "--backend",
        "codex",
        "--mode",
        "analyze",
        "--task",
        "inspect",
      ],
      { cwd: projectRoot, stdout: "pipe", stderr: "pipe", env: Bun.env },
    );
    const [stderr, exitCode] = await Promise.all([
      new Response(process.stderr).text(),
      process.exited,
    ]);

    expect(exitCode).toBe(2);
    expect(stderr).toContain(
      "Composer orchestrator mode requires --backend claude for analyze",
    );
  });

  test("CLI orchestrator identity takes precedence over the environment", async () => {
    const fixture = createFakeCodex();
    const result = await run(
      "analyze",
      fixture,
      ["--orchestrator", "sol"],
      { FABLE_ORCHESTRATOR_ORCHESTRATOR: "grok" },
    );

    expect(result.exitCode).toBe(0);
    expect(readTraceRecords(fixture)[0].orchestrator_identity).toBe("sol");
  });

  test.each(["fable", "sol", "composer", "opus", "cursor-fable-high"])(
    "accepts %s from FABLE_ORCHESTRATOR_ORCHESTRATOR",
    async (identity) => {
      const result = await routes(["--json"], {
        FABLE_ORCHESTRATOR_ORCHESTRATOR: identity,
      });

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).orchestrator_identity).toBe(identity);
    },
  );

  test.each(["", "   "])(
    "uses explicit null for a blank orchestrator environment (%s)",
    async (identity) => {
      const result = await routes(["--json"], {
        FABLE_ORCHESTRATOR_ORCHESTRATOR: identity,
      });

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).orchestrator_identity).toBeNull();
    },
  );

  test.each([
    [["--json", "--orchestrator", "grok"], {}, "--orchestrator"],
    [
      ["--json"],
      { FABLE_ORCHESTRATOR_ORCHESTRATOR: "grok" },
      "FABLE_ORCHESTRATOR_ORCHESTRATOR",
    ],
  ] as const)(
    "rejects invalid orchestrator identity from %s",
    async (args, env, source) => {
      const result = await routes([...args], { ...env });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(source);
      expect(result.stderr).toContain(
        "fable, sol, composer, opus, cursor-fable-high",
      );
    },
  );

  test("routes JSON reports active identity and truthful harness support", async () => {
    const result = await routes(
      ["--json", "--orchestrator", "composer"],
      {
        FABLE_ORCHESTRATOR_CLAUDE_MODEL: "hostile-claude-model",
        FABLE_ORCHESTRATOR_COMPOSER_MODEL: "hostile-composer-model",
      },
    );
    const report = JSON.parse(result.stdout);

    expect(report.orchestrator_identity).toBe("composer");
    expect(report.orchestrator_identity_support.cursor.composer).toBe(true);
    expect(report.orchestrator_identity_support.codex.composer).toBe(false);
    expect(report.orchestrator_identity_support["claude-code"].opus).toBe(true);
    expect(report.composer_orchestrator_mode).toEqual({
      active: true,
      policy: "composer-economy/v1",
      stack: "(O) Composer -> opus-explore -> composer-implement -> opus-check",
      worker_stack: ["opus-explore", "composer-implement", "opus-check"],
      effective_routes: [
        expect.objectContaining({
          mode: "analyze",
          route: "opus-explore",
          model: "claude-opus-4-8",
          sandbox: "read-only",
        }),
        expect.objectContaining({
          mode: "implement",
          route: "composer-implement",
          model: "composer-2.5",
          sandbox: "workspace-write",
        }),
        expect.objectContaining({
          mode: "review",
          route: "opus-check",
          model: "claude-opus-4-8",
          sandbox: "read-only",
        }),
      ],
    });
    expect(
      report.routes
        .filter((route: { active: boolean }) => route.active)
        .map(
          (route: {
            id: string;
            model: string;
            sandbox: string;
            eligible: boolean;
          }) => ({
            id: route.id,
            model: route.model,
            sandbox: route.sandbox,
            eligible: route.eligible,
          }),
        ),
    ).toEqual([
      {
        id: "composer-implement",
        model: "composer-2.5",
        sandbox: "workspace-write",
        eligible: true,
      },
      {
        id: "opus-explore",
        model: "claude-opus-4-8",
        sandbox: "read-only",
        eligible: true,
      },
      {
        id: "opus-check",
        model: "claude-opus-4-8",
        sandbox: "read-only",
        eligible: true,
      },
    ]);
    expect(
      report.routes
        .filter((route: { active: boolean }) => !route.active)
        .every((route: { eligible: boolean }) => route.eligible === false),
    ).toBe(true);
    const serializedReport = JSON.stringify(report);
    expect(serializedReport).not.toContain("Use when Codex is unavailable");
    expect(serializedReport).not.toContain("Use when Opus is unavailable");
    expect(serializedReport).not.toContain("explicitly chooses Grok");
    expect(
      report.routes
        .filter((route: { active: boolean }) => route.active)
        .every((route: { guidance: string }) =>
          route.guidance.includes("no automatic fallback"),
        ),
    ).toBe(true);
  });

  test("exports deterministic executable routing capabilities as the versioned JSON contract", async () => {
    const fixture = createFakeCodex();
    const environment = {
      FABLE_ORCHESTRATOR_CODEX_BIN: fixture.executable,
      FABLE_ORCHESTRATOR_CURSOR_BIN: fixture.executable,
      FABLE_ORCHESTRATOR_CLAUDE_BIN: fixture.executable,
      FAKE_CODEX_ARGUMENTS: fixture.argumentsPath,
      FABLE_ORCHESTRATOR_ANALYZE_MODEL: "custom-analyze",
      FABLE_ORCHESTRATOR_IMPLEMENT_MODEL: "custom-implement",
      FABLE_ORCHESTRATOR_REVIEW_MODEL: "custom-review",
      FABLE_ORCHESTRATOR_COMPOSER_MODEL: "custom-composer",
      FABLE_ORCHESTRATOR_CLAUDE_MODEL: "custom-opus",
      ROUTES_TEST_SECRET: "super-secret-do-not-export",
    };
    const first = await routes(["--json"], environment);
    const second = await routes(["--json"], environment);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    expect(first.stderr).toBe("");
    expect(existsSync(fixture.argumentsPath)).toBe(false);
    expect(existsSync(resolve(first.traceDirectory, "runs.jsonl"))).toBe(false);
    expect(existsSync(resolve(second.traceDirectory, "runs.jsonl"))).toBe(false);

    const profile = JSON.parse(first.stdout) as {
      schema_version: number;
      source: string;
      orchestrator_identity: string | null;
      orchestrator_identity_support: Record<string, Record<string, boolean>>;
      routes: Array<{
        id: string;
        backend: string;
        mode: string;
        model: string;
        sandbox: string;
        guidance: string;
        task_class_variants?: Array<{
          task_class: string;
          case_sensitive: boolean;
          trim_whitespace: boolean;
          model: string;
        }>;
      }>;
    };
    expect(Object.keys(profile)).toEqual([
      "schema_version",
      "source",
      "orchestrator_identity",
      "orchestrator_identity_support",
      "composer_orchestrator_mode",
      "workload_classes",
      "routing_policy",
      "routes",
    ]);
    expect(profile.schema_version).toBe(2);
    expect(profile.source).toBe("fable-orchestrator");
    expect(profile.orchestrator_identity).toBeNull();
    expect(profile.routes.map((route) => route.id)).toEqual([
      "codex-explore",
      "composer-implement",
      "codex-implement",
      "codex-check",
      "opus-explore",
      "opus-implement",
      "opus-check",
      "grok-explore",
      "grok-implement",
      "grok-check",
      "kimi-explore",
      "kimi-implement",
      "kimi-check",
      "fable-explore",
      "fable-implement",
      "fable-check",
      "cursor-fable-explore",
      "cursor-fable-implement",
      "cursor-fable-check",
      "minimax-explore",
      "minimax-implement",
      "minimax-check",
      "composer-explore",
      "composer-check",
      "terra-implement",
      "sol-explore",
      "sol-check",
      "sol-implement",
    ]);
    expect(new Set(profile.routes.map((route) => route.id)).size).toBe(
      profile.routes.length,
    );

    const expectedModels: Record<string, string> = {
      "codex-explore": "gpt-5.6-luna",
      "composer-implement": "composer-2.5",
      "codex-implement": "gpt-5.5",
      "codex-check": "gpt-5.5",
      "opus-explore": "claude-opus-4-8",
      "opus-implement": "claude-opus-4-8",
      "opus-check": "claude-opus-4-8",
      "grok-explore": "grok-4.5",
      "grok-implement": "grok-4.5",
      "grok-check": "grok-4.5",
      "kimi-explore": "moonshotai/kimi-k3",
      "kimi-implement": "moonshotai/kimi-k3",
      "kimi-check": "moonshotai/kimi-k3",
      "fable-explore": "claude-fable-5",
      "fable-implement": "claude-fable-5",
      "fable-check": "claude-fable-5",
      "cursor-fable-explore": "claude-fable-5-thinking-high",
      "cursor-fable-implement": "claude-fable-5-thinking-high",
      "cursor-fable-check": "claude-fable-5-thinking-high",
      "minimax-explore": "MiniMax-M3",
      "minimax-implement": "MiniMax-M3",
      "minimax-check": "MiniMax-M3",
      "composer-explore": "composer-2.5",
      "composer-check": "composer-2.5",
      "terra-implement": "gpt-5.6-terra",
      "sol-explore": "gpt-5.6-sol",
      "sol-check": "gpt-5.6-sol",
      "sol-implement": "gpt-5.6-sol",
    };
    const supportedBackends = new Set([
      "codex",
      "composer",
      "claude",
      "opencode",
      "minimax",
    ]);
    const supportedModes = new Set(["analyze", "implement", "review"]);
    const supportedSandboxes = new Set(["read-only", "workspace-write"]);
    for (const route of profile.routes) {
      expect(supportedBackends.has(route.backend)).toBe(true);
      expect(supportedModes.has(route.mode)).toBe(true);
      expect(supportedSandboxes.has(route.sandbox)).toBe(true);
      expect(route.model).toBe(expectedModels[route.id]);
      expect(route.guidance.length).toBeGreaterThan(0);
    }

    expect(
      profile.routes.find((route) => route.id === "codex-implement"),
    ).not.toHaveProperty("task_class_variants");
    expect(
      profile.routes.find((route) => route.id === "codex-check"),
    ).not.toHaveProperty("task_class_variants");
    expect(first.stdout).not.toContain("Complete the bounded task");
    expect(first.stdout).not.toContain("super-secret-do-not-export");
    expect(first.stdout).not.toContain(fixture.workspace);
    expect(first.stdout).not.toContain(fixture.traceDirectory);
  });

  test("uses GPT-5.5 with workspace writes for implementation", async () => {
    const result = await run("implement", createFakeCodex());

    expect(result.exitCode).toBe(0);
    expect(result.arguments).toContain("gpt-5.5");
    expect(result.arguments).toContain("workspace-write");
    expect(result.arguments).toContain("model_reasoning_effort=high");
  });

  test("defaults codex review to GPT-5.5 with high reasoning effort", async () => {
    const fixture = createFakeCodex();
    const result = await run("review", fixture);

    expect(result.exitCode).toBe(0);
    expect(result.arguments).toContain("gpt-5.5");
    expect(result.arguments).toContain("model_reasoning_effort=high");

    const [record] = readTraceRecords(fixture);
    expect(record.model).toBe("gpt-5.5");
    expect(record.effort).toBe("high");
  });

  test("does not pass reasoning effort for analyze by default", async () => {
    const result = await run("analyze", createFakeCodex());

    expect(result.exitCode).toBe(0);
    expect(
      result.arguments.some((argument) =>
        argument.includes("model_reasoning_effort"),
      ),
    ).toBe(false);
  });

  test("honors explicit --effort over codex implement defaults", async () => {
    const fixture = createFakeCodex();
    const result = await run("implement", fixture, ["--effort", "low"]);

    expect(result.exitCode).toBe(0);
    expect(result.arguments).toContain("model_reasoning_effort=low");
    expect(result.arguments).not.toContain("model_reasoning_effort=high");

    const [record] = readTraceRecords(fixture);
    expect(record.effort).toBe("low");
  });

  test("reports gpt-5.5 codex implement and review defaults via routes", async () => {
    const fixture = createFakeCodex();
    const result = await routes(["--json"], {
      FABLE_ORCHESTRATOR_CODEX_BIN: fixture.executable,
      FAKE_CODEX_ARGUMENTS: fixture.argumentsPath,
    });

    expect(result.exitCode).toBe(0);
    const profile = JSON.parse(result.stdout) as {
      routes: Array<{ id: string; model: string }>;
    };
    expect(
      Object.fromEntries(
        profile.routes
          .filter((route) =>
            ["codex-explore", "codex-implement", "codex-check"].includes(
              route.id,
            ),
          )
          .map((route) => [route.id, route.model]),
      ),
    ).toEqual({
      "codex-explore": "gpt-5.6-luna",
      "codex-implement": "gpt-5.5",
      "codex-check": "gpt-5.5",
    });
  });

  test("passes FABLE_ORCHESTRATOR_IMPLEMENT_MODEL through Codex for implementation", async () => {
    const fixture = createFakeCodex();
    const result = await run("implement", fixture, [], {
      FABLE_ORCHESTRATOR_IMPLEMENT_MODEL: "gpt-5.6-terra",
    });

    expect(result.exitCode).toBe(0);
    const modelIndex = result.arguments.indexOf("--model");
    expect(modelIndex).toBeGreaterThanOrEqual(0);
    expect(result.arguments[modelIndex + 1]).toBe("gpt-5.6-terra");

    const [record] = readTraceRecords(fixture);
    expect(record.model).toBe("gpt-5.6-terra");
  });

  test("passes FABLE_ORCHESTRATOR_REVIEW_MODEL through Codex for review", async () => {
    const result = await run("review", createFakeCodex(), [], {
      FABLE_ORCHESTRATOR_REVIEW_MODEL: "gpt-5.6-luna",
    });

    expect(result.exitCode).toBe(0);
    expect(result.arguments).toContain("gpt-5.6-luna");
  });

  test("passes FABLE_ORCHESTRATOR_ANALYZE_MODEL through Codex for analysis", async () => {
    const result = await run("analyze", createFakeCodex(), [], {
      FABLE_ORCHESTRATOR_ANALYZE_MODEL: "gpt-5.6-luna",
    });

    expect(result.exitCode).toBe(0);
    expect(result.arguments).toContain("gpt-5.6-luna");
  });

  test("classifies Codex usage-limit outages with override model set", async () => {
    const usageLimitMessage =
      "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 9:43 PM.";
    const fixture = createFakeCodex(7, 0, usageLimitMessage);
    const result = await run("implement", fixture, [], {
      FABLE_ORCHESTRATOR_IMPLEMENT_MODEL: "gpt-5.6-terra",
    });

    expect(result.exitCode).toBe(1);

    const hintLine = result.stderr
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("{"));
    expect(hintLine).toBe(
      JSON.stringify({
        failure_class: "backend_unavailable",
        outage_reason: "usage_limit",
        fallback: { backend: "claude", model: "claude-opus-4-8" },
      }),
    );

    const [record] = readTraceRecords(fixture);
    expect(record.failure_class).toBe("backend_unavailable");
    expect(record.outage_reason).toBe("usage_limit");
    expect(record.fallback).toEqual({
      backend: "claude",
      model: "claude-opus-4-8",
    });
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
    expect(stderr).toMatch(
      /fable-orchestrator: progress: worker returned; validating result/,
    );

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

  test("passes FABLE_ORCHESTRATOR_COMPOSER_MODEL through Cursor for implementation", async () => {
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
          FABLE_ORCHESTRATOR_COMPOSER_MODEL: "gpt-5.6-sol",
        },
      },
    );

    const stdout = await new Response(process.stdout).text();
    const stderr = await new Response(process.stderr).text();
    expect(await process.exited).toBe(0);
    expect(stderr).toMatch(
      /fable-orchestrator: progress: worker returned; validating result/,
    );

    const argumentsList = JSON.parse(
      readFileSync(fixture.argumentsPath, "utf8"),
    ) as string[];
    const modelIndex = argumentsList.indexOf("--model");
    expect(modelIndex).toBeGreaterThanOrEqual(0);
    expect(argumentsList[modelIndex + 1]).toBe("gpt-5.6-sol");
    expect(JSON.parse(stdout).summary).toBe("composer done");

    const records = readTraceRecords(fixture);
    expect(records).toHaveLength(1);
    expect(records[0].backend).toBe("composer");
    expect(records[0].model).toBe("gpt-5.6-sol");
    expect(records[0].status).toBe("completed");
  });

  test("uses Claude Opus 4.8 with read-only tools for analysis", async () => {
    const fixture = createFakeClaude();
    const result = await runClaude("analyze", fixture);

    expect(result.exitCode).toBe(0);
    expect(result.arguments).toContain("claude-opus-4-8");
    expect(result.arguments).toContain("--json-schema");
    expect(result.arguments).toContain("--tools");
    expect(result.arguments).toContain("Read,Grep,Glob");
    expect(result.arguments).not.toContain("Edit");
    expect(result.arguments).not.toContain("--bare");
    expect(result.arguments).not.toContain("--dangerously-skip-permissions");
    expect(JSON.parse(result.stdout).summary).toBe("claude done");

    const [record] = readTraceRecords(fixture);
    expect(record.backend).toBe("claude");
    expect(record.sandbox).toBe("read-only");
  });

  test("respects Claude bin and model environment overrides", async () => {
    const fixture = createFakeClaude();
    const result = await runClaude("analyze", fixture, [], {
      FABLE_ORCHESTRATOR_CLAUDE_BIN: fixture.executable,
      FABLE_ORCHESTRATOR_CLAUDE_MODEL: "claude-sonnet-4-6",
    });

    expect(result.exitCode).toBe(0);
    expect(result.arguments).toContain("claude-sonnet-4-6");

    const [record] = readTraceRecords(fixture);
    expect(record.model).toBe("claude-sonnet-4-6");
  });

  test("minimax backend reuses the Claude CLI with Anthropic env injection", async () => {
    const fixture = createFakeClaude();
    const process = Bun.spawn(
      [
        runner,
        "run",
        "--backend",
        "minimax",
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
          FABLE_ORCHESTRATOR_CLAUDE_BIN: fixture.executable,
          FAKE_CLAUDE_ARGUMENTS: fixture.argumentsPath,
          FAKE_CLAUDE_ENV: fixture.envPath,
          FABLE_ORCHESTRATOR_MINIMAX_API_KEY: "test-minimax-key",
          ...traceEnv(fixture),
        },
      },
    );

    const stdout = await new Response(process.stdout).text();
    expect(await process.exited).toBe(0);
    expect(JSON.parse(stdout).summary).toBe("claude done");

    const workerArguments = JSON.parse(
      readFileSync(fixture.argumentsPath, "utf8"),
    ) as string[];
    expect(workerArguments).toContain("MiniMax-M3");
    expect(workerArguments).toContain("Read,Grep,Glob");

    const [recordedEnv] = readFileSync(fixture.envPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, string>);
    expect(recordedEnv).toEqual({
      base_url: "https://api.minimax.io/anthropic",
      api_key: "test-minimax-key",
    });

    const [record] = readTraceRecords(fixture);
    expect(record.backend).toBe("minimax");
    expect(record.model).toBe("MiniMax-M3");
    expect(record.sandbox).toBe("read-only");
  });

  test("minimax backend fails fast without an API key", async () => {
    const fixture = createFakeClaude();
    const process = Bun.spawn(
      [
        runner,
        "run",
        "--backend",
        "minimax",
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
          FABLE_ORCHESTRATOR_CLAUDE_BIN: fixture.executable,
          FAKE_CLAUDE_ARGUMENTS: fixture.argumentsPath,
          FABLE_ORCHESTRATOR_MINIMAX_API_KEY: "",
          MINIMAX_API_KEY: "",
          ...traceEnv(fixture),
        },
      },
    );

    const stderr = await new Response(process.stderr).text();
    expect(await process.exited).toBe(1);
    expect(stderr).toContain("MiniMax invocation failed");
    expect(stderr).toContain("FABLE_ORCHESTRATOR_MINIMAX_API_KEY");
    expect(existsSync(fixture.argumentsPath)).toBe(false);
  });

  test("walks the codex -> claude -> grok -> minimax chain on availability outages", async () => {
    const codexFixture = createFakeCodex(7, 0, "You've hit your usage limit.");
    const claudeFixture = createFakeClaude(0, {
      failWithoutBaseUrl: true,
      failureMessage: "usage limit reached for this account",
    });
    const cursorFixture = createFakeCursor(
      1,
      "fenced",
      "rate limit exceeded for Grok",
    );
    const process = Bun.spawn(
      [
        runner,
        "run",
        "--backend",
        "codex",
        "--mode",
        "analyze",
        "--task",
        "Analyze the repo",
        "--cwd",
        codexFixture.workspace,
        "--fallback",
        "claude",
      ],
      {
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          FABLE_ORCHESTRATOR_CODEX_BIN: codexFixture.executable,
          FAKE_CODEX_ARGUMENTS: codexFixture.argumentsPath,
          FABLE_ORCHESTRATOR_CLAUDE_BIN: claudeFixture.executable,
          FAKE_CLAUDE_ARGUMENTS: claudeFixture.argumentsPath,
          FAKE_CLAUDE_ENV: claudeFixture.envPath,
          FABLE_ORCHESTRATOR_CURSOR_BIN: cursorFixture.executable,
          FAKE_CURSOR_ARGUMENTS: cursorFixture.argumentsPath,
          MINIMAX_API_KEY: "test-minimax-key",
          ...traceEnv(codexFixture),
        },
      },
    );

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).summary).toBe("claude done");
    expect(stderr).toContain(
      "codex unavailable (usage_limit); retrying on claude backend",
    );
    expect(stderr).toContain(
      "claude unavailable (usage_limit); retrying on composer backend",
    );
    expect(stderr).toContain(
      "composer unavailable (usage_limit); retrying on minimax backend with MiniMax-M3",
    );

    const records = readTraceRecords(codexFixture);
    expect(records.map((record) => record.backend)).toEqual([
      "codex",
      "claude",
      "composer",
      "minimax",
    ]);
    expect(records[0].fallback).toEqual({
      backend: "claude",
      model: "claude-opus-4-8",
    });
    expect(records[1].fallback).toEqual({
      backend: "composer",
      model: "grok-4.5",
    });
    expect(records[2].fallback).toEqual({
      backend: "minimax",
      model: "MiniMax-M3",
    });
    expect(records[1].fallback_of).toBe(records[0].run_id);
    expect(records[2].fallback_of).toBe(records[1].run_id);
    expect(records[3].fallback_of).toBe(records[2].run_id);
    expect(records[3].status).toBe("completed");
    expect(records[3].model).toBe("MiniMax-M3");
  });

  test("fallback chain stops after grok when no MiniMax key is configured", async () => {
    const codexFixture = createFakeCodex(7, 0, "You've hit your usage limit.");
    const claudeFixture = createFakeClaude(1, {
      failureMessage: "usage limit reached for this account",
    });
    const cursorFixture = createFakeCursor(
      1,
      "fenced",
      "rate limit exceeded for Grok",
    );
    const process = Bun.spawn(
      [
        runner,
        "run",
        "--backend",
        "codex",
        "--mode",
        "analyze",
        "--task",
        "Analyze the repo",
        "--cwd",
        codexFixture.workspace,
        "--fallback",
        "claude",
      ],
      {
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          FABLE_ORCHESTRATOR_CODEX_BIN: codexFixture.executable,
          FAKE_CODEX_ARGUMENTS: codexFixture.argumentsPath,
          FABLE_ORCHESTRATOR_CLAUDE_BIN: claudeFixture.executable,
          FAKE_CLAUDE_ARGUMENTS: claudeFixture.argumentsPath,
          FABLE_ORCHESTRATOR_CURSOR_BIN: cursorFixture.executable,
          FAKE_CURSOR_ARGUMENTS: cursorFixture.argumentsPath,
          FABLE_ORCHESTRATOR_MINIMAX_API_KEY: "",
          MINIMAX_API_KEY: "",
          ...traceEnv(codexFixture),
        },
      },
    );

    const stderr = await new Response(process.stderr).text();
    expect(await process.exited).toBe(1);
    expect(stderr).toContain(
      "claude unavailable (usage_limit); retrying on composer backend",
    );
    expect(stderr).not.toContain("retrying on minimax backend");

    const records = readTraceRecords(codexFixture);
    expect(records.map((record) => record.backend)).toEqual([
      "codex",
      "claude",
      "composer",
    ]);
  });

  test("--worker-model overrides the codex policy model", async () => {
    const fixture = createFakeCodex();
    const result = await run("analyze", fixture, [
      "--worker-model",
      "gpt-5.6-sol",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.arguments).toContain("gpt-5.6-sol");
    expect(result.arguments).not.toContain("gpt-5.6-luna");

    const [record] = readTraceRecords(fixture);
    expect(record.model).toBe("gpt-5.6-sol");
  });

  test("--worker-model overrides the claude model and beats the env override", async () => {
    const fixture = createFakeClaude();
    const result = await runClaude(
      "analyze",
      fixture,
      ["--worker-model", "claude-fable-5"],
      {
        FABLE_ORCHESTRATOR_CLAUDE_MODEL: "claude-sonnet-4-6",
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.arguments).toContain("claude-fable-5");
    expect(result.arguments).not.toContain("claude-sonnet-4-6");

    const [record] = readTraceRecords(fixture);
    expect(record.model).toBe("claude-fable-5");
  });

  test("rejects --worker-model with unsupported characters or --route", async () => {
    const fixture = createFakeCodex();
    const badModel = Bun.spawn(
      [
        runner,
        "run",
        "--backend",
        "codex",
        "--mode",
        "analyze",
        "--task",
        "Complete the bounded task",
        "--cwd",
        fixture.workspace,
        "--worker-model",
        "bad model!",
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
    const badModelStderr = await new Response(badModel.stderr).text();
    expect(await badModel.exited).toBe(2);
    expect(badModelStderr).toContain(
      "--worker-model contains unsupported characters",
    );

    const withRoute = Bun.spawn(
      [
        runner,
        "run",
        "--route",
        "codex-explore",
        "--task",
        "Complete the bounded task",
        "--cwd",
        fixture.workspace,
        "--worker-model",
        "gpt-5.6-sol",
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
    const withRouteStderr = await new Response(withRoute.stderr).text();
    expect(await withRoute.exited).toBe(2);
    expect(withRouteStderr).toContain(
      "--worker-model cannot be combined with --route",
    );
    expect(existsSync(fixture.argumentsPath)).toBe(false);
  });

  test("doctor reports backend readiness independently", async () => {
    const codex = createStatusExecutable("codex", "Logged in using ChatGPT", 0);
    const cursor = createStatusExecutable(
      "cursor-agent",
      "SecItemCopyMatching failed -50",
      1,
    );
    const process = Bun.spawn(
      [runner, "doctor", "--json", "--orchestrator", "composer"],
      {
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          FABLE_ORCHESTRATOR_CODEX_BIN: codex,
          FABLE_ORCHESTRATOR_CURSOR_BIN: cursor,
        },
      },
    );

    const stdout = await new Response(process.stdout).text();
    expect(await process.exited).toBe(0);

    const report = JSON.parse(stdout);
    expect(report.status).toBe("attention_required");
    expect(report.orchestrator_identity).toBe("composer");
    expect(report.orchestrator_identity_support.cursor.composer).toBe(true);
    expect(report.orchestrator_identity_support["claude-code"].composer).toBe(false);
    expect(report.composer_orchestrator_mode).toEqual({
      active: true,
      policy: "composer-economy/v1",
      stack: "(O) Composer -> opus-explore -> composer-implement -> opus-check",
      worker_stack: ["opus-explore", "composer-implement", "opus-check"],
      effective_routes: [
        expect.objectContaining({
          mode: "analyze",
          route: "opus-explore",
          model: "claude-opus-4-8",
          sandbox: "read-only",
        }),
        expect.objectContaining({
          mode: "implement",
          route: "composer-implement",
          model: "composer-2.5",
          sandbox: "workspace-write",
        }),
        expect.objectContaining({
          mode: "review",
          route: "opus-check",
          model: "claude-opus-4-8",
          sandbox: "read-only",
        }),
      ],
    });
    expect(report.codex.authenticated).toBe(true);
    expect(report.composer.authenticated).toBe(false);
    expect(report.codex.models["gpt-5.5"].available).toBe(true);
    expect(report.codex.models["gpt-5.6-terra"].available).toBe(true);
    expect(report.codex.models["gpt-5.6-luna"].available).toBe(true);
    expect(report.codex.models["gpt-5.6-sol"].available).toBe(true);
    expect(report.composer.models["gpt-5.6-sol"]).toBeUndefined();
    expect(report.composer.models["composer-2.5"].available).toBe(false);
    expect(report.composer.models["grok-4.5"].available).toBe(false);
    expect(report.next_actions.join(" ")).toContain("CURSOR_API_KEY");
    expect(report.next_actions.join(" ")).toContain("without sudo");
  });

  test("Composer doctor excludes Codex and fallback advice and exposes only the fixed economy routes", async () => {
    const cursor = createStatusExecutable(
      "cursor-agent",
      "Logged in to Cursor",
      0,
    );
    const claude = createFakeClaudeAuth(true);
    const missingCodexDirectory = mkdtempSync(`${tmpdir()}/missing-codex-`);
    temporaryDirectories.push(missingCodexDirectory);
    const missingCodex = resolve(missingCodexDirectory, "codex");
    const process = Bun.spawn(
      [runner, "doctor", "--json", "--orchestrator", "composer"],
      {
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          FABLE_ORCHESTRATOR_CODEX_BIN: missingCodex,
          FABLE_ORCHESTRATOR_CURSOR_BIN: cursor,
          FABLE_ORCHESTRATOR_CLAUDE_BIN: claude,
          FABLE_ORCHESTRATOR_CLAUDE_MODEL: "hostile-claude-model",
          FABLE_ORCHESTRATOR_COMPOSER_MODEL: "hostile-composer-model",
        },
      },
    );

    const stdout = await new Response(process.stdout).text();
    expect(await process.exited).toBe(0);

    const report = JSON.parse(stdout);
    expect(report.status).toBe("ready");
    expect(report.codex.installed).toBe(false);
    expect(report.next_actions).toEqual([]);
    expect(JSON.stringify(report.next_actions)).not.toContain("Codex");
    expect(JSON.stringify(report.next_actions)).not.toContain("--backend claude");
    expect(JSON.stringify(report.next_actions)).not.toContain(
      "FABLE_ORCHESTRATOR_FALLBACK",
    );
    expect(
      report.routes
        .filter((route: { active: boolean }) => route.active)
        .map(
          (route: {
            id: string;
            model: string;
            eligible: boolean;
          }) => ({
            id: route.id,
            model: route.model,
            eligible: route.eligible,
          }),
        ),
    ).toEqual([
      { id: "composer-implement", model: "composer-2.5", eligible: true },
      { id: "opus-explore", model: "claude-opus-4-8", eligible: true },
      { id: "opus-check", model: "claude-opus-4-8", eligible: true },
    ]);
    expect(
      report.routes
        .filter((route: { active: boolean }) => !route.active)
        .map((route: { id: string; active: boolean; eligible: boolean }) => ({
          id: route.id,
          active: route.active,
          eligible: route.eligible,
        })),
    ).toEqual([
      { id: "codex-explore", active: false, eligible: false },
      { id: "codex-implement", active: false, eligible: false },
      { id: "codex-check", active: false, eligible: false },
      { id: "opus-implement", active: false, eligible: false },
      { id: "grok-explore", active: false, eligible: false },
      { id: "grok-implement", active: false, eligible: false },
      { id: "grok-check", active: false, eligible: false },
      { id: "kimi-explore", active: false, eligible: false },
      { id: "kimi-implement", active: false, eligible: false },
      { id: "kimi-check", active: false, eligible: false },
      { id: "fable-explore", active: false, eligible: false },
      { id: "fable-implement", active: false, eligible: false },
      { id: "fable-check", active: false, eligible: false },
      { id: "cursor-fable-explore", active: false, eligible: false },
      { id: "cursor-fable-implement", active: false, eligible: false },
      { id: "cursor-fable-check", active: false, eligible: false },
      { id: "minimax-explore", active: false, eligible: false },
      { id: "minimax-implement", active: false, eligible: false },
      { id: "minimax-check", active: false, eligible: false },
      { id: "composer-explore", active: false, eligible: false },
      { id: "composer-check", active: false, eligible: false },
      { id: "terra-implement", active: false, eligible: false },
      { id: "sol-explore", active: false, eligible: false },
      { id: "sol-check", active: false, eligible: false },
      { id: "sol-implement", active: false, eligible: false },
    ]);
    const serializedReport = JSON.stringify(report);
    expect(serializedReport).not.toContain("Use when Codex is unavailable");
    expect(serializedReport).not.toContain("Use when Opus is unavailable");
    expect(serializedReport).not.toContain("explicitly chooses Grok");
    expect(
      report.routes
        .filter((route: { active: boolean }) => route.active)
        .every((route: { guidance: string }) =>
          route.guidance.includes("no automatic fallback"),
        ),
    ).toBe(true);
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
      "gpt-5.6-terra",
      "--note",
      "analysis missed the failing path",
    ]);
    expect(annotation.exitCode).toBe(0);
    expect(annotation.stdout).toContain("Recorded escalated");

    const [record] = readAnnotationRecords(fixture);
    expect(record.schema).toBe(1);
    expect(record.run_id).toBe(runId);
    expect(record.outcome).toBe("escalated");
    expect(record.escalated_to).toBe("gpt-5.6-terra");
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

  test("report aggregates completion, acceptance, tokens, and latency", async () => {
    const fixture = createFakeCodex();
    // Two analyze runs (gpt-5.6-luna): one accepted, one escalated.
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
      (group: { key: string }) => group.key === "gpt-5.6-luna",
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
    expect(humanStdout).toContain("gpt-5.6-luna");
    expect(humanStdout).toContain("gpt-5.5");
    expect(humanStdout).toContain("runs by model");
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
          "--backend",
          "codex",
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
      "gpt-5.6-luna",
    );

    expect(received[1].path).toBe("/v1/evals/evaluation-1/datapoints");
    expect(received[1].body.points).toHaveLength(1);
    expect(received[1].body.points[0].data.model).toBe("gpt-5.6-luna");
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


  test("rejects invalid --effort values without recording a run", async () => {
    const fixture = createFakeCodex();
    const process = Bun.spawn(
      [
        runner,
        "run",
        "--backend",
        "codex",
        "--mode",
        "implement",
        "--task",
        "Complete the bounded task",
        "--cwd",
        fixture.workspace,
        "--effort",
        "turbo",
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
    expect(await process.exited).not.toBe(0);
    expect(stderr).toContain("--effort must be one of");
    expect(existsSync(fixture.argumentsPath)).toBe(false);
    expect(existsSync(resolve(fixture.traceDirectory, "runs.jsonl"))).toBe(
      false,
    );
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


  test("report rejects an invalid --group-by", async () => {
    const fixture = createFakeCodex();
    await run("analyze", fixture);

    const result = await report(fixture, ["--group-by", "nonsense"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--group-by must be one of");
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
    expect(summary.totals.by_model["gpt-5.6-luna"].runs).toBe(1);
    expect(summary.recent).toHaveLength(1);
  });

  test("retries classified Codex outages on claude when fallback is enabled", async () => {
    const usageLimitMessage =
      "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 9:43 PM.";
    const codexFixture = createFakeCodex(7, 0, usageLimitMessage);
    const claudeFixture = createFakeClaude();
    const result = await runWithBackends(
      "analyze",
      codexFixture,
      claudeFixture,
      [],
      { FABLE_ORCHESTRATOR_FALLBACK: "claude" },
    );

    expect(result.exitCode).toBe(0);
    expect(result.codexInvoked).toBe(true);
    expect(result.claudeInvoked).toBe(true);
    expect(JSON.parse(result.stdout).summary).toBe("claude done");
    expect(result.stderr).toContain(
      "codex unavailable (usage_limit); retrying on claude backend",
    );

    const records = readTraceRecords(codexFixture);
    expect(records).toHaveLength(2);
    expect(records[0].failure_class).toBe("backend_unavailable");
    expect(records[0].outage_reason).toBe("usage_limit");
    expect(records[1].backend).toBe("claude");
    expect(records[1].fallback_of).toBe(records[0].run_id);
    expect(records[1].status).toBe("completed");
  });

  test("retries Claude availability outages once more on composer Grok", async () => {
    const usageLimitMessage =
      "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 9:43 PM.";
    const codexFixture = createFakeCodex(7, 0, usageLimitMessage);
    const claudeFixture = createFakeClaude(1, {
      failureMessage: "Claude usage limit reached",
    });
    const cursorFixture = createFakeCursor();
    const result = await runWithCodexClaudeComposer(
      "analyze",
      codexFixture,
      claudeFixture,
      cursorFixture,
      { FABLE_ORCHESTRATOR_FALLBACK: "claude" },
    );

    expect(result.exitCode).toBe(0);
    expect(result.codexInvoked).toBe(true);
    expect(result.claudeInvoked).toBe(true);
    expect(result.cursorInvoked).toBe(true);
    expect(JSON.parse(result.stdout).summary).toBe("composer done");
    expect(result.stderr).toContain(
      '{"failure_class":"backend_unavailable","outage_reason":"usage_limit","fallback":{"backend":"composer","model":"grok-4.5"}}',
    );
    expect(result.stderr).toContain(
      "claude unavailable (usage_limit); retrying on composer backend with grok-4.5",
    );

    const records = readTraceRecords(codexFixture);
    expect(records).toHaveLength(3);
    expect(records.map((record) => record.backend)).toEqual([
      "codex",
      "claude",
      "composer",
    ]);
    expect(records.map((record) => record.model)).toEqual([
      "gpt-5.6-luna",
      "claude-opus-4-8",
      "grok-4.5",
    ]);
    expect(records[1].fallback_of).toBe(records[0].run_id);
    expect(records[2].fallback_of).toBe(records[1].run_id);
    expect(records[2].status).toBe("completed");
  });

  test("doctor reports claude readiness independently", async () => {
    const codex = createStatusExecutable("codex", "Logged in using ChatGPT", 0);
    const cursor = createStatusExecutable(
      "cursor-agent",
      "Logged in to Cursor",
      0,
    );
    const claude = createFakeClaudeAuth(true);
    const process = Bun.spawn([runner, "doctor", "--json"], {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...Bun.env,
        FABLE_ORCHESTRATOR_CODEX_BIN: codex,
        FABLE_ORCHESTRATOR_CURSOR_BIN: cursor,
        FABLE_ORCHESTRATOR_CLAUDE_BIN: claude,
      },
    });

    const stdout = await new Response(process.stdout).text();
    expect(await process.exited).toBe(0);

    const report = JSON.parse(stdout);
    expect(report.claude.installed).toBe(true);
    expect(report.claude.authenticated).toBe(true);
    expect(report.claude.detail).toContain("chatgpt");
  });

});
