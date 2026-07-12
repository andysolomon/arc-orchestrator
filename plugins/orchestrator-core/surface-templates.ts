import {
  FEATURE_MATRIX,
  PARENT_MODEL_DEFAULTS,
  type FeatureMatrixEntry,
  type ParentOrchestratorId,
  type SurfaceFeatureStatus,
} from "./feature-matrix";
import type { OrchestratorSurface } from "./prompt-factory";
import type { RouteCapability } from "../fable-orchestrator/lib/routes";
import {
  EXPLICIT_OVERRIDE_RULE,
  EXPLICIT_OVERRIDE_RULE_INLINE,
  COMPOSER_ORCHESTRATOR_MODE_STACK,
  CODEX_SOL_PARENT_FALLBACK_EFFORT_POLICY,
  OPUS_VS_SOL_DISTINCTION,
  PARENT_ORCHESTRATOR_UNAVAILABLE_TRIGGERS,
  cursorRouteSelectionBullets,
  displayParentOrchestratorId,
  formatCursorParentFallbackChain,
  gpt56WorkerRoutingBullets,
  gpt56WorkerRoutingSection,
  renderRoutingPolicyMd,
  renderWorkloadMatrixGuidanceSection,
  routePreferenceSummary,
  routePreferenceSummaryForCursorDocs,
} from "./routing-policy";

const SURFACE_LABELS: Record<OrchestratorSurface, string> = {
  claude: "Claude",
  cursor: "Cursor",
  pi: "Pi",
  copilot: "Copilot",
};

function formatSurfaceCell(status: SurfaceFeatureStatus): string {
  if (status.kind === "required") {
    const paths = [status.path, ...(status.additionalPaths ?? [])];
    return `required: ${paths.map((path) => `\`${path}\``).join(", ")}`;
  }
  return `intentional difference — ${formatIntentionalDifferenceRationale(status.rationale)}`;
}

function formatDefaultParent(
  defaultParent: (typeof PARENT_MODEL_DEFAULTS)[number]["defaultParent"],
): string {
  switch (defaultParent) {
    case "fable":
      return "Fable";
    case "codex-5.6-terra":
      return "Codex 5.6 Terra";
    case "codex-5.6-sol":
      return "Codex 5.6 Sol";
  }
}

function formatParentFallbackParents(
  surface: OrchestratorSurface,
  fallbackParents: ParentOrchestratorId[] | undefined,
): string {
  if (!fallbackParents || fallbackParents.length === 0) {
    return "—";
  }

  if (surface === "cursor") {
    return `${CURSOR_PARENT_AVAILABILITY_CHAIN}. Run every parent in this availability chain at high reasoning effort; use \`--effort high\` or the surface-equivalent reasoning-effort control.`;
  }

  const chain = fallbackParents.map(displayParentOrchestratorId).join(", then ");
  return `${chain} when Fable is unavailable (${PARENT_ORCHESTRATOR_UNAVAILABLE_TRIGGERS}); ${CODEX_SOL_PARENT_FALLBACK_EFFORT_POLICY}`;
}

const CURSOR_PARENT_AVAILABILITY_CHAIN =
  `CC-Fable → ${formatCursorParentFallbackChain().replace(", then ", " → ")}`;

const CURSOR_PARENT_FALLBACK_POLICY =
  `Follow the cross-harness parent availability chain: ${CURSOR_PARENT_AVAILABILITY_CHAIN}. If CC-Fable is unavailable because of ${PARENT_ORCHESTRATOR_UNAVAILABLE_TRIGGERS}, use Codex 5.6 Sol; if Codex 5.6 Sol is also unavailable, use Cursor-Fable-High. Run every parent in this availability chain at high reasoning effort; use \`--effort high\` or the surface-equivalent reasoning-effort control, and never use low or unspecified/default reasoning for a parent.`;

const CURSOR_ACTIVE_PARENT_CONTEXT =
  `Use the active tier of the ${CURSOR_PARENT_AVAILABILITY_CHAIN} parent availability chain at high reasoning. Planning, ambiguity resolution, route selection, final judgment, and user communication stay in the active parent chat.`;

function renderCursorComposerOrchestratorModeSection(): string {
  return `## Composer Orchestrator Mode

Composer orchestrator mode is an explicit opt-in economy mode for a Cursor-native Composer parent. Cursor carries this required policy because \`(O) Composer\` is Cursor-native. It is inactive by default and does not change the ${CURSOR_PARENT_AVAILABILITY_CHAIN} parent availability chain.

Fixed opt-in economy tree: ${COMPOSER_ORCHESTRATOR_MODE_STACK}.

While economy mode is active, explicitly exclude Fable, Codex 5.6 Sol, and default Codex workers (\`codex-explore\`, \`codex-implement\`, and \`codex-check\`) from route selection.

Escalation behavior: remain on the economy stack unless a worker fails. No silent upgrade to Fable, Sol, or default Codex workers is allowed. If an economy worker fails, stop for an explicit parent decision before leaving the economy stack.
`;
}

function formatAssertionPath(path: string): string {
  if (path === "plugins/pi-orchestrator/prompts/orchestrate.md") {
    return `\`${path}\` (symlink to \`plugins/orchestrator-core/prompts/pi-orchestrate.md\`)`;
  }
  return `\`${path}\``;
}

