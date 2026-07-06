import type { OrchestratorSurface } from "./prompt-factory";

export type SurfaceFeatureStatus =
  | { kind: "required"; path: string }
  | { kind: "intentional-difference"; rationale: string };

export type FeatureMatrixEntry = {
  id: string;
  name: string;
  surfaces: Record<OrchestratorSurface, SurfaceFeatureStatus>;
};

export type ParentModelDefault = {
  surface: OrchestratorSurface;
  defaultParent: "fable" | "codex-5.5";
  assertionPaths: string[];
};

/** Checked-in cross-surface feature parity matrix. Tests in test/feature-parity.test.ts enforce it. */
export const FEATURE_MATRIX: FeatureMatrixEntry[] = [
  {
    id: "orchestrate",
    name: "Orchestrate skill / prompt",
    surfaces: {
      claude: {
        kind: "required",
        path: "plugins/fable-orchestrator/skills/orchestrate/SKILL.md",
      },
      cursor: {
        kind: "required",
        path: "plugins/cursor-orchestrator/skills/orchestrate/SKILL.md",
      },
      pi: {
        kind: "required",
        path: "plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md",
      },
      copilot: {
        kind: "required",
        path: "plugins/copilot-orchestrator/prompts/orchestrate.prompt.md",
      },
    },
  },
  {
    id: "prompt-factory",
    name: "Prompt factory skill",
    surfaces: {
      claude: {
        kind: "required",
        path: "plugins/fable-orchestrator/skills/prompt-factory/SKILL.md",
      },
      cursor: {
        kind: "required",
        path: "plugins/cursor-orchestrator/skills/prompt-factory/SKILL.md",
      },
      pi: {
        kind: "intentional-difference",
        rationale:
          "Pi is Codex-first and reuses docs/orchestrator slash commands for durable prompt generation; it does not ship a dedicated prompt-factory skill.",
      },
      copilot: {
        kind: "intentional-difference",
        rationale:
          "Copilot uses checked-in prompt templates under plugins/copilot-orchestrator/prompts/ rather than a prompt-factory skill surface.",
      },
    },
  },
  {
    id: "setup",
    name: "Setup / doctor skill",
    surfaces: {
      claude: {
        kind: "required",
        path: "plugins/fable-orchestrator/skills/setup/SKILL.md",
      },
      cursor: {
        kind: "required",
        path: "plugins/cursor-orchestrator/skills/setup/SKILL.md",
      },
      pi: {
        kind: "intentional-difference",
        rationale:
          "Pi declares the shared runner via package.json; backend authentication is the user's local responsibility and is not wrapped in a Pi setup skill.",
      },
      copilot: {
        kind: "intentional-difference",
        rationale:
          "Copilot setup guidance lives inline in copilot-instructions.md; there is no separate setup skill artifact.",
      },
    },
  },
  {
    id: "observability",
    name: "Observability skill",
    surfaces: {
      claude: {
        kind: "required",
        path: "plugins/fable-orchestrator/skills/observability/SKILL.md",
      },
      cursor: {
        kind: "required",
        path: "plugins/cursor-orchestrator/skills/observability/SKILL.md",
      },
      pi: {
        kind: "intentional-difference",
        rationale:
          "Pi covers basic runs inspection inline in the arc-orchestrator skill; it does not ship a dedicated observability skill with Laminar boundaries.",
      },
      copilot: {
        kind: "intentional-difference",
        rationale:
          "Copilot documents observability inline in copilot-instructions.md; there is no separate observability skill artifact.",
      },
    },
  },
  {
    id: "direct-worker",
    name: "Direct worker escape hatch",
    surfaces: {
      claude: {
        kind: "required",
        path: "plugins/fable-orchestrator/skills/direct-worker/SKILL.md",
      },
      cursor: {
        kind: "required",
        path: "plugins/cursor-orchestrator/skills/direct-worker/SKILL.md",
      },
      pi: {
        kind: "intentional-difference",
        rationale:
          "Pi delegates through explicit fable-orchestrator CLI commands in arc-orchestrator; it has no auto-mode direct-worker escape hatch.",
      },
      copilot: {
        kind: "intentional-difference",
        rationale:
          "Copilot invokes workers through explicit prompt templates; it has no direct-worker escape hatch for auto-mode classification blocks.",
      },
    },
  },
  {
    id: "opus-review",
    name: "Opus / high-taste review worker",
    surfaces: {
      claude: {
        kind: "required",
        path: "plugins/fable-orchestrator/agents/opus-review.md",
      },
      cursor: {
        kind: "required",
        path: "plugins/cursor-orchestrator/skills/opus-review/SKILL.md",
      },
      pi: {
        kind: "intentional-difference",
        rationale:
          "Pi is Codex-first; high-taste review is routed through codex/review rather than an Opus 4.8 worker surface.",
      },
      copilot: {
        kind: "intentional-difference",
        rationale:
          "Copilot is Codex-first; review.prompt.md routes through codex/review rather than an Opus 4.8 worker surface.",
      },
    },
  },
  {
    id: "claude-fallback-backend",
    name: "Claude (Opus 4.8) availability fallback backend",
    surfaces: {
      claude: {
        kind: "required",
        path: "plugins/fable-orchestrator/skills/claude-runtime/SKILL.md",
      },
      cursor: {
        kind: "required",
        path: "plugins/cursor-orchestrator/skills/direct-worker/SKILL.md",
      },
      pi: {
        kind: "required",
        path: "plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md",
      },
      copilot: {
        kind: "required",
        path: "plugins/copilot-orchestrator/copilot-instructions.md",
      },
    },
  },
  {
    id: "fallback-retry",
    name: "Opt-in automatic fallback retry",
    surfaces: {
      claude: {
        kind: "required",
        path: "plugins/fable-orchestrator/skills/orchestrate/references/routing-policy.md",
      },
      cursor: {
        kind: "required",
        path: "plugins/cursor-orchestrator/skills/orchestrate/SKILL.md",
      },
      pi: {
        kind: "required",
        path: "plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md",
      },
      copilot: {
        kind: "required",
        path: "plugins/copilot-orchestrator/copilot-instructions.md",
      },
    },
  },
  {
    id: "doctor-claude-readiness",
    name: "Doctor Claude backend readiness",
    surfaces: {
      claude: {
        kind: "required",
        path: "plugins/fable-orchestrator/skills/setup/SKILL.md",
      },
      cursor: {
        kind: "required",
        path: "plugins/cursor-orchestrator/skills/setup/SKILL.md",
      },
      pi: {
        kind: "intentional-difference",
        rationale:
          "Pi declares the shared runner via package.json; backend authentication is the user's local responsibility and is not wrapped in a Pi setup skill.",
      },
      copilot: {
        kind: "intentional-difference",
        rationale:
          "Copilot setup guidance lives inline in copilot-instructions.md; there is no separate setup skill artifact.",
      },
    },
  },
  {
    id: "opus-availability-workers",
    name: "Opus availability-fallback workers",
    surfaces: {
      claude: {
        kind: "required",
        path: "plugins/fable-orchestrator/agents/opus-explore.md",
      },
      cursor: {
        kind: "intentional-difference",
        rationale:
          "Cursor has no thin opus-* Agent wrappers; availability fallback is reached through direct runner invocation (--backend claude) in the direct-worker skill.",
      },
      pi: {
        kind: "intentional-difference",
        rationale:
          "Pi has no opus-* worker agents; availability fallback is reached through explicit fable-orchestrator run --backend claude commands in arc-orchestrator.",
      },
      copilot: {
        kind: "intentional-difference",
        rationale:
          "Copilot has no opus-* worker agents; availability fallback is reached through explicit fable-orchestrator run --backend claude commands documented in copilot-instructions.md.",
      },
    },
  },
  {
    id: "parent-model-default",
    name: "Parent model default policy",
    surfaces: {
      claude: {
        kind: "required",
        path: "plugins/fable-orchestrator/skills/orchestrate/SKILL.md",
      },
      cursor: {
        kind: "required",
        path: "plugins/cursor-orchestrator/skills/orchestrate/SKILL.md",
      },
      pi: {
        kind: "required",
        path: "plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md",
      },
      copilot: {
        kind: "required",
        path: "plugins/copilot-orchestrator/copilot-instructions.md",
      },
    },
  },
];

/** Default parent orchestrator per surface. Enforced by content assertions in feature-parity tests. */
export const PARENT_MODEL_DEFAULTS: ParentModelDefault[] = [
  {
    surface: "claude",
    defaultParent: "fable",
    assertionPaths: ["plugins/fable-orchestrator/skills/orchestrate/SKILL.md"],
  },
  {
    surface: "cursor",
    defaultParent: "fable",
    assertionPaths: [
      "plugins/cursor-orchestrator/rules/orchestrator.mdc",
      "plugins/cursor-orchestrator/skills/orchestrate/SKILL.md",
    ],
  },
  {
    surface: "pi",
    defaultParent: "codex-5.5",
    assertionPaths: ["plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md"],
  },
  {
    surface: "copilot",
    defaultParent: "codex-5.5",
    assertionPaths: ["plugins/copilot-orchestrator/copilot-instructions.md"],
  },
];
