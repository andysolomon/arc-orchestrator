import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
} {
  const directory = mkdtempSync(`${tmpdir()}/fake-codex-`);
  temporaryDirectories.push(directory);
  const executable = resolve(directory, "codex");
  const argumentsPath = resolve(directory, "arguments.json");
  const workspace = resolve(directory, "workspace");

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
  echo "simulated Codex failure" >&2
  exit ${exitCode}
fi
printf '%s\\n' '{"status":"completed","summary":"done","changes":[],"verification":[],"risks":[],"next_actions":[]}' > "$output_file"
`,
  );
  chmodSync(executable, 0o755);

  return { executable, argumentsPath, workspace };
}

function createFakeCursor(exitCode = 0): {
  executable: string;
  argumentsPath: string;
  workspace: string;
} {
  const directory = mkdtempSync(`${tmpdir()}/fake-cursor-`);
  temporaryDirectories.push(directory);
  const executable = resolve(directory, "cursor-agent");
  const argumentsPath = resolve(directory, "arguments.json");
  const workspace = resolve(directory, "workspace");

  Bun.spawnSync(["mkdir", "-p", workspace]);

  writeFileSync(
    executable,
    `#!/bin/sh
printf '%s\\n' "$@" | jq -R -s 'split("\\n")[:-1]' > "$FAKE_CURSOR_ARGUMENTS"
if [ ${exitCode} -ne 0 ]; then
  echo "simulated Cursor failure" >&2
  exit ${exitCode}
fi
printf '%s\\n' '{"result":"{\\"status\\":\\"completed\\",\\"summary\\":\\"composer done\\",\\"changes\\":[\\"src/app.ts\\"],\\"verification\\":[],\\"risks\\":[],\\"next_actions\\":[]}"}'
`,
  );
  chmodSync(executable, 0o755);

  return { executable, argumentsPath, workspace };
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
        },
      },
    );

    const stderr = await new Response(process.stderr).text();
    expect(await process.exited).toBe(1);
    expect(stderr).toContain("simulated Codex failure");
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
});
