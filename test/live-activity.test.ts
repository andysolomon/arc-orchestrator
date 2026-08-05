import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureWorkspaceBaseline,
  createLiveActivityEmitter,
  diffWorkspaceChanges,
  LIVE_ACTIVITY_EVENT_PREFIX,
  LIVE_ACTIVITY_LIMITS,
  liveActivityEnabled,
  sanitizeLiveActivityText,
} from "../plugins/arc-orchestrator/lib/live-activity";
import {
  executeRunAttempt,
  type BackendInvocationInput,
  type BackendInvocationOutput,
} from "../plugins/arc-orchestrator/lib/engine";

type ParsedEvent = {
  v: number;
  kind: string;
  seq: number;
  at: number;
  data: Record<string, unknown>;
};

function parseEvents(lines: string[]): ParsedEvent[] {
  return lines
    .filter((line) => line.startsWith(LIVE_ACTIVITY_EVENT_PREFIX))
    .map(
      (line) =>
        JSON.parse(line.slice(LIVE_ACTIVITY_EVENT_PREFIX.length)) as ParsedEvent,
    );
}

function collectingEmitter(options?: {
  now?: () => number;
  enabled?: boolean;
  maxEvents?: number;
  minActivityIntervalMs?: number;
}) {
  const lines: string[] = [];
  const emitter = createLiveActivityEmitter({
    emitStderr: (line) => lines.push(line),
    ...options,
  });
  return { emitter, lines };
}

describe("live-activity: protocol format", () => {
  test("events are single stderr lines with versioned JSON and monotonic seq", () => {
    const { emitter, lines } = collectingEmitter({ now: () => 1234 });
    emitter.phase({ phase: "implement", status: "preparing" });
    emitter.activity({ status: "waiting-provider", tool: "composer" });
    emitter.files({
      count: 1,
      files: [{ file: "src/app.ts", status: "added" }],
    });

    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line.startsWith(LIVE_ACTIVITY_EVENT_PREFIX)).toBe(true);
      expect(line).not.toContain("\n");
    }
    const events = parseEvents(lines);
    expect(events.map((event) => event.kind)).toEqual([
      "phase",
      "activity",
      "files",
    ]);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
    for (const event of events) {
      expect(event.v).toBe(1);
      expect(event.at).toBe(1234);
      expect(Object.keys(event).sort()).toEqual([
        "at",
        "data",
        "kind",
        "seq",
        "v",
      ]);
    }
  });

  test("phase events carry only whitelisted fields", () => {
    const { emitter, lines } = collectingEmitter();
    emitter.phase({
      phase: "implement",
      status: "running",
      model: "composer-2.5",
      // Anything outside the whitelist must be dropped.
      ...({ prompt: "SECRET PROMPT", reasoning: "chain of thought" } as object),
    });
    const [event] = parseEvents(lines);
    expect(event.data).toEqual({
      phase: "implement",
      status: "running",
      model: "composer-2.5",
    });
    expect(lines[0]).not.toContain("SECRET PROMPT");
    expect(lines[0]).not.toContain("chain of thought");
  });

  test("invalid phase status drops the event entirely", () => {
    const { emitter, lines } = collectingEmitter();
    emitter.phase({ phase: "implement", status: "totally-made-up" as never });
    expect(lines).toHaveLength(0);
  });

  test("unknown activity status drops prose instead of forwarding it", () => {
    const { emitter, lines } = collectingEmitter();
    emitter.activity({ status: "private reasoning" as never });
    expect(lines).toHaveLength(0);
  });
});

describe("live-activity: redaction and caps", () => {
  test("assistant and reasoning prose is never admitted to events", () => {
    const prose = `assistant reasoning line one\nline two with /Users/someone/private/path\n${"x".repeat(500)}`;
    const sanitized = sanitizeLiveActivityText(prose, 160);
    expect(sanitized).not.toBeNull();
    expect(sanitized!).not.toContain("\n");
    expect(sanitized!.length).toBeLessThanOrEqual(160);

    const { emitter, lines } = collectingEmitter();
    emitter.activity({
      status: "waiting-provider",
      ...({
        detail: prose,
        reasoning: prose,
        assistant: prose,
        tool: prose,
      } as object),
    });
    const [event] = parseEvents(lines);
    expect(event.data).toEqual({ status: "waiting-provider" });
    expect(lines[0]).not.toContain("assistant reasoning");
    expect(lines[0]).not.toContain("line two with");
  });

  test("non-string and empty fields are dropped, counts are floored", () => {
    const { emitter, lines } = collectingEmitter();
    emitter.activity({
      status: "waiting-provider",
      tool: 42 as never,
      count: 3.9,
    });
    const [event] = parseEvents(lines);
    expect(event.data).toEqual({ status: "waiting-provider", count: 3 });
  });

  test("files list is capped while count preserves the full total", () => {
    const { emitter, lines } = collectingEmitter();
    const files = Array.from({ length: 30 }, (_, index) => ({
      file: `src/file-${index}.ts`,
      status: "added" as const,
    }));
    emitter.files({
      count: 30,
      files,
    });
    const [event] = parseEvents(lines);
    expect((event.data.files as unknown[]).length).toBe(
      LIVE_ACTIVITY_LIMITS.maxFilesListed,
    );
    expect(event.data.count).toBe(30);
  });
});

