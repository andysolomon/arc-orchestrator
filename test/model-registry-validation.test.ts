import { describe, expect, test } from "bun:test";
import {
  CANDIDATE_STACKS,
  MODEL_REGISTRY,
  MODEL_REGISTRY_ERROR,
  validateModelRegistry,
  type CandidateStack,
  type ModelRegistryEntry,
} from "../plugins/arc-orchestrator/lib/model-registry";

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

  test("rule 2 rejects case-insensitive alias collision", () => {
    const first = cloneEntry("composer-2.5", () => {});
    const second = cloneEntry("gpt-5.6-luna", (entry) => {
      entry.aliases = ["COMPOSER-2.5"];
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

  test("rule 5 rejects unknown sandbox value as data", () => {
    const entry = cloneEntry("composer-2.5", (candidate) => {
      candidate.sandboxPermissionSupport = [
        "workspace-write",
        "danger-full-access" as "workspace-write",
      ];
    });
    const result = validateModelRegistry([entry], []);
    expectRuleError(result, MODEL_REGISTRY_ERROR.UNKNOWN_SANDBOX_VALUE);
  });

  test("rule 6 rejects stack candidate that is not route-eligible", () => {
    const registry = MODEL_REGISTRY.map((entry) => {
      if (entry.stableId !== "fable-5") return entry;
      return {
        ...entry,
        routeEligibility: entry.routeEligibility.filter(
          (route) => route !== "implement.workspace-write.v1",
        ),
      };
    });
    const result = validateModelRegistry(registry, cloneStacks(() => {}));
    expectRuleError(result, MODEL_REGISTRY_ERROR.STACK_CANDIDATE_NOT_ELIGIBLE);
  });

  test("rule 6 rejects role-restricted candidate in automatic-fallback stack", () => {
    const entry = cloneEntry("gpt-5.6-sol", (candidate) => {
      candidate.roleRestriction = "explicit-parent-authorization";
    });
    const stacks = cloneStacks((candidateStacks) => {
      const medium = candidateStacks.find(
        (stack) =>
          stack.route === "implement.workspace-write.v1" &&
          stack.workloadClass === "medium-medium",
      );
      medium?.candidates.push("gpt-5.6-sol");
    });
    const result = validateModelRegistry(
      MODEL_REGISTRY.map((item) =>
        item.stableId === "gpt-5.6-sol" ? entry : item,
      ),
      stacks,
    );
    expectRuleError(
      result,
      MODEL_REGISTRY_ERROR.ROLE_RESTRICTED_AUTOMATIC_FALLBACK,
    );
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
    const entry = cloneEntry("haiku-4.5", (candidate) => {
      candidate.routeEligibility = ["explore.read-only.v1"];
    });
    const result = validateModelRegistry([entry], []);
    expectRuleError(result, MODEL_REGISTRY_ERROR.PLANNED_ROUTE_ELIGIBLE);
  });

  test("rule 9 rejects parent-only entry with any route eligibility", () => {
    const entry = cloneEntry("composer-2.5", (candidate) => {
      candidate.roleRestriction = "parent-only";
      candidate.routeEligibility = ["taste-review.read-only.v1"];
    });
    const result = validateModelRegistry([entry], []);
    expectRuleError(result, MODEL_REGISTRY_ERROR.PARENT_ONLY_ROUTE_ELIGIBLE);
  });

  test("rule 10 (former GLM exclusion) is lifted for provider-qualified OpenCode Go identities", () => {
    const entry = cloneEntry("opencode-go-glm-5.2", () => {});
    const result = validateModelRegistry([entry], []);
    expect(result.ok).toBe(true);
    expect("GLM_EXCLUSION" in MODEL_REGISTRY_ERROR).toBe(false);
  });

  test("rule 11 accepts approved OpenCode Go GLM 5.3 and GLM 5.3 Flash entries", () => {
    for (const stableId of ["opencode-go-glm-5.3", "opencode-go-glm-5.3-flash"]) {
      const entry = cloneEntry(stableId, () => {});
      const result = validateModelRegistry([entry], []);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    }
  });

  test("rule 11 rejects direct GLM entry with non-OpenCode transport", () => {
    const entry = cloneEntry("composer-2.5", (candidate) => {
      candidate.stableId = "glm-5.3";
      candidate.family = "glm";
      candidate.displayName = "GLM 5.3";
      candidate.providerModelId = "glm-5.3";
      candidate.aliases = [];
    });
    const result = validateModelRegistry([entry], []);
    expectRuleError(result, MODEL_REGISTRY_ERROR.GLM_PROVIDER_BOUNDARY);
    expect(
      result.errors.some((error) => error.includes("providerModelId must be opencode-go/glm-*")),
    ).toBe(true);
    expect(
      result.errors.some((error) => error.includes("transportBackend must be opencode")),
    ).toBe(true);
  });

  test("rule 11 rejects GLM entry with wrong backend", () => {
    const entry = cloneEntry("opencode-go-glm-5.3", (candidate) => {
      candidate.transportBackend = "codex";
      candidate.adapterId = "codex-exec";
    });
    const result = validateModelRegistry([entry], []);
    expectRuleError(result, MODEL_REGISTRY_ERROR.GLM_PROVIDER_BOUNDARY);
    expect(
      result.errors.some((error) => error.includes("transportBackend must be opencode")),
    ).toBe(true);
  });

  test("rule 11 rejects GLM entry with wrong adapter", () => {
    const entry = cloneEntry("opencode-go-glm-5.3", (candidate) => {
      candidate.adapterId = "cursor-agent";
    });
    const result = validateModelRegistry([entry], []);
    expectRuleError(result, MODEL_REGISTRY_ERROR.GLM_PROVIDER_BOUNDARY);
    expect(
      result.errors.some((error) => error.includes("adapterId must be opencode")),
    ).toBe(true);
  });

  test("rule 11 rejects GLM entry with wrong serving provider", () => {
    const entry = cloneEntry("opencode-go-glm-5.3", (candidate) => {
      candidate.servingProvider = "Zhipu AI";
    });
    const result = validateModelRegistry([entry], []);
    expectRuleError(result, MODEL_REGISTRY_ERROR.GLM_PROVIDER_BOUNDARY);
    expect(
      result.errors.some((error) => error.includes("servingProvider must be OpenCode Go")),
    ).toBe(true);
  });

  test("rule 11 rejects GLM entry with malformed provider model id", () => {
    const entry = cloneEntry("opencode-go-glm-5.3", (candidate) => {
      candidate.providerModelId = "opencode-go/not-glm";
    });
    const result = validateModelRegistry([entry], []);
    expectRuleError(result, MODEL_REGISTRY_ERROR.GLM_PROVIDER_BOUNDARY);
    expect(
      result.errors.some((error) => error.includes("providerModelId must be opencode-go/glm-*")),
    ).toBe(true);
  });

  test("rule 11 rejects provider-model-id-only GLM entry on the composer path", () => {
    const entry = cloneEntry("composer-2.5", (candidate) => {
      candidate.stableId = "bulk-implementer";
      candidate.family = "composer";
      candidate.displayName = "Bulk Implementer";
      candidate.aliases = [];
      candidate.providerModelId = "opencode-go/glm-5.3";
    });
    const result = validateModelRegistry([entry], []);
    expectRuleError(result, MODEL_REGISTRY_ERROR.GLM_PROVIDER_BOUNDARY);
    expect(
      result.errors.some((error) =>
        error.includes("transportBackend must be opencode"),
      ),
    ).toBe(true);
    expect(
      result.errors.some((error) => error.includes("adapterId must be opencode")),
    ).toBe(true);
    expect(
      result.errors.some((error) =>
        error.includes("servingProvider must be OpenCode Go"),
      ),
    ).toBe(true);
    expect(
      result.errors.some((error) =>
        error.includes("stableId must be opencode-go-glm-5.3"),
      ),
    ).toBe(true);
  });

  test("rule 11 rejects provider-model-id-only GLM entry on the codex path", () => {
    const entry = cloneEntry("gpt-5.6-luna", (candidate) => {
      candidate.stableId = "cheap-explorer";
      candidate.family = "gpt";
      candidate.displayName = "Cheap Explorer";
      candidate.aliases = [];
      candidate.providerModelId = "opencode-go/glm-5.3-flash";
    });
    const result = validateModelRegistry([entry], []);
    expectRuleError(result, MODEL_REGISTRY_ERROR.GLM_PROVIDER_BOUNDARY);
    expect(
      result.errors.some((error) =>
        error.includes("transportBackend must be opencode"),
      ),
    ).toBe(true);
    expect(
      result.errors.some((error) =>
        error.includes("stableId must be opencode-go-glm-5.3-flash"),
      ),
    ).toBe(true);
  });

  test("rule 11 rejects GLM identity whose stableId drifts from the provider id", () => {
    const entry = cloneEntry("opencode-go-glm-5.3", (candidate) => {
      candidate.stableId = "opencode-go-glm-5.3-alias";
    });
    const result = validateModelRegistry([entry], []);
    expectRuleError(result, MODEL_REGISTRY_ERROR.GLM_PROVIDER_BOUNDARY);
    expect(
      result.errors.some((error) =>
        error.includes("stableId must be opencode-go-glm-5.3"),
      ),
    ).toBe(true);
  });

  test("rule 11 accepts every approved OpenCode Go GLM registry entry", () => {
    const approved = MODEL_REGISTRY.filter((entry) =>
      entry.stableId.startsWith("opencode-go-glm-"),
    );
    expect(approved.length).toBeGreaterThan(0);
    for (const entry of approved) {
      const result = validateModelRegistry([cloneEntry(entry.stableId, () => {})], []);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    }
  });

  test("rule 11 rejects GLM stack candidate that violates the provider boundary", () => {
    const entry = cloneEntry("opencode-go-glm-5.3", (candidate) => {
      candidate.providerModelId = "glm-5.3";
      candidate.transportBackend = "codex";
      candidate.adapterId = "codex-exec";
    });
    const stacks = cloneStacks((candidateStacks) => {
      const easyLight = candidateStacks.find(
        (stack) =>
          stack.route === "implement.workspace-write.v1" &&
          stack.workloadClass === "easy-light",
      );
      if (easyLight) {
        easyLight.candidates = [entry.stableId, ...easyLight.candidates];
        easyLight.rungs = [
          { stableId: entry.stableId, effort: "none" },
          ...(easyLight.rungs ?? []),
        ];
      }
    });
    const result = validateModelRegistry(
      MODEL_REGISTRY.map((item) =>
        item.stableId === entry.stableId ? entry : item,
      ),
      stacks,
    );
    expectRuleError(result, MODEL_REGISTRY_ERROR.GLM_PROVIDER_BOUNDARY);
  });

  test("rule 11 preserves planned non-routable GLM inventory", () => {
    const entry: ModelRegistryEntry = {
      ...cloneEntry("haiku-4.5", () => {}),
      stableId: "glm-5.4-planned",
      family: "glm",
      displayName: "GLM 5.4 (planned)",
      maturity: "planned",
      routeEligibility: [],
      providerModelId: null,
      transportBackend: null,
      adapterId: null,
      servingProvider: null,
      aliases: [],
    };
    const result = validateModelRegistry([entry], []);
    expect(result.ok).toBe(true);
  });
});
