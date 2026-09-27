// E2E: the `routing` subcommands and `--workload-evidence`, driven through the
// shipped runner binary with a fake Codex CLI. Asserts on what the runner
// observably does: what it prints, what it exits with, and what it writes to
// the schema-4 and routing-trace-v2 trace files.

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const runner = resolve(projectRoot, "plugins/arc-orchestrator/bin/arc-orchestrator");
const temporaryDirectories: string[] = [];
const NOW_MS = Date.parse("2026-09-26T00:00:00Z");

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const directory = mkdtempSync(`${tmpdir()}/${prefix}-`);
  temporaryDirectories.push(directory);
  return directory;
}

function createFakeCodex(): { executable: string; argumentsPath: string; workspace: string; traceDirectory: string } {
  const directory = tempDir("routing-cli-codex");
  const executable = resolve(directory, "codex");
  const argumentsPath = resolve(directory, "arguments.json");
  const workspace = resolve(directory, "workspace");
  const traceDirectory = resolve(directory, "traces");
  mkdirSync(workspace, { recursive: true });
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
printf '%s\\n' '{"type":"thread.started","thread_id":"fake-thread"}'
printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":1200,"cached_input_tokens":200,"output_tokens":300}}'
printf '%s\\n' '{"status":"completed","summary":"done","changes":[],"verification":[],"risks":[],"next_actions":[]}' > "$output_file"
`,
  );
  chmodSync(executable, 0o755);
  return { executable, argumentsPath, workspace, traceDirectory };
}

async function invoke(args: string[], env: Record<string, string> = {}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([runner, ...args], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, ...env },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function runImplement(fixture: ReturnType<typeof createFakeCodex>, extraArguments: string[]) {
  return invoke(
    ["run", "--mode", "implement", "--phase", "implement", "--task", "Complete the bounded task", "--cwd", fixture.workspace, ...extraArguments],
    {
      ARC_ORCHESTRATOR_CODEX_BIN: fixture.executable,
      FAKE_CODEX_ARGUMENTS: fixture.argumentsPath,
      ARC_ORCHESTRATOR_TRACE: "1",
      ARC_ORCHESTRATOR_TRACE_DIR: fixture.traceDirectory,
      ARC_ORCHESTRATOR_LAMINAR: "0",
    },
  );
}

function readJsonl(path: string): Record<string, unknown>[] {
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

const HARD_MEDIUM_EVIDENCE = JSON.stringify({ scope: { packages: 2, crossPackage: true }, change: { estimatedFiles: 6, authBoundary: true } });

describe("arc-orchestrator routing", () => {
  test("profile classifies evidence and explains it", async () => {
    const result = await invoke(["routing", "profile", "--evidence", HARD_MEDIUM_EVIDENCE]);
    expect(result.exitCode).toBe(0);
    const profile = JSON.parse(result.stdout);
    expect(profile.workloadClass).toBe("hard-medium");
    expect(profile.reasons).toContain("authentication boundary affected");
    const text = await invoke(["routing", "profile", "--evidence", HARD_MEDIUM_EVIDENCE, "--text"]);
    expect(text.stdout).toStartWith("hard-medium (hard x medium)");
  });

  test("profile rejects malformed evidence with exit 2", async () => {
    const result = await invoke(["routing", "profile", "--evidence", '{"scope":{"relevantFiles":"lots"}}']);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("scope.relevantFiles must be a non-negative number");
  });

  test("simulate runs the shared engine with availability evidence and explains the decision", async () => {
    const context = JSON.stringify({
      phase: "implement",
      evidence: JSON.parse(HARD_MEDIUM_EVIDENCE),
      availability: { backends: [{ backend: "codex", classification: "rate_limit", observedAtMs: NOW_MS }] },
      nowMs: NOW_MS,
    });
    const result = await invoke(["routing", "simulate", "--context", context]);
    expect(result.exitCode).toBe(0);
    const { evaluation, explanation } = JSON.parse(result.stdout);
    expect(evaluation.workloadClass).toBe("hard-medium");
    expect(evaluation.workloadClassSource).toBe("profiled");
    expect(evaluation.traversal.steps[0].status).toBe("unavailable");
    expect(evaluation.traversal.selected.rungId).toBe("cursor-grok-4.7-high@high");
    expect(evaluation.selection.outcome).toBe("selected");
    expect(evaluation.selectionTrace.executed).toBe(false);
    expect(explanation.headline).toBe("Selected: Cursor Grok 4.7 High @ high");
    const text = await invoke(["routing", "simulate", "--context", context, "--text"]);
    expect(text.stdout).toContain("Codex Sol was unavailable (codex observed rate_limit)");
  });

  test("simulate fails closed on a parent-local phase", async () => {
    const result = await invoke(["routing", "simulate", "--context", JSON.stringify({ phase: "analyze", nowMs: NOW_MS })]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).evaluation.error.code).toBe("parent-local-phase");
  });

  test("validate accepts the shipped policy document and rejects a candidate that routes an excluded model", async () => {
    const ok = await invoke(["routing", "validate", "--policy", "docs/arc-model-policy.md"]);
    expect(ok.exitCode).toBe(0);
    expect(JSON.parse(ok.stdout).valid).toBe(true);

    const directory = tempDir("routing-cli-policy");
    const candidate = JSON.parse(readFileSync(resolve(projectRoot, "packages/routing-core/generated/routing-policy.json"), "utf8"));
    candidate.policy.workloadChains["easy-light"].push("sonnet-5@high");
    const path = resolve(directory, "candidate.json");
    writeFileSync(path, JSON.stringify(candidate));
    const bad = await invoke(["routing", "validate", "--policy", path]);
    expect(bad.exitCode).toBe(1);
    const report = JSON.parse(bad.stdout);
    expect(report.valid).toBe(false);
    expect(report.issues.map((issue: { code: string }) => issue.code)).toContain("excluded-model");
  });

  test("diff reports semantic changes and emits an applicable patch", async () => {
    const directory = tempDir("routing-cli-diff");
    const candidate = JSON.parse(readFileSync(resolve(projectRoot, "packages/routing-core/generated/routing-policy.json"), "utf8"));
    candidate.policy.workloadChains["hard-medium"][0] = "opus-5.5@high";
    const path = resolve(directory, "candidate.json");
    writeFileSync(path, JSON.stringify(candidate));
    const result = await invoke(["routing", "diff", "--policy", path]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.valid).toBe(true);
    expect(report.diff.changes.map((change: { summary: string }) => change.summary)).toContain("workload hard-medium: lead changed gpt-6-sol@high → opus-5.5@high");
    expect(report.patch).toContain("+workload hard-medium: opus-5.5@high, cursor-grok-4.7-high@high, opencode-go-glm-5.3@none");
    const text = await invoke(["routing", "diff", "--policy", path, "--text"]);
    expect(text.stdout).toContain("### workload:hard-medium");
  });

  test("export reproduces the committed canonical artifacts byte-for-byte", async () => {
    const directory = tempDir("routing-cli-export");
    const result = await invoke(["routing", "export", "--out", directory]);
    expect(result.exitCode).toBe(0);
    const committed = resolve(projectRoot, "packages/routing-core/generated");
    const names = readdirSync(committed).sort();
    expect(readdirSync(directory).sort()).toEqual(names);
    for (const name of names) {
      expect(readFileSync(resolve(directory, name), "utf8"), name).toBe(readFileSync(resolve(committed, name), "utf8"));
    }
    const manifest = JSON.parse(readFileSync(resolve(committed, "manifest.json"), "utf8"));
    expect(manifest.contract).toBe("arc-routing-artifacts/v1");
    expect(Object.keys(manifest.files).sort()).toEqual(["arc-model-policy.md", "capability-snapshot.json", "model-registry.json", "routing-policy.json"]);
  });

  test("contract prints the routing bundle", async () => {
    const result = await invoke(["routing", "contract"]);
    expect(result.exitCode).toBe(0);
    const bundle = JSON.parse(result.stdout);
    expect(bundle.contract).toBe("arc-routing-bundle/v1");
    expect(bundle.policy.policy.label).toBe("runner-routing-v4");
    expect(bundle.registry.entries.length).toBeGreaterThan(10);
    expect(bundle.snapshot.schemaVersion).toBe(1);
  });

  test("unknown subcommand exits 2 with usage", async () => {
    const result = await invoke(["routing", "bogus"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("arc-orchestrator routing simulate");
  });
});

describe("arc-orchestrator run --workload-evidence", () => {
  test("derives the workload class for automatic implement and records the profile in both trace files", async () => {
    const fixture = createFakeCodex();
    const result = await runImplement(fixture, ["--workload-evidence", HARD_MEDIUM_EVIDENCE, "--routing-policy", "runner-routing-v4"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).summary).toBe("done");
    // hard-medium leads with Sol on codex, so the fake codex served it.
    const arguments_ = JSON.parse(readFileSync(fixture.argumentsPath, "utf8")) as string[];
    expect(arguments_).toContain("gpt-6-sol");

    const [record] = readJsonl(resolve(fixture.traceDirectory, "runs.jsonl"));
    expect(record!.workload_class).toBe("hard-medium");
    const profile = record!.workload_profile as Record<string, unknown>;
    expect(profile.contract).toBe("workload-profile/v1");
    expect(profile.class_source).toBe("profiled");
    expect(profile.routed_class).toBe("hard-medium");
    expect(profile.disagreement).toBeNull();
    expect(profile.reasons).toContain("authentication boundary affected");

    const [v2] = readJsonl(resolve(fixture.traceDirectory, "routing-trace-v2.jsonl"));
    expect((v2!.workload_profile as Record<string, unknown>).workload_class).toBe("hard-medium");
    expect((v2!.versions as Record<string, unknown>).routing_core).toBe("arc-routing-core/v1");
    expect((v2!.legacy as Record<string, unknown>).workload_class).toBe("hard-medium");
  });

  test("an explicit --workload-class wins and the disagreement is recorded", async () => {
    const fixture = createFakeCodex();
    const result = await runImplement(fixture, ["--workload-class", "hard-medium", "--workload-evidence", '{"change":{"estimatedFiles":1}}']);
    expect(result.exitCode, result.stderr).toBe(0);
    const [record] = readJsonl(resolve(fixture.traceDirectory, "runs.jsonl"));
    expect(record!.workload_class).toBe("hard-medium");
    const profile = record!.workload_profile as Record<string, unknown>;
    expect(profile.class_source).toBe("explicit");
    expect(profile.workload_class).toBe("easy-light");
    expect(profile.disagreement).toEqual({ explicit: "hard-medium", profiled: "easy-light" });
  });

  test("evidence without scope or change facts cannot route and fails closed", async () => {
    const fixture = createFakeCodex();
    const result = await runImplement(fixture, ["--workload-evidence", '{"execution":{"previousFailures":3}}']);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("could not derive a workload class");
  });

  test("malformed evidence is rejected before any dispatch", async () => {
    const fixture = createFakeCodex();
    const result = await runImplement(fixture, ["--workload-evidence", '{"change":{"apiBoundary":"yes"}}']);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("change.apiBoundary must be a boolean");
  });

  test("a run without evidence writes no workload_profile key (byte-compatible traces)", async () => {
    const fixture = createFakeCodex();
    const result = await runImplement(fixture, ["--workload-class", "hard-medium"]);
    expect(result.exitCode, result.stderr).toBe(0);
    const [record] = readJsonl(resolve(fixture.traceDirectory, "runs.jsonl"));
    expect("workload_profile" in record!).toBe(false);
    const [v2] = readJsonl(resolve(fixture.traceDirectory, "routing-trace-v2.jsonl"));
    expect("workload_profile" in v2!).toBe(false);
  });
});
