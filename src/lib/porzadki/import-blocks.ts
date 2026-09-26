import { prisma } from "@/lib/prisma";

// Blokada ponownego importu z HubSpota (model ImportBlock) — ID kontaktów,
// firm i transakcji trwale usuniętych w panelu. Po ID, nie po e-mailu /
// telefonie: nowy formularz tej samej osoby tworzy nowe zapytanie.

export type BlockKind = "CONTACT" | "COMPANY" | "DEAL";

export async function blockedIds(kind: BlockKind): Promise<Set<string>> {
  const rows = await prisma.importBlock.findMany({ where: { kind }, select: { hubspotId: true } });
  return new Set(rows.map((r) => r.hubspotId));
}
