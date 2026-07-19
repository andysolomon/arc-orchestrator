import {
  TASTE_SENSITIVE_TASK_CLASSES,
  profileFor,
  routeCapabilities,
  type Profile,
  type RouteCapability,
} from "../fable-orchestrator/lib/routes";
import {
  ROLLOUT_GATES_SCHEMA_VERSION,
  ROLLOUT_TRANSITION_CRITERIA,
  type RolloutTransition,
} from "../fable-orchestrator/lib/rollout-gates";
import type { Mode, RouteId } from "../fable-orchestrator/lib/trace-schema";

const DEFAULT_ENV: Record<string, string | undefined> = {};

export const EXPLICIT_OVERRIDE_RULE = "Explicit model overrides always win.";

export const EXPLICIT_OVERRIDE_RULE_INLINE = "Explicit model overrides always win";

export const COMPOSER_OVERRIDE_ESCAPE_HATCH =
  "`ARC_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit override escape hatch, not the default.";

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
  "`ARC_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit Composer override, not the default.";

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
  "`gpt-5.6-sol` is OpenAI's flagship on Codex. Use the explicit `sol-explore`/`sol-check`/`sol-implement` diagnostic routes (or a non-empty model override) when Sol is required; `task_class` is observability metadata only and never selects a model. Keep routine Cursor work on `composer-2.5`.",
  "User-facing UI, copy, and API design require taste of at least 7. Fable chooses the direction; Codex may implement a precise approved specification.",
  "Use Fable 5 or Opus 4.8 for reviews of plans and implementations. Use GPT-5.5 as an additional independent perspective when the risk justifies it.",
  "Do not use Haiku.",
];

export const WORKER_DESCRIPTIONS = [
  "`composer-implement`: executes a clear, approved implementation contract through Cursor Composer 2.5.",
  `\`codex-implement\`: handles harder implementation or reruns work that did not meet the bar through GPT-5.5 ${CODEX_IMPLEMENT_REVIEW_EFFORT_PHRASE}.`,
  `\`codex-check\`: independently checks correctness, regressions, security, and acceptance criteria through GPT-5.5 ${CODEX_IMPLEMENT_REVIEW_EFFORT_PHRASE}.`,
  "`codex-explore`: performs token-heavy repository exploration and evidence gathering through GPT-5.6 Luna by default.",
  "`opus-explore`, `opus-check`, `opus-implement`: first-tier availability-fallback workers that forward to the `claude` backend (Opus 4.8) when Codex is unavailable or the parent explicitly routes there; not the default route and not the taste-review path (`opus-review`).",
  "`grok-explore`, `grok-check`, `grok-implement`: second-tier availability-fallback workers that forward to the `composer` backend with Grok 4.5 when Claude/Opus is unavailable; not the default route, not taste escalation, and not the taste-review path (`opus-review`).",
  "Fable reviews worker results, inspects important diffs and verification, and makes every final decision.",
];

export const ECO_ORCHESTRATOR_MODE_STACK =
  "(O) Eco -> opus-explore [| grok-explore] -> composer-implement -> opus-check [| grok-check]";

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

