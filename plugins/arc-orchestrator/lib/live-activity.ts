// Versioned, privacy-safe live activity events for external renderers (Pi).
//
// Protocol: one stderr line per event, prefixed `arc-orchestrator: event: `
// followed by a single JSON object `{v,kind,seq,at,data}`. Version 1 preserves
// lifecycle and file summaries; additive version 2 events carry safe unified
// hunks. Only whitelisted, bounded fields ever reach `data`; assistant/reasoning
// prose, raw backend stdout, and prompts are never forwarded. Emission is
// best-effort: every entry point swallows failures so an event cannot fail a run.

import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export const LIVE_ACTIVITY_PROTOCOL_VERSION = 1 as const;
export const LIVE_ACTIVITY_EVENT_PREFIX = "arc-orchestrator: event: ";

export type LiveActivityKind = "activity" | "phase" | "files";

export type LiveActivityPhaseStatus =
  | "preparing"
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

export type LiveActivityDiffHunk = {
  header: string;
  lines: string[];
};

export type LiveActivityDiffOmission =
  | "baseline-dirty"
  | "binary"
  | "malformed-diff"
  | "sensitive-path"
  | "size-limit"
  | "symlink"
  | "unsafe-content"
  | "unavailable";

export type LiveActivityDiffData = {
  file: string;
  status: LiveActivityFileStatus;
  oldFile?: string;
  hunks: LiveActivityDiffHunk[];
  truncated: boolean;
  redactions: number;
  omitted?: LiveActivityDiffOmission;
};