describe("live-activity: rate limits and safety", () => {
  test("activity events are rate limited; phase and files are not", () => {
    let clock = 0;
    const { emitter, lines } = collectingEmitter({
      now: () => clock,
      minActivityIntervalMs: 1000,
    });
    emitter.activity({ status: "waiting-provider", tool: "codex" });
    clock = 200;
    emitter.activity({ status: "waiting-provider", tool: "composer" });
    emitter.phase({ phase: "implement", status: "running" });
    clock = 1500;
    emitter.activity({ status: "waiting-provider", tool: "claude" });

    const events = parseEvents(lines);
    expect(events.map((event) => event.kind)).toEqual([
      "activity",
      "phase",
      "activity",
    ]);
    expect(lines.join("\n")).not.toContain("composer");
  });

  test("total event cap stops all emission", () => {
    const { emitter, lines } = collectingEmitter({ maxEvents: 3 });
    for (let index = 0; index < 10; index += 1) {
      emitter.phase({ phase: "implement", status: "running" });
    }
    expect(lines).toHaveLength(3);
  });

  test("a throwing emitStderr never propagates", () => {
    const emitter = createLiveActivityEmitter({
      emitStderr: () => {
        throw new Error("sink failed");
      },
    });
    expect(() =>
      emitter.phase({ phase: "implement", status: "running" }),
    ).not.toThrow();
    expect(() =>
      emitter.activity({ status: "waiting-provider" }),
    ).not.toThrow();
  });

  test("liveActivityEnabled honors opt-out values only", () => {
    expect(liveActivityEnabled({})).toBe(true);
    expect(liveActivityEnabled({ ARC_ORCHESTRATOR_LIVE_ACTIVITY: "1" })).toBe(
      true,
    );
    for (const value of ["0", "off", "false", " OFF "]) {
      expect(
        liveActivityEnabled({ ARC_ORCHESTRATOR_LIVE_ACTIVITY: value }),
      ).toBe(false);
    }
    const { emitter, lines } = collectingEmitter({ enabled: false });
    emitter.phase({ phase: "implement", status: "running" });
    expect(lines).toHaveLength(0);
  });
});

function initGitRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "arc-live-activity-"));
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", "-C", repo, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    }
  };
  git("init");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(join(repo, "tracked.txt"), "original\n");
  writeFileSync(join(repo, "doomed.txt"), "delete me\n");
  git("add", ".");
  git("commit", "-m", "baseline", "--no-gpg-sign");
  return repo;
}