function tasteSensitiveModelFor(_route: CodexModeDefault): string {
  // Sol is reached through the explicit `sol-implement` route or a model
  // override — never through task_class matching.
  return "gpt-5.6-sol";
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

The orchestrator is the parent authority that owns planning, architecture, ambiguity resolution, route selection, final judgment, and user communication. It is distinct from both the incidental chat parent/model hosting a conversation and the bounded workers selected by worker routes. The runner selects this role only through the public \`--orchestrator <identity>\` / \`ARC_ORCHESTRATOR_ORCHESTRATOR=<identity>\` contract; it never infers orchestrator identity from a chat UI model. CLI selection takes precedence over the environment. When neither is supplied (including a blank environment value), the explicit backward-compatible value is \`null\` / not selected.

The initial identities are exactly \`fable\`, \`sol\`, \`eco\`, \`opus\`, and \`cursor-fable-high\`. The \`eco\` identity activates the fixed eco policy below. All other identities, and a null/unset identity, retain the existing routing and fallback behavior.

When the preferred parent orchestrator is unavailable (${PARENT_ORCHESTRATOR_UNAVAILABLE_TRIGGERS}), Cursor follows an ordered parent availability chain. Planning, architecture, ambiguity resolution, route selection, final judgment, and user communication stay in the **active** parent session — whichever parent is actually running.

### Cursor parent chain

1. **CC-Fable** (Claude Code Fable 5) — primary parent orchestrator when available.
2. **Codex-Sol** (\`codex-5.6-sol\` / GPT-5.6 Sol as parent) — first fallback when CC-Fable is unavailable. ${CODEX_SOL_PARENT_FALLBACK_EFFORT_POLICY}
3. **Cursor-Fable-High** (Fable in Cursor at high reasoning) — second fallback when Codex-Sol is also unavailable.

This is **parent-orchestrator availability**, not worker routing. Under ADR 0004, Fable and Sol are also legitimate *workers* at their exact automatic stack positions. Parent-orchestrator Codex-Sol remains an availability recovery path for the parent session.
`;
}

export function renderEcoOrchestratorModeSection(): string {
  return `## Eco orchestrator mode

Eco orchestrator mode is a fixed opt-in economy policy for an Eco parent. It is never the default parent policy, never changes the CC-Fable → Codex-Sol → Cursor-Fable-High parent availability order, and never changes normal worker routing when economy mode is inactive.

Activate the runner policy on each call with \`--orchestrator eco\`, or set \`ARC_ORCHESTRATOR_ORCHESTRATOR=eco\` for the session. The CLI flag takes precedence over the environment. On Claude Code, Pi, or Copilot this selects the economy worker routes but does not turn the current chat into an Eco parent. True Eco-parent orchestration requires Cursor: start from an active Cursor Composer chat and select the same runner identity there.

Fixed opt-in economy tree: ${ECO_ORCHESTRATOR_MODE_STACK}.

The runner maps \`analyze\` to \`opus-explore\` (Claude Opus 4.8, read-only), \`implement\` to \`composer-implement\` (Composer 2.5, workspace-write), and \`review\` to \`opus-check\` (Claude Opus 4.8, read-only). For analyze/review only, an availability failure on Opus retries once on \`grok-explore\` / \`grok-check\` (Grok 4.5). Implement has no automatic backup. This fixed selection is active whenever the resolved orchestrator identity is \`eco\`, independently of rollout-stage selection flags. Model override variables do not replace an economy worker.

CLI calls that omit \`--backend\` and \`--route\` are resolved to the applicable economy worker. An explicitly supplied conflicting \`--backend\` or \`--route\`, and a conflicting direct engine API request, fail visibly instead of silently ignoring the selected orchestrator identity.

While economy mode is active, explicitly exclude Fable, Codex 5.6 Sol, and direct Codex \`--backend codex\` workers from route selection. The parent must not choose Fable, Sol, or default Codex workers as a quiet upgrade path for economy work.

Escalation behavior: remain on the eco stack (Opus primary, optional Grok availability backup for analyze/review, Composer implement). No silent upgrade: never silently upgrade to Fable, Sol, or default Codex workers. If both the primary and in-stack backup fail, or implement fails, stop for an explicit parent decision before leaving the eco stack.
`;
}

export function renderMechanicalOpsPolicySection(): string {
  return `## Shipping authority

Workers are prohibited from commits, pushes, merges, GitHub mutations, and deployment. There are no mechanical worker routes or aliases. When the user authorizes shipping, the parent orchestrator performs the authorized \`git\` or \`gh\` operation directly after reviewing worker evidence.`;
}

