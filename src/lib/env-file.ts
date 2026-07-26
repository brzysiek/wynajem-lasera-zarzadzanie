import fs from "fs";
import path from "path";

// This host's lsnode integration loads .env directly into the process env
// (see src/lib/logger.ts's reasoning — no dotenv package is required
// anywhere in app code), so writing a key here and restarting is genuinely
// how a secret gets applied on this hosting stack, matching how every other
// secret in this project (DATABASE_URL, SMTP_*, NEXTAUTH_SECRET) is already
// configured.
const ENV_PATH = path.join(process.cwd(), ".env");

// Same restart trigger deploy-finish.sh touches after a deploy — this is
// Phusion Passenger's standard restart signal, which lsnode also honors.
const RESTART_FILE = path.join(process.cwd(), "tmp", "restart.txt");

export function setEnvValue(key: string, value: string): void {
  const content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const updated = pattern.test(content) ? content.replace(pattern, line) : `${content.replace(/\s*$/, "")}\n${line}\n`;
  fs.writeFileSync(ENV_PATH, updated);
}

export function triggerRestart(): void {
  fs.mkdirSync(path.dirname(RESTART_FILE), { recursive: true });
  const now = new Date();
  try {
    fs.utimesSync(RESTART_FILE, now, now);
  } catch {
    fs.closeSync(fs.openSync(RESTART_FILE, "w"));
  }
}