describe("live-activity: workspace baseline diff", () => {
  test("reports actual added/modified/deleted changes since baseline", () => {
    const repo = initGitRepo();
    try {
      const baseline = captureWorkspaceBaseline(repo);
      expect(baseline).not.toBeNull();

      writeFileSync(join(repo, "tracked.txt"), "changed\n");
      writeFileSync(join(repo, "created.txt"), "new file\n");
      unlinkSync(join(repo, "doomed.txt"));

      const diff = diffWorkspaceChanges(baseline!);
      expect(diff).not.toBeNull();
      expect(diff!.count).toBe(3);
      expect(diff!.files).toEqual([
        { file: "created.txt", status: "added" },
        { file: "doomed.txt", status: "deleted" },
        { file: "tracked.txt", status: "modified" },
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("pre-existing dirty files are excluded; only new changes are reported", () => {
    const repo = initGitRepo();
    try {
      writeFileSync(join(repo, "already-dirty.txt"), "dirty before run\n");
      const baseline = captureWorkspaceBaseline(repo);
      writeFileSync(join(repo, "worker-output.txt"), "written by worker\n");

      const diff = diffWorkspaceChanges(baseline!);
      expect(diff!.files).toEqual([
        { file: "worker-output.txt", status: "added" },
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("degrades to null in a non-git directory", () => {
    const plain = mkdtempSync(join(tmpdir(), "arc-live-activity-plain-"));
    const nested = join(plain, "definitely-not-a-repo");
    mkdirSync(nested);
    try {
      // GIT_DIR-less lookup can still find an enclosing repo when tmpdir is
      // inside one; assert only that the helpers never throw and stay
      // consistent with each other.
      const baseline = captureWorkspaceBaseline(nested);
      if (baseline !== null) {
        expect(() => diffWorkspaceChanges(baseline)).not.toThrow();
      } else {
        expect(baseline).toBeNull();
      }
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  test("detects further edits to a file that was already dirty", () => {
    const repo = initGitRepo();
    try {
      writeFileSync(join(repo, "tracked.txt"), "dirty before run\n");
      const baseline = captureWorkspaceBaseline(repo);
      writeFileSync(join(repo, "tracked.txt"), "changed during run\n");

      expect(diffWorkspaceChanges(baseline!)?.files).toEqual([
        { file: "tracked.txt", status: "modified" },
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("malformed or vanished workspace state degrades without throwing", () => {
    const repo = initGitRepo();
    const baseline = captureWorkspaceBaseline(repo);
    rmSync(repo, { recursive: true, force: true });

    expect(() => diffWorkspaceChanges(baseline!)).not.toThrow();
    expect(diffWorkspaceChanges(baseline!)).toBeNull();
  });
});

const completedResult = {
  status: "completed",
  summary: "done",
  changes: ["worker-output.txt"],
  verification: ["checked"],
  risks: [],
  next_actions: [],
};

function composerSuccess(): BackendInvocationOutput {
  return {
    stdout: JSON.stringify({
      is_error: false,
      result: JSON.stringify(completedResult),
      usage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 },
    }),
    stderr: "",
    exitCode: 0,
  };
}

function attemptInput(cwd: string) {
  return {
    backend: "composer" as const,
    mode: "implement" as const,
    task: "do work",
    cwd,
    label: null,
    taskClass: null,
    routeRationale: null,
    budget: { maxTokens: null, maxDurationMs: null },
    effort: null,
  };
}

describe("live-activity: engine integration", () => {
  test("workspace-write run emits phase lifecycle and actual file changes", async () => {
    const repo = initGitRepo();
    try {
      const stderr: string[] = [];
      const result = await executeRunAttempt(attemptInput(repo), {
        env: {},
        invokeBackend: async (input: BackendInvocationInput) => {
          writeFileSync(join(input.cwd, "worker-output.txt"), "made by worker\n");
          input.emitProgress?.("worker process started; awaiting provider response");
          return composerSuccess();
        },
        emitStderr: (line) => stderr.push(line),
      });

      expect(result.success).toBe(true);
      // Existing coarse progress lines are preserved unchanged.
      expect(stderr.join("\n")).toContain(
        "arc-orchestrator: progress: preparing composer implement worker",
      );
      expect(stderr.join("\n")).toContain(
        "arc-orchestrator: progress: structured result accepted; recording evidence",
      );

      const events = parseEvents(stderr);
      const phaseStatuses = events
        .filter((event) => event.kind === "phase")
        .map((event) => event.data.status);
      expect(phaseStatuses).toEqual([
        "preparing",
        "waiting-write-lock",
        "running",
        "validating",
        "completed",
      ]);

      const filesEvents = events.filter((event) => event.kind === "files");
      expect(filesEvents).toHaveLength(1);
      expect(filesEvents[0].data.files).toEqual([
        { file: "worker-output.txt", status: "added" },
      ]);

      // Privacy: no event line ever carries the task/prompt text.
      for (const line of stderr.filter((entry) =>
        entry.startsWith(LIVE_ACTIVITY_EVENT_PREFIX),
      )) {
        expect(line).not.toContain("do work");
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("failed backend emits an error phase event and still reports files", async () => {
    const repo = initGitRepo();
    try {
      const stderr: string[] = [];
      const result = await executeRunAttempt(attemptInput(repo), {
        env: {},
        invokeBackend: async (input: BackendInvocationInput) => {
          writeFileSync(join(input.cwd, "partial.txt"), "half done\n");
          return { stdout: "not json", stderr: "boom", exitCode: 1 };
        },
        emitStderr: (line) => stderr.push(line),
      });

      expect(result.success).toBe(false);
      const events = parseEvents(stderr);
      expect(
        events.some(
          (event) => event.kind === "phase" && event.data.status === "error",
        ),
      ).toBe(true);
      const filesEvents = events.filter((event) => event.kind === "files");
      expect(filesEvents).toHaveLength(1);
      expect(filesEvents[0].data.files).toEqual([
        { file: "partial.txt", status: "added" },
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("read-only analyze run emits phase events but no files event", async () => {
    const stderr: string[] = [];
    const result = await executeRunAttempt(
      { ...attemptInput(process.cwd()), backend: "codex", mode: "analyze" },
      {
        env: {},
        invokeBackend: async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
          resultText: JSON.stringify(completedResult),
        }),
        emitStderr: (line) => stderr.push(line),
      },
    );

    expect(result.success).toBe(true);
    const events = parseEvents(stderr);
    expect(events.some((event) => event.kind === "files")).toBe(false);
    expect(
      events.some(
        (event) => event.kind === "phase" && event.data.status === "completed",
      ),
    ).toBe(true);
  });

  test("ARC_ORCHESTRATOR_LIVE_ACTIVITY=off disables events without touching progress lines", async () => {
    const repo = initGitRepo();
    try {
      const stderr: string[] = [];
      const result = await executeRunAttempt(attemptInput(repo), {
        env: { ARC_ORCHESTRATOR_LIVE_ACTIVITY: "off" },
        invokeBackend: async () => composerSuccess(),
        emitStderr: (line) => stderr.push(line),
      });

      expect(result.success).toBe(true);
      expect(
        stderr.some((line) => line.startsWith(LIVE_ACTIVITY_EVENT_PREFIX)),
      ).toBe(false);
      expect(stderr.join("\n")).toContain(
        "arc-orchestrator: progress: worker is running (composer/implement)",
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
