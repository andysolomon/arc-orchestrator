import { describe, expect, test } from "bun:test";
import {
  extractClaudeResult,
  extractComposerResult,
  stripCodeFences,
  validateResult,
} from "../plugins/fable-orchestrator/lib/envelope";

const validResult = {
  status: "completed",
  summary: "done",
  changes: ["src/app.ts"],
  verification: [],
  risks: [],
  next_actions: [],
};

describe("engine/envelope: validateResult", () => {
  test("accepts completed and blocked results", () => {
    expect(() => validateResult(validResult)).not.toThrow();
    expect(() =>
      validateResult({ ...validResult, status: "blocked" }),
    ).not.toThrow();
  });

  test("rejects non-object and array values", () => {
    expect(() => validateResult(null)).toThrow("result is not an object");
    expect(() => validateResult("nope")).toThrow("result is not an object");
    expect(() => validateResult([validResult])).toThrow(
      "result is not an object",
    );
  });

  test("rejects an invalid status", () => {
    expect(() => validateResult({ ...validResult, status: "done" })).toThrow(
      "result.status is invalid",
    );
  });

  test("rejects a non-string summary", () => {
    expect(() => validateResult({ ...validResult, summary: 1 })).toThrow(
      "result.summary is invalid",
    );
  });

  test("rejects array fields that are missing or hold non-strings", () => {
    expect(() =>
      validateResult({ ...validResult, changes: "src/app.ts" }),
    ).toThrow("result.changes is invalid");
    expect(() =>
      validateResult({ ...validResult, next_actions: [1, 2] }),
    ).toThrow("result.next_actions is invalid");
  });
});

describe("engine/envelope: stripCodeFences", () => {
  test("strips language-tagged and plain fences, leaves bare text", () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFences("```\nplain\n```")).toBe("plain");
    expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe("engine/envelope: extractComposerResult", () => {
  test("returns a result embedded directly on the envelope", () => {
    expect(extractComposerResult({ ...validResult })).toEqual(validResult);
  });

  test("parses a fenced JSON result string", () => {
    const envelope = {
      is_error: false,
      result: `\`\`\`json\n${JSON.stringify(validResult)}\n\`\`\``,
    };
    expect(extractComposerResult(envelope)).toEqual(validResult);
  });

  test("recovers the JSON object when prose precedes it", () => {
    const envelope = {
      result: `Here is my summary of the work.\n${JSON.stringify(validResult)}`,
    };
    expect(extractComposerResult(envelope)).toEqual(validResult);
  });

  test("returns the last valid embedded object when several appear", () => {
    const second = { ...validResult, summary: "second" };
    const envelope = {
      result: `${JSON.stringify(validResult)} then ${JSON.stringify(second)}`,
    };
    expect(extractComposerResult(envelope)).toEqual(second);
  });

  test("throws with worktree-inspection guidance when no result is present", () => {
    expect(() => extractComposerResult({ result: "not json" })).toThrow(
      "inspect the worktree",
    );
  });
});

describe("engine/envelope: extractClaudeResult", () => {
  test("reads structured_output and structuredOutput objects", () => {
    expect(
      extractClaudeResult({ structured_output: { ...validResult } }),
    ).toEqual(validResult);
    expect(
      extractClaudeResult({ structuredOutput: { ...validResult } }),
    ).toEqual(validResult);
  });

  test("parses a fenced structured_output string", () => {
    const envelope = {
      structured_output: `\`\`\`json\n${JSON.stringify(validResult)}\n\`\`\``,
    };
    expect(extractClaudeResult(envelope)).toEqual(validResult);
  });

  test("falls back to the composer extraction on the result field", () => {
    const envelope = { result: JSON.stringify(validResult) };
    expect(extractClaudeResult(envelope)).toEqual(validResult);
  });
});
