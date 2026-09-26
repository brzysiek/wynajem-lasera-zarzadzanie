import { prisma } from "@/lib/prisma";

// Osoby, które piszą wnioski i zmieniają dane (filtry „Autor” / „Wykonał”).
export async function loadPorzadkiPeople(): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({ where: { role: { in: ["ADMIN", "STAFF", "AGENT"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}