const FORMATTED_RATIONALE_OVERRIDES: Record<string, string> = {
  "Pi is Codex-first and reuses docs/orchestrator slash commands for durable prompt generation; it does not ship a dedicated prompt-factory skill.":
    "Pi is Codex-first and reuses `docs/orchestrator` slash commands for durable prompt generation; it does not ship a dedicated prompt-factory skill.",
  "Copilot uses checked-in prompt templates under plugins/copilot-orchestrator/prompts/ rather than a prompt-factory skill surface.":
    "Copilot uses checked-in prompt templates under `plugins/copilot-orchestrator/prompts/` rather than a prompt-factory skill surface.",
  "Pi declares the shared runner via package.json; backend authentication is the user's local responsibility and is not wrapped in a Pi setup skill.":
    "Pi declares the shared runner via `package.json`; backend authentication is the user's local responsibility and is not wrapped in a Pi setup skill.",
  "Copilot setup guidance lives inline in copilot-instructions.md; there is no separate setup skill artifact.":
    "Copilot setup guidance lives inline in `copilot-instructions.md`; there is no separate setup skill artifact.",
  "Pi covers basic runs inspection inline in the arc-orchestrator skill; it does not ship a dedicated observability skill with Laminar boundaries.":
    "Pi covers basic runs inspection inline in the arc-orchestrator skill; it does not ship a dedicated observability skill with Laminar boundaries.",
  "Copilot documents observability inline in copilot-instructions.md; there is no separate observability skill artifact.":
    "Copilot documents observability inline in `copilot-instructions.md`; there is no separate observability skill artifact.",
  "Pi delegates through explicit fable-orchestrator CLI commands in arc-orchestrator; it has no auto-mode direct-worker escape hatch.":
    "Pi delegates through explicit `fable-orchestrator` CLI commands in arc-orchestrator; it has no auto-mode direct-worker escape hatch.",
  "Pi is Codex-first; high-taste review is routed through codex/review rather than an Opus 4.8 worker surface.":
    "Pi is Codex-first; high-taste review is routed through `codex/review` rather than an Opus 4.8 worker surface.",
  "Copilot is Codex-first; review.prompt.md routes through codex/review rather than an Opus 4.8 worker surface.":
    "Copilot is Codex-first; `review.prompt.md` routes through `codex/review` rather than an Opus 4.8 worker surface.",
  "Cursor has no thin opus-* Agent wrappers; availability fallback is reached through direct runner invocation (--backend claude) in the direct-worker skill.":
    "Cursor has no thin opus-* Agent wrappers; availability fallback is reached through direct runner invocation (`--backend claude`) in the direct-worker skill.",
  "Pi has no opus-* worker agents; availability fallback is reached through explicit fable-orchestrator run --backend claude commands in arc-orchestrator.":
    "Pi has no opus-* worker agents; availability fallback is reached through explicit `fable-orchestrator run --backend claude` commands in arc-orchestrator.",
  "Copilot has no opus-* worker agents; availability fallback is reached through explicit fable-orchestrator run --backend claude commands documented in copilot-instructions.md.":
    "Copilot has no opus-* worker agents; availability fallback is reached through explicit `fable-orchestrator run --backend claude` commands documented in copilot-instructions.md.",
  "Cursor has no thin grok-* Agent wrappers; second-tier availability fallback is reached through direct runner invocation (--backend composer --route grok-*) in the direct-worker skill.":
    "Cursor has no thin grok-* Agent wrappers; second-tier availability fallback is reached through direct runner invocation (`--backend composer --route grok-*`) in the direct-worker skill.",
  "Pi has no grok-* worker agents; second-tier availability fallback is reached through explicit fable-orchestrator run --backend composer --route grok-* commands in arc-orchestrator.":
    "Pi has no grok-* worker agents; second-tier availability fallback is reached through explicit `fable-orchestrator run --backend composer --route grok-*` commands in arc-orchestrator.",
  "Copilot has no grok-* worker agents; second-tier availability fallback is reached through explicit fable-orchestrator run --backend composer --route grok-* commands documented in copilot-instructions.md.":
    "Copilot has no grok-* worker agents; second-tier availability fallback is reached through explicit `fable-orchestrator run --backend composer --route grok-*` commands documented in copilot-instructions.md.",
  "Pi is Codex 5.6 Sol-first and intentionally does not expose Composer as a parent orchestrator; it may invoke composer/implement only as a bounded worker route.":
    "Pi is Codex 5.6 Sol-first and intentionally does not expose Composer as a parent orchestrator; it may invoke `composer/implement` only as a bounded worker route.",
  "Copilot is Codex 5.6 Terra-first and intentionally does not expose Composer as a parent orchestrator; it may invoke composer/implement only as a bounded worker route.":
    "Copilot is Codex 5.6 Terra-first and intentionally does not expose Composer as a parent orchestrator; it may invoke `composer/implement` only as a bounded worker route.",
};

function formatIntentionalDifferenceRationale(rationale: string): string {
  return FORMATTED_RATIONALE_OVERRIDES[rationale] ?? rationale;
}

export function renderFeatureParityMatrixMd(): string {
  const parentRows = PARENT_MODEL_DEFAULTS.map((policy) => {
    const fallback = formatParentFallbackParents(policy.surface, policy.fallbackParents);
    const defaultParent = policy.surface === "cursor"
      ? "CC-Fable"
      : formatDefaultParent(policy.defaultParent);
    const paths = policy.assertionPaths.map((path) => formatAssertionPath(path)).join(", ");
    return `| ${SURFACE_LABELS[policy.surface]} | ${defaultParent} | ${fallback} | ${paths} |`;
  }).join("\n");

  const featureHeader =
    "| Feature | Claude | Cursor | Pi | Copilot |\n| --- | --- | --- | --- | --- |";
  const featureRows = FEATURE_MATRIX.map((feature: FeatureMatrixEntry) => {
    const cells = (["claude", "cursor", "pi", "copilot"] as const)
      .map((surface) => formatSurfaceCell(feature.surfaces[surface]))
      .join(" | ");
    return `| ${feature.name} | ${cells} |`;
  }).join("\n");

  return `# Orchestrator Feature Parity Matrix

\`plugins/orchestrator-core/feature-matrix.ts\` is the **source of truth** for cross-surface feature parity. \`test/feature-parity.test.ts\` enforces it: required artifacts must exist, intentional differences must carry a documented rationale, and parent-model defaults must match policy.

## Parent model defaults

| Surface | Default parent | Fallback parent | Assertion paths |
| --- | --- | --- | --- |
${parentRows}

## Feature matrix

${featureHeader}
${featureRows}

## GPT-5.6 worker routing differences

All surfaces document the same worker defaults: \`gpt-5.6-luna\` for Codex
explore, \`gpt-5.5\` for hard Codex implement/review, and \`gpt-5.6-sol\` for
taste-sensitive Codex implement/review. Composer 2.5 remains the default Cursor
implementation worker; \`FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol\` is an
explicit override escape hatch, not the default. Explicit model overrides win.
The intentionally different parent policies remain unchanged: Cursor follows
CC-Fable → Codex 5.6 Sol → Cursor-Fable-High, with high reasoning required at
every parent tier; Pi is Codex 5.6 Sol-first, and Copilot is Codex 5.6
Terra-first.

## Updating the matrix

1. Edit \`plugins/orchestrator-core/feature-matrix.ts\`.
2. Mirror the change in this document.
3. Run \`env -u FABLE_ORCHESTRATOR_LOCK_WAIT_MS bun test\` from the repository root.

When a Claude Code feature lands, add or update the matrix entry before merging so Cursor (and Pi/Copilot where applicable) cannot silently drift.
`;
}

