import {
  TASTE_SENSITIVE_TASK_CLASSES,
  routeCapabilities,
} from "../fable-orchestrator/lib/routes";

const DEFAULT_ENV: Record<string, string | undefined> = {};

export const EXPLICIT_OVERRIDE_RULE = "Explicit model overrides always win.";

export const EXPLICIT_OVERRIDE_RULE_INLINE = "Explicit model overrides always win";

export const COMPOSER_OVERRIDE_ESCAPE_HATCH =
  "`FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit override escape hatch, not the default.";

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

export const HOW_TO_APPLY_RANKINGS = [
  "These are defaults, not limits. If a cheaper model misses the bar, rerun or redo the work with a stronger model without asking. Judge the output, not the price tag.",
  "Usage headroom is a tie-breaker only. For anything that ships, prioritize intelligence, then taste, then usage efficiency.",
  "Use `composer-2.5` by default for bulk clear-spec implementation, migrations, mechanical refactors, and focused test additions.",
  "Use `gpt-5.6-terra` as the default Codex model for harder implementation, repository analysis, difficult debugging, and escalation when Composer 2.5 misses the quality bar: it matches `gpt-5.5` on intelligence with better layout judgment, and its shorter output fits workers that must return compact evidence. Prefer `gpt-5.5` only as an independent second perspective or when Terra's terser output drops detail a review needs.",
  "Use `gpt-5.6-luna` for high-volume, low-stakes Codex exploration — log sifting, dependency tracing, evidence gathering. Escalate to Terra when Luna misses.",
  "`gpt-5.6-sol` is OpenAI's flagship on Codex. Use it for taste-sensitive or especially difficult bounded Codex implementation/review (`--task-class taste-sensitive`, `ui`, `copy`, or `api-design`) when Terra is not enough; keep routine Cursor work on `composer-2.5`.",
  "User-facing UI, copy, and API design require taste of at least 7. Fable chooses the direction; Codex may implement a precise approved specification.",
  "Use Fable 5 or Opus 4.8 for reviews of plans and implementations. Use GPT-5.5 as an additional independent perspective when the risk justifies it.",
  "Do not use Haiku.",
];

export const WORKER_DESCRIPTIONS = [
  "`composer-implement`: executes a clear, approved implementation contract through Cursor Composer 2.5.",
  "`codex-implement`: handles harder implementation or reruns work that did not meet the bar through GPT-5.6 Terra, with GPT-5.6 Sol for taste-sensitive task classes.",
  "`codex-check`: independently checks correctness, regressions, security, and acceptance criteria through GPT-5.6 Terra, with GPT-5.6 Sol for taste-sensitive task classes.",
  "`codex-explore`: performs token-heavy repository exploration and evidence gathering through GPT-5.6 Luna by default.",
  "`opus-explore`, `opus-check`, `opus-implement`: availability-fallback workers that forward to the `claude` backend (Opus 4.8) when Codex is unavailable or the parent explicitly routes there; not the default route and not the taste-review path (`opus-review`).",
  "Fable reviews worker results, inspects important diffs and verification, and makes every final decision.",
];

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

export function gpt56WorkerRoutingBullets(): string[] {
  return [
    "`gpt-5.6-luna`: Codex analyze default for high-volume, low-stakes exploration and evidence gathering.",
    "`gpt-5.6-terra`: Codex implement/review default for harder implementation, debugging, escalation, and routine checks.",
    `\`gpt-5.6-sol\`: Codex implement/review default for taste-sensitive task classes (${tasteSensitiveTaskClassList()}) unless the matching \`FABLE_ORCHESTRATOR_IMPLEMENT_MODEL\` or \`FABLE_ORCHESTRATOR_REVIEW_MODEL\` override is non-empty.`,
    "Composer 2.5 remains the default Cursor implementation worker; `FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol` is an explicit override escape hatch, not the default.",
    EXPLICIT_OVERRIDE_RULE,
  ];
}

export function gpt56WorkerRoutingSection(surfaceNote: string): string {
  const bullets = gpt56WorkerRoutingBullets()
    .map((bullet) => `- ${bullet}`)
    .join("\n");
  return `## GPT-5.6 Worker Routing\n\n${bullets}\n\n${surfaceNote}`;
}

export function routePreferenceSummary(): string {
  return `Prefer Composer 2.5 for clear mechanical implementation, GPT-5.6 Terra for hard Codex implement/review, GPT-5.6 Luna for repo exploration, GPT-5.6 Sol for ${OPUS_VS_SOL_DISTINCTION.sol}, and Opus 4.8 for ${OPUS_VS_SOL_DISTINCTION.opus}.`;
}

export function routePreferenceSummaryForCursorDocs(): string {
  return `Prefer Composer 2.5 for clear mechanical implementation, GPT-5.6 Terra for hard Codex implement/review, GPT-5.6 Luna for repo exploration, GPT-5.6 Sol for ${OPUS_VS_SOL_DISTINCTION.sol}, and Opus 4.8 when the task needs ${OPUS_VS_SOL_DISTINCTION.opus}.`;
}

