import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { recommendedPromptFiles } from "./prompt-factory";
import { renderWorkloadMatrixGuidanceSection } from "./routing-policy";
import {
  WORKLOAD_MATRIX_PREFIX,
  renderCopilotInstructions,
  renderCopilotOrchestratePrompt,
  renderCopilotReviewPrompt,
  renderCursorDocsDirectWorker,
  renderCursorDocsFileFocusedReview,
  renderCursorDocsImplementation,
  renderCursorDocsModelSelection,
  renderCursorDocsOpusReview,
  renderCursorDocsOrchestrate,
  renderCursorDocsPluginSurfaceSync,
  renderCursorDocsRepoScan,
  renderCursorDocsTestStrategy,
  renderCursorOrchestrateCommand,
  renderCursorOrchestratePrompt,
  renderCursorOrchestrateSkill,
  renderCursorOrchestratorRule,
  renderCursorReadme,
  renderFeatureParityMatrixMd,
  renderPiArcOrchestratorSkill,
  renderPiOrchestratePrompt,
  renderRoutingPolicyMd,
} from "./surface-templates";

export type GeneratedSurface = {
  relativePath: string;
  render: (rootDir: string) => string;
};

export const GENERATED_SURFACES: GeneratedSurface[] = [
  {
    relativePath:
      "plugins/fable-orchestrator/skills/orchestrate/references/routing-policy.md",
    render: () => renderRoutingPolicyMd(),
  },
  {
    relativePath: "plugins/cursor-orchestrator/skills/orchestrate/SKILL.md",
    render: () => renderCursorOrchestrateSkill(),
  },
  {
    relativePath: "plugins/cursor-orchestrator/rules/orchestrator.mdc",
    render: () => renderCursorOrchestratorRule(),
  },
  {
    relativePath: "plugins/cursor-orchestrator/prompts/orchestrate.md",
    render: () => renderCursorOrchestratePrompt(),
  },
  {
    relativePath: "plugins/cursor-orchestrator/commands/orchestrate.md",
    render: () => renderCursorOrchestrateCommand(),
  },
  {
    relativePath: "plugins/cursor-orchestrator/README.md",
    render: () => renderCursorReadme(),
  },
  {
    relativePath: "plugins/pi-orchestrator/skills/arc-orchestrator/SKILL.md",
    render: () => renderPiArcOrchestratorSkill(),
  },
  {
    relativePath: "plugins/pi-orchestrator/prompts/orchestrate.md",
    render: () => renderPiOrchestratePrompt(),
  },
  {
    relativePath: "plugins/copilot-orchestrator/copilot-instructions.md",
    render: () => renderCopilotInstructions(),
  },
  {
    relativePath: "plugins/copilot-orchestrator/prompts/orchestrate.prompt.md",
    render: () => renderCopilotOrchestratePrompt(),
  },
  {
    relativePath: "plugins/copilot-orchestrator/prompts/review.prompt.md",
    render: () => renderCopilotReviewPrompt(),
  },
  {
    relativePath: "docs/orchestrator/feature-parity-matrix.md",
    render: () => renderFeatureParityMatrixMd(),
  },
  {
    relativePath: "docs/orchestrator/workload-matrix.md",
    render: (rootDir) => renderWorkloadMatrix(rootDir),
  },
  {
    relativePath: "docs/orchestrator/cursor/orchestrate.md",
    render: () => renderCursorDocsOrchestrate(),
  },
  {
    relativePath: "docs/orchestrator/cursor/model-selection.md",
    render: () => renderCursorDocsModelSelection(),
  },
  {
    relativePath: "docs/orchestrator/cursor/opus-review.md",
    render: () => renderCursorDocsOpusReview(),
  },
  {
    relativePath: "docs/orchestrator/cursor/implementation.md",
    render: () => renderCursorDocsImplementation(),
  },
  {
    relativePath: "docs/orchestrator/cursor/direct-worker.md",
    render: () => renderCursorDocsDirectWorker(),
  },
  {
    relativePath: "docs/orchestrator/cursor/repo-scan.md",
    render: () => renderCursorDocsRepoScan(),
  },
  {
    relativePath: "docs/orchestrator/cursor/file-focused-review.md",
    render: () => renderCursorDocsFileFocusedReview(),
  },
  {
    relativePath: "docs/orchestrator/cursor/plugin-surface-sync.md",
    render: () => renderCursorDocsPluginSurfaceSync(),
  },
  {
    relativePath: "docs/orchestrator/cursor/test-strategy.md",
    render: () => renderCursorDocsTestStrategy(),
  },
];

export const GENERATED_SURFACE_PATHS = GENERATED_SURFACES.map(
  (surface) => surface.relativePath,
);

function renderWorkloadMatrix(rootDir: string): string {
  // The "## Design" section is immutable historical content carried forward
  // from the checked-in file. Fail loudly rather than silently rewriting
  // history when it cannot be read.
  const existingPath = join(rootDir, "docs/orchestrator/workload-matrix.md");
  const existing = readFileSync(existingPath, "utf8");
  const designIndex = existing.indexOf("\n## Design\n");
  if (designIndex < 0) {
    throw new Error(
      `generate-surfaces: missing "## Design" marker in ${existingPath}; refusing to drop historical content`,
    );
  }
  const historicalSuffix = existing.slice(designIndex + 1);

  return (
    WORKLOAD_MATRIX_PREFIX +
    renderWorkloadMatrixGuidanceSection() +
    "\n" +
    historicalSuffix
  );
}

export type GenerateSurfacesOptions = {
  dryRun?: boolean;
  outputRoot?: string;
};

export function generateAllSurfaces(
  rootDir: string,
  options: GenerateSurfacesOptions = {},
): string[] {
  const outputRoot = options.outputRoot ?? rootDir;
  const written: string[] = [];

  // Keep cursor doc mirrors aligned with prompt-factory recommendations.
  const promptFactoryDocs = new Set(
    recommendedPromptFiles({
      hasDocs: true,
      hasPlugins: true,
      hasTests: true,
    }).map((entry) => entry.file),
  );
  for (const surface of GENERATED_SURFACES) {
    if (surface.relativePath.startsWith("docs/orchestrator/cursor/")) {
      const canonical = surface.relativePath.replace(
        "docs/orchestrator/cursor/",
        "docs/orchestrator/",
      );
      if (promptFactoryDocs.has(canonical)) {
        promptFactoryDocs.delete(canonical);
      }
    }
  }

  if (promptFactoryDocs.size > 0) {
    throw new Error(
      `Missing cursor doc mirrors for prompt-factory recommendations: ${[...promptFactoryDocs].join(", ")}`,
    );
  }

  for (const surface of GENERATED_SURFACES) {
    const content = surface.render(rootDir);
    const outputPath = join(outputRoot, surface.relativePath);

    if (!options.dryRun) {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, content, "utf8");
    }

    written.push(surface.relativePath);
  }

  return written;
}

if (import.meta.main) {
  const rootDir = resolve(import.meta.dir, "../..");
  const written = generateAllSurfaces(rootDir);
  console.log(`Generated ${written.length} surface files.`);
}