export function renderCursorOrchestrateSkill(): string {
  return `---
name: orchestrate
description: Follow the CC-Fable, Codex 5.6 Sol, then Cursor-Fable-High parent availability chain at high reasoning. Route bounded work to Composer 2.5, Codex, or Opus while keeping planning and judgment in the active parent chat.
---

# Cursor Orchestrator

Use this skill when the user asks Cursor Agent to orchestrate work.

## Parent Policy

- Use CC-Fable as the default parent orchestrator when available.
- ${CURSOR_PARENT_FALLBACK_POLICY}
- Keep planning, ambiguity resolution, route selection, final judgment, and user communication in the active parent chat, whether the parent is CC-Fable, Codex 5.6 Sol, or Cursor-Fable-High.
- Delegate only bounded worker tasks.

## Route Selection

- Composer 2.5: clear, mechanical, high-volume implementation after the approach is approved.
- Codex analyze: read-only repo exploration, dependency tracing, evidence gathering, and log/test-failure analysis; defaults to GPT-5.6 Luna.
- Parent availability chain: use CC-Fable first, Codex 5.6 Sol second, and Cursor-Fable-High third, all at high reasoning.
- Codex implement: hard implementation, debugging-heavy fixes, or escalation after Composer misses the bar; defaults to GPT-5.5, or Sol for taste-sensitive task classes.
- Codex review: read-only correctness, regression, security, and acceptance-criteria checks; defaults to GPT-5.5, or Sol for taste-sensitive task classes.
- Opus 4.8 review: ${OPUS_VS_SOL_DISTINCTION.opus}; use Sol for ${OPUS_VS_SOL_DISTINCTION.sol}.
- Claude backend (\`--backend claude\`): first-tier availability fallback for analyze, review, or implement when Codex is unavailable or the parent explicitly routes to Opus 4.8. Set \`FABLE_ORCHESTRATOR_FALLBACK=claude\` for opt-in automatic retry on availability-classified Codex failures.
- Grok routes (\`--backend composer --route grok-*\`): second-tier availability fallback when Claude/Opus is also unavailable; use \`grok-explore\`, \`grok-check\`, or \`grok-implement\` via the composer backend with Grok 4.5. Grok is availability recovery, not taste escalation and not a substitute for \`opus-review\`.

${gpt56WorkerRoutingSection(
    "Cursor's three-tier parent availability chain does not change the backend-specific worker choices above.",
  )}

${renderCursorComposerOrchestratorModeSection()}

## Delegation Contract

Before delegating, state:

1. exact outcome;
2. files or subsystem in scope;
3. behavior that must not change;
4. required tests or verification;
5. prohibited actions: no commits, pushes, merges, deployments, secret edits, or unrelated refactors;
6. short safe label.

Treat worker output as evidence, not ground truth. Inspect diffs and verification before accepting implementation work.
`;
}

export function renderCursorOrchestratorRule(
  capabilities?: RouteCapability[],
): string {
  return `---
description: Three-tier high-reasoning parent orchestration policy for Cursor projects
alwaysApply: true
---

# Cursor Orchestrator

When the user asks to orchestrate work in Cursor, use CC-Fable as the default parent orchestrator when available. ${CURSOR_PARENT_FALLBACK_POLICY} Keep planning, ambiguity resolution, route selection, final judgment, and user communication in the active parent chat, whether the parent is CC-Fable, Codex 5.6 Sol, or Cursor-Fable-High.

Delegate only bounded worker tasks with:

1. exact outcome;
2. files or subsystem in scope;
3. behavior that must not change;
4. required tests or verification;
5. prohibited actions: no commits, pushes, merges, deployments, secret edits, or unrelated refactors;
6. a short safe label.

## Route Selection

${cursorRouteSelectionBullets(capabilities).map((bullet, index) => index === 0 ? `- Use ${CURSOR_PARENT_AVAILABILITY_CHAIN} as the ordered parent availability chain at high reasoning.` : `- ${bullet}`).join("\n")}

## GPT-5.6 Worker Models

${gpt56WorkerRoutingBullets(capabilities).map((bullet) => `- ${bullet}`).join("\n")}

## Guardrails

- Do not delegate unclear tasks; ask the user or narrow the contract first.
- Treat worker output as evidence, not ground truth.
- Inspect diffs and verification before accepting implementation work.
- Do not use Composer for read-only review; Cursor headless write mode is implementation-only.
- Prefer the cheapest capable worker, but use Opus when taste/design judgment is the reason for the review.
`;
}

export function renderCursorOrchestratePrompt(): string {
  return `# Cursor Orchestrator Prompt

Paste this into Cursor chat when the parent availability chain reaches Cursor, or use the same contract from an earlier parent tier. ${CURSOR_PARENT_FALLBACK_POLICY}

\`\`\`text
Use the active parent tier to orchestrate <TASK>. ${CURSOR_PARENT_FALLBACK_POLICY} First decide whether this should stay in the parent chat or be delegated. If delegated, produce a bounded worker contract with outcome, scope, invariants, verification, prohibitions, and a safe label. ${routePreferenceSummary()} \`FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol\` is an explicit Composer override, not the default. ${EXPLICIT_OVERRIDE_RULE} Do not commit, push, merge, deploy, edit secrets, or touch unrelated files unless I explicitly ask.
\`\`\`

## Direct runner examples

\`\`\`sh
fable-orchestrator run --backend composer --mode implement --task "<bounded mechanical implementation contract>" --cwd "$PWD" --label "cursor-composer-<short-name>"
\`\`\`

\`\`\`sh
fable-orchestrator run --backend codex --mode review --task "<bounded correctness/security review contract>" --cwd "$PWD" --label "cursor-codex-review-<short-name>"
\`\`\`
`;
}

export function renderCursorOrchestrateCommand(): string {
  return `---
name: orchestrate
description: Orchestrate the given task through the CC-Fable, Codex 5.6 Sol, then Cursor-Fable-High parent availability chain at high reasoning, delegating only bounded worker contracts to Composer, Codex, or Opus routes.
---

Use the active tier in the parent availability chain to orchestrate the user-supplied task. ${CURSOR_PARENT_FALLBACK_POLICY} Follow the \`orchestrate\` skill in this plugin.

1. Decide whether the work should stay in the parent chat or be delegated.
2. If delegated, produce a bounded worker contract with outcome, scope, invariants, verification, prohibitions, and a safe label.
3. Route: Composer 2.5 for clear mechanical implementation, GPT-5.5 for hard Codex implement/review, GPT-5.6 Luna for repo exploration, GPT-5.6 Sol for ${OPUS_VS_SOL_DISTINCTION.sol}, and Opus 4.8 for ${OPUS_VS_SOL_DISTINCTION.opus}. \`FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol\` is an explicit Composer override, not the default. ${EXPLICIT_OVERRIDE_RULE}
4. Inspect diffs and verification evidence before accepting worker output; treat it as evidence, not ground truth.

Do not commit, push, merge, deploy, edit secrets, or touch unrelated files unless the user explicitly asks.
`;
}