// Codex automatic defaults are no longer reachable through public route
// aliases (codex-explore/implement/check were removed). They remain the real
// automatic ADR defaults, so the docs derive them from the same `profileFor`
// resolver execution uses, injectable for tests, instead of a removed route id.
export type CodexModeDefault = {
  backend: "codex";
  mode: Mode;
  model: string;
  sandbox: Profile["sandbox"];
};

export type CodexRouteDefaults = {
  explore: CodexModeDefault;
  implement: CodexModeDefault;
  check: CodexModeDefault;
};

export function defaultCodexRouteDefaults(
  env: Record<string, string | undefined> = DEFAULT_ENV,
): CodexRouteDefaults {
  const build = (mode: Mode): CodexModeDefault => {
    const profile = profileFor(env, mode);
    return { backend: "codex", mode, model: profile.model, sandbox: profile.sandbox };
  };
  return {
    explore: build("analyze"),
    implement: build("implement"),
    check: build("review"),
  };
}

type RoutingDefaults = {
  explore: CodexModeDefault;
  composerImplement: RouteCapability;
  codexImplement: CodexModeDefault;
  codexCheck: CodexModeDefault;
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
  codexDefaults: CodexRouteDefaults = defaultCodexRouteDefaults(),
): RoutingDefaults {
  return {
    explore: codexDefaults.explore,
    composerImplement: routeFor("composer-implement", capabilities),
    codexImplement: codexDefaults.implement,
    codexCheck: codexDefaults.check,
    tasteSensitiveImplementModel: tasteSensitiveModelFor(codexDefaults.implement),
    tasteSensitiveCheckModel: tasteSensitiveModelFor(codexDefaults.check),
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
  _overrideDescription: TasteSensitiveOverrideDescription,
): string[] {
  return [
    `\`${defaults.tasteSensitiveImplementModel}\`: explicit \`sol-explore\`/\`sol-check\`/\`sol-implement\` Codex diagnostic routes for flagship Sol; \`task_class\` never selects this model.`,
  ];
}

export function gpt56WorkerRoutingBullets(
  capabilities: RouteCapability[] = defaultRouteCapabilities(),
  tasteSensitiveOverrideDescription: TasteSensitiveOverrideDescription =
    "unless the matching mode override is non-empty.",
  codexDefaults: CodexRouteDefaults = defaultCodexRouteDefaults(),
): string[] {
  const defaults = routingDefaults(capabilities, codexDefaults);
  return [
    `\`${defaults.explore.model}\`: Codex ${defaults.explore.mode} default for high-volume, low-stakes exploration and evidence gathering.`,
    ...codexDefaultRoutingBullets(defaults),
    ...tasteSensitiveRoutingBullets(defaults, tasteSensitiveOverrideDescription),
    `${displayModel(defaults.composerImplement.model)} remains the default Cursor implementation worker; \`ARC_ORCHESTRATOR_COMPOSER_MODEL=${defaults.tasteSensitiveImplementModel}\` is an explicit override escape hatch, not the default.`,
    EXPLICIT_OVERRIDE_RULE,
  ];
}

export function gpt56WorkerRoutingSection(
  surfaceNote: string,
  capabilities: RouteCapability[] = defaultRouteCapabilities(),
  codexDefaults: CodexRouteDefaults = defaultCodexRouteDefaults(),
): string {
  const bullets = gpt56WorkerRoutingBullets(
    capabilities,
    {
      shared:
        "unless the matching `ARC_ORCHESTRATOR_IMPLEMENT_MODEL` or `ARC_ORCHESTRATOR_REVIEW_MODEL` override is non-empty.",
      implement:
        "unless `ARC_ORCHESTRATOR_IMPLEMENT_MODEL` is non-empty.",
      check:
        "unless `ARC_ORCHESTRATOR_REVIEW_MODEL` is non-empty.",
    },
    codexDefaults,
  )
    .map((bullet) => `- ${bullet}`)
    .join("\n");
  return `## GPT-5.6 Worker Routing\n\n${bullets}\n\n${surfaceNote}`;
}

export function routePreferenceSummary(
  capabilities: RouteCapability[] = defaultRouteCapabilities(),
  codexDefaults: CodexRouteDefaults = defaultCodexRouteDefaults(),
): string {
  const defaults = routingDefaults(capabilities, codexDefaults);
  const codexPreference =
    defaults.codexImplement.model === defaults.codexCheck.model
      ? `${displayModel(defaults.codexImplement.model)} for hard Codex implement/review`
      : `${displayModel(defaults.codexImplement.model)} for hard Codex implementation and ${displayModel(defaults.codexCheck.model)} for independent Codex review`;
  const tastePreference = `${displayModel(defaults.tasteSensitiveImplementModel)} via explicit \`sol-implement\` for ${OPUS_VS_SOL_DISTINCTION.sol}`;
  return `Prefer ${displayModel(defaults.composerImplement.model)} for clear mechanical implementation, ${codexPreference}, ${displayModel(defaults.explore.model)} for repo exploration, ${tastePreference}, and Opus 4.8 for ${OPUS_VS_SOL_DISTINCTION.opus}. Use \`workload_class\` for automatic implementation stacks; \`task_class\` is metadata only.`;
}

export function routePreferenceSummaryForCursorDocs(
  capabilities: RouteCapability[] = defaultRouteCapabilities(),
  codexDefaults: CodexRouteDefaults = defaultCodexRouteDefaults(),
): string {
  const defaults = routingDefaults(capabilities, codexDefaults);
  const codexPreference =
    defaults.codexImplement.model === defaults.codexCheck.model
      ? `${displayModel(defaults.codexImplement.model)} for hard Codex implement/review`
      : `${displayModel(defaults.codexImplement.model)} for hard Codex implementation and ${displayModel(defaults.codexCheck.model)} for independent Codex review`;
  const tastePreference = `${displayModel(defaults.tasteSensitiveImplementModel)} via explicit \`sol-implement\` for ${OPUS_VS_SOL_DISTINCTION.sol}`;
  return `Prefer ${displayModel(defaults.composerImplement.model)} for clear mechanical implementation, ${codexPreference}, ${displayModel(defaults.explore.model)} for repo exploration, ${tastePreference}, and Opus 4.8 when the task needs ${OPUS_VS_SOL_DISTINCTION.opus}. Use \`workload_class\` for automatic implementation stacks; \`task_class\` is metadata only.`;
}

export function cursorRouteSelectionBullets(
  capabilities: RouteCapability[] = defaultRouteCapabilities(),
  codexDefaults: CodexRouteDefaults = defaultCodexRouteDefaults(),
): string[] {
  const defaults = routingDefaults(capabilities, codexDefaults);
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
    `Use Codex implement for difficult implementation, debugging-heavy fixes, or escalation after ${composerEscalationLabel} misses the bar; defaults to ${displayModel(defaults.codexImplement.model)} ${CODEX_IMPLEMENT_REVIEW_EFFORT_PHRASE}.`,
    `Use Codex review for read-only correctness, regression, security, and acceptance-criteria checks; defaults to ${displayModel(defaults.codexCheck.model)} ${CODEX_IMPLEMENT_REVIEW_EFFORT_PHRASE}.`,
    `Use Opus 4.8 review for ${OPUS_VS_SOL_DISTINCTION.opus}; use explicit \`sol-implement\` for ${OPUS_VS_SOL_DISTINCTION.sol}.`,
    `Automatic delegation omits \`--backend\`/\`--route\` and selects by mode plus \`workload_class\`; \`task_class\` is free-form observability metadata only.`,
  ];
}

