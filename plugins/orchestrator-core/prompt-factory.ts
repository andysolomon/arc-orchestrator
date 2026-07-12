export type OrchestratorSurface = "claude" | "cursor" | "pi" | "copilot";
export type OrchestratorRoute =
  | "codex/analyze"
  | "codex/implement"
  | "codex/review"
  | "composer/implement";

export type PromptFactoryInput = {
  surface: OrchestratorSurface;
  route: OrchestratorRoute;
  outcome: string;
  scope: string[];
  invariants: string[];
  verification: string[];
  prohibitions?: string[];
  label: string;
};

export type PromptFileRecommendation = {
  file: string;
  route: OrchestratorRoute;
  purpose: string;
};

const DEFAULT_PROHIBITIONS = [
  "Do not commit, push, merge, deploy, or edit secrets.",
  "Do not touch unrelated files or perform broad refactors outside the stated scope.",
];

const SURFACE_INTROS: Record<OrchestratorSurface, string> = {
  claude:
    "Use the Claude Code Fable orchestrator plugin. Fable owns planning, ambiguity resolution, final judgment, and user communication.",
  cursor:
    "Use the Cursor Fable orchestrator plugin. Fable in Cursor is the default/recommended parent orchestrator; planning, ambiguity resolution, final judgment, and user communication stay in the parent Cursor chat.",
  pi: "Use the Pi ARC orchestrator package. Codex 5.6 Sol is the default parent orchestrator; Fable is not required.",
  copilot:
    "Use the GitHub Copilot ARC orchestrator prompt surface. Codex 5.6 Terra is the default parent orchestrator; Fable is not required.",
};

export function buildDelegationPrompt(input: PromptFactoryInput): string {
  const prohibitions = input.prohibitions?.length
    ? input.prohibitions
    : DEFAULT_PROHIBITIONS;

  return [
    `# Orchestrator Prompt: ${input.label}`,
    "",
    SURFACE_INTROS[input.surface],
    "",
    `Route: ${input.route}`,
    "",
    "## Outcome",
    input.outcome,
    "",
    "## Scope",
    ...input.scope.map((item) => `- ${item}`),
    "",
    "## Invariants",
    ...input.invariants.map((item) => `- ${item}`),
    "",
    "## Verification",
    ...input.verification.map((item) => `- ${item}`),
    "",
    "## Prohibitions",
    ...prohibitions.map((item) => `- ${item}`),
    "",
    "## Safe Label",
    input.label,
    "",
  ].join("\n");
}

export function recommendedPromptFiles(repoSignals: {
  hasDocs?: boolean;
  hasPlugins?: boolean;
  hasTests?: boolean;
}): PromptFileRecommendation[] {
  const recommendations: PromptFileRecommendation[] = [
    {
      file: "docs/orchestrator/repo-scan.md",
      route: "codex/analyze",
      purpose: "Map repository structure, risks, test commands, and useful delegation routes.",
    },
    {
      file: "docs/orchestrator/file-focused-review.md",
      route: "codex/review",
      purpose: "Review one file or subsystem against explicit acceptance criteria.",
    },
  ];

  recommendations.push({
    file: "docs/orchestrator/implementation.md",
    route: "codex/implement",
    purpose: "Turn bounded repo work into a safe implementation delegation prompt.",
  });

  recommendations.push({
    file: "docs/orchestrator/model-selection.md",
    route: "parent-model",
    purpose: "Show default Fable orchestration and explicit Opus/current-model orchestration commands.",
  });

  recommendations.push({
    file: "docs/orchestrator/direct-worker.md",
    route: "direct-worker",
    purpose: "Show direct worker slash commands for cases where auto mode blocks the Agent wrapper.",
  });

  recommendations.push({
    file: "docs/orchestrator/opus-review.md",
    route: "opus-review",
    purpose: "Show Opus 4.8 slash commands for high-taste read-only review.",
  });

  if (repoSignals.hasPlugins) {
    recommendations.push({
      file: "docs/orchestrator/plugin-surface-sync.md",
      route: "codex/review",
      purpose: "Keep Claude, Pi, Copilot, and future orchestrator plugin surfaces aligned.",
    });
  }

  if (repoSignals.hasTests) {
    recommendations.push({
      file: "docs/orchestrator/test-strategy.md",
      route: "codex/analyze",
      purpose: "Find the right focused and full verification commands before implementation.",
    });
  }

  return recommendations;
}
