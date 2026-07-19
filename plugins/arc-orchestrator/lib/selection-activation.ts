// Staged activation controls for canonical route selection. These flags are
// intentionally exact-value opt-ins: an unset, blank, or unknown value keeps
// the legacy backend/mode execution path in place.

import type { EnvLike } from "./routes";

export const ROUTE_SELECTION_STAGE_ENV =
  "ARC_ORCHESTRATOR_ROUTE_SELECTION";

export type RouteSelectionStage = "off" | "shadow" | "active";

export function routeSelectionStage(env: EnvLike): RouteSelectionStage {
  const value = env[ROUTE_SELECTION_STAGE_ENV]?.trim().toLowerCase();
  if (value === "shadow") {
    return "shadow";
  }
  if (value === "active") {
    return "active";
  }
  return "off";
}
