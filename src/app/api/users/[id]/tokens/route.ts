import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { generateToken } from "@/lib/agent-api/token";
import { TOKEN_VALIDITY_DAYS, listTokens } from "@/lib/agent-api/tokens-admin";
import { logInfo } from "@/lib/logger";

// Tokeny API agenta — tylko ADMIN, tylko dla kont z rolą AGENT. Nowy token
// wraca w odpowiedzi RAZ (w bazie jest tylko jego skrót).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  return NextResponse.json({ tokens: await listTokens(id) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!user) return NextResponse.json({ message: "Nie znaleziono użytkownika." }, { status: 404 });
  if (user.role !== "AGENT") return NextResponse.json({ message: "Tokeny API tylko dla konta z rolą Agent AI." }, { status: 400 });
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : "Token agenta";
  // Ważność 30 / 90 / 180 / 365 dni (domyślnie 90).
  const days = (TOKEN_VALIDITY_DAYS as readonly number[]).includes(Number(body?.days)) ? Number(body.days) : 90;
  const t = generateToken();
  const row = await prisma.apiToken.create({
    data: { userId: id, name, tokenHash: t.hash, prefix: t.prefix, createdById: session.user.id, expiresAt: new Date(Date.now() + days * 86_400_000) },
  });
  logInfo("agent_token_created", { userId: session.user.id, agentUserId: id, tokenId: row.id });
  return NextResponse.json({ token: t.token, tokens: await listTokens(id) });
}
