import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { BASE_PATH } from "@/lib/base-path";
import { PorzadkiError } from "@/lib/porzadki/proposals";
import { RATE_LIMIT_PER_MINUTE, bearerToken, hashToken } from "@/lib/agent-api/token";
import { logError, logWarn } from "@/lib/logger";

// Wspólna obsługa tras /api/agent/*: uwierzytelnienie tokenem (tylko
// użytkownik z rolą AGENT, token nieunieważniony), limit zapytań na token,
// log każdego wywołania (kto, co, kiedy, status), błędy jako czytelny JSON.

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

export async function withAgent(req: NextRequest, handler: (agent: AgentCtx) => Promise<Response>): Promise<Response> {
  const started = Date.now();
  const raw = bearerToken(req.headers.get("authorization"));
  if (!raw) return json({ message: "Brak tokenu. Nagłówek: Authorization: Bearer wla_…" }, 401);

  const token = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    select: { id: true, revokedAt: true, lastUsedAt: true, user: { select: { id: true, name: true, role: true } } },
  });
  if (!token || token.revokedAt || token.user.role !== "AGENT") {
    logWarn("agent_api_auth_failed", { tokenId: token?.id ?? null, revoked: Boolean(token?.revokedAt) });
    return json({ message: "Token nieprawidłowy, unieważniony albo nie należy do konta agenta." }, 401);
  }

  const path = req.nextUrl.pathname.startsWith(BASE_PATH) ? req.nextUrl.pathname.slice(BASE_PATH.length) : req.nextUrl.pathname;
  const fullPath = `${path}${req.nextUrl.search}`.slice(0, 255);
  const recent = await prisma.apiCallLog.count({ where: { tokenId: token.id, createdAt: { gte: new Date(Date.now() - 60_000) } } });

  let res: Response;
  if (recent >= RATE_LIMIT_PER_MINUTE) {
    res = NextResponse.json({ message: `Limit ${RATE_LIMIT_PER_MINUTE} zapytań na minutę — spróbuj za chwilę.` }, { status: 429, headers: { "Retry-After": "60" } });
  } else {
    try {
      res = await handler({ userId: token.user.id, role: "AGENT", name: token.user.name, tokenId: token.id });
    } catch (err) {
      if (err instanceof AgentApiError || err instanceof PorzadkiError) res = json({ message: err.message }, err.status);
      else {
        logError("agent_api_failed", err, { tokenId: token.id, path });
        res = json({ message: "Błąd serwera." }, 500);
      }
    }
  }

  await prisma.apiCallLog.create({
    data: { tokenId: token.id, userId: token.user.id, method: req.method.slice(0, 8), path: fullPath, status: res.status, durationMs: Date.now() - started },
  });
  if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > 60_000) {
    await prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
  }
  // Log trzymamy 90 dni — sprzątanie przy okazji (średnio raz na 200 wywołań).
  if (Math.random() < 0.005) await prisma.apiCallLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * 86_400_000) } } });
  return res;
}
