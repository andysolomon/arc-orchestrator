import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  MECHANICAL_OPS_MODEL,
  executeMechanicalBroker,
  mechanicalContractForAlias,
  mechanicalExecutorEnvironment,
  parseMechanicalBrokerPlan,
  resolveTrustedMechanicalExecutable,
  validateMechanicalArgv,
  validateMechanicalOperationPlan,
  type MechanicalRouteAlias,
} from "../plugins/fable-orchestrator/lib/mechanical-ops-sandbox";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fakeExecutable(directory: string, name: string, body = ""): string {
  const executable = resolve(directory, name);
  writeFileSync(
    executable,
    `#!/bin/sh
printf '%s\\n' "$0 $*" >> "${resolve(directory, `${name}.log`)}"
${body}
`,
  );
  chmodSync(executable, 0o755);
  return executable;
}

function plan(commands: string[][]): string {
  return JSON.stringify({
    is_error: false,
    result: JSON.stringify({
      commands: commands.map((argv) => ({ argv })),
    }),
  });
}

describe("mechanical-ops-sandbox: contracts", () => {
  test.each([
    ["mechanical-open-pr", "open-pr", "mechanical-open-pr.workspace-write.v1"],
    [
      "mechanical-post-comment",
      "post-github-comment",
      "mechanical-post-comment.workspace-write.v1",
    ],
    ["mechanical-commit-push", "commit-push", "mechanical-commit-push.workspace-write.v1"],
    ["mechanical-merge", "merge", "mechanical-merge.workspace-write.v1"],
  ] as const)("fixes %s to Composer 2.5 with one operation contract", (alias, taskClass, route) => {
    const contract = mechanicalContractForAlias(alias);
    expect(contract).toMatchObject({
      alias,
      taskClass,
      canonicalRoute: route,
      backend: "composer",
      mode: "implement",
      model: MECHANICAL_OPS_MODEL,
      sandbox: "workspace-write",
      policyVersion: "mechanical-ops-sandbox/v1",
    });
  });
});

describe("mechanical-ops-sandbox: argv policy", () => {
  test.each([
    ["mechanical-open-pr", ["gh", "pr", "create", "--title", "T", "--body", "B"]],
    ["mechanical-post-comment", ["gh", "issue", "comment", "167", "--body", "done"]],
    ["mechanical-commit-push", ["git", "commit", "-m", "feat: update"]],
    ["mechanical-commit-push", ["git", "push", "origin", "feature/branch"]],
    ["mechanical-merge", ["gh", "pr", "merge", "12", "--squash", "--delete-branch"]],
  ] as Array<[MechanicalRouteAlias, string[]]>)("allows %s %j", (alias, argv) => {
    expect(validateMechanicalArgv(alias, argv)).toEqual({ ok: true });
  });

  test.each([
    ["mechanical-open-pr", ["git", "push"]],
    ["mechanical-post-comment", ["gh", "repo", "delete", "owner/name"]],
    ["mechanical-commit-push", ["git", "add", "."]],
    ["mechanical-commit-push", ["git", "push", "origin", "--force"]],
    ["mechanical-commit-push", ["git", "push", "origin", "--delete", "feature/branch"]],
    ["mechanical-commit-push", ["git", "push", "origin", "--force-with-lease"]],
    ["mechanical-commit-push", ["git", "push", "/tmp/other-repo", "main"]],
    ["mechanical-commit-push", ["git", "push", "../other", "main"]],
    ["mechanical-commit-push", ["git", "push", "upstream", "main"]],
    ["mechanical-commit-push", ["git", "commit", "--no-verify", "-m", "feat: update"]],
    ["mechanical-commit-push", ["git", "commit", "-n", "-m", "feat: update"]],
    ["mechanical-commit-push", ["/usr/bin/git", "push", "origin", "feature/branch"]],
    ["mechanical-open-pr", ["gh", "pr", "create", "--title", "T", "--body-file", "/etc/passwd"]],
    ["mechanical-open-pr", ["gh", "pr", "create", "--title", "T", "--body", "B", "--repo", "owner/name"]],
    ["mechanical-post-comment", ["gh", "issue", "comment", "167", "--body-file", "/tmp/body.md"]],
    ["mechanical-post-comment", ["gh", "issue", "comment", "167", "--body", "done", "--repo", "owner/name"]],
    ["mechanical-post-comment", ["gh", "issue", "comment", "https://github.com/other/repo/issues/1", "--body", "done"]],
    ["mechanical-post-comment", ["gh", "pr", "comment", "https://github.com/other/repo/pull/1", "--body", "done"]],
    ["mechanical-merge", ["gh", "pr", "merge", "https://github.com/other/repo/pull/1", "--squash"]],
    ["mechanical-merge", ["gh", "pr", "merge", "other-branch", "--squash"]],
    ["mechanical-merge", ["gh", "pr", "merge", "12", "--admin"]],
    ["mechanical-merge", ["gh", "pr", "merge", "12", "--repo", "owner/name"]],
    ["mechanical-open-pr", ["gh", "pr", "create", "--title", "T", "--body", "B", "--web"]],
    ["mechanical-merge", ["gh", "pr", "merge", "12", "--body", "x; rm -rf ."]],
    ["mechanical-open-pr", ["sh", "-c", "gh pr create"]],
  ] as Array<[MechanicalRouteAlias, string[]]>)("rejects bypass for %s %j", (alias, argv) => {
    expect(validateMechanicalArgv(alias, argv).ok).toBe(false);
  });
});

