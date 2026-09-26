import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { BASE_PATH } from "@/lib/base-path";
import { PorzadkiError } from "@/lib/porzadki/proposals";
import { RATE_LIMIT_PER_MINUTE, bearerToken, hashToken } from "@/lib/agent-api/token";
import { logError, logWarn } from "@/lib/logger";

// Wspólna obsługa wywołań agenta — trasy /api/agent/* (withAgent) i serwer
// MCP /api/mcp: uwierzytelnienie tokenem (tylko użytkownik z rolą AGENT,
// token nieunieważniony i ważny), limit zapytań na token, log każdego
// wywołania (kto, co, kiedy, status), błędy jako czytelny JSON.

export type AgentCtx = { userId: string; role: "AGENT"; name: string; tokenId: string };

export class AgentApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => undefined);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AgentApiError("Treść żądania musi być obiektem JSON.");
  return body as Record<string, unknown>;
}

export type ResolvedAgent = { agent: AgentCtx; lastUsedAt: Date | null };

// Token z nagłówka → konto agenta albo powód odmowy.
export async function resolveAgent(req: NextRequest): Promise<{ ok: true; value: ResolvedAgent } | { ok: false; reason: "missing" | "invalid" }> {
  const raw = bearerToken(req.headers.get("authorization"));
  if (!raw) return { ok: false, reason: "missing" };
  const token = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    select: { id: true, revokedAt: true, expiresAt: true, lastUsedAt: true, user: { select: { id: true, name: true, role: true } } },
  });
  const expired = !!token?.expiresAt && token.expiresAt.getTime() <= Date.now();
  if (!token || token.revokedAt || expired || token.user.role !== "AGENT") {
    logWarn("agent_api_auth_failed", { tokenId: token?.id ?? null, revoked: Boolean(token?.revokedAt), expired });
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, value: { agent: { userId: token.user.id, role: "AGENT", name: token.user.name, tokenId: token.id }, lastUsedAt: token.lastUsedAt } };
}

export async function isRateLimited(tokenId: string): Promise<boolean> {
  const recent = await prisma.apiCallLog.count({ where: { tokenId, createdAt: { gte: new Date(Date.now() - 60_000) } } });
  return recent >= RATE_LIMIT_PER_MINUTE;
}

export function rateLimitResponse() {
  return NextResponse.json({ message: `Limit ${RATE_LIMIT_PER_MINUTE} zapytań na minutę — spróbuj za chwilę.` }, { status: 429, headers: { "Retry-After": "60" } });
}

export function requestPath(req: NextRequest): string {
  const p = req.nextUrl.pathname.startsWith(BASE_PATH) ? req.nextUrl.pathname.slice(BASE_PATH.length) : req.nextUrl.pathname;
  return `${p}${req.nextUrl.search}`;
}

export async function logAgentCall(r: ResolvedAgent, method: string, path: string, status: number, started: number) {
  await prisma.apiCallLog.create({
    data: { tokenId: r.agent.tokenId, userId: r.agent.userId, method: method.slice(0, 8), path: path.slice(0, 255), status, durationMs: Date.now() - started },
  });
  if (!r.lastUsedAt || Date.now() - r.lastUsedAt.getTime() > 60_000) {
    await prisma.apiToken.update({ where: { id: r.agent.tokenId }, data: { lastUsedAt: new Date() } });
  }
  // Log trzymamy 90 dni — sprzątanie przy okazji (średnio raz na 200 wywołań).
  if (Math.random() < 0.005) await prisma.apiCallLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * 86_400_000) } } });
}

export async function withAgent(req: NextRequest, handler: (agent: AgentCtx) => Promise<Response>): Promise<Response> {
  const started = Date.now();
  const resolved = await resolveAgent(req);
  if (!resolved.ok) {
    return resolved.reason === "missing"
      ? json({ message: "Brak tokenu. Nagłówek: Authorization: Bearer wla_…" }, 401)
      : json({ message: "Token nieprawidłowy, wygasły, unieważniony albo nie należy do konta agenta." }, 401);
  }
  const r = resolved.value;

  let res: Response;
  if (await isRateLimited(r.agent.tokenId)) {
    res = rateLimitResponse();
  } else {
    try {
      res = await handler(r.agent);
    } catch (err) {
      if (err instanceof AgentApiError || err instanceof PorzadkiError) res = json({ message: err.message }, err.status);
      else {
        logError("agent_api_failed", err, { tokenId: r.agent.tokenId, path: req.nextUrl.pathname });
        res = json({ message: "Błąd serwera." }, 500);
      }
    }
  }
  await logAgentCall(r, req.method, requestPath(req), res.status, started);
  return res;
}
