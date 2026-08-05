// Versioned, privacy-safe live activity events for external renderers (Pi).
//
// Protocol: one stderr line per event, prefixed `arc-orchestrator: event: `
// followed by a single JSON object `{v:1,kind,seq,at,data}`. Only whitelisted,
// bounded fields ever reach `data`; assistant/reasoning prose, raw backend
// stdout, and prompts are never forwarded. Emission is best-effort: every
// entry point swallows its own failures so an event can never fail a run.

import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export const LIVE_ACTIVITY_PROTOCOL_VERSION = 1 as const;
export const LIVE_ACTIVITY_EVENT_PREFIX = "arc-orchestrator: event: ";

export type LiveActivityKind = "activity" | "phase" | "files";

export type LiveActivityPhaseStatus =
  | "preparing"
  | "waiting-write-lock"
  | "running"
  | "validating"
  | "completed"
  | "blocked"
  | "error";

export type LiveActivityPhaseData = {
  phase: string;
  status: LiveActivityPhaseStatus;
  model?: string;
};

export type LiveActivityActivityData = {
  status: "waiting-provider";
  tool?: string;
  count?: number;
};

export type LiveActivityFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "unknown";

export type LiveActivityFileChange = {
  file: string;
  status: LiveActivityFileStatus;
};

export type LiveActivityFilesData = {
  count: number;
  files: LiveActivityFileChange[];
};

export const LIVE_ACTIVITY_LIMITS = {
  maxEventsPerRun: 200,
  minActivityIntervalMs: 1000,
  maxFilesListed: 20,
  maxGitStatusBytes: 2_000_000,
  fieldChars: {
    phase: 40,
    status: 40,
    model: 80,
    tool: 40,
    file: 200,
  },
} as const;

const PHASE_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "waiting-write-lock",
  "running",
  "validating",
  "completed",
  "blocked",
  "error",
]);

const PHASES: ReadonlySet<string> = new Set([
  "explore",
  "analyze",
  "research",
  "plan",
  "implement",
  "verify",
  "deploy",
  "review",
]);

const ACTIVITY_STATUSES: ReadonlySet<string> = new Set(["waiting-provider"]);

const FILE_STATUSES: ReadonlySet<string> = new Set([
  "added",
  "modified",
  "deleted",
  "renamed",
  "unknown",
]);