describe("mechanical-ops-sandbox: broker executor", () => {
  test("scrubs repository-redirection environment variables", () => {
    expect(
      mechanicalExecutorEnvironment({
        GH_TOKEN: "token",
        GH_REPO: "other/repo",
        GIT_DIR: "/tmp/other.git",
        GIT_WORK_TREE: "/tmp/other",
        GIT_CONFIG_COUNT: "1",
        PATH: "/usr/bin",
      }),
    ).toEqual({ GH_TOKEN: "token", PATH: "/usr/bin" });
  });

  test("resolves explicit trusted executables when tests opt into fake binaries", () => {
    const directory = mkdtempSync(`${tmpdir()}/mechanical-sandbox-`);
    temporaryDirectories.push(directory);
    const gh = fakeExecutable(directory, "gh");
    const git = fakeExecutable(directory, "git");

    expect(
      resolveTrustedMechanicalExecutable("gh", {
        env: { FABLE_ORCHESTRATOR_TRUSTED_GH_BIN: gh },
        allowTestTrustedBinaries: true,
      }),
    ).toBe(realpathSync(gh));
    expect(
      resolveTrustedMechanicalExecutable("git", {
        env: { FABLE_ORCHESTRATOR_TRUSTED_GIT_BIN: git },
        allowTestTrustedBinaries: true,
      }),
    ).toBe(realpathSync(git));
  });

  test("does not resolve workspace PATH hijacks as trusted executables", () => {
    const directory = mkdtempSync(`${tmpdir()}/mechanical-path-hijack-`);
    temporaryDirectories.push(directory);
    const git = fakeExecutable(directory, "git");

    const resolved = resolveTrustedMechanicalExecutable("git", {
      env: { PATH: directory },
      cwd: directory,
      brokerTemporaryDirectory: resolve(directory, "tmp"),
      workspaceRoot: directory,
    });

    expect(resolved).not.toBe(git);
  });

  test("rejects explicit workspace and temp executables unless tests opt in", () => {
    const directory = mkdtempSync(`${tmpdir()}/mechanical-untrusted-bin-`);
    temporaryDirectories.push(directory);
    const git = fakeExecutable(directory, "git");

    expect(() =>
      resolveTrustedMechanicalExecutable("git", {
        env: { FABLE_ORCHESTRATOR_TRUSTED_GIT_BIN: git },
        cwd: directory,
        brokerTemporaryDirectory: directory,
        workspaceRoot: directory,
      }),
    ).toThrow("inside an untrusted workspace or temp boundary");
  });

  test.each([
    ["mechanical-open-pr", [["gh", "pr", "create", "--title", "T", "--body", "B"]], true],
    ["mechanical-open-pr", [["gh", "pr", "create", "--title", "T", "--body", "B", "--web"]], false],
    [
      "mechanical-commit-push",
      [
        ["git", "commit", "-m", "feat: update"],
        ["git", "push", "origin", "feature/branch"],
      ],
      true,
    ],
    [
      "mechanical-commit-push",
      [
        ["git", "commit", "--no-verify", "-m", "feat: update"],
        ["git", "push", "origin", "feature/branch"],
      ],
      false,
    ],
    [
      "mechanical-commit-push",
      [
        ["git", "commit", "-m", "feat: update"],
        ["git", "push", "origin", "--force"],
      ],
      false,
    ],
    ["mechanical-merge", [["gh", "pr", "merge", "12", "--squash", "--delete-branch"]], true],
    ["mechanical-merge", [["gh", "pr", "merge", "12", "--admin"]], false],
  ] as Array<[MechanicalRouteAlias, string[][], boolean]>)(
    "keeps validator/runtime parity for %s %j",
    async (alias, commands, allowed) => {
      const directory = mkdtempSync(`${tmpdir()}/mechanical-parity-`);
      temporaryDirectories.push(directory);
      const gh = fakeExecutable(directory, "gh");
      const git = fakeExecutable(directory, "git");

      const validation = validateMechanicalOperationPlan(alias, {
        commands: commands.map((argv) => ({ argv })),
      });
      expect(validation.ok).toBe(allowed);

      const execution = executeMechanicalBroker({
        alias,
        cwd: directory,
        env: {
          FABLE_ORCHESTRATOR_TRUSTED_GH_BIN: gh,
          FABLE_ORCHESTRATOR_TRUSTED_GIT_BIN: git,
        },
        modelStdout: plan(commands),
        modelStderr: "",
        modelExitCode: 0,
        allowTestTrustedBinaries: true,
      });

      if (allowed) {
        await expect(execution).resolves.toMatchObject({
          plan: { commands: commands.map((argv) => ({ argv })) },
          executorExitCode: 0,
        });
      } else {
        await expect(execution).rejects.toThrow("mechanical-ops-sandbox/v1");
      }
    },
  );

  test("does not invoke push when commit fails in a commit-push operation", async () => {
    const directory = mkdtempSync(`${tmpdir()}/mechanical-commit-fails-`);
    temporaryDirectories.push(directory);
    const git = fakeExecutable(
      directory,
      "git",
      `if [ "$1" = "commit" ]; then
  exit 42
fi
`,
    );

    const execution = await executeMechanicalBroker({
      alias: "mechanical-commit-push",
      cwd: directory,
      env: { FABLE_ORCHESTRATOR_TRUSTED_GIT_BIN: git },
      modelStdout: plan([
        ["git", "commit", "-m", "feat: update"],
        ["git", "push", "origin", "feature/branch"],
      ]),
      modelStderr: "",
      modelExitCode: 0,
      allowTestTrustedBinaries: true,
    });

    expect(execution.executorExitCode).toBe(42);
    expect(execution.commands).toHaveLength(1);
    expect(readFileSync(resolve(directory, "git.log"), "utf8")).toContain("commit -m feat: update");
    expect(readFileSync(resolve(directory, "git.log"), "utf8")).not.toContain("push origin");
  });
});