export function defaultRouteCapabilities() {
  return routeCapabilities(DEFAULT_ENV);
}

export function renderRoutingPolicyMd(
  capabilities: RouteCapability[] = defaultRouteCapabilities(),
  codexDefaults: CodexRouteDefaults = defaultCodexRouteDefaults(),
): string {
  const defaults = routingDefaults(capabilities, codexDefaults);
  return `# Routing Policy

## Keep in Fable

- requirements clarification and architecture decisions;
- decomposition of multi-stage work;
- tasks requiring frequent user interaction;
- final review of worker evidence and tradeoffs;
- small changes where delegation overhead exceeds expected savings.

## Prefer automatic explore (\`--mode analyze\`, no \`--route\`)

- repository maps and dependency tracing;
- locating all call sites or configuration surfaces;
- verbose log or test-failure analysis;
- gathering file-level evidence before Fable decides on a fix.

Omit \`--backend\` and \`--route\` so runner-routing-v2 selects from the \`explore.read-only.v1\` ADR stack (Codex models participate only through that chain). The explore sandbox is read-only; default Codex analyze model remains \`${defaults.explore.model}\` when the chain lands on Codex.

## Route to \`composer-implement\`

- a well-specified feature slice;
- mechanical refactors with explicit boundaries;
- migrations and repetitive multi-file edits;
- test additions for already-defined behavior;
The route uses Cursor in non-interactive write mode and defaults to ${displayModel(defaults.composerImplement.model)}. For flagship \`gpt-5.6-sol\`, prefer automatic \`--mode implement\` with an appropriate \`--workload-class\` (or a non-empty \`ARC_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol\` override for local Composer experiments). \`task_class\` never selects a model. Fable must inspect the resulting diff and verification.

## Prefer automatic implement (\`--mode implement\`, no \`--route\`)

- a difficult implementation requiring stronger unsupervised reasoning;
- a focused bug fix with non-obvious root cause;
- a rerun after ${displayModel(defaults.composerImplement.model)} misses the quality bar;
- work where ${displayModel(defaults.codexImplement.model)}'s steerability is more important than cost.

Omit \`--backend\` and \`--route\` so runner-routing-v2 selects from the \`implement.workspace-write.v1\` ADR stack for the chosen \`--workload-class\`. Codex models (including Sol/Terra when placed by workload stacks) participate only through that chain. \`task_class\` is metadata only.

## Prefer automatic check (\`--mode review\`, no \`--route\`)

- independent review of a completed diff;
- regression, security, or correctness checks;
- validation that acceptance criteria are covered.

Omit \`--backend\` and \`--route\` so runner-routing-v2 selects from the \`check.read-only.v1\` ADR stack. The check sandbox is read-only. \`task_class\` is metadata only and never upgrades the review model.

## Route to \`opus-review\`

- high-taste review of UI/UX, product polish, accessibility, or user-facing copy;
- API ergonomics, component composition, and long-lived abstraction review;
- developer-experience docs, prompt wording, or skill/plugin instruction review;
- second-opinion critique after Codex or Composer produced a solution where design quality matters more than raw correctness.

The route is read-only and uses Opus 4.8. Do not use it for bulk implementation, mechanical migrations, large repo scans, straightforward test additions, or generic CI/log summarization.

${renderParentOrchestratorAvailabilitySection()}

${renderEcoOrchestratorModeSection()}

${renderMechanicalOpsPolicySection()}

## Backend availability fallback

When a worker backend is unavailable (usage limit, authentication failure, or missing binary), the runner classifies the outage as \`backend_unavailable\` and emits a machine-readable fallback hint on stderr. Ordinary task failures do not carry this hint. Workers surface the hint verbatim; they never substitute silently.

### Tier 1 — Codex → Opus (Claude)

When **Codex** is unavailable, stderr includes \`fallback: { backend: "claude", model: <resolved> }\`.

**Default (parent-driven):** Re-delegate explicitly to the matching first-tier availability-fallback worker (\`opus-explore\`, \`opus-check\`, or \`opus-implement\`) or invoke \`fable-orchestrator run --backend claude --mode <analyze|review|implement>\` directly. Record the switch with \`annotate --outcome escalated --escalated-to <model>\` on the failed run, or annotate the fallback run's outcome. Do not silently substitute inside a worker.

**Opt-in automatic retry:** Set \`ARC_ORCHESTRATOR_FALLBACK=claude\` (or pass \`--fallback claude\`) for unattended runs. The runner retries an availability-classified Codex failure exactly once on the \`claude\` backend and links both trace records through \`fallback_of\`.

### Tier 2 — Opus → Grok (Composer)

When **Claude/Opus** is also unavailable (or a \`claude\` backend run fails with availability), stderr includes \`fallback: { backend: "composer", model: <grok-4.5 or ARC_ORCHESTRATOR_GROK_MODEL> }\`.

**Default (parent-driven):** Re-delegate explicitly to the matching second-tier worker (\`grok-explore\`, \`grok-check\`, or \`grok-implement\`) or invoke \`fable-orchestrator run --backend composer --mode <analyze|review|implement> --route <grok-explore|grok-check|grok-implement>\` directly. Record the switch with \`annotate --escalated-to\` as above.

**Opt-in automatic retry:** When \`ARC_ORCHESTRATOR_FALLBACK=claude\` is set, an availability-classified Claude failure during that retry chain continues once more on the \`composer\` backend with the Grok route (\`grok-4.5\` by default). Linked trace records still use \`fallback_of\`.

### Tier 3 — Grok → MiniMax (key-gated)

When a MiniMax key is configured (\`ARC_ORCHESTRATOR_MINIMAX_API_KEY\` or \`MINIMAX_API_KEY\`), an availability-classified Grok failure during the retry chain continues once more on the \`minimax\` backend: the Claude CLI run against MiniMax's Anthropic-compatible endpoint (default model \`MiniMax-M3\`), with \`ANTHROPIC_BASE_URL\`/\`ANTHROPIC_API_KEY\` injected per invocation and the operator's normal Claude credentials untouched. As a pay-as-you-go API tier it survives subscription exhaustion of Codex, Claude, and Cursor. The backend is also directly selectable with \`--backend minimax\`, and the composer-tier outage hint names it when the key is configured. Without a MiniMax key the chain skips this tier.

### Tier 4 — MiniMax → Kimi (terminal, key-gated)

When a Kimi/Moonshot key is configured (\`ARC_ORCHESTRATOR_KIMI_API_KEY\`, \`MOONSHOT_API_KEY\`, or \`KIMI_API_KEY\`), an availability-classified failure on the preceding tier continues once more on the terminal direct \`kimi\` backend: the Claude CLI run against Moonshot's Anthropic-compatible endpoint (default model \`kimi-k3[1m]\`), with \`ANTHROPIC_BASE_URL\`/\`ANTHROPIC_AUTH_TOKEN\` injected per invocation (not \`ANTHROPIC_API_KEY\`), recommended Kimi env vars set per invocation, and inherited \`ANTHROPIC_API_KEY\` removed from the worker env so operator Claude credentials cannot conflict. When MiniMax is not configured, a Grok outage can jump directly to Kimi. Direct Kimi is always terminal — no further fallback. The backend is also directly selectable with \`--backend kimi\`. This is distinct from public \`kimi-*\` aliases and automatic stacks, which use OpenCode (\`moonshotai/kimi-k3\` via \`--backend opencode\`). Without a Kimi key the chain terminates after Grok or MiniMax exactly as before.

**Quality bar:** Opus 4.8 ranks below GPT-5.5 on the intelligence heuristic (7 versus 8). Grok is availability recovery, not taste escalation. The parent review bar is unchanged. \`report\` keeps fallback runs distinguishable via \`fallback_of\` so acceptance rates stay honest.

**Distinct from taste and quality escalation:** \`opus-review\` is the taste-review path (content-triggered, read-only critique). \`grok-*\` workers are second-tier availability recovery when Anthropic is unavailable — not taste escalation and not a substitute for \`opus-review\`. Availability fallback is outage-driven or parent-explicit. Quality escalation after a completed-but-rejected run stays a parent decision through \`annotate --escalated-to\`, never a runner behavior.

${renderRolloutGatesSection(capabilities, codexDefaults)}

## Avoid Delegation

- the request is ambiguous or high stakes;
- the task needs secrets not already available through approved local tooling;
- the worker would need unrestricted filesystem or shell access;
- the task includes committing, pushing, merging, or deploying without explicit user approval;
- the worker output would be larger than doing the task directly.

## Mixed Tasks

Split mixed tasks into sequential bounded calls:

1. automatic \`--mode analyze\` to collect evidence;
2. Fable decides the approach;
3. \`composer-implement\` with the chosen approach and acceptance criteria;
4. escalate via automatic \`--mode implement\` (workload_class) only if Composer misses the bar;
5. automatic \`--mode review\` when independent correctness/security review is worth its cost;
6. \`opus-review\` when the output needs taste/API/UX/prompt critique before final acceptance;
7. Fable makes the final decision and reports to the user.
`;
}

