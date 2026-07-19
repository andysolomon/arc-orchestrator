import type { BackendOutageReason } from "./trace-schema";

// Classification of backend failures and construction of the machine-readable
// fallback hint emitted on stderr. These are pure functions of their inputs so
// they can be exercised directly without spawning a backend.

export type BackendFallback =
  | { backend: "claude"; model: string }
  | { backend: "composer"; model: string }
  | { backend: "minimax"; model: string };

export type FallbackHint = {
  failure_class: "backend_unavailable";
  outage_reason: BackendOutageReason;
  fallback: BackendFallback;
};

export function collectCodexErrors(eventStream: string): string[] {
  const messages: string[] = [];

  for (const line of eventStream.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      const nestedError = event.error as Record<string, unknown> | undefined;
      const sessionError =
        event.session && typeof event.session === "object"
          ? ((event.session as { error?: unknown }).error as
              | Record<string, unknown>
              | string
              | undefined)
          : undefined;
      const message =
        event.type === "error" && typeof event.message === "string"
          ? event.message
          : event.type === "error" &&
              typeof nestedError?.message === "string"
            ? nestedError.message
            : event.type === "turn.failed" &&
                typeof nestedError?.message === "string"
              ? nestedError.message
              : typeof sessionError === "string"
                ? sessionError
                : sessionError && typeof sessionError.message === "string"
                  ? sessionError.message
                  : typeof event.error === "string"
                    ? event.error
                    : null;
      if (message && !messages.includes(message)) {
        messages.push(message);
      }
    } catch {
      continue;
    }
  }

  return messages;
}

export function collectOpenCodeErrors(eventStream: string): string[] {
  return collectCodexErrors(eventStream);
}

export function classifyBackendOutage(
  errors: string[],
): BackendOutageReason | null {
  const combined = errors.join("\n");
  if (/usage limit|rate limit|hit your usage/i.test(combined)) {
    return "usage_limit";
  }
  if (/not logged in|authentication|\b401\b|unauthorized/i.test(combined)) {
    return "auth";
  }
  if (/\bENOENT\b|CLI not found|not found: /i.test(combined)) {
    return "missing_binary";
  }
  if (
    /model.?unavailable|unknown model|model not (?:found|available)|provider.*unavailable/i.test(
      combined,
    )
  ) {
    return "model_unavailable";
  }
  return null;
}

// The fallback hint printed on stderr and mirrored into the trace record when a
// Codex run is classified as an availability outage. Key order is significant:
// it is compared verbatim as a JSON string by the CLI's stderr contract.
export function buildFallbackHint(
  reason: BackendOutageReason,
  fallback: BackendFallback,
): FallbackHint {
  return {
    failure_class: "backend_unavailable",
    outage_reason: reason,
    fallback,
  };
}
