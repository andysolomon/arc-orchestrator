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
import {
  buildComposerCommand,
  buildCodexCommand,
  buildClaudeCommand,
  buildOpenCodeCommand,
  createSpawnBackendInvoker,
  OPENCODE_READ_ONLY_PERMISSION,
  openCodeArtifactAgent,
  openCodeArtifactConfigContent,
  openCodeArtifactPermission,
  openCodePermissionEnv,
  openCodeWorkerLabel,
  safeOpenCodeModelLabel,
} from "../plugins/arc-orchestrator/lib/spawn-adapter";

const temporaryDirectories: string[] = [];

describe("spawn-adapter: no-slug argv regression fixtures", () => {
  test("keeps Codex analyze argv byte-for-byte", () => {
    expect(buildCodexCommand({
      codexBinary: "codex",
      profile: { model: "gpt-6-luna", sandbox: "read-only" },
      mode: "analyze",
      cwd: "/repo",
      schemaPath: "/tmp/result.schema.json",
      resultPath: "/tmp/result.json",
      effort: null,
      isGitRepository: true,
      prompt: "Analyze",
    })).toEqual([
      "codex", "exec", "--ephemeral", "--json", "--model", "gpt-6-luna",
      "--sandbox", "read-only", "--cd", "/repo", "--output-schema",
      "/tmp/result.schema.json", "--output-last-message", "/tmp/result.json", "Analyze",
    ]);
  });

  // Narrowing is sandbox-driven, not mode-driven: an explicitly read-only
  // analyze envelope still produces the byte-for-byte read-only argv, while a
  // workspace-write analyze profile gets the write toolset.
  test("keeps Claude-family read-only analyze argv byte-for-byte", () => {
    expect(buildClaudeCommand({
      claudeBinary: "claude",
      profile: { model: "claude-opus-5-5", sandbox: "read-only" },
      mode: "analyze",
      prompt: "Analyze",
      resultSchema: { type: "object" },
    })).toEqual([
      "claude", "-p", "Analyze", "--output-format", "json", "--model",
      "claude-opus-5-5", "--json-schema", '{"type":"object"}', "--tools",
      "Read,Grep,Glob",
    ]);
  });

  test("keeps Claude-family workspace-write analyze argv byte-for-byte", () => {
    expect(buildClaudeCommand({
      claudeBinary: "claude",
      profile: { model: "claude-opus-5-5", sandbox: "workspace-write" },
      mode: "analyze",
      prompt: "Analyze",
      resultSchema: { type: "object" },
    })).toEqual([
      "claude", "-p", "Analyze", "--output-format", "json", "--model",
      "claude-opus-5-5", "--json-schema", '{"type":"object"}', "--tools",
      "Read,Grep,Glob,Edit,Write,Bash", "--permission-mode", "acceptEdits",
      "--allowedTools", "Bash",
    ]);
  });
});