export const LIVE_ACTIVITY_LIMITS = {
  maxEventsPerRun: 200,
  minActivityIntervalMs: 1000,
  maxFilesListed: 20,
  maxGitStatusBytes: 2_000_000,
  maxGitCommandMs: 1_000,
  maxDiffCollectionMs: 2_000,
  maxDiffEventsPerRun: 5,
  maxDiffHunksPerFile: 3,
  maxDiffLinesPerFile: 24,
  maxDiffLineChars: 200,
  maxDiffBytesPerFile: 2_400,
  maxDiffBytesPerRun: 8_000,
  maxEventLineChars: 16_000,
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

const DIFF_OMISSIONS: ReadonlySet<string> = new Set([
  "baseline-dirty",
  "binary",
  "malformed-diff",
  "sensitive-path",
  "size-limit",
  "symlink",
  "unsafe-content",
  "unavailable",
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
  diff(data: LiveActivityDiffData): void;
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
  let diffEvents = 0;
  let diffBytes = 0;

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

  const emitDiff = (data: LiveActivityDiffData): void => {
    try {
      if (
        !enabled ||
        seq >= maxEvents ||
        diffEvents >= LIVE_ACTIVITY_LIMITS.maxDiffEventsPerRun
      ) {
        return;
      }
      const safe = whitelistDiffData(data);
      if (!safe) {
        return;
      }
      const at = now();
      const event = {
        v: 2 as const,
        kind: "diff" as const,
        seq: seq + 1,
        at,
        data: safe,
      };
      const json = JSON.stringify(event);
      const bytes = Buffer.byteLength(json);
      if (
        json.length > LIVE_ACTIVITY_LIMITS.maxEventLineChars ||
        diffBytes + bytes > LIVE_ACTIVITY_LIMITS.maxDiffBytesPerRun
      ) {
        return;
      }
      options.emitStderr(`${LIVE_ACTIVITY_EVENT_PREFIX}${json}`);
      seq += 1;
      diffEvents += 1;
      diffBytes += bytes;
    } catch {
      // Best-effort only.
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
    diff(data) {
      emitDiff(data);
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

type StatusEntry = { path: string; xy: string; oldPath?: string };
type WorkspaceEntry = { xy: string; fingerprint: string; oldPath?: string };

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
    const entry: StatusEntry = { path, xy };
    // Rename/copy records carry the origin path as the next NUL token.
    if (xy.includes("R") || xy.includes("C")) {
      index += 1;
      const oldPath = tokens[index];
      if (!oldPath) {
        return null;
      }
      entry.oldPath = oldPath;
    }
    entries.push(entry);
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
      timeout: LIVE_ACTIVITY_LIMITS.maxGitCommandMs,
      maxBuffer: 4_096,
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
    timeout: LIVE_ACTIVITY_LIMITS.maxGitCommandMs,
    maxBuffer: LIVE_ACTIVITY_LIMITS.maxGitStatusBytes + 1,
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
      ...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
    });
  }
  return entries;
}

function whitelistDiffData(
  data: LiveActivityDiffData,
): Record<string, unknown> | null {
  const file = sanitizeLiveActivityText(
    data?.file,
    LIVE_ACTIVITY_LIMITS.fieldChars.file,
  );
  const status = data?.status;
  const oldFile = sanitizeLiveActivityText(
    data?.oldFile,
    LIVE_ACTIVITY_LIMITS.fieldChars.file,
  );
  const redactions = sanitizeCount(data?.redactions);
  if (
    !file ||
    file !== data.file ||
    !safeRepoRelativePath(file) ||
    !FILE_STATUSES.has(status) ||
    redactions === null ||
    typeof data?.truncated !== "boolean"
  ) {
    return null;
  }
  if (
    data.oldFile !== undefined &&
    (!oldFile || oldFile !== data.oldFile || !safeRepoRelativePath(oldFile))
  ) {
    return null;
  }
  const omitted = data.omitted;
  if (omitted !== undefined && !DIFF_OMISSIONS.has(omitted)) {
    return null;
  }
  const hunks: LiveActivityDiffHunk[] = [];
  let lineCount = 0;
  let truncated = data.truncated;
  if (!Array.isArray(data.hunks)) {
    return null;
  }
  if (data.hunks.length > LIVE_ACTIVITY_LIMITS.maxDiffHunksPerFile) {
    truncated = true;
  }
  for (const hunk of data.hunks.slice(
    0,
    LIVE_ACTIVITY_LIMITS.maxDiffHunksPerFile,
  )) {
    if (!hunk || typeof hunk.header !== "string" || !Array.isArray(hunk.lines)) {
      return null;
    }
    const headerMatch = hunk.header.match(/^(@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@)/);
    if (!headerMatch) {
      return null;
    }
    const lines: string[] = [];
    for (const line of hunk.lines) {
      if (typeof line !== "string" || !/^[ +\\-]/.test(line) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(line)) {
        return null;
      }
      if (lineCount >= LIVE_ACTIVITY_LIMITS.maxDiffLinesPerFile) {
        truncated = true;
        continue;
      }
      const capped = capDiffLine(line);
      lines.push(capped.line);
      lineCount += 1;
      truncated ||= capped.truncated;
    }
    hunks.push({ header: headerMatch[1], lines });
  }
  if (omitted !== undefined && hunks.length > 0) {
    return null;
  }
  if (
    omitted === undefined &&
    (sensitivePath(file) ||
      (oldFile !== null && sensitivePath(oldFile)) ||
      unsafeDiffContent(
        hunks.flatMap((hunk) => hunk.lines).join("\n"),
      ) > 0)
  ) {
    return null;
  }
  const safe = {
    file,
    status,
    ...(oldFile ? { oldFile } : {}),
    hunks,
    truncated,
    redactions,
    ...(omitted ? { omitted } : {}),
  };
  return Buffer.byteLength(JSON.stringify(safe)) <= LIVE_ACTIVITY_LIMITS.maxDiffBytesPerFile
    ? safe
    : null;
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

type HeadObject = { mode: string; size: number };

function safeRepoRelativePath(path: string): boolean {
  if (
    path === "" ||
    isAbsolute(path) ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    return false;
  }
  const parts = path.split(/[\\/]+/);
  return !parts.includes("") && !parts.includes(".") && !parts.includes("..");
}

function sensitivePath(path: string): boolean {
  const parts = path.toLowerCase().split(/[\\/]+/);
  return parts.some((part) =>
    part === ".env" ||
    part.startsWith(".env.") ||
    part === ".npmrc" ||
    part === ".pypirc" ||
    part === ".netrc" ||
    part === "credentials" ||
    part === "credentials.json" ||
    part === "id_rsa" ||
    part === "id_ed25519" ||
    part === ".aws" ||
    part === ".ssh" ||
    part === ".gnupg" ||
    part === ".claude" ||
    part === ".codex" ||
    /\.(?:key|pem|p12|pfx|log)$/i.test(part) ||
    /(^|[._-])(prompt|transcript|conversation)([._-]|$)/.test(part) ||
    /(^|[._-])(secret|secrets|passwords?|tokens?|private[-_]?keys?)([._-]|$)/.test(part)
  );
}

function headObject(root: string, path: string): HeadObject | null {
  const tree = Bun.spawnSync(
    ["git", "-C", root, "ls-tree", "-z", "HEAD", "--", path],
    {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
      timeout: LIVE_ACTIVITY_LIMITS.maxGitCommandMs,
      maxBuffer: 1_001,
    },
  );
  if (tree.exitCode !== 0) {
    return null;
  }
  const output = tree.stdout.toString();
  if (output.length > 1_000 || !output.endsWith("\0")) {
    return null;
  }
  const match = output.match(/^(\d{6}) blob ([0-9a-f]{40,64})\t([^\0]+)\0$/);
  if (!match || match[3] !== path) {
    return null;
  }
  const sizeResult = Bun.spawnSync(["git", "-C", root, "cat-file", "-s", match[2]], {
    stdout: "pipe",
    stderr: "ignore",
    stdin: "ignore",
    timeout: LIVE_ACTIVITY_LIMITS.maxGitCommandMs,
    maxBuffer: 100,
  });
  if (sizeResult.exitCode !== 0) {
    return null;
  }
  const sizeText = sizeResult.stdout.toString().trim();
  if (!/^\d+$/.test(sizeText)) {
    return null;
  }
  return { mode: match[1], size: Number(sizeText) };
}

function currentFileInfo(
  root: string,
  path: string,
): { size: number; symlink: boolean } | null {
  const absolute = workspacePath(root, path);
  if (!absolute) {
    return null;
  }
  try {
    const stat = lstatSync(absolute);
    return {
      size: stat.size,
      symlink: stat.isSymbolicLink() || !stat.isFile(),
    };
  } catch {
    return null;
  }
}

const SECRET_LIKE =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|passwd|secret|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*["']?[^\s"']{6,}|\b(?:AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/i;
const RAW_TRANSCRIPT_LIKE =
  /^[-+ ]?\s*"(?:assistant|reasoning|prompt|system|tool_calls?)"\s*:/i;

function unsafeDiffContent(text: string): number {
  let matches = 0;
  for (const line of text.split("\n")) {
    if (SECRET_LIKE.test(line) || RAW_TRANSCRIPT_LIKE.test(line)) {
      matches += 1;
    }
  }
  return matches;
}

function omission(
  file: string,
  status: LiveActivityFileStatus,
  reason: LiveActivityDiffOmission,
  oldFile?: string,
  redactions = 0,
): LiveActivityDiffData {
  return {
    file,
    status,
    ...(oldFile ? { oldFile } : {}),
    hunks: [],
    truncated: true,
    redactions,
    omitted: reason,
  };
}

function capDiffLine(line: string): { line: string; truncated: boolean } {
  let capped = line.slice(0, LIVE_ACTIVITY_LIMITS.maxDiffLineChars);
  while (Buffer.byteLength(capped) > LIVE_ACTIVITY_LIMITS.maxDiffLineChars) {
    capped = capped.slice(0, -1);
  }
  return { line: capped, truncated: capped !== line };
}

function parseUnifiedHunks(
  text: string,
  base: Omit<LiveActivityDiffData, "hunks" | "truncated" | "redactions">,
): LiveActivityDiffData | null {
  if (/\0/.test(text)) {
    return null;
  }
  const source = text.replace(/\r\n/g, "\n").split("\n");
  const hunks: LiveActivityDiffHunk[] = [];
  let current: LiveActivityDiffHunk | null = null;
  let lineCount = 0;
  let truncated = false;
  for (const raw of source) {
    const match = raw.match(/^(@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@)/);
    if (match) {
      if (hunks.length >= LIVE_ACTIVITY_LIMITS.maxDiffHunksPerFile) {
        truncated = true;
        current = null;
        continue;
      }
      current = { header: match[1], lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current || !/^[ +\\-]/.test(raw)) {
      continue;
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) {
      return null;
    }
    if (lineCount >= LIVE_ACTIVITY_LIMITS.maxDiffLinesPerFile) {
      truncated = true;
      continue;
    }
    const capped = capDiffLine(raw);
    current.lines.push(capped.line);
    lineCount += 1;
    truncated ||= capped.truncated;
    const candidate = { ...base, hunks, truncated, redactions: 0 };
    if (
      Buffer.byteLength(JSON.stringify(candidate)) >
      LIVE_ACTIVITY_LIMITS.maxDiffBytesPerFile
    ) {
      current.lines.pop();
      lineCount -= 1;
      truncated = true;
    }
  }
  return hunks.length > 0 || base.status === "renamed"
    ? { ...base, hunks, truncated, redactions: 0 }
    : null;
}

function untrackedDiff(root: string, file: string): string | null {
  const absolute = workspacePath(root, file);
  if (!absolute) {
    return null;
  }
  let descriptor: number | null = null;
  try {
    descriptor = openSync(
      absolute,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const stat = fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.size > LIVE_ACTIVITY_LIMITS.maxDiffBytesPerFile
    ) {
      return null;
    }
    const content = readFileSync(descriptor);
    if (content.includes(0)) {
      return "binary";
    }
    const text = content.toString("utf8");
    if (Buffer.from(text, "utf8").compare(content) !== 0) {
      return "binary";
    }
    const lines = text.split("\n");
    if (lines.at(-1) === "") {
      lines.pop();
    }
    return `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}`;
  } catch {
    return null;
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // Best-effort collection; the descriptor may already be invalid.
      }
    }
  }
}

function trackedDiff(root: string, file: string, oldFile?: string): string | null {
  const paths = oldFile ? [oldFile, file] : [file];
  const result = Bun.spawnSync(
    [
      "git",
      "-C",
      root,
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--unified=3",
      "HEAD",
      "--",
      ...paths,
    ],
    {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
      timeout: LIVE_ACTIVITY_LIMITS.maxGitCommandMs,
      maxBuffer: LIVE_ACTIVITY_LIMITS.maxDiffBytesPerFile * 8 + 1,
    },
  );
  if (result.exitCode !== 0) {
    return null;
  }
  const bytes = Buffer.from(result.stdout);
  if (bytes.includes(0)) {
    return "binary";
  }
  const output = bytes.toString("utf8");
  if (Buffer.from(output, "utf8").compare(bytes) !== 0) {
    return "binary";
  }
  return output.length <= LIVE_ACTIVITY_LIMITS.maxDiffBytesPerFile * 8 ? output : null;
}

/**
 * Collect bounded, sanitized v2 unified-diff payloads for changes made after
 * the baseline. Collection is deliberately synchronous so callers can emit
 * before finalizing the run. Any ambiguity becomes an omission.
 */
export function collectWorkspaceDiffs(
  baseline: WorkspaceBaseline,
  forbiddenText: readonly string[] = [],
): LiveActivityDiffData[] | null {
  try {
    const deadline = Date.now() + LIVE_ACTIVITY_LIMITS.maxDiffCollectionMs;
    const current = gitStatusEntries(baseline.cwd);
    if (current === null) {
      return null;
    }
    const changed = new Map<string, WorkspaceEntry | null>();
    for (const [file, entry] of current) {
      const previous = baseline.entries.get(file);
      if (previous?.xy !== entry.xy || previous.fingerprint !== entry.fingerprint) {
        changed.set(file, entry);
      }
    }
    for (const file of baseline.entries.keys()) {
      if (!current.has(file)) {
        changed.set(file, null);
      }
    }

    const events: LiveActivityDiffData[] = [];
    const boundedChanges = [...changed]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, LIVE_ACTIVITY_LIMITS.maxFilesListed);
    for (const [file, entry] of boundedChanges) {
      if (events.length >= LIVE_ACTIVITY_LIMITS.maxDiffEventsPerRun) {
        break;
      }
      const status = entry ? fileStatusFromXy(entry.xy) : "unknown";
      const oldFile = entry?.oldPath;
      if (Date.now() >= deadline) {
        events.push(omission(file, status, "unavailable", oldFile));
        continue;
      }
      if (!safeRepoRelativePath(file) || (oldFile && !safeRepoRelativePath(oldFile))) {
        events.push(omission(file, status, "unavailable", oldFile));
        continue;
      }
      if (baseline.entries.has(file) || (oldFile && baseline.entries.has(oldFile))) {
        events.push(omission(file, status, "baseline-dirty", oldFile));
        continue;
      }
      if (sensitivePath(file) || (oldFile && sensitivePath(oldFile))) {
        events.push(omission(file, status, "sensitive-path", oldFile));
        continue;
      }

      const currentInfo =
        status === "deleted" || status === "unknown"
          ? null
          : currentFileInfo(baseline.cwd, file);
      const headPath = oldFile ?? file;
      const oldInfo = status === "added" && !oldFile ? null : headObject(baseline.cwd, headPath);
      if (currentInfo?.symlink || oldInfo?.mode === "120000") {
        events.push(omission(file, status, "symlink", oldFile));
        continue;
      }
      if (
        (currentInfo && currentInfo.size > LIVE_ACTIVITY_LIMITS.maxDiffBytesPerFile) ||
        (oldInfo && oldInfo.size > LIVE_ACTIVITY_LIMITS.maxDiffBytesPerFile)
      ) {
        events.push(omission(file, status, "size-limit", oldFile));
        continue;
      }
      if (
        (status !== "deleted" && status !== "unknown" && !currentInfo) ||
        (status === "deleted" && !oldInfo)
      ) {
        events.push(omission(file, status, "unavailable", oldFile));
        continue;
      }

      const raw = status === "added" && !oldFile
        ? untrackedDiff(baseline.cwd, file)
        : trackedDiff(baseline.cwd, file, oldFile);
      if (
        raw === "binary" ||
        raw?.includes("Binary files ") ||
        raw?.includes("GIT binary patch")
      ) {
        events.push(omission(file, status, "binary", oldFile));
        continue;
      }
      if (raw === null) {
        events.push(omission(file, status, "unavailable", oldFile));
        continue;
      }
      const containsForbiddenText = forbiddenText.some(
        (text) => text !== "" && raw.includes(text),
      );
      const redactions = unsafeDiffContent(raw) + (containsForbiddenText ? 1 : 0);
      if (redactions > 0) {
        events.push(omission(file, status, "unsafe-content", oldFile, redactions));
        continue;
      }
      const parsed = parseUnifiedHunks(raw, {
        file,
        status,
        ...(oldFile ? { oldFile } : {}),
      });
      events.push(parsed ?? omission(file, status, "malformed-diff", oldFile));
    }
    return events;
  } catch {
    return null;
  }
}
