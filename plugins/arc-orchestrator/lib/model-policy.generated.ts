// GENERATED FILE — do not edit.
// Source: arc-pi docs/arc-model-update-08-30-26.md (fenced arc-model-policy block).
// Regenerate with: npm run policy:sync (in the arc-pi repository).
// Runner copy of the ARC model policy. MODEL_POLICY_SOURCE.digest is the
// SHA-256 of JSON.stringify(MODEL_POLICY). scripts/check-model-policy.mjs
// re-parses the synchronized docs/arc-model-policy.md and fails closed when
// this copy is stale or hand-edited; test/model-policy-sync.test.ts proves the
// registry and public bindings match it.

export const MODEL_POLICY_SOURCE = {
  "document": "docs/arc-model-update-08-30-26.md",
  "updated": "2026-08-30",
  "digest": "d87b292bf667acd663b0a187f3c08c5ea9346429ed752ba0163b95cd3a2a3932"
} as const;

export const MODEL_POLICY = {
  "label": "runner-routing-v4",
  "updated": "2026-08-30",
  "supersedes": "docs/arc-model-update-08-18-26.md",
  "fallback": "availability-only",
  "parentLocalPhases": [
    "analyze"
  ],
  "parentDefaults": {
    "pi": {
      "provider": "openai-codex",
      "model": "gpt-5.6-luna",
      "effort": "max"
    },
    "claude-code": {
      "provider": "anthropic",
      "model": "claude-fable-5",
      "effort": "high"
    }
  },
  "routeBindings": [
    {
      "base": "fable",
      "displayName": "Fable 5",
      "stableId": "fable-5",
      "providerModelId": "claude-fable-5",
      "backend": "claude"
    },
    {
      "base": "fable-5",
      "displayName": "Fable 5",
      "stableId": "fable-5",
      "providerModelId": "claude-fable-5",
      "backend": "claude"
    },
    {
      "base": "sol",
      "displayName": "Sol 5.6",
      "stableId": "gpt-5.6-sol",
      "providerModelId": "gpt-5.6-sol",
      "backend": "codex"
    },
    {
      "base": "gpt-5.6-sol",
      "displayName": "Sol 5.6",
      "stableId": "gpt-5.6-sol",
      "providerModelId": "gpt-5.6-sol",
      "backend": "codex"
    },
    {
      "base": "luna",
      "displayName": "Luna 5.6 Max",
      "stableId": "gpt-5.6-luna",
      "providerModelId": "gpt-5.6-luna",
      "backend": "codex",
      "defaultEffort": "max"
    },
    {
      "base": "gpt-5.6-luna",
      "displayName": "Luna 5.6 Max",
      "stableId": "gpt-5.6-luna",
      "providerModelId": "gpt-5.6-luna",
      "backend": "codex",
      "defaultEffort": "max"
    },
    {
      "base": "gpt-5.5",
      "displayName": "GPT 5.5",
      "stableId": "gpt-5.5",
      "providerModelId": "gpt-5.5",
      "backend": "codex"
    },
    {
      "base": "opus",
      "displayName": "Opus 5",
      "stableId": "opus-5",
      "providerModelId": "claude-opus-5",
      "backend": "claude"
    },
    {
      "base": "opus-5",
      "displayName": "Opus 5",
      "stableId": "opus-5",
      "providerModelId": "claude-opus-5",
      "backend": "claude"
    },
    {
      "base": "opus-4.8",
      "displayName": "Opus 4.8",
      "stableId": "opus-4.8",
      "providerModelId": "claude-opus-4-8",
      "backend": "claude"
    },
    {
      "base": "grok",
      "displayName": "Cursor Grok 4.6 High",
      "stableId": "cursor-grok-4.6-high",
      "providerModelId": "cursor-grok-4.6-high",
      "backend": "composer"
    },
    {
      "base": "grok-4.6",
      "displayName": "Cursor Grok 4.6 High",
      "stableId": "cursor-grok-4.6-high",
      "providerModelId": "cursor-grok-4.6-high",
      "backend": "composer"
    },
    {
      "base": "kimi",
      "displayName": "Cursor Kimi K3",
      "stableId": "cursor-kimi-k3",
      "providerModelId": "kimi-k3",
      "backend": "composer"
    },
    {
      "base": "kimi-k3",
      "displayName": "Cursor Kimi K3",
      "stableId": "cursor-kimi-k3",
      "providerModelId": "kimi-k3",
      "backend": "composer"
    },
    {
      "base": "minimax",
      "displayName": "MiniMax M3",
      "stableId": "minimax-m3",
      "providerModelId": "MiniMax-M3",
      "backend": "minimax"
    },
    {
      "base": "minimax-m3",
      "displayName": "MiniMax M3",
      "stableId": "minimax-m3",
      "providerModelId": "MiniMax-M3",
      "backend": "minimax"
    },
    {
      "base": "composer",
      "displayName": "Composer 2.5",
      "stableId": "composer-2.5",
      "providerModelId": "composer-2.5",
      "backend": "composer"
    },
    {
      "base": "composer-2.5",
      "displayName": "Composer 2.5",
      "stableId": "composer-2.5",
      "providerModelId": "composer-2.5",
      "backend": "composer"
    }
  ],
  "surfaces": {
    "fable-5": {
      "name": "CC Fable",
      "fixedEffort": null
    },
    "gpt-5.6-sol": {
      "name": "Codex Sol",
      "fixedEffort": null
    },
    "gpt-5.6-luna": {
      "name": "Codex Luna",
      "fixedEffort": null
    },
    "gpt-5.5": {
      "name": "Codex GPT-5.5",
      "fixedEffort": null
    },
    "opus-5": {
      "name": "CC Opus 5",
      "fixedEffort": null
    },
    "opus-4.8": {
      "name": "CC Opus 4.8",
      "fixedEffort": null
    },
    "cursor-grok-4.6-high": {
      "name": "Cursor Grok 4.6 High",
      "fixedEffort": "high"
    },
    "cursor-kimi-k3": {
      "name": "Cursor Kimi K3",
      "fixedEffort": "high"
    },
    "minimax-m3": {
      "name": "MiniMax M3",
      "fixedEffort": null
    },
    "composer-2.5": {
      "name": "Cursor Composer 2.5",
      "fixedEffort": null
    }
  },
  "emergencyTail": [
    "cursor-kimi-k3@high",
    "minimax-m3@high",
    "composer-2.5@none"
  ],
  "phaseChains": {
    "explore": [
      "fable-5@high",
      "gpt-5.6-sol@high",
      "gpt-5.6-luna@max"
    ],
    "research": [
      "fable-5@high",
      "gpt-5.6-sol@high",
      "gpt-5.6-luna@max"
    ],
    "plan": [
      "fable-5@high",
      "gpt-5.6-sol@high",
      "gpt-5.6-luna@max"
    ],
    "verify": [
      "gpt-5.6-luna@max",
      "gpt-5.5@low",
      "opus-4.8@low",
      "cursor-grok-4.6-high@high"
    ],
    "deploy": [
      "gpt-5.5@low",
      "opus-4.8@low",
      "cursor-grok-4.6-high@high"
    ]
  },
  "workloadChains": {
    "hard-heavy": [
      "fable-5@high",
      "gpt-5.6-sol@high",
      "cursor-grok-4.6-high@high"
    ],
    "hard-medium": [
      "gpt-5.6-sol@high",
      "cursor-grok-4.6-high@high"
    ],
    "hard-light": [
      "gpt-5.6-sol@high",
      "cursor-grok-4.6-high@high"
    ],
    "medium-heavy": [
      "gpt-5.6-sol@high",
      "cursor-grok-4.6-high@high"
    ],
    "medium-medium": [
      "gpt-5.6-luna@max",
      "opus-5@high"
    ],
    "medium-light": [
      "gpt-5.6-luna@max",
      "opus-4.8@low",
      "gpt-5.5@high",
      "opus-5@high"
    ],
    "easy-heavy": [
      "opus-5@high",
      "gpt-5.6-luna@max",
      "opus-4.8@low",
      "opus-5@low",
      "cursor-grok-4.6-high@high"
    ],
    "easy-medium": [
      "gpt-5.6-luna@max",
      "opus-4.8@low",
      "gpt-5.5@low",
      "cursor-grok-4.6-high@high"
    ],
    "easy-light": [
      "gpt-5.6-luna@max",
      "gpt-5.5@low",
      "cursor-grok-4.6-high@high"
    ]
  },
  "excludedModels": [
    "haiku-4.5",
    "sonnet-5"
  ],
  "excludedEfforts": [
    "xhigh"
  ]
} as const;