export function renderCursorReadme(): string {
  return `# Cursor Orchestrator Plugin

This is a real Cursor plugin package for continuing orchestration when the parent availability chain reaches Cursor. ${CURSOR_PARENT_FALLBACK_POLICY} Planning, task decomposition, ambiguity resolution, worker selection, final review, and user communication stay in the active parent chat.

Workers remain bounded:

- \`composer/implement\`: Cursor Composer 2.5 for clear, mechanical, high-volume implementation.
- \`codex/analyze\`: read-only repository exploration.
- \`codex/implement\`: harder implementation or escalation when Composer misses the bar; GPT-5.6 Sol for taste-sensitive task classes.
- \`codex/review\`: correctness, regression, security, and acceptance-criteria review; GPT-5.6 Sol for taste-sensitive task classes.
- \`opus/review\`: high-taste read-only critique for UI/UX, API ergonomics, docs, copy, prompts, and long-lived abstractions.

## Install Locally

Copy this plugin into Cursor's local plugin directory (the reliable default):

\`\`\`sh
mkdir -p ~/.cursor/plugins/local
cp -R /Users/andrewsolomon/orchestrator/plugins/cursor-orchestrator ~/.cursor/plugins/local/cursor-orchestrator
\`\`\`

A symlink also works on some Cursor versions, but Cursor's plugin validation can reject symlinks whose targets live outside \`~/.cursor/plugins/local\`, so prefer copying unless you have verified symlinks load on your version:

\`\`\`sh
ln -s /Users/andrewsolomon/orchestrator/plugins/cursor-orchestrator ~/.cursor/plugins/local/cursor-orchestrator
\`\`\`

Then restart Cursor or run **Developer: Reload Window**.

You can also copy only the rule into a project if you do not want to install the full plugin:

\`\`\`sh
mkdir -p .cursor/rules
cp /Users/andrewsolomon/orchestrator/plugins/cursor-orchestrator/rules/orchestrator.mdc .cursor/rules/orchestrator.mdc
\`\`\`

Use \`/orchestrate\` or \`/opus-review\` from Cursor chat when the plugin is installed, or use the prompt examples in \`prompts/\` manually.

## Component Layout

Cursor discovers plugin components by convention from this directory:

| Path | Purpose |
| --- | --- |
| \`.cursor-plugin/plugin.json\` | Plugin manifest (name, version, author) |
| \`rules/\` | Project rules (e.g. \`orchestrator.mdc\`) |
| \`skills/\` | Agent skills (e.g. \`orchestrate/SKILL.md\`) |
| \`commands/\` | Slash commands discovered by Cursor (e.g. \`/orchestrate\`, \`/opus-review\`) |
| \`prompts/\` | Manual copy/paste prompt examples (not auto-discovered by Cursor) |

No extra registration is required beyond placing files in these standard directories.

## Distribution

**Local testing** — Use the install steps above: symlink or copy this directory into \`~/.cursor/plugins/local\`, then reload Cursor. This is the fastest loop for development and dogfooding.

**Team or marketplace distribution** — When the plugin is ready to share beyond your machine:

1. **GitHub repository import** — Publish or point teammates at the repository containing \`plugins/cursor-orchestrator\`. In Cursor, use marketplace or team plugin import from a GitHub URL so others install the same package without manual copying.
2. **Manual distribution** — Copy the entire \`plugins/cursor-orchestrator\` directory (including \`.cursor-plugin/\`, \`rules/\`, \`skills/\`, \`commands/\`, and \`prompts/\`) to each developer's \`~/.cursor/plugins/local/\` or your team's shared plugin path.

Graduate from local copy → versioned release or marketplace listing once manifest, layout, and README match what maintainers expect for distribution.

## Defaults

- Parent availability chain: ${CURSOR_PARENT_AVAILABILITY_CHAIN}.
- Parent reasoning effort: high for every tier; use \`--effort high\` or the surface-equivalent reasoning-effort control.
- Bulk mechanical implementation worker: Composer 2.5.
- Bounded taste-sensitive Codex implementation/review against explicit criteria: GPT-5.6 Sol.
- Open-ended high-taste critique or design direction before criteria are fixed: Opus 4.8.
- Repo exploration worker: GPT-5.6 Luna.

## GPT-5.6 worker routing

\`gpt-5.6-luna\` is the Codex analyze default. \`gpt-5.5\` is the Codex
implement/review default for harder work. \`gpt-5.6-sol\` is the Codex
implement/review default for taste-sensitive task classes (\`ui\`, \`copy\`,
or \`api-design\`). Composer 2.5 remains the default Cursor implementation
worker; \`FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol\` is an explicit
override escape hatch, not the default. ${EXPLICIT_OVERRIDE_RULE}
Cursor follows ${CURSOR_PARENT_AVAILABILITY_CHAIN} at high reasoning for parent orchestration.
`;
}

