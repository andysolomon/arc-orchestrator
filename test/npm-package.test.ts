import { describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");

type PackEntry = {
  filename: string;
  files: Array<{ path: string }>;
};

function run(
  command: string[],
  cwd = projectRoot,
): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync(command, {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function output(result: ReturnType<typeof Bun.spawnSync>): string {
  return `${result.stdout.toString()}\n${result.stderr.toString()}`;
}

function normalizePackEntries(value: unknown): PackEntry[] {
  const entries = Array.isArray(value)
    ? value
    : value !== null && typeof value === "object"
      ? Object.values(value)
      : [];

  if (
    !entries.every(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        typeof (entry as PackEntry).filename === "string",
    )
  ) {
    throw new Error("npm pack returned an unexpected JSON shape");
  }

  return entries as PackEntry[];
}

function isAllowedTarPath(path: string): boolean {
  return (
    path === "package/package.json" ||
    path === "package/README.md" ||
    path === "package/LICENSE" ||
    path.startsWith("package/plugins/arc-orchestrator/bin/") ||
    path.startsWith("package/plugins/arc-orchestrator/lib/")
  );
}

describe("npm runner package", () => {
  test("declares a public runtime package without local-link dependencies", () => {
    const manifest = JSON.parse(
      readFileSync(join(projectRoot, "package.json"), "utf8"),
    );

    expect(manifest.name).toBe("@andysolomon/arc-orchestrator");
    const lockfile = readFileSync(join(projectRoot, "bun.lock"), "utf8");
    expect(lockfile).toContain(`"name": "${manifest.name}"`);
    expect(manifest.private).toBeUndefined();
    expect(manifest.license).toBe("MIT");
    expect(manifest.publishConfig).toEqual({ access: "public" });
    expect(manifest.bin).toEqual({
      "arc-orchestrator": "plugins/arc-orchestrator/bin/arc-orchestrator",
    });
    expect(manifest.exports["./runner"]).toBe(
      "./plugins/arc-orchestrator/bin/arc-orchestrator",
    );

    for (const [name, specifier] of Object.entries(
      manifest.dependencies ?? {},
    )) {
      expect(
        String(specifier),
        `${name} must be registry-portable`,
      ).not.toMatch(/^(?:link|file):/);
    }
  });

  test("normalizes npm pack array and package-keyed JSON output", () => {
    const entry: PackEntry = {
      filename: "andysolomon-arc-orchestrator-0.61.0.tgz",
      files: [],
    };

    expect(normalizePackEntries([entry])).toEqual([entry]);
    expect(
      normalizePackEntries({ "@andysolomon/arc-orchestrator": entry }),
    ).toEqual([entry]);
  });

  test("packs only the runtime allowlist and executes outside the repository", () => {
    const temp = mkdtempSync(join(tmpdir(), "arc-orchestrator-pack-"));
    try {
      const pack = run([
        "npm",
        "pack",
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        temp,
      ]);
      expect(pack.exitCode, output(pack)).toBe(0);

      const entries = normalizePackEntries(
        JSON.parse(pack.stdout.toString()),
      );
      expect(entries).toHaveLength(1);
      const tarball = join(temp, entries[0]!.filename);
      const listing = run(["tar", "-tzf", tarball]);
      expect(listing.exitCode, output(listing)).toBe(0);
      const paths = listing.stdout.toString().split("\n").filter(Boolean);

      expect(paths).toContain("package/package.json");
      expect(paths).toContain("package/LICENSE");
      expect(paths).toContain(
        "package/plugins/arc-orchestrator/bin/arc-orchestrator",
      );
      expect(paths).toContain("package/plugins/arc-orchestrator/lib/cli.ts");
      expect(paths.every(isAllowedTarPath), paths.join("\n")).toBe(true);
      expect(
        paths.some((path) =>
          /(?:^|\/)(?:test|node_modules|\.git)(?:\/|$)/.test(path),
        ),
      ).toBe(false);

      const extracted = join(temp, "extracted");
      const working = join(temp, "working");
      mkdirSync(extracted);
      mkdirSync(working);
      const extract = run(["tar", "-xzf", tarball, "-C", extracted]);
      expect(extract.exitCode, output(extract)).toBe(0);

      const runner = join(
        extracted,
        "package/plugins/arc-orchestrator/bin/arc-orchestrator",
      );
      expect(statSync(runner).mode & 0o111).not.toBe(0);
      const version = run([runner, "--version"], working);
      expect(version.exitCode, output(version)).toBe(0);
      expect(version.stdout.toString().trim()).toBe(
        JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"))
          .version,
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