function rolloutStageList(): string {
  return "`fixture`, `shadow`, `opt-in`, `limited-cohort`, and `default`";
}

export function renderRolloutGatesSection(
  capabilities: RouteCapability[] = defaultRouteCapabilities(),
  codexDefaults: CodexRouteDefaults = defaultCodexRouteDefaults(),
): string {
  const defaults = routingDefaults(capabilities, codexDefaults);
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

Rollout gates coordinate canonical route selection, the bounded one-pass availability fallback engine, routing-trace v2 writes, and future delegation activation. Stages progress only after telemetry gates pass **and** \`humanApproved=true\`; unset or invalid \`ARC_ORCHESTRATOR_ROLLOUT_STAGE\` preserves legacy off behavior with no automatic promotion.

\`ARC_ORCHESTRATOR_ROLLOUT_HUMAN_APPROVED=1\` is a runtime prerequisite for \`shadow\`, \`opt-in\`, \`limited-cohort\`, and \`default\` projection. Without it, the configured stage does not activate selection, fallback, or delegation (fixture/off projection), while routing-trace v2 writing remains enabled unless explicitly rolled back.

### Stages

| Stage | Selection | Fallback | Execution |
| --- | --- | --- | --- |
| \`fixture\` | off | off | legacy backend/mode only |
| \`shadow\` | shadow | shadow | legacy control path; observational shadow only |
| \`opt-in\` | active when \`ARC_ORCHESTRATOR_ROLLOUT_OPT_IN=1\` | same | canonical selection only for exact opt-in |
| \`limited-cohort\` | active for deterministic cohort hash | same | bounded \`ARC_ORCHESTRATOR_COHORT_ID\` + percent |
| \`default\` | active | active | canonical selection for eligible aliases |

Shadow mode never changes execution: the runner invokes the same legacy backend/model as control while recording proposed canonical selection for \`${composerLabel}\` implementation defaults and Codex defaults (\`${exploreModel}\` explore, \`${implementModel}\` implement, \`${checkModel}\` review) plus automatic \`workload_class\` stacks for Sol.

### Independent rollback switches

Set any of these to \`0\` to roll back without changing the configured stage:

- \`ARC_ORCHESTRATOR_ROLLOUT_SELECTION\`
- \`ARC_ORCHESTRATOR_ROLLOUT_FALLBACK\`
- \`ARC_ORCHESTRATOR_ROLLOUT_TRACE_V2\`
- \`ARC_ORCHESTRATOR_ROLLOUT_DELEGATION\` (library gate only; CLI delegation is not activated here)

Legacy per-feature selection and fallback env controls (\`ARC_ORCHESTRATOR_ROUTE_SELECTION\`, \`ARC_ORCHESTRATOR_FALLBACK_ENGINE\`) retain precedence only when rollout stage is unset or \`humanApproved=true\`; configured \`shadow\`, \`opt-in\`, \`limited-cohort\`, or \`default\` without approval keeps selection, fallback, and delegation off while routing-trace v2 stays on. Legacy \`ARC_ORCHESTRATOR_TRACE_V2\` and rollout rollback switches are applied afterward; rollback flags always win for safety.

Routing-trace v2 writing is projected on for unset, \`fixture\`, \`shadow\`, \`opt-in\`, \`limited-cohort\`, and \`default\` unless explicitly disabled by legacy \`ARC_ORCHESTRATOR_TRACE_V2=0\` or rollout \`ARC_ORCHESTRATOR_ROLLOUT_TRACE_V2=0\`.

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
- Fable and Sol are ordinary ADR 0004 workers at their exact automatic placements (not parent-only / never-worker);
- taste-review (\`opus-review\`) has no automatic fallback;
- completed-low-quality disposition is terminal and never retryable or fallback-eligible;
- no quality-based fallback escalation.

Stages: ${rolloutStageList()}.
`;
}