describe("mechanical-ops-sandbox: broker plan parsing", () => {
  test("extracts exactly one operation plan from a Cursor envelope", () => {
    expect(
      parseMechanicalBrokerPlan(
        JSON.stringify({
          is_error: false,
          result: JSON.stringify({
            commands: [
              { argv: ["gh", "pr", "create", "--title", "T", "--body", "B"] },
            ],
          }),
        }),
      ),
    ).toEqual({
      commands: [
        { argv: ["gh", "pr", "create", "--title", "T", "--body", "B"] },
      ],
    });
  });

  test.each([
    "not json",
    JSON.stringify({ commands: "gh pr create" }),
    JSON.stringify({ commands: [{ argv: ["gh", "pr", "create"] }], note: "extra" }),
    JSON.stringify({ argv: ["gh", "pr", "create"] }),
    `${JSON.stringify({ commands: [{ argv: ["gh", "pr", "create"] }] })}\n${JSON.stringify({
      commands: [{ argv: ["gh", "pr", "merge"] }],
    })}`,
  ])("rejects malformed or multiple plans: %s", (stdout) => {
    expect(() => parseMechanicalBrokerPlan(stdout)).toThrow(
      "expected exactly one structured operation plan",
    );
  });

  test.each([
    {
      name: "one command",
      commands: [["git", "commit", "-m", "feat: update"]],
      reason: "invalid-command-count:1:expected-2",
    },
    {
      name: "three commands",
      commands: [
        ["git", "commit", "-m", "feat: update"],
        ["git", "push", "origin", "feature/branch"],
        ["git", "push", "origin", "feature/branch"],
      ],
      reason: "invalid-command-count:3:expected-2",
    },
    {
      name: "wrong order",
      commands: [
        ["git", "push", "origin", "feature/branch"],
        ["git", "commit", "-m", "feat: update"],
      ],
      reason: "invalid-command-order:expected-git-commit-first",
    },
  ])("rejects malformed commit-push plan: $name", ({ commands, reason }) => {
    expect(
      validateMechanicalOperationPlan("mechanical-commit-push", {
        commands: commands.map((argv) => ({ argv })),
      }),
    ).toEqual({ ok: false, reason });
  });
});

describe("mechanical-ops-sandbox: absolute executable paths", () => {
  test("rejects absolute git and gh executable tokens before command-form checks", () => {
    expect(
      validateMechanicalArgv("mechanical-commit-push", [
        "/usr/bin/git",
        "push",
        "origin",
        "feature/branch",
      ]),
    ).toEqual({ ok: false, reason: "path-executable-rejected" });
    expect(
      validateMechanicalArgv("mechanical-open-pr", [
        "/opt/homebrew/bin/gh",
        "pr",
        "create",
        "--title",
        "T",
        "--body",
        "B",
      ]),
    ).toEqual({ ok: false, reason: "path-executable-rejected" });
  });
});
