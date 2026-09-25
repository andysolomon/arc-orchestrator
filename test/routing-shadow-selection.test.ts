import { describe, expect, test } from "bun:test";
import {
  ROUTE_SELECTION_STAGE_ENV,
} from "../plugins/arc-orchestrator/lib/selection-activation";
import { resolveRoutingShadow } from "../plugins/arc-orchestrator/lib/routing-shadow";

const NOW_MS = Date.parse("2026-07-25T00:00:00Z");

const shadowEnv = {
  [ROUTE_SELECTION_STAGE_ENV]: "shadow",
};

describe("routing-shadow capability selection: opt-in", () => {
  test("shadow stage without configured snapshot does not invent evidence", () => {
    const report = resolveRoutingShadow({
      requestedAlias: "composer-implement",
      env: shadowEnv,
      nowMs: NOW_MS,
      pinAlias: false,
      workloadClass: "medium-medium",
    });
    expect(report.capabilityShadow?.ran).toBe(false);
    expect(report.capabilityShadow?.skipReason).toBe("snapshot-absent");
  });
});
