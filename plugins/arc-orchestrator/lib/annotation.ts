// The parent model's judgment of a completed worker run, recorded after the
// fact and joined to the run by run_id.
export type Outcome =
  | "accepted"
  | "rejected"
  | "blocked"
  | "verification-failed"
  | "escalated";

export type AnnotationRecord = {
  schema: number;
  run_id: string;
  timestamp: string;
  outcome: Outcome;
  escalated_to: string | null;
  note: string | null;
};

export const ANNOTATION_SCHEMA_VERSION = 1;

export const OUTCOMES: Outcome[] = [
  "accepted",
  "rejected",
  "blocked",
  "verification-failed",
  "escalated",
];
