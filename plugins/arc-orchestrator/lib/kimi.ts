import type { EnvLike } from "./routes";

// Kimi (Moonshot) exposes an Anthropic-compatible endpoint, so the kimi backend
// reuses the Claude CLI with per-invocation base-URL and auth-token environment
// injection. As a pay-as-you-go API tier it is not subject to the subscription
// usage limits that can exhaust the codex and claude backends simultaneously,
// which makes it the terminal availability-fallback tier after MiniMax when configured.

export const KIMI_DEFAULT_MODEL = "kimi-k3[1m]";
export const KIMI_DEFAULT_BASE_URL = "https://api.moonshot.ai/anthropic";

export function kimiModel(env: EnvLike): string {
  return env.ARC_ORCHESTRATOR_KIMI_MODEL?.trim() || KIMI_DEFAULT_MODEL;
}

export function kimiBaseUrl(env: EnvLike): string {
  return (
    env.ARC_ORCHESTRATOR_KIMI_BASE_URL?.trim() || KIMI_DEFAULT_BASE_URL
  );
}

export function kimiApiKey(env: EnvLike): string | null {
  return (
    env.ARC_ORCHESTRATOR_KIMI_API_KEY?.trim() ||
    env.MOONSHOT_API_KEY?.trim() ||
    env.KIMI_API_KEY?.trim() ||
    null
  );
}

export function kimiConfigured(env: EnvLike): boolean {
  return kimiApiKey(env) !== null;
}
