import {
  TASTE_SENSITIVE_TASK_CLASSES,
  routeCapabilities,
  type RouteCapability,
} from "../fable-orchestrator/lib/routes";
import {
  ROLLOUT_GATES_SCHEMA_VERSION,
  ROLLOUT_TRANSITION_CRITERIA,
  type RolloutTransition,
} from "../fable-orchestrator/lib/rollout-gates";
import type { RouteId } from "../fable-orchestrator/lib/trace-schema";

const DEFAULT_ENV: Record<string, string | undefined> = {};

export const EXPLICIT_OVERRIDE_RULE = "Explicit model overrides always win.";

export const EXPLICIT_OVERRIDE_RULE_INLINE = "Explicit model overrides always win";

export const COMPOSER_OVERRIDE_ESCAPE_HATCH =
  "`FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit override escape hatch, not the default.";

import type { ParentOrchestratorId } from "./feature-matrix";

export const CURSOR_PARENT_FALLBACK_CHAIN: ParentOrchestratorId[] = [
  "codex-5.6-sol",
  "cursor-fable-high",
];

export const PARENT_ORCHESTRATOR_UNAVAILABLE_TRIGGERS =
  "usage limit, authentication failure, or model unavailable";

export const CODEX_SOL_PARENT_FALLBACK_EFFORT_POLICY =
  "Run the Codex-Sol parent fallback at high reasoning effort; use `--effort high` or the surface-equivalent reasoning-effort control.";

export const COMPOSER_OVERRIDE_NOT_DEFAULT =
  "`FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit Composer override, not the default.";

export const MODEL_RANKINGS: Array<{
  model: string;
  backend: string;
  usageHeadroom: number;
  intelligence: number;
  taste: number;
}> = [
  { model: "composer-2.5", backend: "Cursor (`cursor-agent`)", usageHeadroom: 10, intelligence: 7, taste: 6 },
  { model: "gpt-5.6-luna", backend: "Codex (`codex exec`)", usageHeadroom: 10, intelligence: 6, taste: 5 },
  { model: "gpt-5.6-terra", backend: "Codex (`codex exec`)", usageHeadroom: 10, intelligence: 8, taste: 6 },
  { model: "gpt-5.5", backend: "Codex (`codex exec`)", usageHeadroom: 9, intelligence: 8, taste: 5 },
  { model: "gpt-5.6-sol", backend: "Codex (`codex exec`)", usageHeadroom: 5, intelligence: 9, taste: 7 },
  { model: "sonnet-5", backend: "Claude Code", usageHeadroom: 5, intelligence: 5, taste: 7 },
  { model: "opus-4.8", backend: "Claude Code", usageHeadroom: 4, intelligence: 7, taste: 8 },
  { model: "fable-5", backend: "Claude Code (parent)", usageHeadroom: 2, intelligence: 9, taste: 9 },
];

export const GPT56_PLACEMENTS =
  "GPT-5.6 placements: Terra matches GPT-5.5's intelligence while drawing roughly half the usage, and 5.6's shorter output and stronger layout/visual-hierarchy judgment lift its taste to 6, so it saturates the headroom scale alongside Composer. Luna is the lightweight tier — cheapest and fastest in the family, but a step down in what it can handle unsupervised. Sol is OpenAI's flagship with the highest reasoning ceiling on Codex; route Sol through Codex rather than Cursor so it can use Codex's read-only and workspace-write sandbox controls.";

export const CODEX_IMPLEMENT_REVIEW_EFFORT_PHRASE =
  "at high reasoning effort unless `--effort` overrides";

export const HOW_TO_APPLY_RANKINGS = [
  "These are defaults, not limits. If a cheaper model misses the bar, rerun or redo the work with a stronger model without asking. Judge the output, not the price tag.",
  "Usage headroom is a tie-breaker only. For anything that ships, prioritize intelligence, then taste, then usage efficiency.",
  "Use `composer-2.5` by default for bulk clear-spec implementation, migrations, mechanical refactors, and focused test additions.",
  `Use \`gpt-5.5\` ${CODEX_IMPLEMENT_REVIEW_EFFORT_PHRASE} as the default Codex model for harder implementation, repository analysis, difficult debugging, and escalation when Composer 2.5 misses the quality bar. Prefer \`gpt-5.6-terra\` when usage headroom matters more than depth: it matches \`gpt-5.5\` on intelligence with better layout judgment and terser output, at roughly half the usage draw.`,
  "Use `gpt-5.6-luna` for high-volume, low-stakes Codex exploration — log sifting, dependency tracing, evidence gathering. Escalate to `gpt-5.5` when Luna misses.",
  "`gpt-5.6-sol` is OpenAI's flagship on Codex. Use it for taste-sensitive or especially difficult bounded Codex implementation/review (`--task-class taste-sensitive`, `ui`, `copy`, or `api-design`) when GPT-5.5 is not enough; keep routine Cursor work on `composer-2.5`.",
  "User-facing UI, copy, and API design require taste of at least 7. Fable chooses the direction; Codex may implement a precise approved specification.",
  "Use Fable 5 or Opus 4.8 for reviews of plans and implementations. Use GPT-5.5 as an additional independent perspective when the risk justifies it.",
  "Do not use Haiku.",
];

