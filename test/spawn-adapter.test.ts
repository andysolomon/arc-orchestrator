import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  buildComposerCommand,
  createSpawnBackendInvoker,
} from "../plugins/fable-orchestrator/lib/spawn-adapter";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("spawn-adapter: buildComposerCommand", () => {
  test("uses --force for implement mode", () => {
    const command = buildComposerCommand({
      cursorBinary: "cursor-agent",
      profile: { model: "composer-2.5" },
      mode: "implement",
      cwd: "/tmp/workspace",
      prompt: "Implement the task",
    });

    expect(command).toEqual([
      "cursor-agent",
      "--print",
      "--output-format",
      "json",
      "--model",
      "composer-2.5",
      "--workspace",
      "/tmp/workspace",
      "--force",
      "Implement the task",
    ]);
  });

  test("uses plan mode for mechanical implement broker planning", () => {
    const command = buildComposerCommand({
      cursorBinary: "cursor-agent",
      profile: { model: "composer-2.5" },
      mode: "implement",
      cwd: "/tmp/workspace",
      prompt: "Plan one mechanical command",
      forcePlanMode: true,
    });

    expect(command).toContain("--mode");
    expect(command).toContain("plan");
    expect(command).not.toContain("--force");
    expect(command).toContain("composer-2.5");
  });

  test("uses plan mode for analyze and review read-only enforcement", () => {
    for (const mode of ["analyze", "review"] as const) {
      const command = buildComposerCommand({
        cursorBinary: "cursor-agent",
        profile: { model: "grok-4.5" },
        mode,
        cwd: "/tmp/workspace",
        prompt: "Read-only task",
      });

      expect(command).toContain("--mode");
      expect(command).toContain("plan");
      expect(command).not.toContain("--force");
      expect(command).toContain("grok-4.5");
    }
  });
});

