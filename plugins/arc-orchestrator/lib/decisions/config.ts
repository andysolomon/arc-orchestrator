// Configuration for Jev (TypeSafe) structured decisions.
//
// Everything here is a pure function of an EnvLike so the flag, thresholds, and
// client settings can be exercised directly in unit tests. Unknown or invalid
// values fall back to the documented defaults instead of failing a run.

import type { EnvLike } from "../routes";

// off: never call Jev; the existing parent-owned decision stands.
// shadow: call Jev and log what it would have decided, but act on the
//   existing decision only.
// on: act on the confidence-gated Jev decision.
export type JevDecisionMode = "off" | "shadow" | "on";

export function jevDecisionMode(env: EnvLike): JevDecisionMode {
  const raw = env.USE_JEV_DECISIONS?.trim().toLowerCase();
  if (raw === "shadow") {
    return "shadow";
  }
  if (raw === "on" || raw === "1" || raw === "true") {
    return "on";
  }
  return "off";
}

export type JevThresholds = {
  // Minimum Choice confidence for routeTask to act without Fable.
  routeMinConfidence: number;
  // Minimum Score confidence (every assessTask score) to act without Fable.
  assessMinConfidence: number;
  // Minimum confidence Fable must state when it settles an uncertain
  // completion check; below it the task goes to a human.
  completionMinConfidence: number;
  // A completion Noul at or above this reads as "yes".
  completionYes: number;
  // A completion Noul at or below this reads as "no".
  completionNo: number;
  // "Needs human review" Noul strictly above this always requires a human.
  humanReviewNoul: number;
  // Risk (1-5 scale) at or above this always requires a human.
  riskHuman: number;
};

export const DEFAULT_JEV_THRESHOLDS: JevThresholds = {
  routeMinConfidence: 0.75,
  assessMinConfidence: 0.75,
  completionMinConfidence: 0.75,
  completionYes: 0.8,
  completionNo: 0.2,
  humanReviewNoul: 0.6,
  riskHuman: 4,
};

export const JEV_THRESHOLD_ENV: Record<keyof JevThresholds, string> = {
  routeMinConfidence: "ROUTE_MIN_CONFIDENCE",
  assessMinConfidence: "ASSESS_MIN_CONFIDENCE",
  completionMinConfidence: "COMPLETION_MIN_CONFIDENCE",
  completionYes: "COMPLETION_YES_THRESHOLD",
  completionNo: "COMPLETION_NO_THRESHOLD",
  humanReviewNoul: "HUMAN_REVIEW_THRESHOLD",
  riskHuman: "RISK_HUMAN_THRESHOLD",
};

function envNumber(
  env: EnvLike,
  name: string,
  fallback: number,
  min: number,
  max: number,
  warnings: string[],
): number {
  const raw = env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    warnings.push(
      `${name} must be a number from ${min} to ${max}; using ${fallback}`,
    );
    return fallback;
  }
  return value;
}

export function resolveJevThresholds(env: EnvLike): {
  thresholds: JevThresholds;
  warnings: string[];
} {
  const warnings: string[] = [];
  const d = DEFAULT_JEV_THRESHOLDS;
  const n = JEV_THRESHOLD_ENV;
  const thresholds = { ...d };
  for (const key of Object.keys(d) as Array<keyof JevThresholds>) {
    const [min, max] = key === "riskHuman" ? [1, 5] : [0, 1];
    thresholds[key] = envNumber(env, n[key], d[key], min, max, warnings);
  }
  if (thresholds.completionNo >= thresholds.completionYes) {
    warnings.push(
      `${n.completionNo} must be below ${n.completionYes}; using ${d.completionNo} and ${d.completionYes}`,
    );
    thresholds.completionNo = d.completionNo;
    thresholds.completionYes = d.completionYes;
  }
  return { thresholds, warnings };
}

export type JevClientSettings = {
  // Per-attempt timeout handed to the SDK.
  timeoutMs: number;
  // SDK retries after the first attempt (429, 5xx, timeouts, connection).
  maxRetries: number;
  // Wall-clock budget across all attempts; the SDK has none of its own.
  totalTimeoutMs: number;
};

export const DEFAULT_JEV_CLIENT_SETTINGS: JevClientSettings = {
  timeoutMs: 10_000,
  maxRetries: 2,
  totalTimeoutMs: 30_000,
};

export function resolveJevClientSettings(env: EnvLike): {
  settings: JevClientSettings;
  warnings: string[];
} {
  const warnings: string[] = [];
  const d = DEFAULT_JEV_CLIENT_SETTINGS;
  const read = (name: string, fallback: number, min: number, max: number) =>
    Math.round(envNumber(env, name, fallback, min, max, warnings));
  const settings: JevClientSettings = {
    timeoutMs: read("JEV_TIMEOUT_MS", d.timeoutMs, 1, 600_000),
    maxRetries: read("JEV_MAX_RETRIES", d.maxRetries, 0, 10),
    totalTimeoutMs: read("JEV_TOTAL_TIMEOUT_MS", d.totalTimeoutMs, 1, 600_000),
  };
  return { settings, warnings };
}
