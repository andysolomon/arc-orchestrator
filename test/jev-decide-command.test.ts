import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prepareJevRun,
  runDecide,
  type DecideDeps,
} from "../plugins/arc-orchestrator/lib/decisions/decide-command";
import type {
  JevClient,
  JevDecisionLogRecord,
  JevRequest,
} from "../plugins/arc-orchestrator/lib/decisions/jev";

const KEY = "ts-test-secret-key-123";
const TASK = {
  title: "Add retry to webhook sender",
  description: "Retry failed webhook deliveries with backoff.",
  acceptanceCriteria: ["Retries 3 times"],
  filesTouched: ["src/webhooks.ts"],
  estimatedSize: "medium",
};
const FILES: Record<string, string> = {
  "task.json": JSON.stringify(TASK),
  "out.json": JSON.stringify({ status: "completed", summary: "done", changes: ["src/webhooks.ts"] }),
  "change.diff": "diff --git a/src/webhooks.ts b/src/webhooks.ts",
};

type Answers = {
  worker?: { choice: string; confidence: number };
  complexity?: [number, number];
  risk?: [number, number];
  specClarity?: [number, number];
  nouls?: Partial<Record<string, number>>;
};

const score = ([value, confidence]: [number, number]) => ({
  type: "score",
  score: value - 1,
  confidence,
  legend: {},
  probabilities: {},
});

// Answers whatever the request asks, from the table above.
function mockJev(answers: Answers, fail?: string) {
  const requests: JevRequest[] = [];
  const records: JevDecisionLogRecord[] = [];
  const client: JevClient = {
    systemOne: async (request) => {
      requests.push(request);
      if (fail) {
        const error = new Error("down");
        error.name = fail;
        throw error;
      }
      const out: Record<string, unknown> = {};
      for (const name of Object.keys(request.questions)) {
        if (name === "worker") {
          const w = answers.worker ?? { choice: "composer", confidence: 0.9 };
          out.worker = {
            type: "choice",
            choice: w.choice,
            confidence: w.confidence,
            probabilities: { composer: 0, codex: 0, fable: 0, [w.choice]: w.confidence },
          };
        } else if (name === "complexity" || name === "risk" || name === "specClarity") {
          out[name] = score(answers[name] ?? [2, 0.9]);
        } else {
          out[name] = {
            type: "noul",
            noul: answers.nouls?.[name] ?? (name === "needsHumanReview" ? 0.1 : 0.95),
          };
        }
      }
      return { model: "jev-1.13.0", answers: out as never };
    },
  };
  return {
    requests,
    records,
    deps: (env: Record<string, string>): DecideDeps => ({
      env: { TYPESAFE_API_KEY: KEY, ...env },
      client,
      log: (record) => records.push(record),
      readText: (path) => {
        const text = FILES[path];
        if (text === undefined) throw new Error(`ENOENT ${path}`);
        return text;
      },
    }),
  };
}

const ROUTE = ["route", "--task-json", "task.json"];
const COMPLETE = [
  "complete",
  "--task-json",
  "task.json",
  "--worker-output",
  "out.json",
  "--diff",
  "change.diff",
];

describe("decide: USE_JEV_DECISIONS off (default)", () => {
  test("never calls Jev and leaves the decision with the parent", async () => {
    const jev = mockJev({});
    const result = await runDecide(ROUTE, jev.deps({}));
    expect(result).toMatchObject({
      exitCode: 0,
      output: { decision: "route", mode: "off", action: "needs_fable", worker: null },
    });
    expect(jev.requests).toHaveLength(0);
    expect(jev.records).toHaveLength(0);
  });

  test("a parent decision stands as-is, with no thresholds applied", async () => {
    const jev = mockJev({});
    const result = await runDecide(
      [...ROUTE, "--fable-decision", "codex", "--fable-confidence", "0.1"],
      jev.deps({}),
    );
    expect(result).toMatchObject({
      output: { action: "auto", worker: "codex", decided_by: "fable" },
    });
    expect(jev.requests).toHaveLength(0);
  });
});