export function renderCursorPromptFactorySkill(): string {
  return `---
name: prompt-factory
description: Scan a repository and create docs/orchestrator prompt files with Cursor-oriented copy/paste examples that preserve the three-tier high-reasoning parent availability chain. Use Pi or Copilot examples only when requested.
---

# Orchestrator Prompt Factory

Create repo-specific prompt files under \`docs/orchestrator/\` as copy/paste examples for the user's active orchestrator surface. Default to the Cursor surface when this skill is invoked from Cursor; switch to Pi or Copilot only when the user asks for that surface.

Shared orchestrator wording comes from [plugins/orchestrator-core/prompt-factory.ts](../../../orchestrator-core/prompt-factory.ts). Generated Cursor prompts must preserve the exact ordered parent availability chain CC-Fable → Codex 5.6 Sol → Cursor-Fable-High. Run every parent in this availability chain at high reasoning effort; use \`--effort high\` or the surface-equivalent reasoning-effort control. Planning, ambiguity resolution, route selection, final judgment, and user communication stay in the active parent chat.

## Steps

1. **Inventory.** Scan project shape with read-only commands: directories, package manifests, test scripts, plugin surfaces, skills, docs, CI, and notable entrypoints. Completion: you can name the primary languages/frameworks, test commands, plugin surfaces, and documentation sources.
2. **Pick the surface.** Use Cursor when the user is in Cursor or does not specify a surface. Use Pi or Copilot only when requested. Completion: the generated prompt examples use exactly one primary surface unless the task is explicitly about comparing plugin surfaces.
3. **Classify prompts.** Choose only prompt files that match repo signals. Completion: every chosen prompt has a route, audience, and concrete use case for the selected surface.
4. **Centralize.** Update shared wording in \`plugins/orchestrator-core/prompt-factory.ts\` before editing individual prompt files when repeated orchestrator text drifts. Completion: repeated orchestrator wording has one obvious source of truth.
5. **Generate.** Ensure \`docs/\` and \`docs/orchestrator/\` exist, then write concise \`.md\` files that are primarily copy/paste examples, not long explanations. For Cursor, use Cursor chat and \`/orchestrate\`-style delegation examples—not Claude Code slash commands. Completion: every generated file gives multiple copy/paste commands for the selected surface, with labels and safety boundaries embedded in the examples.
6. **Quality review.** Challenge each generated prompt for usefulness, ambiguity, missing scope boundaries, missing verification, and documentation drift when local docs exist. Completion: every generated prompt is something a user could copy into the selected surface and immediately understand how to use.
7. **Verify.** Run existing lightweight tests or docs checks when available; otherwise verify files exist and links resolve. Completion: report exact files created/changed and verification run.

## Rules

- Do not overwrite existing human-authored prompt files without preserving their intent.
- Do not include secrets, absolute paths, raw transcripts, or private task text in generated prompts.
- Keep each generated prompt file focused on one selected surface.
- Do not mix Cursor, Claude Code, Pi, and Copilot instructions in a single prompt unless the prompt is explicitly about plugin-surface alignment.
- Make prompts runnable as copy/paste examples from the selected surface.
- Preserve the exact ordered Cursor parent availability chain: CC-Fable → Codex 5.6 Sol → Cursor-Fable-High.
- Require every Cursor parent tier to use high reasoning via \`--effort high\` or the surface-equivalent reasoning-effort control; never use low or unspecified/default reasoning for a parent.
- Delegate only bounded worker tasks and keep planning and final synthesis in the active parent chat.
`;
}

export function renderPiArcOrchestratorSkill(): string {
  return `---
name: arc-orchestrator
description: Codex-first ARC orchestration for Pi. Use when work should be planned in the parent Pi session and delegated as bounded analyze, implement, or review tasks through the orchestrator runner. Codex 5.6 Sol is the default parent orchestrator; Fable is not required.
---

# ARC Orchestrator for Pi

Use this skill to keep the parent Pi session focused on planning, ambiguity resolution, final judgment, and user communication while delegating bounded execution to the local orchestrator runner.

## Default Parent Model

Use **Codex 5.6 Sol** as the default parent orchestrator for this Pi workflow, and run that Codex-Sol parent session at high reasoning effort. Start Pi with \`--effort high\`, or use Pi's equivalent reasoning-effort control when the surface names it differently. Do not assume Fable is present or preferred. If the active Pi model is weaker than Codex 5.6 Sol or is not running at high reasoning effort, ask the user to switch models or effort before high-risk planning or final acceptance.

## Runner

This package currently reuses the repository runner while the binary retains its historical name:

\`\`\`sh
\${ARC_ORCHESTRATOR_BIN:-./plugins/fable-orchestrator/bin/fable-orchestrator}
\`\`\`

If the package is installed outside this repository, set \`ARC_ORCHESTRATOR_BIN\` to the absolute path of the runner.

## Operating Model

1. Keep planning, architecture, ambiguity resolution, user questions, and final acceptance in the parent Pi session.
2. Delegate only when the task is self-contained and has explicit boundaries.
3. Pick one route:
   - \`codex/analyze\`: read-only repository exploration or evidence gathering; defaults to GPT-5.6 Luna.
   - \`codex/implement\`: difficult implementation through GPT-5.5 with workspace-write access, or Sol for taste-sensitive task classes.
   - \`codex/review\`: independent read-only correctness, regression, security, or acceptance check through GPT-5.5, or Sol for taste-sensitive task classes.
   - \`composer/implement\`: optional bulk mechanical implementation through Cursor Composer 2.5 only when the task is clear and low-risk.
   - \`claude/analyze\`, \`claude/review\`, \`claude/implement\`: first-tier availability fallback through \`--backend claude\` (Opus 4.8) when Codex is unavailable or the parent explicitly routes there.
   - \`grok/analyze\`, \`grok/review\`, \`grok/implement\`: second-tier availability fallback through \`--backend composer --route grok-*\` (Grok 4.5) when Claude/Opus is also unavailable.
4. Treat worker output as evidence, not ground truth.
5. Inspect important diffs and verification evidence before final acceptance.
6. Never ask workers to commit, push, merge, deploy, edit secrets, or touch unrelated files.

${gpt56WorkerRoutingSection(
    "Pi intentionally remains Codex 5.6 Sol-first for parent orchestration. It can invoke\nthe Cursor implementation backend for a bounded task, but that worker route does\nnot change the parent model selection.",
  )}

## Task Contract

Every delegated task must include:

- exact outcome;
- files/subsystems in scope;
- behavior that must remain unchanged;
- required verification or tests;
- prohibited actions and scope boundaries;
- a short non-sensitive \`--label\` for trace readability.

## Commands

Analyze:

\`\`\`sh
\${ARC_ORCHESTRATOR_BIN:-./plugins/fable-orchestrator/bin/fable-orchestrator} run \\
  --backend codex \\
  --mode analyze \\
  --task "<bounded exploration contract>" \\
  --cwd "$PWD" \\
  --label "<safe label>"
\`\`\`

Implement with Codex (GPT-5.5 by default, Sol for taste-sensitive):

\`\`\`sh
\${ARC_ORCHESTRATOR_BIN:-./plugins/fable-orchestrator/bin/fable-orchestrator} run \\
  --backend codex \\
  --mode implement \\
  --task "<bounded implementation contract>" \\
  --cwd "$PWD" \\
  --label "<safe label>"
\`\`\`

Review with Codex (GPT-5.5 by default, Sol for taste-sensitive):

\`\`\`sh
\${ARC_ORCHESTRATOR_BIN:-./plugins/fable-orchestrator/bin/fable-orchestrator} run \\
  --backend codex \\
  --mode review \\
  --task "<bounded review contract>" \\
  --cwd "$PWD" \\
  --label "<safe label>"
\`\`\`

Claude backend fallback (when Codex is unavailable or parent routes to Opus 4.8):

\`\`\`sh
\${ARC_ORCHESTRATOR_BIN:-./plugins/fable-orchestrator/bin/fable-orchestrator} run \\
  --backend claude \\
  --mode analyze \\
  --task "<bounded exploration contract>" \\
  --cwd "$PWD" \\
  --label "<safe label>"
\`\`\`

Set \`FABLE_ORCHESTRATOR_FALLBACK=claude\` for opt-in automatic retry on availability-classified Codex failures. When Claude/Opus is also unavailable, re-delegate to \`grok-explore\`, \`grok-check\`, or \`grok-implement\` (or the matching \`--backend composer --route grok-*\` command below).

Grok second-tier fallback (when Claude/Opus is unavailable):

\`\`\`sh
\${ARC_ORCHESTRATOR_BIN:-./plugins/fable-orchestrator/bin/fable-orchestrator} run \\
  --backend composer \\
  --mode analyze \\
  --route grok-explore \\
  --task "<bounded exploration contract>" \\
  --cwd "$PWD" \\
  --label "<safe label>"
\`\`\`

For UI/UX, user-facing copy, API design, or other taste-sensitive implement/review tasks, add \`--task-class taste-sensitive\` (or \`ui\`, \`copy\`, \`api-design\`) so the runner selects GPT-5.6 Sol.

Inspect recent runs:

\`\`\`sh
\${ARC_ORCHESTRATOR_BIN:-./plugins/fable-orchestrator/bin/fable-orchestrator} runs --limit 10
\`\`\`

## Verification

After implementation work, run focused tests yourself when practical, inspect the diff, and then decide whether to accept, request changes, or escalate to another Codex pass.
`;
}