// Collapse all whitespace (including newlines) so multi-line prose can never
// smuggle content past the single-line protocol, strip control characters, and
// cap the length. Returns null when nothing safe remains.
export function sanitizeLiveActivityText(
  value: unknown,
  limit: number,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  const compact = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (compact === "") {
    return null;
  }
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`;
}

function sanitizeCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function sanitizeLabel(value: unknown, limit: number): string | null {
  const label = sanitizeLiveActivityText(value, limit);
  return label && /^[A-Za-z0-9][A-Za-z0-9._:/+@-]*$/.test(label)
    ? label
    : null;
}

function whitelistPhaseData(
  data: LiveActivityPhaseData,
): Record<string, unknown> | null {
  const chars = LIVE_ACTIVITY_LIMITS.fieldChars;
  const phase = sanitizeLiveActivityText(data.phase, chars.phase);
  const status = sanitizeLiveActivityText(data.status, chars.status);
  if (
    !phase ||
    !status ||
    !PHASES.has(phase) ||
    !PHASE_STATUSES.has(status)
  ) {
    return null;
  }
  const model = sanitizeLabel(data.model, chars.model);
  return {
    phase,
    status,
    ...(model ? { model } : {}),
  };
}

function whitelistActivityData(
  data: LiveActivityActivityData,
): Record<string, unknown> | null {
  const chars = LIVE_ACTIVITY_LIMITS.fieldChars;
  const status = sanitizeLiveActivityText(data.status, chars.status);
  if (!status || !ACTIVITY_STATUSES.has(status)) {
    return null;
  }
  const tool = sanitizeLabel(data.tool, chars.tool);
  const count = sanitizeCount(data.count);
  return {
    status,
    ...(tool ? { tool } : {}),
    ...(count !== null ? { count } : {}),
  };
}

function whitelistFilesData(
  data: LiveActivityFilesData,
): Record<string, unknown> | null {
  const chars = LIVE_ACTIVITY_LIMITS.fieldChars;
  const count = sanitizeCount(data.count);
  if (count === null) {
    return null;
  }
  const files: LiveActivityFileChange[] = [];
  for (const entry of Array.isArray(data.files) ? data.files : []) {
    if (files.length >= LIVE_ACTIVITY_LIMITS.maxFilesListed) {
      break;
    }
    const file = sanitizeLiveActivityText(entry?.file, chars.file);
    const status =
      typeof entry?.status === "string" && FILE_STATUSES.has(entry.status)
        ? entry.status
        : "unknown";
    if (file) {
      files.push({ file, status });
    }
  }
  return {
    count,
    files,
  };
}

export type LiveActivityEmitter = {
  phase(data: LiveActivityPhaseData): void;
  activity(data: LiveActivityActivityData): void;
  files(data: LiveActivityFilesData): void;
};

export type LiveActivityEmitterOptions = {
  emitStderr: (line: string) => void;
  enabled?: boolean;
  now?: () => number;
  minActivityIntervalMs?: number;
  maxEvents?: number;
};

// Opt-out only; live activity is additive and on by default.
export function liveActivityEnabled(
  env: Record<string, string | undefined>,
): boolean {
  const raw = env.ARC_ORCHESTRATOR_LIVE_ACTIVITY?.trim().toLowerCase();
  return !(raw === "0" || raw === "off" || raw === "false");
}

export function createLiveActivityEmitter(
  options: LiveActivityEmitterOptions,
): LiveActivityEmitter {
  const enabled = options.enabled ?? true;
  const now = options.now ?? Date.now;
  const minActivityIntervalMs =
    options.minActivityIntervalMs ?? LIVE_ACTIVITY_LIMITS.minActivityIntervalMs;
  const maxEvents = options.maxEvents ?? LIVE_ACTIVITY_LIMITS.maxEventsPerRun;
  let seq = 0;
  let lastActivityAt: number | null = null;

  const emit = (kind: LiveActivityKind, data: Record<string, unknown>): void => {
    try {
      if (!enabled || seq >= maxEvents) {
        return;
      }
      const at = now();
      // Rate limit applies to the chatty `activity` kind only; `phase` and
      // `files` are naturally bounded per attempt and always pass.
      if (kind === "activity") {
        if (lastActivityAt !== null && at - lastActivityAt < minActivityIntervalMs) {
          return;
        }
        lastActivityAt = at;
      }
      seq += 1;
      const line = JSON.stringify({
        v: LIVE_ACTIVITY_PROTOCOL_VERSION,
        kind,
        seq,
        at,
        data,
      });
      options.emitStderr(`${LIVE_ACTIVITY_EVENT_PREFIX}${line}`);
    } catch {
      // Best-effort only: event emission must never fail a worker run.
    }
  };

  return {
    phase(data) {
      try {
        const safe = whitelistPhaseData(data);
        if (safe) {
          emit("phase", safe);
        }
      } catch {
        // Swallow: never fail the run.
      }
    },
    activity(data) {
      try {
        const safe = whitelistActivityData(data);
        if (safe) {
          emit("activity", safe);
        }
      } catch {
        // Swallow: never fail the run.
      }
    },
    files(data) {
      try {
        const safe = whitelistFilesData(data);
        if (safe) {
          emit("files", safe);
        }
      } catch {
        // Swallow: never fail the run.
      }
    },
  };
}

// --- Workspace file-change capture -----------------------------------------
//
// Baseline-vs-current comparison of `git status --porcelain -z`, taken around
// a workspace-write invocation. Anything unsafe (non-git cwd, git failure,
// oversized status output) degrades to null so callers simply skip the event.

export type WorkspaceBaseline = {
  cwd: string;
  entries: Map<string, WorkspaceEntry>;
};

type StatusEntry = { path: string; xy: string };
type WorkspaceEntry = { xy: string; fingerprint: string };

function parsePorcelainZ(output: string): StatusEntry[] | null {
  const entries: StatusEntry[] = [];
  const tokens = output.split("\0");
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    if (token.length < 4) {
      return null;
    }
    const xy = token.slice(0, 2);
    const path = token.slice(3);
    if (!path) {
      return null;
    }
    entries.push({ path, xy });
    // Rename/copy records carry the origin path as the next NUL token.
    if (xy.includes("R") || xy.includes("C")) {
      index += 1;
    }
  }
  return entries;
}

function gitRepoRoot(cwd: string): string | null {
  const result = Bun.spawnSync(
    ["git", "-C", cwd, "rev-parse", "--show-toplevel"],
    {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    },
  );
  if (result.exitCode !== 0) {
    return null;
  }
  const root = result.stdout.toString().trim();
  if (!isAbsolute(root)) {
    return null;
  }
  try {
    return realpathSync(root);
  } catch {
    return null;
  }
}

function workspacePath(root: string, path: string): string | null {
  const absolute = resolve(root, path);
  const fromRoot = relative(root, absolute);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot))
    ? absolute
    : null;
}

function fingerprintPath(root: string, path: string): string {
  const absolute = workspacePath(root, path);
  if (!absolute) {
    return "unsafe-path";
  }
  try {
    const stat = lstatSync(absolute);
    // Metadata only: never read workspace contents (which may include secrets).
    // inode/size/mtime/ctime detects edits to files already dirty at baseline.
    return `metadata:${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  } catch {
    return "missing";
  }
}

