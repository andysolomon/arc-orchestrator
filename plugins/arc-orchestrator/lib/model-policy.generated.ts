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
  "updated": "2026-09-01",
  "digest": "9b8b3ec209711ef34e6c2bd990bce9c507810dbe6b983a7400c3f05783fe7c97"
} as const;

export const MODEL_POLICY = {
  "label": "runner-routing-v4",
  "updated": "2026-09-01",
  "supersedes": "docs/arc-model-update-08-18-26.md",
  "fallback": "availability-only",
  "parentLocalPhases": [
    "analyze"
  ],
  "parentDefaults": {
    "pi": {
      "provider": "openai-codex",
      "model": "gpt-5.6-sol",
      "effort": "high"
    },
    "claude-code": {
      "provider": "anthropic",
      "model": "claude-fable-5-1",
      "effort": "high"
    }
  },
  "routeBindings": [
    {
      "base": "fable",
      "displayName": "Fable 5.1",
      "stableId": "fable-5.1",
      "providerModelId": "claude-fable-5-1",
      "backend": "claude"
    },
    {
      "base": "fable-5.1",
      "displayName": "Fable 5.1",
      "stableId": "fable-5.1",
      "providerModelId": "claude-fable-5-1",
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
    },
    {
      "base": "glm-5.3-flash",
      "displayName": "OpenCode Go GLM 5.3 Flash",
      "stableId": "opencode-go-glm-5.3-flash",
      "providerModelId": "opencode-go/glm-5.3-flash",
      "backend": "opencode"
    },
    {
      "base": "glm-5.3",
      "displayName": "OpenCode Go GLM 5.3",
      "stableId": "opencode-go-glm-5.3",
      "providerModelId": "opencode-go/glm-5.3",
      "backend": "opencode"
    },
    {
      "base": "deepseek-v4-pro",
      "displayName": "OpenCode Go DeepSeek V4 Pro",
      "stableId": "opencode-go-deepseek-v4-pro",
      "providerModelId": "opencode-go/deepseek-v4-pro",
      "backend": "opencode"
    },
    {
      "base": "deepseek-v4-flash",
      "displayName": "OpenCode Go DeepSeek V4 Flash",
      "stableId": "opencode-go-deepseek-v4-flash",
      "providerModelId": "opencode-go/deepseek-v4-flash",
      "backend": "opencode"
    },
    {
      "base": "go-kimi-k3",
      "displayName": "OpenCode Go Kimi K3",
      "stableId": "opencode-go-kimi-k3",
      "providerModelId": "opencode-go/kimi-k3",
      "backend": "opencode"
    },
    {
      "base": "qwen-3.8-max",
      "displayName": "OpenCode Go Qwen 3.8 Max",
      "stableId": "opencode-go-qwen3.8-max",
      "providerModelId": "opencode-go/qwen3.8-max",
      "backend": "opencode"
    },
    {
      "base": "muse-spark-1.2",
      "displayName": "OpenCode Go Muse Spark 1.2",
      "stableId": "opencode-go-muse-spark-1.2-contributor",
      "providerModelId": "opencode-go/muse-spark-1.2-contributor",
      "backend": "opencode"
    },
    {
      "base": "glm-5.2",
      "displayName": "OpenCode Go GLM 5.2",
      "stableId": "opencode-go-glm-5.2",
      "providerModelId": "opencode-go/glm-5.2",
      "backend": "opencode"
    },
    {
      "base": "kimi-k2.7-code",
      "displayName": "OpenCode Go Kimi K2.7 Code",
      "stableId": "opencode-go-kimi-k2.7-code",
      "providerModelId": "opencode-go/kimi-k2.7-code",
      "backend": "opencode"
    },
    {
      "base": "go-grok-4.6",
      "displayName": "OpenCode Go Grok 4.6",
      "stableId": "opencode-go-grok-4.6",
      "providerModelId": "opencode-go/grok-4.6",
      "backend": "opencode"
    },
    {
      "base": "go-luna",
      "displayName": "OpenCode Go Luna 5.6",
      "stableId": "opencode-go-gpt-5.6-luna",
      "providerModelId": "opencode-go/gpt-5.6-luna",
      "backend": "opencode"
    }
  ],
  "surfaces": {
    "fable-5.1": {
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
    },
    "opencode-go-glm-5.3-flash": {
      "name": "OpenCode Go GLM 5.3 Flash",
      "fixedEffort": null
    },
    "opencode-go-glm-5.3": {
      "name": "OpenCode Go GLM 5.3",
      "fixedEffort": null
    },
    "opencode-go-deepseek-v4-pro": {
      "name": "OpenCode Go DeepSeek V4 Pro",
      "fixedEffort": null
    },
    "opencode-go-deepseek-v4-flash": {
      "name": "OpenCode Go DeepSeek V4 Flash",
      "fixedEffort": null
    },
    "opencode-go-kimi-k3": {
      "name": "OpenCode Go Kimi K3",
      "fixedEffort": null
    },
    "opencode-go-qwen3.8-max": {
      "name": "OpenCode Go Qwen 3.8 Max",
      "fixedEffort": null
    },
    "opencode-go-muse-spark-1.2-contributor": {
      "name": "OpenCode Go Muse Spark 1.2",
      "fixedEffort": null
    },
    "opencode-go-glm-5.2": {
      "name": "OpenCode Go GLM 5.2",
      "fixedEffort": null
    },
    "opencode-go-kimi-k2.7-code": {
      "name": "OpenCode Go Kimi K2.7 Code",
      "fixedEffort": null
    },
    "opencode-go-grok-4.6": {
      "name": "OpenCode Go Grok 4.6",
      "fixedEffort": null
    },
    "opencode-go-gpt-5.6-luna": {
      "name": "OpenCode Go Luna 5.6",
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
      "fable-5.1@high",
      "gpt-5.6-sol@high",
      "gpt-5.6-luna@max",
      "opencode-go-glm-5.3@none"
    ],
    "research": [
      "fable-5.1@high",
      "gpt-5.6-sol@high",
      "gpt-5.6-luna@max",
      "opencode-go-glm-5.3@none"
    ],
    "plan": [
      "fable-5.1@high",
      "gpt-5.6-sol@high",
      "gpt-5.6-luna@max",
      "opencode-go-glm-5.3@none"
    ],
    "verify": [
      "gpt-5.6-luna@max",
      "gpt-5.5@low",
      "opencode-go-deepseek-v4-pro@none",
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
      "fable-5.1@high",
      "gpt-5.6-sol@high",
      "cursor-grok-4.6-high@high",
      "opencode-go-glm-5.3@none"
    ],
    "hard-medium": [
      "gpt-5.6-sol@high",
      "cursor-grok-4.6-high@high",
      "opencode-go-glm-5.3@none"
    ],
    "hard-light": [
      "gpt-5.6-sol@high",
      "cursor-grok-4.6-high@high",
      "opencode-go-glm-5.3@none"
    ],
    "medium-heavy": [
      "gpt-5.6-sol@high",
      "cursor-grok-4.6-high@high",
      "opencode-go-glm-5.3@none"
    ],
    "medium-medium": [
      "opus-5@high",
      "cursor-grok-4.6-high@high",
      "opencode-go-glm-5.3@none"
    ],
    "medium-light": [
      "opencode-go-glm-5.3-flash@none",
      "cursor-grok-4.6-high@high",
      "opus-4.8@low",
      "gpt-5.5@high",
      "opus-5@high"
    ],
    "easy-heavy": [
      "opencode-go-glm-5.3-flash@none",
      "opus-5@high",
      "gpt-5.6-luna@max",
      "opus-4.8@low",
      "opus-5@low",
      "cursor-grok-4.6-high@high"
    ],
    "easy-medium": [
      "opencode-go-glm-5.3-flash@none",
      "gpt-5.6-luna@max",
      "opus-4.8@low",
      "gpt-5.5@low",
      "cursor-grok-4.6-high@high"
    ],
    "easy-light": [
      "opencode-go-glm-5.3-flash@none",
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