export function renderPiOrchestratePrompt(): string {
  return `---
description: Use ARC orchestration with Codex 5.6 Sol as the default parent orchestrator
argument-hint: "<task>"
---
Use ARC orchestration with Codex 5.6 Sol as the default parent orchestrator.

Task to prepare for delegation:

$ARGUMENTS

Before delegating, produce a bounded contract with:

1. exact outcome;
2. files or subsystems in scope;
3. behavior that must remain unchanged;
4. required tests or verification;
5. prohibited actions, especially no commits, pushes, merges, deployments, secret edits, or unrelated refactors;
6. the best route: codex/analyze (GPT-5.6 Luna), codex/implement (GPT-5.5 or Sol for taste-sensitive), codex/review (GPT-5.5 or Sol for taste-sensitive), or composer/implement (Composer 2.5). \`FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol\` is an explicit Composer override, not the default. ${EXPLICIT_OVERRIDE_RULE_INLINE};
7. a short safe label for traces.

If the task is ambiguous, ask clarifying questions instead of delegating.
`;
}

export function renderCopilotInstructions(): string {
  return `# ARC Orchestrator Instructions for GitHub Copilot

Use these instructions as \`.github/copilot-instructions.md\` in repositories that should use ARC orchestration.

## Default Orchestrator

Codex 5.6 Terra is the default parent orchestrator. Do not treat Fable as the default or required orchestrator for this workflow.

## Operating Model

- Keep planning, architecture, ambiguity resolution, user interaction, and final acceptance in the parent Copilot session.
- Delegate only bounded, self-contained work with explicit scope and verification requirements.
- Use the local orchestrator runner for worker execution when available:

\`\`\`sh
\${ARC_ORCHESTRATOR_BIN:-./plugins/fable-orchestrator/bin/fable-orchestrator}
\`\`\`

- Treat worker output as evidence, not truth. Inspect important diffs and verification before accepting.
- Never instruct workers to commit, push, merge, deploy, edit secrets, or touch unrelated files.

## Routing

- \`codex/analyze\`: read-only exploration, repository mapping, evidence gathering; defaults to GPT-5.6 Luna.
- \`codex/implement\`: default difficult implementation route through GPT-5.5 with workspace-write access, or Sol for taste-sensitive task classes.
- \`codex/review\`: independent read-only review through GPT-5.5, or Sol for taste-sensitive task classes.
- \`composer/implement\`: optional clear, mechanical bulk implementation through Composer 2.5 when the contract is already approved.
- \`claude/analyze\`, \`claude/review\`, \`claude/implement\`: first-tier availability fallback through \`--backend claude\` (Opus 4.8) when Codex is unavailable or the parent explicitly routes there. Set \`FABLE_ORCHESTRATOR_FALLBACK=claude\` for opt-in automatic retry on availability-classified Codex failures.
- \`grok/analyze\`, \`grok/review\`, \`grok/implement\`: second-tier availability fallback through \`--backend composer --route grok-*\` (Grok 4.5) when Claude/Opus is also unavailable. Grok is availability recovery, not taste escalation and not a substitute for \`opus-review\`.

${gpt56WorkerRoutingSection(
    "Copilot intentionally remains Codex 5.6 Terra-first for parent orchestration. It can\ninvoke the Cursor implementation backend for a bounded task, but that does not\nmake Sol a Copilot parent model.",
  )}

## Delegation Contract

Before invoking a worker, define:

1. exact outcome;
2. files or subsystem in scope;
3. behavior that must remain unchanged;
4. tests or verification to run;
5. prohibited actions and scope boundaries;
6. short safe label for trace records.

## Observability

Inspect local traces with:

\`\`\`sh
\${ARC_ORCHESTRATOR_BIN:-./plugins/fable-orchestrator/bin/fable-orchestrator} runs --limit 10
\`\`\`

Local traces record backend, mode, resolved model, sandbox, duration, token usage, status, changed-file count, project hash, and optional label. They must not include prompts, secrets, file contents, or absolute paths.
`;
}

export function renderCopilotOrchestratePrompt(): string {
  return `# ARC Orchestrate

You are operating with Codex 5.6 Terra as the default parent orchestrator.

User request:

{{input}}

Create a bounded delegation plan. Include:

- exact outcome;
- scoped files/subsystems;
- invariants and behavior that must not change;
- verification/tests;
- prohibited actions: no commits, pushes, merges, deployments, secret edits, or unrelated refactors;
- selected route: codex/analyze (\`gpt-5.6-luna\`), codex/implement (\`gpt-5.5\` or \`gpt-5.6-sol\` for taste-sensitive), codex/review (\`gpt-5.5\` or \`gpt-5.6-sol\` for taste-sensitive), or composer/implement (Composer 2.5). \`FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol\` is an explicit Composer override, not the default. ${EXPLICIT_OVERRIDE_RULE}
- one safe trace label.

If any requirement is ambiguous, ask clarifying questions before delegating. If it is bounded, show the exact runner command to execute.
`;
}