describe("decide: shadow", () => {
  test("runs Jev and logs its decision, but outputs only the parent's decision", async () => {
    const jev = mockJev({ worker: { choice: "composer", confidence: 0.9 } });
    const result = await runDecide(
      [...ROUTE, "--fable-decision", "codex", "--fable-confidence", "0.9"],
      jev.deps({ USE_JEV_DECISIONS: "shadow" }),
    );
    expect(result).toMatchObject({
      exitCode: 0,
      output: { mode: "shadow", shadow: true, action: "auto", worker: "codex", decided_by: "fable" },
    });
    if (result.exitCode !== 0) return;
    expect(result.output.jev).toBeUndefined();
    expect(jev.requests).toHaveLength(2);
    const gate = jev.records.find((record) => record.kind === "gate")!;
    expect(gate.agrees).toBe(false);
    expect(gate.gate).toMatchObject({ action: "auto", value: "composer", decidedBy: "jev" });
    expect(gate.applied).toMatchObject({ value: "codex", decidedBy: "fable" });
  });

  test("records agreement when Jev and the parent match", async () => {
    const jev = mockJev({ worker: { choice: "codex", confidence: 0.9 } });
    await runDecide(
      [...ROUTE, "--fable-decision", "codex", "--fable-confidence", "0.9"],
      jev.deps({ USE_JEV_DECISIONS: "shadow" }),
    );
    expect(jev.records.find((record) => record.kind === "gate")?.agrees).toBe(true);
  });

  test("a Jev failure in shadow never changes the output", async () => {
    const jev = mockJev({}, "InternalServerError");
    const result = await runDecide(ROUTE, jev.deps({ USE_JEV_DECISIONS: "shadow" }));
    expect(result).toMatchObject({ output: { action: "needs_fable", worker: null } });
  });
});

describe("decide route: on", () => {
  test("confident composer acts automatically with a composer-implement dispatch", async () => {
    const jev = mockJev({ worker: { choice: "composer", confidence: 0.9 } });
    const result = await runDecide(ROUTE, jev.deps({ USE_JEV_DECISIONS: "on" }));
    expect(result).toMatchObject({
      output: { action: "auto", worker: "composer", decided_by: "jev" },
    });
    if (result.exitCode !== 0) return;
    expect(String(result.output.dispatch)).toContain("--route composer-implement");
    expect(result.output.jev).toMatchObject({ worker: "composer", confidence: 0.9 });
  });

  test("confident codex carries the derived workload class", async () => {
    const jev = mockJev({ worker: { choice: "codex", confidence: 0.9 }, complexity: [4, 0.9] });
    const result = await runDecide(ROUTE, jev.deps({ USE_JEV_DECISIONS: "on" }));
    expect(result).toMatchObject({
      output: { action: "auto", worker: "codex", workload_class: "hard-medium" },
    });
    if (result.exitCode !== 0) return;
    expect(String(result.output.dispatch)).toContain("--workload-class hard-medium");
  });

  test("codex without a confident workload class goes back to Fable", async () => {
    const jev = mockJev({ worker: { choice: "codex", confidence: 0.9 }, complexity: [4, 0.5] });
    const result = await runDecide(ROUTE, jev.deps({ USE_JEV_DECISIONS: "on" }));
    expect(result).toMatchObject({
      output: { action: "needs_fable", worker: "codex", workload_class: null, dispatch: null },
    });
  });

  test("low confidence escalates to Fable; Fable below threshold flags a human", async () => {
    const jev = mockJev({ worker: { choice: "codex", confidence: 0.5 } });
    expect(await runDecide(ROUTE, jev.deps({ USE_JEV_DECISIONS: "on" }))).toMatchObject({
      output: { action: "needs_fable" },
    });
    expect(
      await runDecide(
        [...ROUTE, "--fable-decision", "fable", "--fable-confidence", "0.6"],
        jev.deps({ USE_JEV_DECISIONS: "on" }),
      ),
    ).toMatchObject({ output: { action: "needs_human", worker: "fable" } });
    expect(
      await runDecide(
        [...ROUTE, "--fable-decision", "fable", "--fable-confidence", "0.8"],
        jev.deps({ USE_JEV_DECISIONS: "on" }),
      ),
    ).toMatchObject({ output: { action: "auto", worker: "fable", decided_by: "fable" } });
  });

  test("risk >= 4 always requires a human", async () => {
    const jev = mockJev({ worker: { choice: "composer", confidence: 0.99 }, risk: [4.2, 0.9] });
    expect(await runDecide(ROUTE, jev.deps({ USE_JEV_DECISIONS: "on" }))).toMatchObject({
      output: { action: "needs_human", dispatch: null },
    });
  });

  test("Jev timeout falls back to the parent", async () => {
    const jev = mockJev({}, "APITimeoutError");
    expect(await runDecide(ROUTE, jev.deps({ USE_JEV_DECISIONS: "on" }))).toMatchObject({
      output: { action: "needs_fable", worker: null, reasons: ["Jev unavailable (timeout)"] },
    });
  });

  test("respects ROUTE_MIN_CONFIDENCE from config", async () => {
    const jev = mockJev({ worker: { choice: "composer", confidence: 0.9 } });
    expect(
      await runDecide(ROUTE, jev.deps({ USE_JEV_DECISIONS: "on", ROUTE_MIN_CONFIDENCE: "0.95" })),
    ).toMatchObject({ output: { action: "needs_fable" } });
  });
});