describe("spawn-adapter: mechanical routes", () => {
  function writeFakeTool(directory: string, name: "git" | "gh") {
    const executable = resolve(directory, name);
    const log = resolve(directory, `${name}.log`);
    writeFileSync(
      executable,
      `#!/bin/sh
printf '%s\\n' "$0 $*" >> "${log}"
printf '%s\\n' "${name}-stdout:$*"
printf '%s\\n' "${name}-stderr:$*" >&2
exit 0
`,
    );
    chmodSync(executable, 0o755);
    return { executable, log };
  }

  function writeFakeCursor(directory: string, commandPayload: string) {
    const cursor = resolve(directory, "cursor-agent");
    const argsLog = resolve(directory, "cursor-args.log");
    writeFileSync(
      cursor,
      `#!/bin/sh
printf '%s\\n' "$*" >> "${argsLog}"
printf '%s\\n' ${JSON.stringify(commandPayload)}
`,
    );
    chmodSync(cursor, 0o755);
    return { cursor, argsLog };
  }

  async function invokeMechanical(
    alias: string,
    operationPlan: unknown,
    toolOptions: { gitBody?: string } = {},
  ): Promise<{ directory: string; output: Awaited<ReturnType<ReturnType<typeof createSpawnBackendInvoker>>>; logs: Record<string, string> }> {
    const directory = mkdtempSync(`${tmpdir()}/spawn-mechanical-`);
    temporaryDirectories.push(directory);
    const temporaryDirectory = resolve(directory, "tmp");
    Bun.spawnSync(["mkdir", "-p", temporaryDirectory]);
    const gh = writeFakeTool(directory, "gh");
    const git = writeFakeTool(directory, "git");
    if (toolOptions.gitBody) {
      writeFileSync(
        git.executable,
        `#!/bin/sh
printf '%s\\n' "$0 $*" >> "${git.log}"
printf '%s\\n' "git-stdout:$*"
printf '%s\\n' "git-stderr:$*" >&2
${toolOptions.gitBody}
exit 0
`,
      );
      chmodSync(git.executable, 0o755);
    }
    const cursor = writeFakeCursor(
      directory,
      JSON.stringify({
        is_error: false,
        result: typeof operationPlan === "string"
          ? operationPlan
          : JSON.stringify(operationPlan),
      }),
    );

    const invoke = createSpawnBackendInvoker(
      {
        PATH: directory,
        FABLE_ORCHESTRATOR_CURSOR_BIN: cursor.cursor,
        FABLE_ORCHESTRATOR_TRUSTED_GH_BIN: gh.executable,
        FABLE_ORCHESTRATOR_TRUSTED_GIT_BIN: git.executable,
      } as NodeJS.ProcessEnv,
      { allowTestTrustedMechanicalBinaries: true },
    );
    const output = await invoke({
      backend: "composer",
      mode: "implement",
      task: "mechanical op",
      cwd: directory,
      taskClass: "open-pr",
      temporaryDirectory,
      budget: { maxDurationMs: null, maxTokens: null },
      effort: null,
      profile: { model: "composer-2.5", sandbox: "workspace-write", instruction: "x" },
      prompt: "prompt",
      resultSchema: { type: "object" } as never,
      requestedAlias: alias,
    });

    return {
      directory,
      output,
      logs: {
        cursorArgs: readFileSync(cursor.argsLog, "utf8"),
        gh: existsSync(gh.log) ? readFileSync(gh.log, "utf8") : "",
        git: existsSync(git.log) ? readFileSync(git.log, "utf8") : "",
      },
    };
  }

  const allowedCases = [
    [
      "mechanical-open-pr",
      [["gh", "pr", "create", "--title", "T", "--body", "B"]],
      "gh",
      1,
    ],
    [
      "mechanical-post-comment",
      [["gh", "issue", "comment", "167", "--body", "done"]],
      "gh",
      1,
    ],
    [
      "mechanical-commit-push",
      [
        ["git", "commit", "-m", "feat: update"],
        ["git", "push", "origin", "feature/branch"],
      ],
      "git",
      2,
    ],
    ["mechanical-merge", [["gh", "pr", "merge", "12", "--squash"]], "gh", 1],
  ] as const;

  test.each(allowedCases)(
    "plans then executes trusted operation plan for %s",
    async (alias, commands, executable, expectedExecutions) => {
      const { output, logs } = await invokeMechanical(alias, {
        commands: commands.map((argv) => ({ argv })),
      });

      expect(output.exitCode).toBe(0);
      expect(output.stdout).toContain("mechanical broker executed");
      expect(logs.cursorArgs).toContain("--mode plan");
      expect(logs.cursorArgs).not.toContain("--force");
      for (const argv of commands) {
        expect(logs[executable]).toContain(argv.slice(1).join(" "));
      }
      const totalExecutions = logs.gh.trim().split("\n").filter(Boolean).length +
        logs.git.trim().split("\n").filter(Boolean).length;
      expect(totalExecutions).toBe(expectedExecutions);
    },
  );

  test.each([
    [
      "destructive",
      "mechanical-commit-push",
      {
        commands: [
          { argv: ["git", "commit", "-m", "feat: update"] },
          { argv: ["git", "push", "origin", "--force"] },
        ],
      },
      "unlisted-flag:--force",
    ],
    [
      "no-verify",
      "mechanical-commit-push",
      {
        commands: [
          { argv: ["git", "commit", "--no-verify", "-m", "feat: update"] },
          { argv: ["git", "push", "origin", "feature/branch"] },
        ],
      },
      "unlisted-flag:--no-verify",
    ],
    [
      "wrong-order",
      "mechanical-commit-push",
      {
        commands: [
          { argv: ["git", "push", "origin", "feature/branch"] },
          { argv: ["git", "commit", "-m", "feat: update"] },
        ],
      },
      "invalid-command-order:expected-git-commit-first",
    ],
    [
      "unlisted",
      "mechanical-open-pr",
      { commands: [{ argv: ["gh", "repo", "delete", "owner/name"] }] },
      "unlisted-command",
    ],
    [
      "body-file",
      "mechanical-open-pr",
      { commands: [{ argv: ["gh", "pr", "create", "--title", "T", "--body-file", "/etc/passwd"] }] },
      "unlisted-flag:--body-file",
    ],
    [
      "repo",
      "mechanical-post-comment",
      { commands: [{ argv: ["gh", "issue", "comment", "167", "--body", "B", "--repo", "owner/name"] }] },
      "unlisted-flag:--repo",
    ],
    [
      "absolute",
      "mechanical-commit-push",
      {
        commands: [
          { argv: ["/usr/bin/git", "commit", "-m", "feat: update"] },
          { argv: ["git", "push"] },
        ],
      },
      "path-executable-rejected",
    ],
    ["malformed", "mechanical-open-pr", { command: "gh pr create" }, "expected exactly one structured operation plan"],
    [
      "multiple",
      "mechanical-open-pr",
      `${JSON.stringify({ commands: [{ argv: ["gh", "pr", "create", "--title", "T", "--body", "B"] }] })}\n${JSON.stringify({
        commands: [{ argv: ["gh", "pr", "create", "--title", "T2", "--body", "B2"] }],
      })}`,
      "expected exactly one structured operation plan",
    ],
  ] as const)(
    "rejects %s mechanical output before executor",
    async (_name, alias, command, reason) => {
      const { output, logs } = await invokeMechanical(alias, command);

      expect(output.exitCode).toBe(126);
      expect(output.stderr).toContain(reason);
      expect(logs.gh).toBe("");
      expect(logs.git).toBe("");
    },
  );

  test("does not pass generic model overrides or fallback through mechanical routes at the spawn boundary", async () => {
    const { logs } = await invokeMechanical("mechanical-open-pr", {
      commands: [{ argv: ["gh", "pr", "create", "--title", "T", "--body", "B"] }],
    });

    expect(logs.cursorArgs).toContain("--model composer-2.5");
  });

  test("does not use PATH wrappers as the mutation boundary", async () => {
    const { directory, logs } = await invokeMechanical("mechanical-open-pr", {
      commands: [{ argv: ["gh", "pr", "create", "--title", "T", "--body", "B"] }],
    });

    expect(existsSync(resolve(directory, "mechanical-bin"))).toBe(false);
    expect(logs.gh).toContain(resolve(directory, "gh"));
  });

  test("commit failure stops before push", async () => {
    const { output, logs } = await invokeMechanical(
      "mechanical-commit-push",
      {
        commands: [
          { argv: ["git", "commit", "-m", "feat: update"] },
          { argv: ["git", "push", "origin", "feature/branch"] },
        ],
      },
      {
        gitBody: `if [ "$1" = "commit" ]; then
  exit 42
fi`,
      },
    );

    expect(output.exitCode).toBe(42);
    expect(logs.git).toContain("commit -m feat: update");
    expect(logs.git).not.toContain("push origin");
  });
});