export const WORKER_DESCRIPTIONS = [
  "`composer-implement`: executes a clear, approved implementation contract through Cursor Composer 2.5.",
  `\`codex-implement\`: handles harder implementation or reruns work that did not meet the bar through GPT-5.5 ${CODEX_IMPLEMENT_REVIEW_EFFORT_PHRASE}, with GPT-5.6 Sol for taste-sensitive task classes.`,
  `\`codex-check\`: independently checks correctness, regressions, security, and acceptance criteria through GPT-5.5 ${CODEX_IMPLEMENT_REVIEW_EFFORT_PHRASE}, with GPT-5.6 Sol for taste-sensitive task classes.`,
  "`codex-explore`: performs token-heavy repository exploration and evidence gathering through GPT-5.6 Luna by default.",
  "`opus-explore`, `opus-check`, `opus-implement`: first-tier availability-fallback workers that forward to the `claude` backend (Opus 4.8) when Codex is unavailable or the parent explicitly routes there; not the default route and not the taste-review path (`opus-review`).",
  "`grok-explore`, `grok-check`, `grok-implement`: second-tier availability-fallback workers that forward to the `composer` backend with Grok 4.5 when Claude/Opus is unavailable; not the default route, not taste escalation, and not the taste-review path (`opus-review`).",
  "Fable reviews worker results, inspects important diffs and verification, and makes every final decision.",
];

export const COMPOSER_ORCHESTRATOR_MODE_STACK =
  "(O) Composer -> opus-explore -> composer-implement -> opus-check";

export const DELEGATION_CONTRACT_ITEMS = [
  "the exact outcome;",
  "the files or subsystem in scope when known;",
  "behavior that must remain unchanged;",
  "required tests or verification;",
  "prohibited actions and explicit scope boundaries.",
];

export const OPUS_VS_SOL_DISTINCTION = {
  opus:
    "open-ended high-taste critique or design direction before criteria are fixed",
  sol: "bounded taste-sensitive Codex implementation/review against explicit criteria",
};

export function tasteSensitiveTaskClassList(): string {
  return TASTE_SENSITIVE_TASK_CLASSES.map((taskClass) => `\`${taskClass}\``).join(
    ", ",
  );
}

export function tasteSensitiveTaskClassListWithOr(): string {
  const classes = TASTE_SENSITIVE_TASK_CLASSES.map((taskClass) => `\`${taskClass}\``);
  if (classes.length <= 1) {
    return classes.join(", ");
  }
  return `${classes.slice(0, -1).join(", ")}, or ${classes.at(-1)}`;
}

function routeFor(
  routeId: RouteId,
  capabilities: RouteCapability[],
): RouteCapability {
  const route = capabilities.find((candidate) => candidate.id === routeId);
  if (!route) {
    throw new Error(`Missing route capability for ${routeId}`);
  }
  return route;
}

function tasteSensitiveModelFor(route: RouteCapability): string {
  const variant = route.task_class_variants?.find(
    (candidate) => candidate.task_class === "taste-sensitive",
  );
  if (!variant) {
    throw new Error(`Missing taste-sensitive variant for ${route.id}`);
  }
  return variant.model;
}