export function defaultRouteCapabilities() {
  return routeCapabilities(DEFAULT_ENV);
}

export function renderRoutingPolicyMd(): string {
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

The route is read-only and defaults to \`gpt-5.6-luna\`.

## Route to \`composer-implement\`

- a well-specified feature slice;
- mechanical refactors with explicit boundaries;
- migrations and repetitive multi-file edits;
- test additions for already-defined behavior;
The route uses Cursor in non-interactive write mode and defaults to Composer 2.5. Keep taste-sensitive UI/UX, user-facing copy, and API-design work on Codex (\`gpt-5.6-sol\`) unless the parent explicitly forces a Composer model with \`FABLE_ORCHESTRATOR_COMPOSER_MODEL\`. Fable must inspect the resulting diff and verification.

## Route to \`codex-implement\`

- a difficult implementation requiring stronger unsupervised reasoning;
- a focused bug fix with non-obvious root cause;
- a rerun after Composer 2.5 misses the quality bar;
- work where GPT-5.6 Terra's steerability is more important than cost.

The route is workspace-write and defaults to \`gpt-5.6-terra\`; taste-sensitive task classes default to \`gpt-5.6-sol\` unless \`FABLE_ORCHESTRATOR_IMPLEMENT_MODEL\` is set.

## Route to \`codex-check\`

- independent review of a completed diff;
- regression, security, or correctness checks;
- validation that acceptance criteria are covered.

The route is read-only and defaults to \`gpt-5.6-terra\`; taste-sensitive task classes default to \`gpt-5.6-sol\` unless \`FABLE_ORCHESTRATOR_REVIEW_MODEL\` is set.

## Route to \`opus-review\`

- high-taste review of UI/UX, product polish, accessibility, or user-facing copy;
- API ergonomics, component composition, and long-lived abstraction review;
- developer-experience docs, prompt wording, or skill/plugin instruction review;
- second-opinion critique after Codex or Composer produced a solution where design quality matters more than raw correctness.

The route is read-only and uses Opus 4.8. Do not use it for bulk implementation, mechanical migrations, large repo scans, straightforward test additions, or generic CI/log summarization.

## Backend availability fallback

When Codex is unavailable (usage limit, authentication failure, or missing binary), the runner classifies the outage as \`backend_unavailable\` and emits a machine-readable fallback hint on stderr (\`fallback: { backend: "claude", model: <resolved> }\`). Ordinary task failures do not carry this hint.

**Default (parent-driven):** Re-delegate explicitly to the matching availability-fallback worker (\`opus-explore\`, \`opus-check\`, or \`opus-implement\`) or invoke \`fable-orchestrator run --backend claude --mode <analyze|review|implement>\` directly. Record the switch with \`annotate --outcome escalated --escalated-to <model>\` on the failed run, or annotate the fallback run's outcome. Do not silently substitute inside a worker.

**Opt-in automatic retry:** Set \`FABLE_ORCHESTRATOR_FALLBACK=claude\` (or pass \`--fallback claude\`) for unattended runs. The runner retries an availability-classified failure exactly once on the \`claude\` backend and links both trace records through \`fallback_of\`.

**Quality bar:** Opus 4.8 ranks below GPT-5.6 Terra on the intelligence heuristic (7 versus 8). The parent review bar is unchanged. \`report\` keeps fallback runs distinguishable via \`fallback_of\` so acceptance rates stay honest.

**Distinct from other Opus routes:** \`opus-review\` is the taste-review path (content-triggered, read-only critique). Availability fallback is outage-driven or parent-explicit. Quality escalation after a completed-but-rejected run stays a parent decision through \`annotate --escalated-to\`, never a runner behavior.

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

export function renderWorkloadMatrixGuidanceSection(): string {
  return `## Current GPT-5.6 routing guidance

The benchmark below is a dated 2026-07-05 snapshot and did not measure the
GPT-5.6 models. Its token, latency, and acceptance figures therefore remain
historical evidence for the listed models, not a benchmark ranking for Terra,
Luna, or Sol.

| Model | Available through | Reach for it when |
| --- | --- | --- |
| \`gpt-5.6-luna\` | Codex | Default read-only analysis: high-volume exploration, log sifting, dependency tracing, and evidence gathering. |
| \`gpt-5.6-terra\` | Codex | Default hard implementation and review: difficult debugging, escalation after Composer 2.5 misses the bar, and routine independent checks. |
| \`gpt-5.6-sol\` | Codex | Taste-sensitive implementation and read-only review for ${tasteSensitiveTaskClassListWithOr()} task classes; Sol is OpenAI's flagship on Codex when Terra is not enough. |
| \`composer-2.5\` | Cursor Agent | Default clear-spec, high-volume implementation after the approach is approved. |

Composer 2.5 remains the Cursor implementation default. \`FABLE_ORCHESTRATOR_COMPOSER_MODEL=gpt-5.6-sol\`
remains an explicit Cursor override escape hatch, not a default. See
\`docs/orchestrator/model-selection.md\` for environment-variable targeting.
`;
}
