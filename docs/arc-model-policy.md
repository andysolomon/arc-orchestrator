<!-- SYNCED FILE — do not edit. Source: arc-pi docs/arc-model-update-08-30-26.md. Regenerate with: npm run policy:sync (in the arc-pi repository). -->
# AI Model Selection and Orchestration — 2026-08-30 update

**By Andrew Solomon**

**Status:** current. Supersedes
[`docs/arc-model-update-08-18-26.md`](arc-model-update-08-18-26.md), which is
retained unchanged as the historical record of the benchmark analysis and the
reasoning behind the ordering below.

This update does not change the verified `runner-routing-v4` model/effort
ordering. It makes the ordering machine-readable: the fenced
`arc-model-policy` block below is the single authoritative input for ARC Pi and
the sibling `arc-orchestrator` runner. Everything else in this document is
explanatory prose.

---

## How the policy is consumed

`scripts/sync-model-policy.mjs` parses the normative block deterministically
(no model, no network) and regenerates:

- `extensions/arc-orchestrator/model-policy.generated.ts` — the ARC Pi
  route/launcher consumer (`routes.ts` derives public route bindings, phase
  chains, the nine workload chains, the emergency tail, and the policy label
  from it).
- `defaults/model-policy.json` — the launcher copy `bin/arc-pi` reads for the
  default parent provider/model/thinking.
- `plugins/arc-orchestrator/lib/model-policy.generated.ts` in the sibling
  `arc-orchestrator` repository — the runner copy that `trace-schema.ts`,
  `model-registry.ts`, `routes.ts`, and the generated surfaces consume.
- `docs/arc-model-policy.md` and `scripts/model-policy.mjs` in the runner —
  verbatim copies of this document and the parser, so the runner's
  `scripts/check-model-policy.mjs` can re-derive the digest from Markdown
  without an arc-pi checkout.

Every generated artifact embeds a SHA-256 digest of the canonical policy.
`npm run policy:check` (also part of `npm run verify`) re-parses this document
and fails closed when any ARC Pi artifact, or the runner copies when the
sibling repository is present, are stale or were edited by hand. `bin/arc-pi`
re-parses this document at launch and refuses to start when
`defaults/model-policy.json` carries a different digest, label, or parent
defaults. The ARC Pi and runner policy consumers verify the embedded digest
against the copy's content at load time. The runner's
`bun scripts/check-model-policy.mjs` re-parses its local Markdown copy and
rejects a stale or tampered generated copy; its
`test/model-policy-sync.test.ts` proves that the public bindings, candidate
stacks, workload classes, shipped registry entries (provider model id,
backend, fixed effort), and rendered surfaces equal the copy.

Editing rules:

1. Change the fenced block, never the generated files.
2. Run `npm run policy:sync` in ARC Pi, then `bun run generate:surfaces` in
   the runner.
3. Commit both repositories together; a digest mismatch between them is a
   rejected state, not a warning.

---

## Normative routing block

Line grammar (one directive per line; `#` starts a comment; ordering is
significant everywhere):

- `policy`, `updated`, `supersedes`, `fallback`: single values.
- `parent-local`: comma-separated lifecycle phases that never delegate.
- `parent-default <surface>`: `provider/model@effort` for a parent surface.
- `binding <base>`: `Display Name | stable-id | provider-model-id | backend`
  with an optional trailing `| default-effort` for public alias bases.
- `surface <stable-id>`: `Surface Name [| fixed-effort <effort>]` — the
  human-readable rung label on generated runner surfaces, and whether the
  model is a fixed effort profile with no selectable effort control. Every
  bound model needs one; the runner checks it against the shipped registry.
- `tail`: ordered `stable-id@effort` rungs appended to every automatic stack.
- `phase <phase>` / `workload <class>`: ordered primary `stable-id@effort`
  rungs; the tail is appended by the consumers, never written here.
- `exclude-models` / `exclude-efforts`: identifiers that must not appear in
  any automatic chain.

