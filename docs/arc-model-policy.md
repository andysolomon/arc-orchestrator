<!-- SYNCED FILE — do not edit. Source: arc-pi policy/arc-model-policy.md. Regenerate with: npm run policy:sync (in the arc-pi repository). -->
# ARC model policy

The fenced `arc-model-policy` block in this file is the single authoritative
routing input for ARC Pi and the sibling `arc-orchestrator` runner. It lives in
its own undated file so policy revisions never rename the source. The history
and reasoning behind each revision stay in the dated update documents in
arc-pi, currently `docs/arc-model-update-08-30-26.md`.

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
  verbatim copies of this file and the parser, so the runner's
  `scripts/check-model-policy.mjs` can re-derive the digest from Markdown
  without an arc-pi checkout.

Every generated artifact embeds a SHA-256 digest of the canonical policy.
`npm run policy:check` (also part of `npm run verify`) re-parses this file
and fails closed when any ARC Pi artifact, or the runner copies when the
sibling repository is present, are stale or were edited by hand. `bin/arc-pi`
re-parses this file at launch and refuses to start when
`defaults/model-policy.json` carries a different digest, label, or parent
defaults. The ARC Pi and runner policy consumers verify the embedded digest
against the copy's content at load time. The runner's
`bun scripts/check-model-policy.mjs` re-parses its local Markdown copy and
rejects a stale or tampered generated copy; its
`test/model-policy-sync.test.ts` proves that the public bindings, candidate
stacks, workload classes, shipped registry entries (provider model id,
backend, fixed effort), and rendered surfaces equal the copy.

Editing rules:

1. Change the fenced block below, never the generated files.
2. Run `npm run policy:sync` in ARC Pi, then `bun run generate:surfaces` in
   the runner.
3. Commit both repositories together; a digest mismatch between them is a
   rejected state, not a warning.

## Line grammar

Line grammar (one directive per line; `#` starts a comment; ordering is
significant everywhere):

- `policy`, `updated`, `supersedes`, `fallback`: single values.
- `parent-local`: comma-separated lifecycle phases that never delegate.
- `parent-default <surface>`: `provider/model@effort` for a parent surface.
- `binding <base>`: `Display Name | stable-id | provider-model-id | backend`
  with an optional trailing `| default-effort` for public alias bases. A
  provider model id may carry one `provider/` prefix (`opencode-go/glm-5.3`);
  stable ids and bases never contain `/`.
- `surface <stable-id>`: `Surface Name [| fixed-effort <effort>]` — the
  human-readable rung label on generated runner surfaces, and whether the
  model is a fixed effort profile with no selectable effort control. Every
  bound model needs one; the runner checks it against the shipped registry.
- `tail`: ordered `stable-id@effort` rungs appended to every automatic stack.
- `phase <phase>` / `workload <class>`: ordered primary `stable-id@effort`
  rungs; the tail is appended by the consumers, never written here.
- `exclude-models` / `exclude-efforts`: identifiers that must not appear in
  any automatic chain.

## Policy

