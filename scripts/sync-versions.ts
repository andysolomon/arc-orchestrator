#!/usr/bin/env bun

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const projectRoot = resolve(import.meta.dir, "..");

type ManifestSpec = {
  path: string;
  apply: (data: Record<string, unknown>, version: string) => void;
};

const manifests: ManifestSpec[] = [
  {
    path: "package.json",
    apply: (data, version) => {
      data.version = version;
    },
  },
  {
    path: "plugins/fable-orchestrator/.claude-plugin/plugin.json",
    apply: (data, version) => {
      data.version = version;
    },
  },
  {
    path: ".claude-plugin/marketplace.json",
    apply: (data, version) => {
      const metadata = data.metadata as Record<string, unknown> | undefined;
      if (metadata) {
        metadata.version = version;
      }
      const plugins = data.plugins as Array<Record<string, unknown>> | undefined;
      if (plugins?.[0]) {
        plugins[0].version = version;
      }
    },
  },
  {
    path: "plugins/pi-orchestrator/package.json",
    apply: (data, version) => {
      data.version = version;
    },
  },
  {
    path: "plugins/cursor-orchestrator/.cursor-plugin/plugin.json",
    apply: (data, version) => {
      data.version = version;
    },
  },
];

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function main(): void {
  const version = process.argv[2];

  if (!version || !SEMVER_PATTERN.test(version)) {
    fail("Error: version argument is missing or invalid (expected semver, e.g. 0.3.0)");
  }

  for (const manifest of manifests) {
    const fullPath = resolve(projectRoot, manifest.path);

    if (!existsSync(fullPath)) {
      fail(`Error: manifest file not found: ${manifest.path}`);
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(readFileSync(fullPath, "utf8")) as Record<string, unknown>;
    } catch {
      fail(`Error: manifest file is unparseable: ${manifest.path}`);
    }

    manifest.apply(data, version);
    writeFileSync(fullPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
}

main();
