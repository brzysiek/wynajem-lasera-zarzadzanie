import fs from "fs";
import path from "path";

// Same reasoning as diag.log/crash.log in server.js: this host's
// Passenger/lsnode setup gives no discoverable location for the Node
// process's own stdout/stderr (see server.js's top comment), so anything
// worth checking after the fact — e.g. "did the reset e-mail actually
// send?" — has to be written to a file in the app directory ourselves.
// Kept separate from crash.log, which specifically means "the process
// itself crashed"; mixing in recoverable per-request errors here would
// blur that signal.

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

const configuredLevel = (process.env.LOG_LEVEL || "INFO").toUpperCase();
const threshold = LOG_LEVELS[configuredLevel as LogLevel] ?? LOG_LEVELS.INFO;
const retentionDays = parseInt(process.env.LOG_RETENTION_DAYS || "", 10) || 30;

const FILE_NAME_RE = /^(app|app-error)-(\d{4}-\d{2}-\d{2})\.log$/;

// Rotation-by-filename: each write recomputes today's date and appends to
// that day's file, so "rotation" needs no rename/cron step of its own — a
// new day simply means a new filename. Old-format app.log/app-error.log
// (no date suffix) are left alone as harmless pre-rotation history.
function todayStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Warsaw" });
}

function logPath(prefix: "app" | "app-error"): string {
  return path.join(process.cwd(), `${prefix}-${todayStr()}.log`);
}

let lastCleanupDate = "";

// Runs at most once per process per calendar day (cheap directory scan),
// triggered opportunistically off a normal log write rather than a
// dedicated timer — this host has no real cron (see server.js).
function cleanupOldLogsOncePerDay(): void {
  const today = todayStr();
  if (lastCleanupDate === today) return;
  lastCleanupDate = today;
  try {
    const cutoff = Date.now() - retentionDays * 86_400_000;
    for (const file of fs.readdirSync(process.cwd())) {
      const match = file.match(FILE_NAME_RE);
      if (!match) continue;
      const fileDate = Date.parse(`${match[2]}T00:00:00Z`);
      if (fileDate < cutoff) fs.unlinkSync(path.join(process.cwd(), file));
    }
  } catch {
    // Best-effort only — don't let cleanup break the request.
  }
}

function appendLine(prefix: "app" | "app-error", line: string): void {
  try {
    fs.appendFileSync(logPath(prefix), line);
  } catch {
    // Best-effort only — don't let logging itself break the request.
  }
}

function format(level: LogLevel, event: string, data?: Record<string, unknown>): string {
  return `[${new Date().toISOString()}] ${level} ${event}${data ? ` ${JSON.stringify(data)}` : ""}\n`;
}

function write(level: LogLevel, event: string, data?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < threshold) return;
  const line = format(level, event, data);
  appendLine("app", line);
  // WARN/ERROR also land in app-error-*.log so it stays the single place to
  // check for problems, regardless of what LOG_LEVEL the app.log trace is
  // currently configured at.
  if (LOG_LEVELS[level] >= LOG_LEVELS.WARN) appendLine("app-error", line);
  cleanupOldLogsOncePerDay();
}

export function logDebug(event: string, data?: Record<string, unknown>): void {
  write("DEBUG", event, data);
}

export function logInfo(event: string, data?: Record<string, unknown>): void {
  write("INFO", event, data);
}

export function logWarn(event: string, data?: Record<string, unknown>): void {
  write("WARN", event, data);
}

export function logError(event: string, err: unknown, data?: Record<string, unknown>): void {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  write("ERROR", event, { ...data, error: message });
}
