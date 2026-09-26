import { prisma } from "@/lib/prisma";

// Zarządzanie tokenami API agenta (Ustawienia → Użytkownicy, tylko ADMIN).
export type ApiTokenDto = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null; calls24h: number };

export async function listTokens(userId: string): Promise<ApiTokenDto[]> {
  const since = new Date(Date.now() - 86_400_000);
  const rows = await prisma.apiToken.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { calls: { where: { createdAt: { gte: since } } } } } },
  });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    revokedAt: t.revokedAt?.toISOString() ?? null,
    calls24h: t._count.calls,
  }));
}
