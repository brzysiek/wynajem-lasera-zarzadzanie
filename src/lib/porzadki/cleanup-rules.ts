import { prisma } from "@/lib/prisma";

// Reguły porządków — lista (czytają wszyscy, agent przed pracą).
export type CleanupRuleDto = { id: string; body: string; example: string | null; createdBy: string | null; createdAt: string; updatedAt: string };

export async function listRules(): Promise<CleanupRuleDto[]> {
  const rows = await prisma.cleanupRule.findMany({ orderBy: { createdAt: "asc" }, include: { createdBy: { select: { name: true } } } });
  return rows.map((r) => ({ id: r.id, body: r.body, example: r.example, createdBy: r.createdBy?.name ?? null, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }));
}
