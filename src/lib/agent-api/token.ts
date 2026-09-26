import { createHash, randomBytes } from "node:crypto";

// Tokeny API agenta — czyste funkcje (vitest). W bazie tylko skrót SHA-256;
// sam token pokazywany raz przy utworzeniu.

export const TOKEN_PREFIX = "wla_";
export const RATE_LIMIT_PER_MINUTE = 120;

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateToken(): { token: string; hash: string; prefix: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashToken(token), prefix: token.slice(0, 12) };
}

// „Authorization: Bearer wla_…” → token albo null.
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!m) return null;
  return m[1].startsWith(TOKEN_PREFIX) ? m[1] : null;
}

// Parametry list: strona (od 1) i na_strone (1–200, domyślnie 50).
export function pagination(sp: URLSearchParams): { page: number; perPage: number; skip: number } {
  const page = Math.max(1, Math.floor(Number(sp.get("strona") ?? sp.get("page")) || 1));
  const perPage = Math.min(200, Math.max(1, Math.floor(Number(sp.get("na_strone") ?? sp.get("perPage")) || 50)));
  return { page, perPage, skip: (page - 1) * perPage };
}

export function paginate<T>(list: T[], p: { page: number; perPage: number; skip: number }) {
  return { items: list.slice(p.skip, p.skip + p.perPage), page: p.page, perPage: p.perPage, total: list.length, pages: Math.max(1, Math.ceil(list.length / p.perPage)) };
}

// Data „YYYY-MM-DD” z query → Date (początek dnia UTC) albo null / "invalid".
export function dayParam(v: string | null): Date | null | "invalid" {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "invalid";
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}