export function renderCopilotReviewPrompt(): string {
  return `# ARC Review

Use Codex 5.6 Terra as the default parent orchestrator and prepare an independent read-only review. \`gpt-5.5\` is the default Codex review worker; \`gpt-5.6-sol\` applies for taste-sensitive task classes; \`gpt-5.6-luna\` is for analyze routes only. \`FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol\` is an explicit Composer override, not the default. ${EXPLICIT_OVERRIDE_RULE}

Review target:

{{input}}

Produce a \`codex/review\` contract that asks the worker to check:

- correctness against the stated acceptance criteria;
- regressions and behavior changes;
- security or data exposure risks;
- missing tests or verification gaps;
- unnecessary or out-of-scope file changes.

The worker must not edit files, commit, push, merge, deploy, or access secrets. Include \`--task-class taste-sensitive\` when the review is about UI/UX, user-facing copy, API design, or other Sol-worthy taste concerns. Include a short safe trace label and the exact runner command.
`;
}

export function renderCursorDocsOrchestrate(): string {
  return `# Cursor Orchestrate Prompts

${CURSOR_ACTIVE_PARENT_CONTEXT} With the cursor-orchestrator plugin installed, \`/orchestrate <task>\` wraps the same contract. ${CURSOR_PARENT_FALLBACK_POLICY}

\`\`\`text
/orchestrate <TASK>
\`\`\`

Manual paste when the plugin is not installed:

\`\`\`text
Use the active parent tier to orchestrate <TASK>. ${CURSOR_PARENT_FALLBACK_POLICY} First decide whether this should stay in the parent chat or be delegated. If delegated, produce a bounded worker contract with outcome, scope, invariants, verification, prohibitions, and a safe label. ${routePreferenceSummaryForCursorDocs()} Do not commit, push, merge, deploy, edit secrets, or touch unrelated files unless I explicitly ask.
\`\`\`

Verify backends before the first delegation in a new environment:

\`\`\`sh
fable-orchestrator doctor --json
\`\`\`
`;
}

export function renderCursorDocsModelSelection(): string {
  return `# Model Selection (Cursor)

${CURSOR_ACTIVE_PARENT_CONTEXT} ${CURSOR_PARENT_FALLBACK_POLICY} Workers are chosen per task:

| Route | Worker | Use for |
| --- | --- | --- |
| \`composer/implement\` | Composer 2.5 | Clear, mechanical, high-volume implementation |
| \`codex/implement\` | GPT-5.5 (Sol for taste-sensitive) | Hard implementation, debugging-heavy fixes, escalation; use Sol for bounded taste-sensitive work against explicit criteria |
| \`codex/analyze\` | GPT-5.6 Luna | Repo exploration and evidence gathering |
| \`codex/review\` | GPT-5.5 (Sol for taste-sensitive) | Correctness, regression, security, acceptance criteria; use Sol for bounded taste-sensitive review against explicit criteria |
| \`opus/review\` | Opus 4.8 | ${OPUS_VS_SOL_DISTINCTION.opus.charAt(0).toUpperCase() + OPUS_VS_SOL_DISTINCTION.opus.slice(1)} |

Use Sol for ${OPUS_VS_SOL_DISTINCTION.sol}. Reserve Opus for ${OPUS_VS_SOL_DISTINCTION.opus}.

\`FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol\` is an explicit Composer override escape hatch, not the default.

Start any task with the parent decision prompt:

\`\`\`text
/orchestrate <TASK>
\`\`\`

Compare how routes have actually performed before changing defaults:

\`\`\`sh
fable-orchestrator report --group-by model
fable-orchestrator report --group-by task_class
\`\`\`

Record your judgment after each delegated run so the report stays meaningful:

\`\`\`sh
fable-orchestrator annotate --run latest --outcome accepted
\`\`\`
`;
}

export function renderCursorDocsOpusReview(): string {
  return `# Opus Review Prompts (Cursor)

${CURSOR_ACTIVE_PARENT_CONTEXT} ${CURSOR_PARENT_FALLBACK_POLICY}

Use Opus for ${OPUS_VS_SOL_DISTINCTION.opus}. Use Sol for ${OPUS_VS_SOL_DISTINCTION.sol}.

\`\`\`text
/opus-review <UI_API_DOCS_OR_PROMPT>
\`\`\`

Manual paste when the plugin is not installed:

\`\`\`text
Use Opus 4.8 as a read-only review worker for <UI_API_DOCS_OR_PROMPT>. Focus on taste, UX polish, accessibility, API ergonomics, component boundaries, docs/copy clarity, prompt wording, and long-term maintainability. Do not edit files. Return a concise verdict, top findings with evidence, suggested improvements, and whether Composer or Codex should do follow-up implementation. Label the review cursor-opus-review-<short-name>.
\`\`\`
`;
}

export function renderCursorDocsImplementation(): string {
  return `# Implementation Prompts (Cursor)

${CURSOR_ACTIVE_PARENT_CONTEXT} ${CURSOR_PARENT_FALLBACK_POLICY} The active parent turns the request into a bounded contract and picks the worker.

\`\`\`text
/orchestrate implement <OUTCOME>. Scope: <FILES_OR_SUBSYSTEM>. Must not change: <INVARIANTS>. Verify with: env -u FABLE_ORCHESTRATOR_LOCK_WAIT_MS bun test. Do not commit, push, merge, deploy, edit secrets, or touch unrelated files. Label the run impl-<short-name>.
\`\`\`

Direct runner equivalents:

\`\`\`sh
# Clear, mechanical, high-volume implementation (default)
fable-orchestrator run --backend composer --mode implement --task "<bounded implementation contract with outcome, scope, invariants, verification, prohibitions>" --cwd "$PWD" --label "impl-composer-<short-name>"
\`\`\`

\`\`\`sh
# Hard implementation or escalation after Composer misses the bar
fable-orchestrator run --backend codex --mode implement --task "<bounded implementation contract>" --cwd "$PWD" --label "impl-codex-<short-name>"
\`\`\`

Inspect the diff and run verification yourself before accepting the work. Write-capable runs serialize per project; run independent write tasks from separate worktrees.
`;
}

