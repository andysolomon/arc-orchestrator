import type { EnvLike } from "./routes";

// MiniMax exposes an Anthropic-compatible endpoint, so the minimax backend
// reuses the Claude CLI with per-invocation base-URL and API-key environment
// injection. As a pay-as-you-go API tier it is not subject to the subscription
// usage limits that can exhaust the codex and claude backends simultaneously,
// which makes it the terminal availability-fallback tier when configured.

export const MINIMAX_DEFAULT_MODEL = "MiniMax-M3";
export const MINIMAX_DEFAULT_BASE_URL = "https://api.minimax.io/anthropic";

export function minimaxModel(env: EnvLike): string {
  return (
    env.FABLE_ORCHESTRATOR_MINIMAX_MODEL?.trim() || MINIMAX_DEFAULT_MODEL
  );
}

export function minimaxBaseUrl(env: EnvLike): string {
  return (
    env.FABLE_ORCHESTRATOR_MINIMAX_BASE_URL?.trim() || MINIMAX_DEFAULT_BASE_URL
  );
}

export function minimaxApiKey(env: EnvLike): string | null {
  return (
    env.FABLE_ORCHESTRATOR_MINIMAX_API_KEY?.trim() ||
    env.MINIMAX_API_KEY?.trim() ||
    null
  );
}

export function minimaxConfigured(env: EnvLike): boolean {
  return minimaxApiKey(env) !== null;
}
