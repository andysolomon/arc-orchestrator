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
  buildOpenCodeCommand,
  createSpawnBackendInvoker,
  OPENCODE_READ_ONLY_PERMISSION,
  openCodePermissionEnv,
  openCodeWorkerLabel,
  safeOpenCodeModelLabel,
} from "../plugins/arc-orchestrator/lib/spawn-adapter";

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
      "--trust",
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

    expect(command).toContain("--trust");
    expect(command).toContain("--mode");
    expect(command).toContain("plan");
    expect(command).not.toContain("--force");
    expect(command).toContain("composer-2.5");
  });

  test("uses plan mode for analyze and review read-only enforcement", () => {
    for (const mode of ["analyze", "review"] as const) {
      const command = buildComposerCommand({
        cursorBinary: "cursor-agent",
        profile: { model: "cursor-grok-4.6-high" },
        mode,
        cwd: "/tmp/workspace",
        prompt: "Read-only task",
      });

      expect(command).toContain("--trust");
      expect(command).toContain("--mode");
      expect(command).toContain("plan");
      expect(command).not.toContain("--force");
      expect(command).toContain("cursor-grok-4.6-high");
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

  test("buildOpenCodeCommand forwards opencode-go provider model ids verbatim with no effort flag", () => {
    for (const model of [
      "opencode-go/glm-5.3-flash",
      "opencode-go/glm-5.3",
      "opencode-go/deepseek-v4-pro",
      "opencode-go/kimi-k3",
    ]) {
      const implement = buildOpenCodeCommand({
        opencodeBinary: "opencode",
        profile: { model },
        prompt: "Implement the task",
        mode: "implement",
      });
      expect(implement).toEqual([
        "opencode",
        "--pure",
        "run",
        "--format",
        "json",
        "--model",
        model,
        "Implement the task",
      ]);
      expect(implement).not.toContain("--agent");
      expect(implement.join(" ")).not.toMatch(/effort/i);

      const review = buildOpenCodeCommand({
        opencodeBinary: "opencode",
        profile: { model },
        prompt: "Review the diff",
        mode: "review",
      });
      expect(review.slice(0, 5)).toEqual([
        "opencode",
        "--pure",
        "run",
        "--agent",
        "arc-orchestrator-read-only",
      ]);
      expect(review).toContain(model);
    }
  });

  test("openCodeWorkerLabel names the dispatched model instead of assuming Kimi", () => {
    expect(openCodeWorkerLabel("opencode-go/glm-5.3-flash")).toBe(
      "OpenCode (opencode-go/glm-5.3-flash)",
    );
    expect(openCodeWorkerLabel("moonshotai/kimi-k3")).toBe(
      "OpenCode (moonshotai/kimi-k3)",
    );
    expect(openCodeWorkerLabel("opencode-go/glm-5.3")).not.toContain("Kimi");
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
