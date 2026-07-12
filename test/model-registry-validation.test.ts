import { describe, expect, test } from "bun:test";
import {
  CANDIDATE_STACKS,
  MODEL_REGISTRY,
  MODEL_REGISTRY_ERROR,
  validateModelRegistry,
  type CandidateStack,
  type ModelRegistryEntry,
} from "../plugins/fable-orchestrator/lib/model-registry";

function cloneEntry(
  stableId: string,
  mutate: (entry: ModelRegistryEntry) => void,
): ModelRegistryEntry {
  const source = MODEL_REGISTRY.find((entry) => entry.stableId === stableId);
  if (!source) {
    throw new Error(`Missing fixture source: ${stableId}`);
  }
  const copy = JSON.parse(JSON.stringify(source)) as ModelRegistryEntry;
  mutate(copy);
  return copy;
}

function cloneStacks(
  mutate?: (stacks: CandidateStack[]) => void,
): CandidateStack[] {
  const stacks = JSON.parse(
    JSON.stringify([...CANDIDATE_STACKS]),
  ) as CandidateStack[];
  mutate?.(stacks);
  return stacks;
}

function expectRuleError(
  result: { ok: boolean; errors: string[] },
  rule: string,
): void {
  expect(result.ok).toBe(false);
  expect(result.errors.some((error) => error.includes(rule))).toBe(true);
}

describe("model-registry: validation rules", () => {
  test("runnable entry with full evidence passes", () => {
    const entries = [cloneEntry("composer-2.5", () => {})];
    const result = validateModelRegistry(entries, []);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("rule 1 rejects duplicate stableId", () => {
    const duplicate = cloneEntry("composer-2.5", () => {});
    const result = validateModelRegistry(
      [duplicate, JSON.parse(JSON.stringify(duplicate)) as ModelRegistryEntry],
      [],
    );
    expectRuleError(result, MODEL_REGISTRY_ERROR.DUPLICATE_STABLE_ID);
  });

  test("rule 2 rejects ambiguous alias", () => {
    const first = cloneEntry("composer-2.5", () => {});
    const second = cloneEntry("gpt-5.6-luna", (entry) => {
      entry.aliases = ["Composer 2.5"];
    });
    const result = validateModelRegistry([first, second], []);
    expectRuleError(result, MODEL_REGISTRY_ERROR.AMBIGUOUS_ALIAS);
  });

  test("rule 3 rejects unknown route version on entry eligibility", () => {
    const entry = cloneEntry("composer-2.5", (candidate) => {
      candidate.routeEligibility = [
        "implement.workspace-write.v2" as "implement.workspace-write.v1",
      ];
    });
    const result = validateModelRegistry([entry], []);
    expectRuleError(result, MODEL_REGISTRY_ERROR.UNKNOWN_ROUTE_VERSION);
  });

  test("rule 3 rejects unknown route version on stack route", () => {
    const stacks = cloneStacks((candidateStacks) => {
      candidateStacks[0] = {
        ...candidateStacks[0],
        route: "implement.workspace-write.v2" as "implement.workspace-write.v1",
      };
    });
    const result = validateModelRegistry([...MODEL_REGISTRY], stacks);
    expectRuleError(result, MODEL_REGISTRY_ERROR.UNKNOWN_ROUTE_VERSION);
  });

  test("rule 4 rejects unknown output-contract version", () => {
    const entry = cloneEntry("composer-2.5", (candidate) => {
      candidate.outputContracts = [
        "implementation-result.v2" as "implementation-result.v1",
      ];
    });
    const result = validateModelRegistry([entry], []);
    expectRuleError(result, MODEL_REGISTRY_ERROR.UNKNOWN_OUTPUT_CONTRACT);
  });

  test("rule 5 rejects unsupported sandbox claim", () => {
    const entry = cloneEntry("composer-2.5", (candidate) => {
      candidate.sandboxPermissionSupport = ["read-only"];
    });
    const result = validateModelRegistry([entry], []);
    expectRuleError(result, MODEL_REGISTRY_ERROR.UNSUPPORTED_SANDBOX_CLAIM);
  });

  test("rule 6 rejects duplicate candidate within one stack", () => {
    const stacks = cloneStacks((candidateStacks) => {
      candidateStacks[0] = {
        ...candidateStacks[0],
        candidates: ["composer-2.5", "composer-2.5"],
      };
    });
    const result = validateModelRegistry([...MODEL_REGISTRY], stacks);
    expectRuleError(result, MODEL_REGISTRY_ERROR.FALLBACK_CYCLE);
  });

  test("rule 6 rejects unknown stack candidate", () => {
    const stacks = cloneStacks((candidateStacks) => {
      candidateStacks[0] = {
        ...candidateStacks[0],
        candidates: ["missing-model"],
      };
    });
    const result = validateModelRegistry([...MODEL_REGISTRY], stacks);
    expectRuleError(result, MODEL_REGISTRY_ERROR.FALLBACK_CYCLE);
  });

  test("rule 7 rejects runnable entry missing evidence", () => {
    const entry = cloneEntry("composer-2.5", (candidate) => {
      candidate.evidence = null;
    });
    const result = validateModelRegistry([entry], []);
    expectRuleError(result, MODEL_REGISTRY_ERROR.RUNNABLE_MISSING_EVIDENCE);
  });

  test("rule 8 rejects planned entry with route eligibility", () => {
    const entry = cloneEntry("grok-4.5", (candidate) => {
      candidate.routeEligibility = ["explore.read-only.v1"];
    });
    const result = validateModelRegistry([entry], []);
    expectRuleError(result, MODEL_REGISTRY_ERROR.PLANNED_ROUTE_ELIGIBLE);
  });

  test("rule 9 rejects parent-only entry with route eligibility", () => {
    const entry = cloneEntry("fable-5", (candidate) => {
      candidate.routeEligibility = ["explore.read-only.v1"];
    });
    const result = validateModelRegistry([entry], []);
    expectRuleError(result, MODEL_REGISTRY_ERROR.PARENT_ONLY_ROUTE_ELIGIBLE);
  });

  test("rule 10 rejects glm in stableId", () => {
    const entry = cloneEntry("composer-2.5", (candidate) => {
      candidate.stableId = "glm-5.2";
    });
    const result = validateModelRegistry([entry], []);
    expectRuleError(result, MODEL_REGISTRY_ERROR.GLM_EXCLUSION);
  });
});
