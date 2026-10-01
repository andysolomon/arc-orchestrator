import { expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";

const runner = resolve(
  import.meta.dir,
  "../plugins/arc-orchestrator/bin/arc-orchestrator",
);
const completed = {
  status: "completed",
  summary: "reviewed",
  changes: [],
  verification: [],
  risks: [],
  next_actions: [],
};
const denied = {
  type: "tool_use",
  part: {
    tool: "read",
    state: {
      status: "error",
      error: "The user rejected permission to use this specific tool call.",
    },
  },
};
const textResult = { type: "text", part: { text: JSON.stringify(completed) } };

// All checks drive the shipped CLI with fake provider executables. Each case
// leaves capture.json, result.json and runner traces as repeatable evidence.
async function runReview(
  events: unknown[],
  options: { route?: string; roots?: unknown } = {},
) {
  const root = mkdtempSync(resolve(tmpdir(), "arc-review-e2e-"));
  const workspace = resolve(root, "workspace");
  const sibling = resolve(root, "sibling");
  mkdirSync(workspace);
  mkdirSync(sibling);
  const capture = resolve(root, "capture.json");
  const binary = resolve(root, "fake-provider");
  writeFileSync(
    binary,
    `#!${process.execPath}
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ args: process.argv.slice(2), config: process.env.OPENCODE_CONFIG_CONTENT, permission: process.env.OPENCODE_PERMISSION }));
if (process.argv.includes("--workspace")) {
  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: ${JSON.stringify(JSON.stringify(completed))} }));
} else {
  for (const event of ${JSON.stringify(events)}) console.log(JSON.stringify(event));
}
`,
  );
  chmodSync(binary, 0o755);
  const env = {
    ...process.env,
    ARC_ORCHESTRATOR_ORCHESTRATOR: "",
    ARC_ORCHESTRATOR_OPENCODE_BIN: binary,
    ARC_ORCHESTRATOR_CURSOR_BIN: binary,
    ARC_ORCHESTRATOR_TRACE_DIR: resolve(root, "traces"),
    ARC_ORCHESTRATOR_READ_ROOTS: JSON.stringify(options.roots ?? [sibling]),
  };
  const child = Bun.spawn(
    [
      runner,
      "run",
      "--mode",
      "review",
      "--phase",
      "verify",
      "--route",
      options.route ?? "deepseek-v4-pro-check",
      "--cwd",
      workspace,
      "--task",
      "Review named repositories without writes",
    ],
    { env, cwd: workspace, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  writeFileSync(
    resolve(root, "result.json"),
    JSON.stringify({ stdout, stderr, exitCode }),
  );
  return { root, sibling, capture, stdout, stderr, exitCode };
}

test("OpenCode denied reads survive a zero exit without final text", async () => {
  const result = await runReview([denied]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("read: The user rejected permission");
  expect(result.stderr).not.toContain('"fallback"');
});

test("zero-exit OpenCode provider errors are failures, not missing results", async () => {
  const result = await runReview([
    { type: "error", error: { message: "authentication required" } },
  ]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("opencode unavailable (auth)");
  const trace = JSON.parse(
    readFileSync(resolve(result.root, "traces/runs.jsonl"), "utf8").trim(),
  );
  expect(trace.error).toContain("authentication required");
  expect(trace.outage_reason).toBe("auth");
});

test("recovered tool errors allow final JSON and the child has scoped read-only grants", async () => {
  const result = await runReview([denied, textResult]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).summary).toBe("reviewed");
  const captured = JSON.parse(readFileSync(result.capture, "utf8"));
  const config = JSON.parse(captured.config);
  expect(config.permission.external_directory).toEqual({
    "*": "deny",
    [`${result.sibling}/**`]: "allow",
  });
  expect(config.agent[config.default_agent].permission).toEqual(
    config.permission,
  );
  expect(JSON.parse(captured.permission)).toEqual(config.permission);
  for (const tool of ["edit", "write", "bash", "task"])
    expect(config.permission[tool]).toBe("deny");
});

test("invalid directory grants fail before any provider process starts", async () => {
  for (const roots of [["/"], [homedir()], ["/tmp/*"], ["relative"], []]) {
    const result = await runReview([textResult], { roots });
    expect(result.exitCode).toBe(1);
    expect(existsSync(result.capture)).toBe(false);
  }
});

test("public Grok review dispatches Cursor's provider ID in read-only plan mode", async () => {
  const result = await runReview([], { route: "grok-check" });
  expect(result.exitCode).toBe(0);
  const { args } = JSON.parse(readFileSync(result.capture, "utf8"));
  expect(args[args.indexOf("--model") + 1]).toBe("grok-4.7-high");
  expect(args[args.indexOf("--mode") + 1]).toBe("plan");
});
