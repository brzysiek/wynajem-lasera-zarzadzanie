import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { listTokens } from "@/lib/agent-api/tokens-admin";
import { logInfo } from "@/lib/logger";

// Unieważnienie tokenu (revokedAt) — tylko ADMIN. Wpis zostaje (log wywołań).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; tokenId: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id, tokenId } = await params;
  const res = await prisma.apiToken.updateMany({ where: { id: tokenId, userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (res.count) logInfo("agent_token_revoked", { userId: session.user.id, tokenId });
  return NextResponse.json({ tokens: await listTokens(id) });
}