```arc-model-policy
policy: runner-routing-v4
updated: 2026-09-23
supersedes: docs/arc-model-update-08-18-26.md
fallback: availability-only
parent-local: analyze

# Parent defaults. ARC Pi launches the parent on Sol at high thinking; the
# Claude Code parent runs Fable 5.1 at high effort.
parent-default pi: openai-codex/gpt-6-sol@high
parent-default claude-code: anthropic/claude-fable-5-1@high

# Public route bindings. Stable semantic bases and versioned bases resolve to
# the same current model; each base exposes -explore/-implement/-check.
binding fable: Fable 5.1 | fable-5.1 | claude-fable-5-1 | claude
binding fable-5.1: Fable 5.1 | fable-5.1 | claude-fable-5-1 | claude
binding sol: Sol 6 | gpt-6-sol | gpt-6-sol | codex
binding gpt-6-sol: Sol 6 | gpt-6-sol | gpt-6-sol | codex
binding luna: Luna 6 Max | gpt-6-luna | gpt-6-luna | codex | max
binding gpt-6-luna: Luna 6 Max | gpt-6-luna | gpt-6-luna | codex | max
binding gpt-5.5: GPT 5.5 | gpt-5.5 | gpt-5.5 | codex
binding opus: Opus 5.5 | opus-5.5 | claude-opus-5-5 | claude
binding opus-5.5: Opus 5.5 | opus-5.5 | claude-opus-5-5 | claude
binding opus-4.8: Opus 4.8 | opus-4.8 | claude-opus-4-8 | claude
binding grok: Cursor Grok 4.7 High | cursor-grok-4.7-high | cursor-grok-4.7-high | composer
binding grok-4.7: Cursor Grok 4.7 High | cursor-grok-4.7-high | cursor-grok-4.7-high | composer
binding minimax: MiniMax M3 | minimax-m3 | MiniMax-M3 | minimax
binding minimax-m3: MiniMax M3 | minimax-m3 | MiniMax-M3 | minimax
binding composer: Composer 2.5 | composer-2.5 | composer-2.5 | composer
binding composer-2.5: Composer 2.5 | composer-2.5 | composer-2.5 | composer
# Cursor Auto (revision 2026-09-11): Cursor's own model router, reached
# through the Composer transport with provider model id `auto`. Explicit-only
# and the Eco availability backup; it holds no automatic runner-routing-v4 rung.
binding cursor-auto: Cursor Auto | cursor-auto | auto | composer

# OpenCode Go provider-qualified identities (2026-08-31 expansion). Each
# stable id mirrors its `opencode-go/<model>` provider id. Bases that would
# collide with an existing Cursor/Codex semantic alias carry a `go-` transport
# prefix so `kimi-k3`, `grok-4.7`, and `luna` keep their current transports.
# The OpenCode transport exposes no effort control: every rung is @none.
binding glm-5.3-flash: OpenCode Go GLM 5.3 Flash | opencode-go-glm-5.3-flash | opencode-go/glm-5.3-flash | opencode
binding glm-5.3: OpenCode Go GLM 5.3 | opencode-go-glm-5.3 | opencode-go/glm-5.3 | opencode
binding deepseek-v4-pro: OpenCode Go DeepSeek V4 Pro | opencode-go-deepseek-v4-pro | opencode-go/deepseek-v4-pro | opencode
binding deepseek-v4-flash: OpenCode Go DeepSeek V4 Flash | opencode-go-deepseek-v4-flash | opencode-go/deepseek-v4-flash | opencode
binding go-kimi-k3: OpenCode Go Kimi K3 | opencode-go-kimi-k3 | opencode-go/kimi-k3 | opencode
binding qwen-3.8-max: OpenCode Go Qwen 3.8 Max | opencode-go-qwen3.8-max | opencode-go/qwen3.8-max | opencode
binding muse-spark-1.2: OpenCode Go Muse Spark 1.2 | opencode-go-muse-spark-1.2-contributor | opencode-go/muse-spark-1.2-contributor | opencode
binding glm-5.2: OpenCode Go GLM 5.2 | opencode-go-glm-5.2 | opencode-go/glm-5.2 | opencode
binding kimi-k2.7-code: OpenCode Go Kimi K2.7 Code | opencode-go-kimi-k2.7-code | opencode-go/kimi-k2.7-code | opencode
binding go-grok-4.6: OpenCode Go Grok 4.6 | opencode-go-grok-4.6 | opencode-go/grok-4.6 | opencode
binding go-luna: OpenCode Go Luna 5.6 | opencode-go-gpt-5.6-luna | opencode-go/gpt-5.6-luna | opencode

# Human-readable rung labels for generated runner surfaces. Fixed-effort
# profiles render without an effort suffix and must match the registry.
surface fable-5.1: CC Fable
surface gpt-6-sol: Codex Sol
surface gpt-6-luna: Codex Luna
surface gpt-5.5: Codex GPT-5.5
surface opus-5.5: CC Opus 5.5
surface opus-4.8: CC Opus 4.8
surface cursor-grok-4.7-high: Cursor Grok 4.7 High | fixed-effort high
surface minimax-m3: MiniMax M3
surface composer-2.5: Cursor Composer 2.5
surface cursor-auto: Cursor Auto
surface opencode-go-glm-5.3-flash: OpenCode Go GLM 5.3 Flash
surface opencode-go-glm-5.3: OpenCode Go GLM 5.3
surface opencode-go-deepseek-v4-pro: OpenCode Go DeepSeek V4 Pro
surface opencode-go-deepseek-v4-flash: OpenCode Go DeepSeek V4 Flash
surface opencode-go-kimi-k3: OpenCode Go Kimi K3
surface opencode-go-qwen3.8-max: OpenCode Go Qwen 3.8 Max
surface opencode-go-muse-spark-1.2-contributor: OpenCode Go Muse Spark 1.2
surface opencode-go-glm-5.2: OpenCode Go GLM 5.2
surface opencode-go-kimi-k2.7-code: OpenCode Go Kimi K2.7 Code
surface opencode-go-grok-4.6: OpenCode Go Grok 4.6
surface opencode-go-gpt-5.6-luna: OpenCode Go Luna 5.6

# Availability-only emergency tail appended to every automatic worker stack.
# OpenCode Go Kimi K3 heads the tail; `composer-2.5` is the terminal rung. The
# 2026-09-05 revision promotes OpenCode Go Kimi K3 to the head of the tail
# (replacing the now-removed cursor-kimi-k3 rung); the 2026-09-11 revision
# removes Cursor Auto from the tail because it is explicit-only.
tail: opencode-go-kimi-k3@none, minimax-m3@high, composer-2.5@none

# Worker phase chains. Analyze has no chain: it is parent-local. GLM 5.3 is a
# late candidate for the reasoning-heavy analysis/review phases; DeepSeek V4 Pro is
# a model-family-diverse Verify candidate. Deploy is unchanged.
phase explore: fable-5.1@high, gpt-6-sol@high, gpt-6-luna@max, opencode-go-glm-5.3@none
phase research: fable-5.1@high, gpt-6-sol@high, gpt-6-luna@max, opencode-go-glm-5.3@none
phase plan: fable-5.1@high, gpt-6-sol@high, gpt-6-luna@max, opencode-go-glm-5.3@none
phase verify: gpt-6-luna@max, gpt-5.5@low, opencode-go-deepseek-v4-pro@none, opus-4.8@low, cursor-grok-4.7-high@high
phase deploy: gpt-5.5@low, opus-4.8@low, cursor-grok-4.7-high@high

# Implement chains keyed by the nine canonical workload classes. GLM 5.3
# trails the hard/medium chains; GLM 5.3 Flash leads the economical
# medium-light and easy chains.
workload hard-heavy: fable-5.1@high, gpt-6-sol@high, cursor-grok-4.7-high@high, opencode-go-glm-5.3@none
workload hard-medium: gpt-6-sol@high, cursor-grok-4.7-high@high, opencode-go-glm-5.3@none
workload hard-light: gpt-6-sol@high, cursor-grok-4.7-high@high, opencode-go-glm-5.3@none
workload medium-heavy: gpt-6-sol@high, cursor-grok-4.7-high@high, opencode-go-glm-5.3@none
workload medium-medium: opus-5.5@high, cursor-grok-4.7-high@high, opencode-go-glm-5.3@none
workload medium-light: opencode-go-glm-5.3-flash@none, cursor-grok-4.7-high@high, opus-4.8@low, gpt-5.5@high, opus-5.5@high
workload easy-heavy: opencode-go-glm-5.3-flash@none, opus-5.5@high, gpt-6-luna@max, opus-4.8@low, opus-5.5@low, cursor-grok-4.7-high@high
workload easy-medium: opencode-go-glm-5.3-flash@none, gpt-6-luna@max, opus-4.8@low, gpt-5.5@low, cursor-grok-4.7-high@high
workload easy-light: opencode-go-glm-5.3-flash@none, gpt-5.5@low, cursor-grok-4.7-high@high

# Exclusions. Haiku is never routed; Sonnet 5 stays registry-only. Efforts
# above high are excluded except Luna's max profile, which is named above.
exclude-models: haiku-4.5, sonnet-5
exclude-efforts: xhigh
```