```arc-model-policy
policy: runner-routing-v4
updated: 2026-08-30
supersedes: docs/arc-model-update-08-18-26.md
fallback: availability-only
parent-local: analyze

# Parent defaults. ARC Pi launches the parent on Luna at max thinking; the
# Claude Code parent runs Fable 5 at high effort.
parent-default pi: openai-codex/gpt-5.6-luna@max
parent-default claude-code: anthropic/claude-fable-5@high

# Public route bindings. Stable semantic bases and versioned bases resolve to
# the same current model; each base exposes -explore/-implement/-check.
binding fable: Fable 5 | fable-5 | claude-fable-5 | claude
binding fable-5: Fable 5 | fable-5 | claude-fable-5 | claude
binding sol: Sol 5.6 | gpt-5.6-sol | gpt-5.6-sol | codex
binding gpt-5.6-sol: Sol 5.6 | gpt-5.6-sol | gpt-5.6-sol | codex
binding luna: Luna 5.6 Max | gpt-5.6-luna | gpt-5.6-luna | codex | max
binding gpt-5.6-luna: Luna 5.6 Max | gpt-5.6-luna | gpt-5.6-luna | codex | max
binding gpt-5.5: GPT 5.5 | gpt-5.5 | gpt-5.5 | codex
binding opus: Opus 5 | opus-5 | claude-opus-5 | claude
binding opus-5: Opus 5 | opus-5 | claude-opus-5 | claude
binding opus-4.8: Opus 4.8 | opus-4.8 | claude-opus-4-8 | claude
binding grok: Cursor Grok 4.6 High | cursor-grok-4.6-high | cursor-grok-4.6-high | composer
binding grok-4.6: Cursor Grok 4.6 High | cursor-grok-4.6-high | cursor-grok-4.6-high | composer
binding kimi: Cursor Kimi K3 | cursor-kimi-k3 | kimi-k3 | composer
binding kimi-k3: Cursor Kimi K3 | cursor-kimi-k3 | kimi-k3 | composer
binding minimax: MiniMax M3 | minimax-m3 | MiniMax-M3 | minimax
binding minimax-m3: MiniMax M3 | minimax-m3 | MiniMax-M3 | minimax
binding composer: Composer 2.5 | composer-2.5 | composer-2.5 | composer
binding composer-2.5: Composer 2.5 | composer-2.5 | composer-2.5 | composer

# Human-readable rung labels for generated runner surfaces. Fixed-effort
# profiles render without an effort suffix and must match the registry.
surface fable-5: CC Fable
surface gpt-5.6-sol: Codex Sol
surface gpt-5.6-luna: Codex Luna
surface gpt-5.5: Codex GPT-5.5
surface opus-5: CC Opus 5
surface opus-4.8: CC Opus 4.8
surface cursor-grok-4.6-high: Cursor Grok 4.6 High | fixed-effort high
surface cursor-kimi-k3: Cursor Kimi K3 | fixed-effort high
surface minimax-m3: MiniMax M3
surface composer-2.5: Cursor Composer 2.5

# Availability-only emergency tail appended to every automatic worker stack.
# Composer is terminal.
tail: cursor-kimi-k3@high, minimax-m3@high, composer-2.5@none

# Worker phase chains. Analyze has no chain: it is parent-local.
phase explore: fable-5@high, gpt-5.6-sol@high, gpt-5.6-luna@max
phase research: fable-5@high, gpt-5.6-sol@high, gpt-5.6-luna@max
phase plan: fable-5@high, gpt-5.6-sol@high, gpt-5.6-luna@max
phase verify: gpt-5.6-luna@max, gpt-5.5@low, opus-4.8@low, cursor-grok-4.6-high@high
phase deploy: gpt-5.5@low, opus-4.8@low, cursor-grok-4.6-high@high

# Implement chains keyed by the nine canonical workload classes.
workload hard-heavy: fable-5@high, gpt-5.6-sol@high, cursor-grok-4.6-high@high
workload hard-medium: gpt-5.6-sol@high, cursor-grok-4.6-high@high
workload hard-light: gpt-5.6-sol@high, cursor-grok-4.6-high@high
workload medium-heavy: gpt-5.6-sol@high, cursor-grok-4.6-high@high
workload medium-medium: gpt-5.6-luna@max, opus-5@high
workload medium-light: gpt-5.6-luna@max, opus-4.8@low, gpt-5.5@high, opus-5@high
workload easy-heavy: opus-5@high, gpt-5.6-luna@max, opus-4.8@low, opus-5@low, cursor-grok-4.6-high@high
workload easy-medium: gpt-5.6-luna@max, opus-4.8@low, gpt-5.5@low, cursor-grok-4.6-high@high
workload easy-light: gpt-5.6-luna@max, gpt-5.5@low, cursor-grok-4.6-high@high

# Exclusions. Haiku is never routed; Sonnet 5 stays registry-only. Efforts
# above high are excluded except Luna's max profile, which is named above.
exclude-models: haiku-4.5, sonnet-5
exclude-efforts: xhigh
```

---

## What the block preserves

- **Label and marker.** `runner-routing-v4` remains the only accepted
  `--routing-policy` value; v2/v3 markers still fail closed.
- **Ordering.** Phase chains, the nine workload chains, effort values, and the
  emergency tail are byte-for-byte the verified ordering from the 08-18-26
  update; this document only changes their source of truth.
- **Explicit aliases.** Every public base above still pins exactly one
  candidate with no inherited fallback. `luna`/`gpt-5.6-luna` aliases carry the
  `max` default effort.
- **Fallback semantics.** Availability-only. Task, malformed-output, and
  verification failures remain terminal.
- **Parent-local Analyze.** No analyze chain exists; the parent runs it.
- **Parent defaults.** ARC Pi still launches `openai-codex/gpt-5.6-luna` at
  `max` thinking unless `ARC_PI_PROVIDER`/`ARC_PI_MODEL`/`ARC_PI_THINKING` or
  explicit Pi flags override it.
- **Authorization gates, sandbox boundaries, trace contracts, parent
  overrides.** Unchanged; the policy block carries no authority over them.

## Release versioning note

The package version files are not changed by this update. The semantic-release
workflow calculates the published version from Conventional Commit history.
