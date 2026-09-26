import { prisma } from "@/lib/prisma";

// Zarządzanie tokenami API agenta (Ustawienia → Użytkownicy, tylko ADMIN).
export type ApiTokenDto = {
  id: string;
  name: string;
  prefix: string;
  kind: "STATIC" | "OAUTH";
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  // Ważność: token ręczny — data wygaśnięcia; konektor OAuth — do kiedy
  // działa odświeżanie (przedłuża się przy każdym użyciu).
  validUntil: string | null;
  expired: boolean;
  calls24h: number;
};

// Ważność tokenu ręcznego (dni) — wybór przy tworzeniu.
export const TOKEN_VALIDITY_DAYS = [30, 90, 180, 365] as const;

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
    kind: t.kind === "OAUTH" ? "OAUTH" : "STATIC",
    validUntil: (t.kind === "OAUTH" ? t.refreshExpiresAt : t.expiresAt)?.toISOString() ?? null,
    expired: !!(t.kind === "OAUTH" ? t.refreshExpiresAt : t.expiresAt) && (t.kind === "OAUTH" ? t.refreshExpiresAt! : t.expiresAt!).getTime() < Date.now(),
    calls24h: t._count.calls,
  }));
}
