import { describe, expect, test } from "bun:test";
import {
  ANNOTATION_SCHEMA_VERSION,
  OUTCOMES,
  type AnnotationRecord,
  type Outcome,
} from "../plugins/arc-orchestrator/lib/annotation";

const EXPECTED_OUTCOMES: Outcome[] = [
  "accepted",
  "rejected",
  "blocked",
  "verification-failed",
  "escalated",
];

describe("annotation shared exports", () => {
  test("exposes schema version 1 and the annotate CLI outcome vocabulary", () => {
    expect(ANNOTATION_SCHEMA_VERSION).toBe(1);
    expect([...OUTCOMES]).toEqual(EXPECTED_OUTCOMES);
  });

  test("AnnotationRecord shape matches annotations.jsonl fields", () => {
    const sample: AnnotationRecord = {
      schema: ANNOTATION_SCHEMA_VERSION,
      run_id: "run-1",
      timestamp: "2026-07-26T00:00:00.000Z",
      outcome: "accepted",
      escalated_to: null,
      note: null,
    };
    expect(OUTCOMES).toContain(sample.outcome);
    expect(sample.schema).toBe(ANNOTATION_SCHEMA_VERSION);
  });
});
