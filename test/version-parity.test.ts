import { describe, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const syncScript = resolve(projectRoot, "scripts/sync-versions.ts");

const manifestPaths = [
  "package.json",
  "plugins/arc-orchestrator/.claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  "plugins/pi-orchestrator/package.json",
  "plugins/cursor-orchestrator/.cursor-plugin/plugin.json",
] as const;

function read(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

function readVersion(path: string): string {
  const data = JSON.parse(read(path)) as Record<string, unknown>;

  if (path === ".claude-plugin/marketplace.json") {
    const metadata = data.metadata as { version: string };
    return metadata.version;
  }

  return data.version as string;
}

function runSync(
  version: string,
  options: { cwd: string; scriptPath?: string },
): { exitCode: number; stderr: string } {
  const scriptPath = options.scriptPath ?? syncScript;
  const result = Bun.spawnSync(["bun", scriptPath, version], {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
  };
}

function copyManifestTree(targetRoot: string, omit?: string): void {
  mkdirSync(resolve(targetRoot, "scripts"), { recursive: true });
  copyFileSync(syncScript, resolve(targetRoot, "scripts/sync-versions.ts"));

  for (const manifestPath of manifestPaths) {
    if (manifestPath === omit) {
      continue;
    }

    const destination = resolve(targetRoot, manifestPath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(resolve(projectRoot, manifestPath), destination);
  }
}

describe("version parity", () => {
  test("every manifest reports the same version as root package.json", () => {
    const rootVersion = readVersion("package.json");

    for (const manifestPath of manifestPaths) {
      expect({ file: manifestPath, version: readVersion(manifestPath) }).toEqual({
        file: manifestPath,
        version: rootVersion,
      });
    }
  });

  test("marketplace plugin entry matches root package.json version", () => {
    const rootVersion = readVersion("package.json");
    const marketplace = JSON.parse(read(".claude-plugin/marketplace.json")) as {
      metadata: { version: string };
      plugins: Array<{ version: string }>;
    };

    expect(marketplace.metadata.version).toBe(rootVersion);
    expect(marketplace.plugins[0]?.version).toBe(rootVersion);
  });

  test("sync script is idempotent against temp manifest copies", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "version-sync-"));
    const tempScript = resolve(tempRoot, "scripts/sync-versions.ts");

    try {
      copyManifestTree(tempRoot);
      const targetVersion = "9.8.7";

      const first = runSync(targetVersion, { cwd: tempRoot, scriptPath: tempScript });
      expect(first.exitCode).toBe(0);

      const afterFirst = manifestPaths.map((manifestPath) =>
        readFileSync(resolve(tempRoot, manifestPath), "utf8"),
      );

      const second = runSync(targetVersion, { cwd: tempRoot, scriptPath: tempScript });
      expect(second.exitCode).toBe(0);

      const afterSecond = manifestPaths.map((manifestPath) =>
        readFileSync(resolve(tempRoot, manifestPath), "utf8"),
      );

      expect(afterSecond).toEqual(afterFirst);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("sync script exits non-zero for an invalid version argument", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "version-sync-invalid-"));
    const tempScript = resolve(tempRoot, "scripts/sync-versions.ts");

    try {
      copyManifestTree(tempRoot);
      const result = runSync("not-a-version", { cwd: tempRoot, scriptPath: tempScript });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("invalid");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("sync script exits non-zero when a manifest file is missing", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "version-sync-missing-"));
    const tempScript = resolve(tempRoot, "scripts/sync-versions.ts");

    try {
      copyManifestTree(tempRoot, "plugins/pi-orchestrator/package.json");
      const result = runSync("1.0.0", { cwd: tempRoot, scriptPath: tempScript });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("plugins/pi-orchestrator/package.json");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("sync script exits non-zero for an unparseable manifest", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "version-sync-bad-json-"));
    const tempScript = resolve(tempRoot, "scripts/sync-versions.ts");

    try {
      copyManifestTree(tempRoot);
      const badManifest = resolve(
        tempRoot,
        "plugins/cursor-orchestrator/.cursor-plugin/plugin.json",
      );
      writeFileSync(badManifest, "{ not valid json\n", "utf8");

      const result = runSync("1.0.0", { cwd: tempRoot, scriptPath: tempScript });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(
        "plugins/cursor-orchestrator/.cursor-plugin/plugin.json",
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