describe("decide assess: on", () => {
  test("returns the workload class and 1-5 scores", async () => {
    const jev = mockJev({ complexity: [3, 0.9], risk: [2, 0.9], specClarity: [4, 0.9] });
    const result = await runDecide(
      ["assess", "--task-json", "task.json"],
      jev.deps({ USE_JEV_DECISIONS: "on" }),
    );
    expect(result).toMatchObject({
      output: {
        action: "auto",
        workload_class: "medium-medium",
        scores: { complexity: { value: 3 }, risk: { value: 2 }, spec_clarity: { value: 4 } },
      },
    });
  });
});

describe("decide complete: on", () => {
  test("all checks pass -> accepted", async () => {
    const jev = mockJev({});
    expect(await runDecide(COMPLETE, jev.deps({ USE_JEV_DECISIONS: "on" }))).toMatchObject({
      output: { action: "auto", outcome: "accepted", decided_by: "jev" },
    });
  });

  test("scope check fails -> rejected", async () => {
    const jev = mockJev({ nouls: { inScope: 0.1 } });
    expect(await runDecide(COMPLETE, jev.deps({ USE_JEV_DECISIONS: "on" }))).toMatchObject({
      output: { action: "auto", outcome: "rejected" },
    });
  });

  test("needs-human-review > 0.6 requires a human", async () => {
    const jev = mockJev({ nouls: { needsHumanReview: 0.7 } });
    expect(await runDecide(COMPLETE, jev.deps({ USE_JEV_DECISIONS: "on" }))).toMatchObject({
      output: { action: "needs_human", outcome: null },
    });
  });

  test("uncertain checks go to Fable, and Fable's confident verdict is applied", async () => {
    const jev = mockJev({ nouls: { testsUpdated: 0.5 } });
    expect(await runDecide(COMPLETE, jev.deps({ USE_JEV_DECISIONS: "on" }))).toMatchObject({
      output: { action: "needs_fable" },
    });
    expect(
      await runDecide(
        [...COMPLETE, "--fable-decision", "accepted", "--fable-confidence", "0.9"],
        jev.deps({ USE_JEV_DECISIONS: "on" }),
      ),
    ).toMatchObject({ output: { action: "auto", outcome: "accepted", decided_by: "fable" } });
  });
});

describe("decide: argument validation", () => {
  const deps = mockJev({}).deps({});
  test.each([
    [["bogus"], "route, assess, or complete"],
    [["route"], "--task-json"],
    [["route", "--nope", "x"], "unknown decide option"],
    [["route", "--task-json"], "missing value"],
    [["route", "--task-json", "missing.json"], "could not be read"],
    [[...ROUTE, "--fable-decision", "codex"], "passed together"],
    [[...ROUTE, "--fable-decision", "codex", "--fable-confidence", "2"], "from 0 to 1"],
    [[...ROUTE, "--fable-decision", "gemini", "--fable-confidence", "1"], "composer, codex, or fable"],
    [["complete", "--task-json", "task.json"], "--worker-output and --diff"],
  ])("%p fails with %s", async (args, message) => {
    const result = await runDecide(args as string[], deps);
    expect(result.exitCode).toBe(2);
    if (result.exitCode === 2) expect(result.error).toContain(message);
  });
});

