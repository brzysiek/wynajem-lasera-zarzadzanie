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
const APP_LOG = path.join(process.cwd(), "app.log");
const APP_ERROR_LOG = path.join(process.cwd(), "app-error.log");

function appendLine(file: string, line: string): void {
  try {
    fs.appendFileSync(file, line);
  } catch {
    // Best-effort only — don't let logging itself break the request.
  }
}

function format(event: string, data?: Record<string, unknown>): string {
  return `[${new Date().toISOString()}] ${event}${data ? ` ${JSON.stringify(data)}` : ""}\n`;
}

export function logInfo(event: string, data?: Record<string, unknown>): void {
  appendLine(APP_LOG, format(event, data));
}

export function logError(event: string, err: unknown, data?: Record<string, unknown>): void {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  appendLine(APP_ERROR_LOG, format(event, { ...data, error: message }));
}
