import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { generateToken, hashToken } from "@/lib/agent-api/token";
import { ACCESS_TOKEN_TTL_S, CODE_TTL_MS, REFRESH_TTL_DAYS, isAllowedRedirect, redirectMatches, verifyPkce } from "@/lib/oauth/rules";
import { OAUTH_SCOPE } from "@/lib/oauth/config";

// Serwer autoryzacji OAuth dla konektora MCP. Dostęp zawsze należy do konta
// z rolą AGENT i zatwierdza go zalogowany ADMIN na ekranie zgody. Połączenie
// = jeden wiersz ApiToken (kind OAUTH): token dostępu 1 h + token
// odświeżający, rotowane przy każdym odświeżeniu; unieważnienie w
// Ustawienia → Użytkownicy → Tokeny API.

export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

// --- dynamiczna rejestracja klienta (RFC 7591) ---

export async function registerClient(body: Record<string, unknown>) {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length) throw new OAuthError("invalid_redirect_uri", "Podaj redirect_uris.");
  // Tylko adresy powrotu claude.ai / claude.com.
  const bad = uris.find((u) => !isAllowedRedirect(u));
  if (bad) throw new OAuthError("invalid_redirect_uri", `Niedozwolony adres powrotu: ${bad}`);
  const clientName = typeof body.client_name === "string" ? body.client_name.slice(0, 120) : null;
  const clientId = `wlc_${randomBytes(16).toString("base64url")}`;
  const row = await prisma.oAuthClient.create({ data: { clientId, clientName, redirectUris: uris } });
  return {
    client_id: row.clientId,
    client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
    client_name: row.clientName ?? undefined,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export async function findClient(clientId: string) {
  const c = await prisma.oAuthClient.findUnique({ where: { clientId } });
  if (!c) return null;
  return { clientId: c.clientId, clientName: c.clientName, redirectUris: Array.isArray(c.redirectUris) ? (c.redirectUris as string[]) : [] };
}

// --- żądanie autoryzacji (ekran zgody) ---

export type AuthorizeParams = { clientId: string; redirectUri: string; codeChallenge: string; state: string | null; scope: string | null };

export async function validateAuthorize(sp: URLSearchParams): Promise<{ ok: true; params: AuthorizeParams; clientName: string | null } | { ok: false; message: string; redirect?: string }> {
  const clientId = sp.get("client_id") ?? "";
  const redirectUri = sp.get("redirect_uri") ?? "";
  const client = clientId ? await findClient(clientId) : null;
  // Bez znanego klienta i zgodnego adresu powrotu nie przekierowujemy nigdzie.
  if (!client) return { ok: false, message: "Nieznana aplikacja (client_id)." };
  if (!redirectUri || !redirectMatches(client.redirectUris, redirectUri)) return { ok: false, message: "Adres powrotu nie zgadza się z zarejestrowanym." };
  if (sp.get("response_type") !== "code") return { ok: false, message: "Obsługiwany jest tylko response_type=code." };
  const codeChallenge = sp.get("code_challenge") ?? "";
  // PKCE obowiązkowe, tylko S256 (skrót SHA-256 w base64url = 43 znaki).
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) || sp.get("code_challenge_method") !== "S256") {
    return { ok: false, message: "Wymagane PKCE (code_challenge_method=S256)." };
  }
  return { ok: true, params: { clientId, redirectUri, codeChallenge, state: sp.get("state"), scope: sp.get("scope") }, clientName: client.clientName };
}

export async function createCode(p: AuthorizeParams, agentUserId: string, approvedById: string): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  await prisma.oAuthCode.create({
    data: { codeHash: hashToken(code), clientId: p.clientId, userId: agentUserId, approvedById, redirectUri: p.redirectUri, codeChallenge: p.codeChallenge, expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });
  return code;
}

// --- endpoint tokenu ---

type TokenResponse = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

function newPair() {
  const access = generateToken();
  const refresh = generateToken();
  const now = Date.now();
  return {
    access,
    refresh,
    data: {
      tokenHash: access.hash,
      prefix: access.prefix,
      refreshHash: refresh.hash,
      expiresAt: new Date(now + ACCESS_TOKEN_TTL_S * 1000),
      refreshExpiresAt: new Date(now + REFRESH_TTL_DAYS * 86_400_000),
    },
  };
}

const response = (access: string, refresh: string): TokenResponse => ({
  access_token: access,
  token_type: "Bearer",
  expires_in: ACCESS_TOKEN_TTL_S,
  refresh_token: refresh,
  scope: OAUTH_SCOPE,
});

export async function exchangeCode(form: URLSearchParams): Promise<TokenResponse> {
  const code = form.get("code") ?? "";
  const verifier = form.get("code_verifier") ?? "";
  const clientId = form.get("client_id") ?? "";
  const redirectUri = form.get("redirect_uri") ?? "";
  const row = code ? await prisma.oAuthCode.findUnique({ where: { codeHash: hashToken(code) } }) : null;
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) throw new OAuthError("invalid_grant", "Kod nieprawidłowy, wygasły albo już użyty.");
  if (clientId && clientId !== row.clientId) throw new OAuthError("invalid_grant", "Kod wydano innej aplikacji.");
  if (redirectUri && redirectUri !== row.redirectUri) throw new OAuthError("invalid_grant", "Adres powrotu nie zgadza się z kodem.");
  if (!verifyPkce(verifier, row.codeChallenge)) throw new OAuthError("invalid_grant", "Weryfikacja PKCE nie powiodła się.");

  const agent = await prisma.user.findUnique({ where: { id: row.userId }, select: { role: true } });
  if (agent?.role !== "AGENT") throw new OAuthError("invalid_grant", "Konto nie ma już roli agenta.");
  const client = await findClient(row.clientId);
  // Jednorazowość atomowo: kod „zużywa” tylko pierwsza wymiana (usedAt: null).
  const claimed = await prisma.oAuthCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw new OAuthError("invalid_grant", "Kod został już użyty.");
  const pair = newPair();
  await prisma.$transaction([
    prisma.apiToken.create({
      data: {
        ...pair.data,
        userId: row.userId,
        name: `Konektor: ${client?.clientName ?? "claude.ai"}`.slice(0, 190),
        kind: "OAUTH",
        oauthClientId: row.clientId,
        createdById: row.approvedById,
      },
    }),
  ]);
  return response(pair.access.token, pair.refresh.token);
}

export async function refreshToken(form: URLSearchParams): Promise<TokenResponse> {
  const raw = form.get("refresh_token") ?? "";
  const clientId = form.get("client_id");
  const row = raw ? await prisma.apiToken.findUnique({ where: { refreshHash: hashToken(raw) }, include: { user: { select: { role: true } } } }) : null;
  if (!row || row.kind !== "OAUTH" || row.revokedAt || !row.refreshExpiresAt || row.refreshExpiresAt.getTime() < Date.now() || row.user.role !== "AGENT") {
    throw new OAuthError("invalid_grant", "Token odświeżający nieprawidłowy, wygasły albo unieważniony.");
  }
  if (clientId && row.oauthClientId && clientId !== row.oauthClientId) throw new OAuthError("invalid_grant", "Token wydano innej aplikacji.");
  // Rotacja: nowe tokeny, stary token odświeżający przestaje działać.
  const pair = newPair();
  await prisma.apiToken.update({ where: { id: row.id }, data: pair.data });
  return response(pair.access.token, pair.refresh.token);
}