describe("prepareJevRun: run call site", () => {
  const RUN = ["run", "--mode", "implement", "--phase", "implement", "--task", "do it"];

  test("off leaves argv untouched and only strips the new options", async () => {
    const jev = mockJev({});
    expect(await prepareJevRun(RUN, jev.deps({}))).toEqual({
      argv: RUN,
      shadow: null,
      error: null,
      notes: [],
    });
    const prepared = await prepareJevRun([...RUN, "--task-json", "task.json"], jev.deps({}));
    expect(prepared.argv).toEqual(RUN);
    expect(jev.requests).toHaveLength(0);
  });

  test("non-run commands pass through", async () => {
    const jev = mockJev({});
    expect((await prepareJevRun(["runs", "--json"], jev.deps({}))).argv).toEqual(["runs", "--json"]);
  });

  test("shadow never changes argv and logs agreement with the parent's class", async () => {
    const jev = mockJev({ complexity: [3, 0.9] });
    const argv = [...RUN, "--workload-class", "medium-medium", "--task-json", "task.json"];
    const prepared = await prepareJevRun(argv, jev.deps({ USE_JEV_DECISIONS: "shadow" }));
    expect(prepared.argv).toEqual([...RUN, "--workload-class", "medium-medium"]);
    await prepared.shadow;
    const gate = jev.records.find((record) => record.kind === "gate")!;
    expect(gate).toMatchObject({ source: "run", applied: "medium-medium", agrees: true });
  });

  test("shadow with no parent class still does not inject one", async () => {
    const jev = mockJev({ complexity: [3, 0.9] });
    const prepared = await prepareJevRun(
      [...RUN, "--task-json", "task.json"],
      jev.deps({ USE_JEV_DECISIONS: "shadow" }),
    );
    expect(prepared.argv).toEqual(RUN);
    await prepared.shadow;
  });

  test("on fills a missing --workload-class from a confident assessment", async () => {
    const jev = mockJev({ complexity: [1.5, 0.9] });
    const prepared = await prepareJevRun(
      [...RUN, "--task-json", "task.json"],
      jev.deps({ USE_JEV_DECISIONS: "on" }),
    );
    expect(prepared.argv).toEqual([...RUN, "--workload-class", "easy-medium"]);
    expect(prepared.notes[0]).toContain("--workload-class easy-medium");
  });

  test("on keeps an explicit parent class", async () => {
    const jev = mockJev({ complexity: [5, 0.9] });
    const prepared = await prepareJevRun(
      [...RUN, "--workload-class", "easy-light", "--task-json", "task.json"],
      jev.deps({ USE_JEV_DECISIONS: "on" }),
    );
    expect(prepared.argv).toEqual([...RUN, "--workload-class", "easy-light"]);
    expect(jev.records.find((record) => record.kind === "gate")?.agrees).toBe(false);
  });

  test("on with low confidence leaves the class to the parent (existing failure path)", async () => {
    const jev = mockJev({ complexity: [3, 0.4] });
    const prepared = await prepareJevRun(
      [...RUN, "--task-json", "task.json"],
      jev.deps({ USE_JEV_DECISIONS: "on" }),
    );
    expect(prepared).toMatchObject({ argv: RUN, error: null });
    expect(prepared.notes[0]).toContain("the parent must pass one");
  });

  test("on with Jev down falls back to the parent", async () => {
    const jev = mockJev({}, "APIConnectionError");
    const prepared = await prepareJevRun(
      [...RUN, "--task-json", "task.json"],
      jev.deps({ USE_JEV_DECISIONS: "on" }),
    );
    expect(prepared).toMatchObject({ argv: RUN, error: null });
    expect(prepared.notes[0]).toContain("Jev unavailable (connection)");
  });

  test("on with risk >= 4 blocks the run until a human approves", async () => {
    const jev = mockJev({ risk: [4, 0.9] });
    const blocked = await prepareJevRun(
      [...RUN, "--workload-class", "easy-light", "--task-json", "task.json"],
      jev.deps({ USE_JEV_DECISIONS: "on" }),
    );
    expect(blocked.error).toContain("requires human approval");
    const approved = await prepareJevRun(
      [...RUN, "--workload-class", "easy-light", "--task-json", "task.json", "--human-approved", "true"],
      jev.deps({ USE_JEV_DECISIONS: "on" }),
    );
    expect(approved).toMatchObject({ argv: [...RUN, "--workload-class", "easy-light"], error: null });
  });

  test("only automatic implement runs are assessed", async () => {
    const jev = mockJev({});
    for (const extra of [["--route", "composer-implement"], ["--backend", "codex"], ["--orchestrator", "eco"]]) {
      const prepared = await prepareJevRun(
        [...RUN, ...extra, "--task-json", "task.json"],
        jev.deps({ USE_JEV_DECISIONS: "on" }),
      );
      expect(prepared.argv).toEqual([...RUN, ...extra]);
    }
    expect(jev.requests).toHaveLength(0);
  });

  test("the new options require values", async () => {
    const jev = mockJev({});
    expect((await prepareJevRun([...RUN, "--task-json"], jev.deps({}))).error).toContain(
      "missing value for --task-json",
    );
    expect(
      (await prepareJevRun(["run", "--task-json", "--mode", "implement"], jev.deps({}))).error,
    ).toContain("missing value for --task-json");
  });

  test("--human-approved must be true", async () => {
    const jev = mockJev({});
    expect(
      (await prepareJevRun([...RUN, "--human-approved", "yes"], jev.deps({}))).error,
    ).toContain("must be true");
  });
});

describe("decide: CLI entry point", () => {
  test("prints the off-mode decision as JSON without contacting Jev", () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-cli-"));
    try {
      const taskPath = join(dir, "task.json");
      writeFileSync(taskPath, JSON.stringify(TASK));
      const env = { ...process.env, ARC_ORCHESTRATOR_TRACE_DIR: dir };
      delete env.USE_JEV_DECISIONS;
      const result = Bun.spawnSync(
        ["bun", "plugins/arc-orchestrator/bin/arc-orchestrator", "decide", "route", "--task-json", taskPath],
        { env },
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toMatchObject({
        decision: "route",
        mode: "off",
        action: "needs_fable",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("usage errors exit 2", () => {
    const result = Bun.spawnSync(["bun", "plugins/arc-orchestrator/bin/arc-orchestrator", "decide", "bogus"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("decide requires route, assess, or complete");
  });
});