function gitStatusEntries(cwd: string): Map<string, WorkspaceEntry> | null {
  const result = Bun.spawnSync([
    "git",
    "-C",
    cwd,
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ], {
    stdout: "pipe",
    stderr: "ignore",
    stdin: "ignore",
  });
  if (result.exitCode !== 0) {
    return null;
  }
  const output = result.stdout.toString();
  if (output.length > LIVE_ACTIVITY_LIMITS.maxGitStatusBytes) {
    return null;
  }
  const parsed = parsePorcelainZ(output);
  if (parsed === null) {
    return null;
  }
  const entries = new Map<string, WorkspaceEntry>();
  for (const entry of parsed) {
    entries.set(entry.path, {
      xy: entry.xy,
      fingerprint: fingerprintPath(cwd, entry.path),
    });
  }
  return entries;
}

export function captureWorkspaceBaseline(cwd: string): WorkspaceBaseline | null {
  try {
    const root = gitRepoRoot(cwd);
    if (!root) {
      return null;
    }
    const entries = gitStatusEntries(root);
    return entries === null ? null : { cwd: root, entries };
  } catch {
    return null;
  }
}

function fileStatusFromXy(xy: string): LiveActivityFileStatus {
  if (xy.includes("?") || xy.includes("A")) {
    return "added";
  }
  if (xy.includes("D")) {
    return "deleted";
  }
  if (xy.includes("R")) {
    return "renamed";
  }
  return "modified";
}

export function diffWorkspaceChanges(
  baseline: WorkspaceBaseline,
): LiveActivityFilesData | null {
  try {
    const current = gitStatusEntries(baseline.cwd);
    if (current === null) {
      return null;
    }
    const changes: LiveActivityFileChange[] = [];
    for (const [file, entry] of current) {
      const previous = baseline.entries.get(file);
      if (
        previous?.xy !== entry.xy ||
        previous.fingerprint !== entry.fingerprint
      ) {
        changes.push({ file, status: fileStatusFromXy(entry.xy) });
      }
    }
    for (const file of baseline.entries.keys()) {
      if (!current.has(file)) {
        // Dirty at baseline, clean now: reverted or removed out-of-band.
        changes.push({ file, status: "unknown" });
      }
    }
    changes.sort((a, b) => a.file.localeCompare(b.file));
    return {
      count: changes.length,
      files: changes.slice(0, LIVE_ACTIVITY_LIMITS.maxFilesListed),
    };
  } catch {
    return null;
  }
}
