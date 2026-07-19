import type { OrchestratorIdentity } from "./orchestrator-identity";
import type { EnvLike } from "./routes";
import { resolveSelectionStage } from "./rollout-gates";

// Four mutually exclusive routing intents for runner-routing-v2.
// - automatic: no --backend and no --route → ADR screenshot stacks
// - explicit: --route → exactly one pinned model, no chain
// - direct: --backend or --worker-model → legacy backend defaults
// - economy: --orchestrator eco → fixed eco tree
export type RoutingIntent = "automatic" | "explicit" | "direct" | "economy";

// Optional fail-closed compatibility marker for clients (for example ARC Pi).
// Pre-v2 runners reject the unknown flag; v2 runners accept the exact value
// only for automatic no-backend/no-route delegation. Omitting the flag keeps
// existing automatic callers working.
export const RUNNER_ROUTING_V2_POLICY = "runner-routing-v2" as const;

export type RoutingIntentInput = {
  orchestratorIdentity?: OrchestratorIdentity | null;
  routingIntent?: RoutingIntent | null;
  requestedAlias?: string | null;
  workerModel?: string | null;
  // true when the caller supplied --backend; false when omitted; undefined for
  // legacy engine callers that always pass a backend without the flag.
  backendExplicit?: boolean;
};

export type RoutingPolicyMarkerResult =
  | { ok: true; marker: typeof RUNNER_ROUTING_V2_POLICY | null }
  | { ok: false; error: string };

export function resolveRoutingIntent(
  input: RoutingIntentInput,
  env: EnvLike = {},
): RoutingIntent {
  if (input.orchestratorIdentity === "eco") {
    return "economy";
  }
  if (input.routingIntent) {
    return input.routingIntent;
  }
  if (input.requestedAlias) {
    return "explicit";
  }
  if (input.workerModel) {
    return "direct";
  }
  if (input.backendExplicit === true) {
    return "direct";
  }
  if (input.backendExplicit === false) {
    return "automatic";
  }
  // Legacy engine callers: selection stage active without an explicit intent
  // flag means the automatic screenshot policy.
  if (resolveSelectionStage(env) === "active") {
    return "automatic";
  }
  return "direct";
}

export function resolveRoutingPolicyMarker(input: {
  routingPolicy?: string | null;
  routingIntent: RoutingIntent;
}): RoutingPolicyMarkerResult {
  const raw = input.routingPolicy?.trim();
  if (!raw) {
    return { ok: true, marker: null };
  }
  if (raw !== RUNNER_ROUTING_V2_POLICY) {
    return {
      ok: false,
      error: `--routing-policy must be ${RUNNER_ROUTING_V2_POLICY}`,
    };
  }
  if (input.routingIntent !== "automatic") {
    return {
      ok: false,
      error: `--routing-policy ${RUNNER_ROUTING_V2_POLICY} is only valid for automatic delegation (omit --backend, --route, and eco mode)`,
    };
  }
  return { ok: true, marker: RUNNER_ROUTING_V2_POLICY };
}