export function renderCursorDocsDirectWorker(): string {
  return `# Direct Worker Commands (Cursor)

${CURSOR_ACTIVE_PARENT_CONTEXT} ${CURSOR_PARENT_FALLBACK_POLICY}

Use these when the agent wrapper is inconvenient or blocked. One bounded worker per command; the active parent chat still owns planning and final judgment. Every task must state outcome, scope, invariants, verification, prohibitions, and a safe label.

\`\`\`sh
fable-orchestrator run --backend codex --mode analyze --task "<bounded read-only analysis contract>" --cwd "$PWD" --label "<safe-label>"
\`\`\`

\`\`\`sh
fable-orchestrator run --backend codex --mode review --task "<bounded read-only review contract>" --cwd "$PWD" --label "<safe-label>"
\`\`\`

\`\`\`sh
fable-orchestrator run --backend codex --mode implement --task "<bounded implementation contract>" --cwd "$PWD" --label "<safe-label>"
\`\`\`

\`\`\`sh
fable-orchestrator run --backend composer --mode implement --task "<bounded mechanical implementation contract>" --cwd "$PWD" --label "<safe-label>"
\`\`\`

Grok second-tier availability fallback (when Claude/Opus is unavailable):

\`\`\`sh
fable-orchestrator run --backend composer --mode analyze --route grok-explore --task "<bounded read-only analysis contract>" --cwd "$PWD" --label "<safe-label>"
\`\`\`

\`\`\`sh
fable-orchestrator run --backend composer --mode review --route grok-check --task "<bounded read-only review contract>" --cwd "$PWD" --label "<safe-label>"
\`\`\`

\`\`\`sh
fable-orchestrator run --backend composer --mode implement --route grok-implement --task "<bounded implementation contract>" --cwd "$PWD" --label "<safe-label>"
\`\`\`

Direct workers never commit, push, merge, deploy, or edit secrets. Use \`--task-class taste-sensitive\` for GPT-5.6 Sol when Codex implement/review covers UI/UX, copy, or API design. If Composer edits files but the runner reports it did not return the required structured result, inspect the worktree and run verification before deciding failure.
`;
}

export function renderCursorDocsRepoScan(): string {
  return `# Repo Scan Prompts (Cursor)

${CURSOR_ACTIVE_PARENT_CONTEXT} ${CURSOR_PARENT_FALLBACK_POLICY} Run these from the repository root.

\`\`\`text
/orchestrate scan this repository and produce a concise delegation map. Identify project type, major subsystems, test/build commands, docs/spec sources, risky files, and the best orchestrator routes for common work. Read-only. Do not edit files. Do not expose secrets or absolute paths. Label the run repo-scan.
\`\`\`

\`\`\`text
/orchestrate inspect this repository and list the best first five orchestrator prompts a new contributor should use here. Read-only. Do not edit files. Label the run repo-prompt-map.
\`\`\`

Direct runner equivalent (read-only Codex exploration):

\`\`\`sh
fable-orchestrator run --backend codex --mode analyze --task "Map repository structure, subsystems, test commands, and risky files. Read-only. Do not expose secrets or absolute paths." --cwd "$PWD" --label "repo-scan"
\`\`\`
`;
}

export function renderCursorDocsFileFocusedReview(): string {
  return `# File-Focused Review Prompts (Cursor)

${CURSOR_ACTIVE_PARENT_CONTEXT} ${CURSOR_PARENT_FALLBACK_POLICY} Replace the file path and criteria.

\`\`\`text
/orchestrate review <FILE_OR_SUBSYSTEM> against these acceptance criteria: <CRITERIA>. Read-only Codex review. Report prioritized findings (blockers, concerns, nits) with file evidence and suggested fixes. Do not edit files. Label the run file-review-<short-name>.
\`\`\`

Direct runner equivalent:

\`\`\`sh
fable-orchestrator run --backend codex --mode review --task "Review <FILE_OR_SUBSYSTEM> against: <CRITERIA>. Read-only. Return prioritized findings with evidence and suggested fixes." --cwd "$PWD" --label "file-review-<short-name>"
\`\`\`

Use Sol for ${OPUS_VS_SOL_DISTINCTION.sol}. Use the Opus route in \`opus-review.md\` for ${OPUS_VS_SOL_DISTINCTION.opus}.
`;
}

export function renderCursorDocsPluginSurfaceSync(): string {
  return `# Plugin Surface Sync Prompts (Cursor)

${CURSOR_ACTIVE_PARENT_CONTEXT} ${CURSOR_PARENT_FALLBACK_POLICY}

Keep Claude Code, Cursor, Pi, and Copilot orchestrator surfaces aligned. The source of truth is \`plugins/orchestrator-core/feature-matrix.ts\`, rendered in \`docs/orchestrator/feature-parity-matrix.md\` and enforced by \`test/feature-parity.test.ts\`.

\`\`\`text
/orchestrate review the orchestrator plugin surfaces for drift. Compare plugins/fable-orchestrator, plugins/cursor-orchestrator, plugins/pi-orchestrator, and plugins/copilot-orchestrator against plugins/orchestrator-core/feature-matrix.ts. Report features present in one surface but missing or stale in another, and whether each gap needs a matrix entry, an intentional-difference rationale, or new artifacts. Read-only. Do not edit files. Label the run surface-sync.
\`\`\`

After adding a feature to any surface, update the matrix first, mirror \`docs/orchestrator/feature-parity-matrix.md\`, then verify:

\`\`\`sh
env -u FABLE_ORCHESTRATOR_LOCK_WAIT_MS bun test
\`\`\`
`;
}

export function renderCursorDocsTestStrategy(): string {
  return `# Test Strategy Prompts (Cursor)

${CURSOR_ACTIVE_PARENT_CONTEXT} ${CURSOR_PARENT_FALLBACK_POLICY} Use this before delegating implementation.

\`\`\`text
/orchestrate analyze this repository's test setup: enumerate test files, the exact commands for focused and full runs, gaps in coverage for <AREA>, and which verification a worker contract should require. Read-only. Do not edit files. Label the run test-strategy.
\`\`\`

Direct runner equivalent:

\`\`\`sh
fable-orchestrator run --backend codex --mode analyze --task "Enumerate test files and exact focused/full verification commands. Identify coverage gaps in <AREA>. Read-only." --cwd "$PWD" --label "test-strategy"
\`\`\`

For this repository the full suite is:

\`\`\`sh
env -u FABLE_ORCHESTRATOR_LOCK_WAIT_MS bun test
\`\`\`
`;
}

export const WORKLOAD_MATRIX_PREFIX = `# Workload Matrix (Phase 6.4)

A representative-workload run of the four delegation routes, captured with the
\`run\` / \`annotate\` / \`report\` pipeline. This is a dated v1 snapshot, not a
final ranking: the Composer numbers are contaminated by a runner bug this run
surfaced (see Findings), so the CLAUDE.md usage-headroom rankings should not be
revised until the matrix is re-run after that fix.

- **Date:** 2026-07-05
- **Backends (snapshot):** Codex (\`gpt-5.4-mini\` analyze, \`gpt-5.5\` implement/review — models used at capture time, not current defaults; see Current GPT-5.6 routing guidance below) via ChatGPT auth; Cursor Composer 2.5.
- **Trace data:** recorded to a dedicated, disposable trace directory (not the user's default traces).

`;

export { renderRoutingPolicyMd };
