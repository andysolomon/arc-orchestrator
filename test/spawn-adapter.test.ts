import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  buildComposerCommand,
  buildOpenCodeCommand,
  createSpawnBackendInvoker,
  OPENCODE_READ_ONLY_PERMISSION,
  openCodePermissionEnv,
} from "../plugins/fable-orchestrator/lib/spawn-adapter";

const temporaryDirectories: string[] = [];

const genericWorkerResult = {
  status: "completed",
  summary: "done",
  changes: [],
  verification: [],
  risks: [],
  next_actions: [],
};

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

  test("uses plan mode when forcePlanMode is requested", () => {
    const command = buildComposerCommand({
      cursorBinary: "cursor-agent",
      profile: { model: "composer-2.5" },
      mode: "implement",
      cwd: "/tmp/workspace",
      prompt: "Plan only",
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

describe("spawn-adapter: OpenCode adapter", () => {
  test("buildOpenCodeCommand uses --pure and controlled agent for read-only", () => {
    const command = buildOpenCodeCommand({
      opencodeBinary: "opencode",
      profile: { model: "moonshotai/kimi-k3" },
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

  test("openCodePermissionEnv denies write tools for analyze and review", () => {
    for (const mode of ["analyze", "review"] as const) {
      const env = openCodePermissionEnv(mode, { PATH: "/usr/bin" });
      expect(JSON.parse(env.OPENCODE_PERMISSION!)).toEqual(OPENCODE_READ_ONLY_PERMISSION);
      expect(env.OPENCODE_CONFIG_CONTENT).toContain("arc-orchestrator-read-only");
    }
    const implementEnv = openCodePermissionEnv("implement", { PATH: "/usr/bin" });
    expect(implementEnv.OPENCODE_PERMISSION).toBeUndefined();
    expect(implementEnv.OPENCODE_CONFIG_CONTENT).toBeUndefined();
  });
});

describe("spawn-adapter: mechanical route removal", () => {
  test("spawn invoker no longer brokers mechanical aliases", async () => {
    const directory = mkdtempSync(`${tmpdir()}/spawn-no-mechanical-`);
    temporaryDirectories.push(directory);
    const temporaryDirectory = resolve(directory, "tmp");
    Bun.spawnSync(["mkdir", "-p", temporaryDirectory]);
    const cursor = resolve(directory, "cursor-agent");
    writeFileSync(
      cursor,
      `#!/bin/sh
printf '%s\n' '{"is_error":false,"result":"{\\"status\\":\\"completed\\",\\"summary\\":\\"ok\\",\\"changes\\":[],\\"verification\\":[],\\"risks\\":[],\\"next_actions\\":[]}"}'
`,
    );
    chmodSync(cursor, 0o755);

    const invoke = createSpawnBackendInvoker({
      PATH: directory,
      ARC_ORCHESTRATOR_CURSOR_BIN: cursor,
    } as NodeJS.ProcessEnv);
    const output = await invoke({
      backend: "composer",
      mode: "implement",
      task: "mechanical op",
      cwd: directory,
      taskClass: null,
      temporaryDirectory,
      budget: { maxDurationMs: null, maxTokens: null },
      effort: null,
      profile: { model: "composer-2.5", sandbox: "workspace-write", instruction: "x" },
      prompt: "prompt",
      resultSchema: { type: "object" } as never,
      requestedAlias: "mechanical-post-comment",
    });

    // Without the broker, mechanical aliases are ordinary composer calls.
    expect(output.exitCode).toBe(0);
    expect(output.stdout).not.toContain("mechanical broker executed");
  });
});
