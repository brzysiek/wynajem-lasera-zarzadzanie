import { createHash } from "node:crypto";

// OAuth dla konektora MCP — czyste reguły (vitest, bez @/): dozwolone adresy
// powrotu (wyłącznie claude.ai i claude.com), dokładne dopasowanie adresu do
// zarejestrowanego i weryfikacja PKCE S256 (obowiązkowe).

export const CLAUDE_CALLBACKS = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"];

export const ACCESS_TOKEN_TTL_S = 3600; // token dostępu: 1 h
export const REFRESH_TTL_DAYS = 30; // odświeżanie wygasa po 30 dniach bez użycia
export const CODE_TTL_MS = 5 * 60_000; // kod autoryzacji: 5 min, jednorazowy

export function isAllowedRedirect(uri: string): boolean {
  return CLAUDE_CALLBACKS.includes(uri);
}

// Adres z żądania autoryzacji musi być dokładnie jednym z zarejestrowanych
// (i dozwolonych) — bez dopasowań częściowych.
export function redirectMatches(registered: string[], uri: string): boolean {
  return isAllowedRedirect(uri) && registered.includes(uri);
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return pkceChallenge(verifier) === challenge;
}

export function redirectWithParams(uri: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.searchParams.set(k, v);
  return u.toString();
}
