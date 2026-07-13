import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const wrapperPath = resolve(
  projectRoot,
  "plugins/pi-orchestrator/bin/arc-orchestrator",
);

function createStubScript(path: string): void {
  writeFileSync(path, '#!/bin/sh\necho "$*"\n', {
    encoding: "utf8",
    mode: 0o755,
  });
}

function buildEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return env;
}

function runWrapper(
  options: {
    args?: string[];
    env?: Record<string, string | undefined>;
    wrapper?: string;
  } = {},
): { exitCode: number; stdout: string; stderr: string } {
  const wrapper = options.wrapper ?? wrapperPath;
  const result = Bun.spawnSync([wrapper, ...(options.args ?? [])], {
    cwd: projectRoot,
    env: buildEnv(options.env ?? {}),
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("pi arc-orchestrator wrapper", () => {
  test("forwards args to ARC_ORCHESTRATOR_BIN override even when PATH has a candidate", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pi-wrapper-override-"));
    try {
      const overrideStub = join(tempDir, "override-runner");
      const pathBinDir = join(tempDir, "path-bin");
      const pathStub = join(pathBinDir, "fable-orchestrator");
      mkdirSync(pathBinDir, { recursive: true });
      createStubScript(overrideStub);
      createStubScript(pathStub);

      const result = runWrapper({
        args: ["run", "--backend", "codex", "--mode", "analyze"],
        env: {
          ARC_ORCHESTRATOR_BIN: overrideStub,
          PATH: `${pathBinDir}:/usr/bin:/bin`,
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("run --backend codex --mode analyze");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("uses fable-orchestrator from PATH when override is unset", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pi-wrapper-path-"));
    try {
      const pathBinDir = join(tempDir, "path-bin");
      const pathStub = join(pathBinDir, "fable-orchestrator");
      mkdirSync(pathBinDir, { recursive: true });
      createStubScript(pathStub);

      const result = runWrapper({
        args: ["runs", "--limit", "3"],
        env: {
          ARC_ORCHESTRATOR_BIN: undefined,
          PATH: `${pathBinDir}:/usr/bin:/bin`,
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("runs --limit 3");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("uses sibling fable-orchestrator when override and PATH miss", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pi-wrapper-sibling-"));
    try {
      const packageBinDir = join(
        tempDir,
        "plugins",
        "pi-orchestrator",
        "bin",
      );
      const siblingBinDir = join(
        tempDir,
        "plugins",
        "fable-orchestrator",
        "bin",
      );
      mkdirSync(packageBinDir, { recursive: true });
      mkdirSync(siblingBinDir, { recursive: true });

      const copiedWrapper = join(packageBinDir, "arc-orchestrator");
      const siblingStub = join(siblingBinDir, "fable-orchestrator");
      copyFileSync(wrapperPath, copiedWrapper);
      chmodSync(copiedWrapper, 0o755);
      createStubScript(siblingStub);

      const result = runWrapper({
        wrapper: copiedWrapper,
        args: ["doctor"],
        env: {
          ARC_ORCHESTRATOR_BIN: undefined,
          PATH: "/usr/bin:/bin",
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("doctor");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("fails with all lookup locations when no runner resolves", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pi-wrapper-miss-"));
    try {
      const isolatedWrapper = join(tempDir, "arc-orchestrator");
      copyFileSync(wrapperPath, isolatedWrapper);
      chmodSync(isolatedWrapper, 0o755);

      const result = runWrapper({
        wrapper: isolatedWrapper,
        args: ["run"],
        env: {
          ARC_ORCHESTRATOR_BIN: undefined,
          PATH: "",
        },
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("ARC_ORCHESTRATOR_BIN");
      expect(result.stderr).toContain("fable-orchestrator");
      expect(result.stderr).toContain(
        "../../fable-orchestrator/bin/fable-orchestrator",
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