describe("spawn-adapter: worker-authored artifact argv", () => {
  test("Claude, MiniMax, and Kimi share path-scoped Edit/Write rules", async () => {
    const command = buildClaudeCommand({
      claudeBinary: "claude",
      profile: { model: "provider-model", sandbox: "workspace-write" },
      mode: "analyze",
      phase: "research",
      taskSlug: "runner-slug",
      prompt: "prompt",
      resultSchema: {},
    });
    expect(command).toContain("Read,Grep,Glob,Edit,Write");
    expect(command).toContain("Edit(docs/runner-slug/**),Write(docs/runner-slug/**)");
    expect(command).not.toContain("Bash");

    const directory = mkdtempSync(`${tmpdir()}/spawn-claude-family-`);
    temporaryDirectories.push(directory);
    const temporaryDirectory = resolve(directory, "tmp");
    mkdirSync(temporaryDirectory);
    const claude = resolve(directory, "claude");
    writeFileSync(
      claude,
      `#!${process.execPath}
console.log(JSON.stringify(process.argv.slice(2)));
`,
    );
    chmodSync(claude, 0o755);

    const invoke = createSpawnBackendInvoker({
      PATH: directory,
      ARC_ORCHESTRATOR_CLAUDE_BIN: claude,
      ARC_ORCHESTRATOR_MINIMAX_API_KEY: "test-key",
      ARC_ORCHESTRATOR_KIMI_API_KEY: "test-key",
    } as NodeJS.ProcessEnv);

    const argvs: Record<string, string[]> = {};
    for (const backend of ["claude", "minimax", "kimi"] as const) {
      const output = await invoke({
        backend,
        mode: "analyze",
        phase: "research",
        taskSlug: "runner-slug",
        task: "artifact write",
        cwd: directory,
        taskClass: null,
        temporaryDirectory,
        budget: { maxDurationMs: null, maxTokens: null },
        effort: null,
        profile: { model: "provider-model", sandbox: "workspace-write", instruction: "x" },
        prompt: "prompt",
        resultSchema: { type: "object" } as never,
        requestedAlias: null,
      });
      expect(output.exitCode).toBe(0);
      argvs[backend] = JSON.parse(output.stdout);
      expect(argvs[backend].slice(0, 6)).toEqual([
        "-p",
        "prompt",
        "--output-format",
        "json",
        "--model",
        "provider-model",
      ]);
    }

    expect(argvs.minimax).toEqual(argvs.claude);
    expect(argvs.kimi).toEqual(argvs.claude);
    for (const argv of Object.values(argvs)) {
      const permissionModeIndex = argv.indexOf("--permission-mode");
      expect(permissionModeIndex).toBeGreaterThan(-1);
      expect(argv.slice(permissionModeIndex, permissionModeIndex + 2)).toEqual([
        "--permission-mode",
        "acceptEdits",
      ]);
      expect(argv).toContain("Read,Grep,Glob,Edit,Write");
      expect(argv).toContain("Edit(docs/runner-slug/**),Write(docs/runner-slug/**)");
      expect(argv).not.toContain("Bash");
    }
  });

  test("OpenCode selects a slug-specific agent and retains all deny rules", () => {
    const command = buildOpenCodeCommand({
      opencodeBinary: "opencode", profile: { model: "moonshotai/kimi-k3", sandbox: "workspace-write" },
      prompt: "prompt", mode: "analyze", taskSlug: "runner-slug",
    });
    expect(command).toContain(openCodeArtifactAgent("runner-slug"));
    expect(openCodeArtifactPermission("runner-slug")).toEqual({
      edit: { "docs/runner-slug/**": "allow", "*": "deny" },
      write: { "docs/runner-slug/**": "allow", "*": "deny" },
      bash: "deny", task: "deny", web: "deny", webfetch: "deny", websearch: "deny",
    });
  });

  test("OpenCode slug env grants the artifact agent with docs/<slug>/** scoped writes", () => {
    const env = openCodePermissionEnv(
      "analyze",
      { PATH: "/usr/bin" },
      "runner-slug",
      "research",
    );
    expect(JSON.parse(env.OPENCODE_PERMISSION!)).toEqual(
      openCodeArtifactPermission("runner-slug"),
    );
    expect(env.OPENCODE_CONFIG_CONTENT).toBe(
      openCodeArtifactConfigContent("runner-slug"),
    );

    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT!);
    const agent = openCodeArtifactAgent("runner-slug");
    expect(config.default_agent).toBe("arc-orchestrator-artifact-runner-slug");
    expect(config.agent[agent].mode).toBe("primary");
    expect(config.permission).toEqual(openCodeArtifactPermission("runner-slug"));
    expect(config.agent[agent].permission).toEqual(
      openCodeArtifactPermission("runner-slug"),
    );
    expect(config.agent[agent].permission.edit).toEqual({
      "docs/runner-slug/**": "allow",
      "*": "deny",
    });
    expect(config.agent[agent].permission.write).toEqual({
      "docs/runner-slug/**": "allow",
      "*": "deny",
    });
    expect(config.agent[agent].permission.bash).toBe("deny");
    expect(config.agent[agent].permission.websearch).toBe("deny");
  });
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("spawn-adapter: buildComposerCommand", () => {
  test("uses plan mode whenever the resolved profile is read-only", () => {
    for (const mode of ["analyze", "review"] as const) {
      const command = buildComposerCommand({
        cursorBinary: "cursor-agent",
        profile: { model: "cursor-grok-4.7-high", sandbox: "read-only" },
        mode,
        cwd: "/tmp/workspace",
        prompt: "Read-only task",
      });

      expect(command).toContain("--trust");
      expect(command).toContain("--mode");
      expect(command).toContain("plan");
      expect(command).not.toContain("--force");
      expect(command).toContain("cursor-grok-4.7-high");
    }
  });

  test("uses force for a workspace-write analyze profile", () => {
    const command = buildComposerCommand({
      cursorBinary: "cursor-agent",
      profile: { model: "cursor-grok-4.7-high", sandbox: "workspace-write" },
      mode: "analyze",
      cwd: "/tmp/workspace",
      prompt: "Analysis task",
    });

    expect(command).toContain("--force");
    expect(command).not.toContain("plan");
  });
});

describe("spawn-adapter: OpenCode adapter", () => {
  test("buildOpenCodeCommand uses --pure and controlled agent for read-only", () => {
    const command = buildOpenCodeCommand({
      opencodeBinary: "opencode",
      profile: { model: "moonshotai/kimi-k3", sandbox: "read-only" },
      prompt: "Analyze the repo",
      mode: "analyze",
    });
    expect(command).toEqual([
      "opencode",
      "--pure",
      "run",
      "--agent",
      "arc-orchestrator-read-only",
      "--format",
      "json",
      "--model",
      "moonshotai/kimi-k3",
      "Analyze the repo",
    ]);
  });

  test("OpenCode progress and deadline model labels reject control characters and overlength ids", () => {
    for (const model of [
      "opencode-go/glm-5.3\ninjected",
      "\u001b[31mopencode-go/glm-5.3",
      "opencode-go/glm-5.3\u0000injected",
      `opencode-go/${"x".repeat(80)}`,
    ]) {
      expect(safeOpenCodeModelLabel(model)).toBe("configured-model");
      expect(openCodeWorkerLabel(model)).toBe("OpenCode (configured-model)");
    }

    const longestAllowed = `m${"x".repeat(79)}`;
    expect(safeOpenCodeModelLabel(longestAllowed)).toBe(longestAllowed);
    expect(safeOpenCodeModelLabel(`${longestAllowed}x`)).toBe(
      "configured-model",
    );
  });

  test("OpenCode child receives the requested workspace as both cwd and PWD", async () => {
    const directory = mkdtempSync(`${tmpdir()}/spawn-opencode-cwd-`);
    temporaryDirectories.push(directory);
    const launcherDirectory = resolve(directory, "launcher");
    const workspace = resolve(directory, "workspace");
    const temporaryDirectory = resolve(directory, "tmp");
    mkdirSync(launcherDirectory);
    mkdirSync(workspace);
    mkdirSync(temporaryDirectory);

    const markerName = "same-named-workspace-marker.txt";
    writeFileSync(resolve(launcherDirectory, markerName), "launcher-parent");
    writeFileSync(resolve(workspace, markerName), "requested-workspace");

    const opencode = resolve(launcherDirectory, "opencode");
    writeFileSync(
      opencode,
      `#!${process.execPath}
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
console.log(JSON.stringify({
  cwd: process.cwd(),
  pwd: process.env.PWD,
  selectedFromCwd: readFileSync("${markerName}", "utf8"),
  selectedFromPwd: readFileSync(resolve(process.env.PWD, "${markerName}"), "utf8"),
}));
`,
    );
    chmodSync(opencode, 0o755);

    const invoke = createSpawnBackendInvoker({
      ...process.env,
      PWD: launcherDirectory,
      ARC_ORCHESTRATOR_OPENCODE_BIN: opencode,
    });
    const progressMessages: string[] = [];
    const output = await invoke({
      backend: "opencode",
      mode: "implement",
      task: "workspace boundary",
      cwd: workspace,
      taskClass: null,
      temporaryDirectory,
      budget: { maxDurationMs: null, maxTokens: null },
      effort: null,
      profile: {
        model: "opencode-go/glm-5.3-flash\ninjected",
        sandbox: "workspace-write",
        instruction: "x",
      },
      prompt: "prompt",
      resultSchema: { type: "object" } as never,
      requestedAlias: null,
      emitProgress: (message) => progressMessages.push(message),
    });

    expect(output.exitCode).toBe(0);
    expect(JSON.parse(output.stdout)).toEqual({
      cwd: workspace,
      pwd: workspace,
      selectedFromCwd: "requested-workspace",
      selectedFromPwd: "requested-workspace",
    });
    expect(output.stdout).not.toContain("launcher-parent");
    expect(progressMessages).toEqual([
      "OpenCode worker process started (configured-model); awaiting provider response",
    ]);
  });

  test("openCodePermissionEnv denies write tools for read-only profiles", () => {
    for (const mode of ["analyze", "review"] as const) {
      const env = openCodePermissionEnv(
        mode,
        { PATH: "/usr/bin" },
        null,
        undefined,
        "read-only",
      );
      expect(JSON.parse(env.OPENCODE_PERMISSION!)).toEqual(OPENCODE_READ_ONLY_PERMISSION);
      expect(env.OPENCODE_CONFIG_CONTENT).toContain("arc-orchestrator-read-only");
    }
    // Sandbox, not mode, drives the deny rules: a workspace-write analyze
    // profile leaves permissions open like implement.
    for (const mode of ["analyze", "implement"] as const) {
      const openEnv = openCodePermissionEnv(
        mode,
        { PATH: "/usr/bin" },
        null,
        undefined,
        "workspace-write",
      );
      expect(openEnv.OPENCODE_PERMISSION).toBeUndefined();
      expect(openEnv.OPENCODE_CONFIG_CONTENT).toBeUndefined();
    }
    const implementEnv = openCodePermissionEnv("implement", { PATH: "/usr/bin" });
    expect(implementEnv.OPENCODE_PERMISSION).toBeUndefined();
    expect(implementEnv.OPENCODE_CONFIG_CONTENT).toBeUndefined();
  });
});

describe("spawn-adapter: runner termination", () => {
  test("forwards SIGTERM on the runner pid to the provider and its helpers", async () => {
    const directory = mkdtempSync(`${tmpdir()}/spawn-signal-forwarding-`);
    temporaryDirectories.push(directory);
    const workerPidFile = resolve(directory, "worker.pid");
    const helperPidFile = resolve(directory, "helper.pid");
    const cursor = resolve(directory, "cursor-agent");
    writeFileSync(
      cursor,
      `#!/bin/sh
sleep 60 &
echo $! > "${helperPidFile}"
echo $$ > "${workerPidFile}"
wait
`,
    );
    chmodSync(cursor, 0o755);

    const adapterPath = resolve(
      import.meta.dir,
      "../plugins/arc-orchestrator/lib/spawn-adapter",
    );
    const runner = resolve(directory, "runner.ts");
    writeFileSync(
      runner,
      `import { createSpawnBackendInvoker } from ${JSON.stringify(adapterPath)};
const invoke = createSpawnBackendInvoker({ PATH: process.env.PATH, ARC_ORCHESTRATOR_CURSOR_BIN: ${JSON.stringify(cursor)} });
await invoke({
  backend: "composer", mode: "implement", phase: "implement", taskSlug: null,
  task: "t", cwd: ${JSON.stringify(directory)}, taskClass: null,
  temporaryDirectory: ${JSON.stringify(directory)},
  budget: { maxDurationMs: null, maxTokens: null }, effort: null,
  profile: { model: "m", sandbox: "workspace-write", instruction: "x" },
  prompt: "p", resultSchema: { type: "object" }, requestedAlias: null,
} as never);
`,
    );

    const runnerProcess = Bun.spawn([process.execPath, runner], {
      stdout: "ignore",
      stderr: "pipe",
    });
    const deadline = Date.now() + 10_000;
    while (!existsSync(workerPidFile) && Date.now() < deadline) {
      await Bun.sleep(50);
    }
    const workerPid = Number(readFileSync(workerPidFile, "utf8").trim());
    const helperPid = Number(readFileSync(helperPidFile, "utf8").trim());
    const isAlive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(isAlive(workerPid)).toBe(true);

    runnerProcess.kill("SIGTERM");
    const exitCode = await runnerProcess.exited;
    const stderr = await new Response(runnerProcess.stderr).text();

    expect(exitCode).toBe(143);
    expect(stderr).toContain("received SIGTERM; stopping 1 worker process(es)");
    const reapDeadline = Date.now() + 2_000;
    while (
      (isAlive(workerPid) || isAlive(helperPid)) &&
      Date.now() < reapDeadline
    ) {
      await Bun.sleep(50);
    }
    expect(isAlive(workerPid)).toBe(false);
    expect(isAlive(helperPid)).toBe(false);
  });
});