function displayModel(model: string): string {
  if (model.startsWith("gpt-")) {
    const [version, ...name] = model.slice("gpt-".length).split("-");
    const suffix = name
      .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
      .join(" ");
    return suffix ? `GPT-${version} ${suffix}` : `GPT-${version}`;
  }

  return model
    .split("-")
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function displayParentOrchestratorId(id: ParentOrchestratorId): string {
  switch (id) {
    case "fable":
      return "CC-Fable";
    case "codex-5.6-terra":
      return "Codex 5.6 Terra";
    case "codex-5.6-sol":
      return "Codex 5.6 Sol";
    case "cursor-fable-high":
      return "Cursor-Fable-High";
  }
}

export function formatCursorParentFallbackChain(): string {
  return CURSOR_PARENT_FALLBACK_CHAIN.map(displayParentOrchestratorId).join(
    ", then ",
  );
}

export function renderParentOrchestratorAvailabilitySection(): string {
  return `## Parent orchestrator availability

When the preferred parent orchestrator is unavailable (${PARENT_ORCHESTRATOR_UNAVAILABLE_TRIGGERS}), Cursor follows an ordered parent availability chain. Planning, architecture, ambiguity resolution, route selection, final judgment, and user communication stay in the **active** parent session — whichever parent is actually running.

### Cursor parent chain

1. **CC-Fable** (Claude Code Fable 5) — primary parent orchestrator when available.
2. **Codex-Sol** (\`codex-5.6-sol\` / GPT-5.6 Sol as parent) — first fallback when CC-Fable is unavailable. ${CODEX_SOL_PARENT_FALLBACK_EFFORT_POLICY}
3. **Cursor-Fable-High** (Fable in Cursor at high reasoning) — second fallback when Codex-Sol is also unavailable.

This is **parent-orchestrator availability**, not worker routing. **Distinct from worker Sol authorization:** Sol as a *worker* still requires explicit parent authorization and is never an automatic *worker* fallback. Parent-orchestrator Codex-Sol is an availability recovery path for the parent session only.
`;
}

export function renderComposerOrchestratorModeSection(): string {
  return `## Composer orchestrator mode

Composer orchestrator mode is a fixed opt-in economy policy for a Composer parent. It is never the default parent policy, never changes the CC-Fable → Codex-Sol → Cursor-Fable-High parent availability order, and never changes normal worker routing when economy mode is inactive.

Fixed opt-in economy tree: ${COMPOSER_ORCHESTRATOR_MODE_STACK}.

While economy mode is active, explicitly exclude Fable, Codex 5.6 Sol, and default Codex workers (\`codex-explore\`, \`codex-implement\`, and \`codex-check\`) from route selection. The parent must not choose Fable, Sol, or default Codex workers as a quiet upgrade path for economy work.

Escalation behavior: remain on the economy stack unless a worker fails; never silently upgrade to Fable, Sol, or default Codex workers. If an economy worker fails, stop for an explicit parent decision before any route outside the economy stack is used.
`;
}

type RoutingDefaults = {
  explore: RouteCapability;
  composerImplement: RouteCapability;
  codexImplement: RouteCapability;
  codexCheck: RouteCapability;
  tasteSensitiveImplementModel: string;
  tasteSensitiveCheckModel: string;
};

type TasteSensitiveOverrideDescription =
  | string
  | {
      shared: string;
      implement: string;
      check: string;
    };

function routingDefaults(
  capabilities: RouteCapability[] = defaultRouteCapabilities(),
): RoutingDefaults {
  const codexImplement = routeFor("codex-implement", capabilities);
  const codexCheck = routeFor("codex-check", capabilities);

  return {
    explore: routeFor("codex-explore", capabilities),
    composerImplement: routeFor("composer-implement", capabilities),
    codexImplement,
    codexCheck,
    tasteSensitiveImplementModel: tasteSensitiveModelFor(codexImplement),
    tasteSensitiveCheckModel: tasteSensitiveModelFor(codexCheck),
  };
}

function codexDefaultRoutingBullets(defaults: RoutingDefaults): string[] {
  const effortPhrase = ` ${CODEX_IMPLEMENT_REVIEW_EFFORT_PHRASE}`;
  if (defaults.codexImplement.model === defaults.codexCheck.model) {
    return [
      `\`${defaults.codexImplement.model}\`: Codex ${defaults.codexImplement.mode}/${defaults.codexCheck.mode} default for harder implementation, debugging, escalation, and routine checks${effortPhrase}.`,
    ];
  }

  return [
    `\`${defaults.codexImplement.model}\`: Codex ${defaults.codexImplement.mode} default for harder implementation, debugging, and escalation${effortPhrase}.`,
    `\`${defaults.codexCheck.model}\`: Codex ${defaults.codexCheck.mode} default for routine checks${effortPhrase}.`,
  ];
}

function tasteSensitiveRoutingBullets(
  defaults: RoutingDefaults,
  overrideDescription: TasteSensitiveOverrideDescription,
): string[] {
  const descriptions =
    typeof overrideDescription === "string"
      ? {
          shared: overrideDescription,
          implement: overrideDescription,
          check: overrideDescription,
        }
      : overrideDescription;
  if (
    defaults.tasteSensitiveImplementModel ===
    defaults.tasteSensitiveCheckModel
  ) {
    return [
      `\`${defaults.tasteSensitiveImplementModel}\`: Codex ${defaults.codexImplement.mode}/${defaults.codexCheck.mode} default for taste-sensitive task classes (${tasteSensitiveTaskClassList()}) ${descriptions.shared}`,
    ];
  }

  return [
    `\`${defaults.tasteSensitiveImplementModel}\`: Codex ${defaults.codexImplement.mode} default for taste-sensitive task classes (${tasteSensitiveTaskClassList()}) ${descriptions.implement}`,
    `\`${defaults.tasteSensitiveCheckModel}\`: Codex ${defaults.codexCheck.mode} default for taste-sensitive task classes (${tasteSensitiveTaskClassList()}) ${descriptions.check}`,
  ];
}

export function gpt56WorkerRoutingBullets(
  capabilities: RouteCapability[] = defaultRouteCapabilities(),
  tasteSensitiveOverrideDescription: TasteSensitiveOverrideDescription =
    "unless the matching mode override is non-empty.",
): string[] {
  const defaults = routingDefaults(capabilities);
  return [
    `\`${defaults.explore.model}\`: Codex ${defaults.explore.mode} default for high-volume, low-stakes exploration and evidence gathering.`,
    ...codexDefaultRoutingBullets(defaults),
    ...tasteSensitiveRoutingBullets(defaults, tasteSensitiveOverrideDescription),
    `${displayModel(defaults.composerImplement.model)} remains the default Cursor implementation worker; \`FABLE_ORCHESTRATOR_COMPOSER_MODEL=${defaults.tasteSensitiveImplementModel}\` is an explicit override escape hatch, not the default.`,
    EXPLICIT_OVERRIDE_RULE,
  ];
}

export function gpt56WorkerRoutingSection(
  surfaceNote: string,
  capabilities: RouteCapability[] = defaultRouteCapabilities(),
): string {
  const bullets = gpt56WorkerRoutingBullets(
    capabilities,
    {
      shared:
        "unless the matching `FABLE_ORCHESTRATOR_IMPLEMENT_MODEL` or `FABLE_ORCHESTRATOR_REVIEW_MODEL` override is non-empty.",
      implement:
        "unless `FABLE_ORCHESTRATOR_IMPLEMENT_MODEL` is non-empty.",
      check:
        "unless `FABLE_ORCHESTRATOR_REVIEW_MODEL` is non-empty.",
    },
  )
    .map((bullet) => `- ${bullet}`)
    .join("\n");
  return `## GPT-5.6 Worker Routing\n\n${bullets}\n\n${surfaceNote}`;
}

export function routePreferenceSummary(
  capabilities: RouteCapability[] = defaultRouteCapabilities(),
): string {
  const defaults = routingDefaults(capabilities);
  const codexPreference =
    defaults.codexImplement.model === defaults.codexCheck.model
      ? `${displayModel(defaults.codexImplement.model)} for hard Codex implement/review`
      : `${displayModel(defaults.codexImplement.model)} for hard Codex implementation and ${displayModel(defaults.codexCheck.model)} for independent Codex review`;
  const tastePreference =
    defaults.tasteSensitiveImplementModel === defaults.tasteSensitiveCheckModel
      ? `${displayModel(defaults.tasteSensitiveImplementModel)} for ${OPUS_VS_SOL_DISTINCTION.sol}`
      : `${displayModel(defaults.tasteSensitiveImplementModel)} for taste-sensitive implementation and ${displayModel(defaults.tasteSensitiveCheckModel)} for taste-sensitive review`;
  return `Prefer ${displayModel(defaults.composerImplement.model)} for clear mechanical implementation, ${codexPreference}, ${displayModel(defaults.explore.model)} for repo exploration, ${tastePreference}, and Opus 4.8 for ${OPUS_VS_SOL_DISTINCTION.opus}.`;
}

export function routePreferenceSummaryForCursorDocs(
  capabilities: RouteCapability[] = defaultRouteCapabilities(),
): string {
  const defaults = routingDefaults(capabilities);
  const codexPreference =
    defaults.codexImplement.model === defaults.codexCheck.model
      ? `${displayModel(defaults.codexImplement.model)} for hard Codex implement/review`
      : `${displayModel(defaults.codexImplement.model)} for hard Codex implementation and ${displayModel(defaults.codexCheck.model)} for independent Codex review`;
  const tastePreference =
    defaults.tasteSensitiveImplementModel === defaults.tasteSensitiveCheckModel
      ? `${displayModel(defaults.tasteSensitiveImplementModel)} for ${OPUS_VS_SOL_DISTINCTION.sol}`
      : `${displayModel(defaults.tasteSensitiveImplementModel)} for taste-sensitive implementation and ${displayModel(defaults.tasteSensitiveCheckModel)} for taste-sensitive review`;
  return `Prefer ${displayModel(defaults.composerImplement.model)} for clear mechanical implementation, ${codexPreference}, ${displayModel(defaults.explore.model)} for repo exploration, ${tastePreference}, and Opus 4.8 when the task needs ${OPUS_VS_SOL_DISTINCTION.opus}.`;
}

export function cursorRouteSelectionBullets(
  capabilities: RouteCapability[] = defaultRouteCapabilities(),
): string[] {
  const defaults = routingDefaults(capabilities);
  const composerEscalationLabel =
    defaults.composerImplement.model === "composer-2.5"
      ? "Composer"
      : displayModel(defaults.composerImplement.model);
  return [
    // The parent-orchestrator fallback chain is a deliberate policy constant, not
    // derived from the codex worker default (W-000085 review round 1).
    `Use ${formatCursorParentFallbackChain()} as the ordered parent orchestrator fallback chain when Fable is unavailable in Cursor (${PARENT_ORCHESTRATOR_UNAVAILABLE_TRIGGERS}). ${CODEX_SOL_PARENT_FALLBACK_EFFORT_POLICY}`,
    `Use Cursor ${displayModel(defaults.composerImplement.model)} for clear, mechanical, high-volume implementation after the approach is approved.`,
    `Use Codex analyze for read-only repo exploration, dependency tracing, and large evidence-gathering tasks; defaults to ${displayModel(defaults.explore.model)}.`,
    `Use Codex implement for difficult implementation, debugging-heavy fixes, or escalation after ${composerEscalationLabel} misses the bar; defaults to ${displayModel(defaults.codexImplement.model)} ${CODEX_IMPLEMENT_REVIEW_EFFORT_PHRASE}, or ${displayModel(defaults.tasteSensitiveImplementModel).split(" ").at(-1)} for taste-sensitive task classes.`,
    `Use Codex review for read-only correctness, regression, security, and acceptance-criteria checks; defaults to ${displayModel(defaults.codexCheck.model)} ${CODEX_IMPLEMENT_REVIEW_EFFORT_PHRASE}, or ${displayModel(defaults.tasteSensitiveCheckModel).split(" ").at(-1)} for taste-sensitive task classes.`,
    `Use Opus 4.8 review for ${OPUS_VS_SOL_DISTINCTION.opus}; use ${displayModel(defaults.tasteSensitiveCheckModel).split(" ").at(-1)} for ${OPUS_VS_SOL_DISTINCTION.sol}.`,
  ];
}

export function defaultRouteCapabilities() {
  return routeCapabilities(DEFAULT_ENV);
}

export function renderRoutingPolicyMd(
  capabilities: RouteCapability[] = defaultRouteCapabilities(),
): string {
  const defaults = routingDefaults(capabilities);
  return `# Routing Policy

## Keep in Fable

- requirements clarification and architecture decisions;
- decomposition of multi-stage work;
- tasks requiring frequent user interaction;
- final review of worker evidence and tradeoffs;
- small changes where delegation overhead exceeds expected savings.

## Route to \`codex-explore\`

- repository maps and dependency tracing;
- locating all call sites or configuration surfaces;
- verbose log or test-failure analysis;
- gathering file-level evidence before Fable decides on a fix.

The route is ${defaults.explore.sandbox} and defaults to \`${defaults.explore.model}\`.

## Route to \`composer-implement\`

- a well-specified feature slice;
- mechanical refactors with explicit boundaries;
- migrations and repetitive multi-file edits;
- test additions for already-defined behavior;
The route uses Cursor in non-interactive write mode and defaults to ${displayModel(defaults.composerImplement.model)}. Keep taste-sensitive UI/UX, user-facing copy, and API-design work on Codex (\`${defaults.tasteSensitiveImplementModel}\`) unless the parent explicitly forces a Composer model with \`FABLE_ORCHESTRATOR_COMPOSER_MODEL\`. Fable must inspect the resulting diff and verification.

## Route to \`codex-implement\`

- a difficult implementation requiring stronger unsupervised reasoning;
- a focused bug fix with non-obvious root cause;
- a rerun after ${displayModel(defaults.composerImplement.model)} misses the quality bar;
- work where ${displayModel(defaults.codexImplement.model)}'s steerability is more important than cost.

The route is ${defaults.codexImplement.sandbox} and defaults to \`${defaults.codexImplement.model}\` ${CODEX_IMPLEMENT_REVIEW_EFFORT_PHRASE}; taste-sensitive task classes default to \`${defaults.tasteSensitiveImplementModel}\` unless \`FABLE_ORCHESTRATOR_IMPLEMENT_MODEL\` is set.

## Route to \`codex-check\`

- independent review of a completed diff;
- regression, security, or correctness checks;
- validation that acceptance criteria are covered.

The route is ${defaults.codexCheck.sandbox} and defaults to \`${defaults.codexCheck.model}\` ${CODEX_IMPLEMENT_REVIEW_EFFORT_PHRASE}; taste-sensitive task classes default to \`${defaults.tasteSensitiveCheckModel}\` unless \`FABLE_ORCHESTRATOR_REVIEW_MODEL\` is set.

## Route to \`opus-review\`

- high-taste review of UI/UX, product polish, accessibility, or user-facing copy;
- API ergonomics, component composition, and long-lived abstraction review;
- developer-experience docs, prompt wording, or skill/plugin instruction review;
- second-opinion critique after Codex or Composer produced a solution where design quality matters more than raw correctness.

The route is read-only and uses Opus 4.8. Do not use it for bulk implementation, mechanical migrations, large repo scans, straightforward test additions, or generic CI/log summarization.

${renderParentOrchestratorAvailabilitySection()}

${renderComposerOrchestratorModeSection()}

## Backend availability fallback

When a worker backend is unavailable (usage limit, authentication failure, or missing binary), the runner classifies the outage as \`backend_unavailable\` and emits a machine-readable fallback hint on stderr. Ordinary task failures do not carry this hint. Workers surface the hint verbatim; they never substitute silently.

### Tier 1 — Codex → Opus (Claude)

When **Codex** is unavailable, stderr includes \`fallback: { backend: "claude", model: <resolved> }\`.

**Default (parent-driven):** Re-delegate explicitly to the matching first-tier availability-fallback worker (\`opus-explore\`, \`opus-check\`, or \`opus-implement\`) or invoke \`fable-orchestrator run --backend claude --mode <analyze|review|implement>\` directly. Record the switch with \`annotate --outcome escalated --escalated-to <model>\` on the failed run, or annotate the fallback run's outcome. Do not silently substitute inside a worker.

**Opt-in automatic retry:** Set \`FABLE_ORCHESTRATOR_FALLBACK=claude\` (or pass \`--fallback claude\`) for unattended runs. The runner retries an availability-classified Codex failure exactly once on the \`claude\` backend and links both trace records through \`fallback_of\`.

### Tier 2 — Opus → Grok (Composer)

When **Claude/Opus** is also unavailable (or a \`claude\` backend run fails with availability), stderr includes \`fallback: { backend: "composer", model: <grok-4.5 or FABLE_ORCHESTRATOR_GROK_MODEL> }\`.

**Default (parent-driven):** Re-delegate explicitly to the matching second-tier worker (\`grok-explore\`, \`grok-check\`, or \`grok-implement\`) or invoke \`fable-orchestrator run --backend composer --mode <analyze|review|implement> --route <grok-explore|grok-check|grok-implement>\` directly. Record the switch with \`annotate --escalated-to\` as above.

**Opt-in automatic retry:** When \`FABLE_ORCHESTRATOR_FALLBACK=claude\` is set, an availability-classified Claude failure during that retry chain continues once more on the \`composer\` backend with the Grok route (\`grok-4.5\` by default). Linked trace records still use \`fallback_of\`.

**Quality bar:** Opus 4.8 ranks below GPT-5.5 on the intelligence heuristic (7 versus 8). Grok is availability recovery, not taste escalation. The parent review bar is unchanged. \`report\` keeps fallback runs distinguishable via \`fallback_of\` so acceptance rates stay honest.

**Distinct from taste and quality escalation:** \`opus-review\` is the taste-review path (content-triggered, read-only critique). \`grok-*\` workers are second-tier availability recovery when Anthropic is unavailable — not taste escalation and not a substitute for \`opus-review\`. Availability fallback is outage-driven or parent-explicit. Quality escalation after a completed-but-rejected run stays a parent decision through \`annotate --escalated-to\`, never a runner behavior.

${renderRolloutGatesSection(capabilities)}

## Avoid Delegation

- the request is ambiguous or high stakes;
- the task needs secrets not already available through approved local tooling;
- the worker would need unrestricted filesystem or shell access;
- the task includes committing, pushing, merging, or deploying without explicit user approval;
- the worker output would be larger than doing the task directly.

## Mixed Tasks

Split mixed tasks into sequential bounded calls:

1. \`codex-explore\` to collect evidence;
2. Fable decides the approach;
3. \`composer-implement\` with the chosen approach and acceptance criteria;
4. escalate to \`codex-implement\` only if Composer misses the bar;
5. \`codex-check\` when independent correctness/security review is worth its cost;
6. \`opus-review\` when the output needs taste/API/UX/prompt critique before final acceptance;
7. Fable makes the final decision and reports to the user.
`;
}

function rolloutStageList(): string {
  return "`fixture`, `shadow`, `opt-in`, `limited-cohort`, and `default`";
}

export function renderRolloutGatesSection(
  capabilities: RouteCapability[] = defaultRouteCapabilities(),
): string {
  const defaults = routingDefaults(capabilities);
  const composerLabel = displayModel(defaults.composerImplement.model);
  const exploreModel = defaults.explore.model;
  const implementModel = defaults.codexImplement.model;
  const checkModel = defaults.codexCheck.model;
  const tasteImplement = defaults.tasteSensitiveImplementModel;
  const tasteCheck = defaults.tasteSensitiveCheckModel;

  const transitionRows = (
    Object.keys(ROLLOUT_TRANSITION_CRITERIA) as RolloutTransition[]
  )
    .map((transition) => {
      const criteria = ROLLOUT_TRANSITION_CRITERIA[transition];
      return `| \`${transition}\` | ${criteria.minSampleSize} | ${criteria.minSelectionMatchRate} | ${criteria.minSelectionCoverageRate} | ${criteria.maxErrorRate} | ${criteria.maxAvailabilityFallbackRate} |`;
    })
    .join("\n");

  return `## Staged routing rollout

Rollout gates coordinate canonical route selection, the bounded one-pass availability fallback engine, routing-trace v2 writes, and future delegation activation. Stages progress only after telemetry gates pass **and** \`humanApproved=true\`; unset or invalid \`FABLE_ORCHESTRATOR_ROLLOUT_STAGE\` preserves legacy off behavior with no automatic promotion.

\`FABLE_ORCHESTRATOR_ROLLOUT_HUMAN_APPROVED=1\` is a runtime prerequisite for \`shadow\`, \`opt-in\`, \`limited-cohort\`, and \`default\` projection. Without it, the configured stage does not activate selection, fallback, or delegation (fixture/off projection), while routing-trace v2 writing remains enabled unless explicitly rolled back.

### Stages

| Stage | Selection | Fallback | Execution |
| --- | --- | --- | --- |
| \`fixture\` | off | off | legacy backend/mode only |
| \`shadow\` | shadow | shadow | legacy control path; observational shadow only |
| \`opt-in\` | active when \`FABLE_ORCHESTRATOR_ROLLOUT_OPT_IN=1\` | same | canonical selection only for exact opt-in |
| \`limited-cohort\` | active for deterministic cohort hash | same | bounded \`FABLE_ORCHESTRATOR_COHORT_ID\` + percent |
| \`default\` | active | active | canonical selection for eligible aliases |

Shadow mode never changes execution: the runner invokes the same legacy backend/model as control while recording proposed canonical selection for \`${composerLabel}\` implementation defaults and Codex defaults (\`${exploreModel}\` explore, \`${implementModel}\` implement, \`${checkModel}\` review, \`${tasteImplement}\` / \`${tasteCheck}\` taste-sensitive variants).

### Independent rollback switches

Set any of these to \`0\` to roll back without changing the configured stage:

- \`FABLE_ORCHESTRATOR_ROLLOUT_SELECTION\`
- \`FABLE_ORCHESTRATOR_ROLLOUT_FALLBACK\`
- \`FABLE_ORCHESTRATOR_ROLLOUT_TRACE_V2\`
- \`FABLE_ORCHESTRATOR_ROLLOUT_DELEGATION\` (library gate only; CLI delegation is not activated here)

Legacy per-feature selection and fallback env controls (\`FABLE_ORCHESTRATOR_ROUTE_SELECTION\`, \`FABLE_ORCHESTRATOR_FALLBACK_ENGINE\`) retain precedence only when rollout stage is unset or \`humanApproved=true\`; configured \`shadow\`, \`opt-in\`, \`limited-cohort\`, or \`default\` without approval keeps selection, fallback, and delegation off while routing-trace v2 stays on. Legacy \`FABLE_ORCHESTRATOR_TRACE_V2\` and rollout rollback switches are applied afterward; rollback flags always win for safety.

Routing-trace v2 writing is projected on for unset, \`fixture\`, \`shadow\`, \`opt-in\`, \`limited-cohort\`, and \`default\` unless explicitly disabled by legacy \`FABLE_ORCHESTRATOR_TRACE_V2=0\` or rollout \`FABLE_ORCHESTRATOR_ROLLOUT_TRACE_V2=0\`.

Automatic fallback remains **availability-only**. Completed-but-low-quality output never triggers fallback or quality escalation.

### Transition telemetry (schema v${ROLLOUT_GATES_SCHEMA_VERSION})

Each transition requires named numeric entry/exit criteria and explicit human approval. Evaluation returns visible unmet reasons when blocked.

| Transition | min sample | min match | min coverage | max error | max availability fallback |
| --- | ---: | ---: | ---: | ---: | ---: |
${transitionRows}

Additional zero-tolerance gates on every transition: redaction violations, schema violations, budget-reset violations, and guardrail violations.

### Guardrails validated at every stage

- planned/screenshot inventory is never runnable;
- GLM remains absent from registry, stacks, and probes;
- Fable stays parent-only and is never a worker candidate;
- Sol requires explicit parent authorization and is never an automatic fallback;
- taste-review (\`opus-review\`) has no automatic fallback;
- completed-low-quality disposition is terminal and never retryable or fallback-eligible;
- no quality-based fallback escalation.

Stages: ${rolloutStageList()}.
`;
}

export function renderWorkloadMatrixGuidanceSection(
  capabilities: RouteCapability[] = defaultRouteCapabilities(),
): string {
  const defaults = routingDefaults(capabilities);
  const codexDefaultRows =
    defaults.codexImplement.model === defaults.codexCheck.model
      ? `| \`${defaults.codexImplement.model}\` | Codex | Default hard implementation and review ${CODEX_IMPLEMENT_REVIEW_EFFORT_PHRASE}: difficult debugging, escalation after ${displayModel(defaults.composerImplement.model)} misses the bar, and routine independent checks. |`
      : `| \`${defaults.codexImplement.model}\` | Codex | Default hard implementation ${CODEX_IMPLEMENT_REVIEW_EFFORT_PHRASE}: difficult debugging and escalation after ${displayModel(defaults.composerImplement.model)} misses the bar. |
| \`${defaults.codexCheck.model}\` | Codex | Default read-only review ${CODEX_IMPLEMENT_REVIEW_EFFORT_PHRASE}: routine independent checks. |`;
  const tasteSensitiveRows =
    defaults.tasteSensitiveImplementModel ===
    defaults.tasteSensitiveCheckModel
      ? `| \`${defaults.tasteSensitiveImplementModel}\` | Codex | Taste-sensitive implementation and read-only review for ${tasteSensitiveTaskClassListWithOr()} task classes; ${displayModel(defaults.tasteSensitiveImplementModel).split(" ").at(-1)} is OpenAI's flagship on Codex when ${displayModel(defaults.codexImplement.model).split(" ").at(-1)} is not enough. |`
      : `| \`${defaults.tasteSensitiveImplementModel}\` | Codex | Taste-sensitive implementation for ${tasteSensitiveTaskClassListWithOr()} task classes. |
| \`${defaults.tasteSensitiveCheckModel}\` | Codex | Taste-sensitive read-only review for ${tasteSensitiveTaskClassListWithOr()} task classes. |`;
  return `## Current GPT-5.6 routing guidance

The benchmark below is a dated 2026-07-05 snapshot and did not measure the
GPT-5.6 models. Its token, latency, and acceptance figures therefore remain
historical evidence for the listed models, not a benchmark ranking for Terra,
Luna, or Sol.

| Model | Available through | Reach for it when |
| --- | --- | --- |
| \`${defaults.explore.model}\` | Codex | Default read-only analysis: high-volume exploration, log sifting, dependency tracing, and evidence gathering. |
${codexDefaultRows}
${tasteSensitiveRows}
| \`${defaults.composerImplement.model}\` | Cursor Agent | Default clear-spec, high-volume implementation after the approach is approved. |

${displayModel(defaults.composerImplement.model)} remains the Cursor implementation default. \`FABLE_ORCHESTRATOR_COMPOSER_MODEL=${defaults.tasteSensitiveImplementModel}\`
remains an explicit Cursor override escape hatch, not a default. See
\`docs/orchestrator/model-selection.md\` for environment-variable targeting.
`;
}