export function renderWorkloadMatrixGuidanceSection(
  capabilities: RouteCapability[] = defaultRouteCapabilities(),
  codexDefaults: CodexRouteDefaults = defaultCodexRouteDefaults(),
): string {
  const defaults = routingDefaults(capabilities, codexDefaults);
  const codexDefaultRows =
    defaults.codexImplement.model === defaults.codexCheck.model
      ? `| \`${defaults.codexImplement.model}\` | Codex | Default hard implementation and review ${CODEX_IMPLEMENT_REVIEW_EFFORT_PHRASE}: difficult debugging, escalation after ${displayModel(defaults.composerImplement.model)} misses the bar, and routine independent checks. |`
      : `| \`${defaults.codexImplement.model}\` | Codex | Default hard implementation ${CODEX_IMPLEMENT_REVIEW_EFFORT_PHRASE}: difficult debugging and escalation after ${displayModel(defaults.composerImplement.model)} misses the bar. |
| \`${defaults.codexCheck.model}\` | Codex | Default read-only review ${CODEX_IMPLEMENT_REVIEW_EFFORT_PHRASE}: routine independent checks. |`;
  const tasteSensitiveRows = `| \`${defaults.tasteSensitiveImplementModel}\` | Codex | Explicit \`sol-explore\`/\`sol-check\`/\`sol-implement\` flagship diagnostic routes; never selected by \`task_class\`. Automatic hard workloads may place Sol via \`workload_class\` stacks. |`;
  return `## Current GPT-5.6 routing guidance

The benchmark below is a dated 2026-07-05 snapshot and did not measure the
GPT-5.6 models. Its token, latency, and acceptance figures therefore remain
historical evidence for the listed models, not a benchmark ranking for Terra,
Luna, or Sol.

Automatic delegation uses mode plus \`workload_class\` (not \`task_class\`).
Omit \`--backend\` and \`--route\` for the ADR screenshot policy; pass \`--route\`
to pin one model; pass \`--backend\` or \`--worker-model\` for direct legacy defaults.

| Model | Available through | Reach for it when |
| --- | --- | --- |
| \`${defaults.explore.model}\` | Codex | Default read-only analysis: high-volume exploration, log sifting, dependency tracing, and evidence gathering. |
${codexDefaultRows}
${tasteSensitiveRows}
| \`${defaults.composerImplement.model}\` | Cursor Agent | Default clear-spec, high-volume implementation after the approach is approved. |

${displayModel(defaults.composerImplement.model)} remains the Cursor implementation default. \`ARC_ORCHESTRATOR_COMPOSER_MODEL=${defaults.tasteSensitiveImplementModel}\`
remains an explicit Cursor override escape hatch, not a default. See
\`docs/orchestrator/model-selection.md\` for environment-variable targeting.
`;
}
