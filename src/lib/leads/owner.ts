import { prisma } from "@/lib/prisma";

// Osoba prowadząca nowe sygnały (lejek, decyzja 27.09.2026): domyślnie Ania.
// Bez takiej osoby w bazie (np. serwer testowy) — podany zapasowy użytkownik.
export async function defaultLeadOwnerId(fallback: string | null = null): Promise<string | null> {
  const ania = await prisma.user.findFirst({ where: { name: "Ania", role: { in: ["ADMIN", "STAFF"] } }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return ania?.id ?? fallback;
}
