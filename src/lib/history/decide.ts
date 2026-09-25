import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { rematchHistory } from "@/lib/history/calendar-import";

// Decyzje biura na /klienci/dopasowania (prompt 3, 2.4). Jedna decyzja
// obejmuje całą grupę (wszystkie wydarzenia o tym samym znormalizowanym
// tytule). Przypisanie tworzy alias, więc kolejne wydarzenia z tym tytułem
// (import, cron) dopasują się już same.

export type DecideAction =
  | { action: "assign"; keys: string[]; clientId: string }
  | { action: "ignore"; keys: string[] }
  | { action: "reset"; keys: string[] };

export function parseDecideBody(body: unknown): DecideAction | string {
  if (!body || typeof body !== "object") return "Nieprawidłowe dane.";
  const b = body as Record<string, unknown>;
  const keys = Array.isArray(b.keys) ? b.keys.filter((k): k is string => typeof k === "string") : [];
  if (keys.length === 0 || keys.length > 500) return "Wybierz co najmniej jedną grupę.";
  if (b.action === "assign") {
    if (typeof b.clientId !== "string" || !b.clientId) return "Wybierz klienta.";
    if (keys.some((k) => !k.trim())) return "Pustego tytułu nie da się przypisać do klienta.";
    return { action: "assign", keys, clientId: b.clientId };
  }
  if (b.action === "ignore") return { action: "ignore", keys };
  if (b.action === "reset") return { action: "reset", keys };
  return "Nieznana akcja.";
}

const ASSIGNED = { matchState: { in: ["AUTO", "CONFIRMED"] } } as const;

// Ile wydarzeń jest przypisanych do klientów (AUTO/CONFIRMED) — do komunikatu
// „…i N kolejnych przypisało się samo” po przeliczeniu.
export async function countAssignedHistory(): Promise<number> {
  return prisma.rentalHistory.count({ where: { matchState: { in: [...ASSIGNED.matchState.in] } } });
}

export async function applyDecision(d: DecideAction, userId: string): Promise<{ events: number; autoAssigned: number }> {
  if (d.action === "assign") {
    const client = await prisma.client.findUnique({ where: { id: d.clientId }, select: { id: true } });
    if (!client) throw new Error("Klient nie istnieje.");
    const res = await prisma.$transaction(async (tx) => {
      for (const alias of d.keys) {
        await tx.clientAlias.upsert({
          where: { alias },
          create: { alias, clientId: d.clientId, createdByUserId: userId },
          update: { clientId: d.clientId, createdByUserId: userId },
        });
      }
      // Biuro świadomie przypisuje wpis do klienta — nawet „Sprzęt u Lucyny”
      // rozpoznane jako nie-wynajem staje się wtedy wynajmem tej klientki.
      await tx.rentalHistory.updateMany({ where: { titleKey: { in: d.keys }, kind: "INNE" }, data: { kind: "WYNAJEM" } });
      return tx.rentalHistory.updateMany({
        where: { titleKey: { in: d.keys } },
        data: {
          clientId: d.clientId,
          matchState: "CONFIRMED",
          matchMethod: "MANUAL",
          matchScore: 1,
          matchedByUserId: userId,
          candidates: Prisma.DbNull,
        },
      });
    });
    // Nowy alias od razu uczy dopasowanie — przeliczamy resztę historii, żeby
    // podobne tytuły („Nurek Nowy Sącz” po potwierdzeniu „Nowy Sącz Nurek”)
    // przypisały się same.
    const before = await countAssignedHistory();
    await rematchHistory();
    return { events: res.count, autoAssigned: Math.max(0, (await countAssignedHistory()) - before) };
  }

  if (d.action === "ignore") {
    const res = await prisma.rentalHistory.updateMany({
      where: { titleKey: { in: d.keys } },
      data: { clientId: null, matchState: "IGNORED", matchMethod: null, matchScore: null, matchedByUserId: userId },
    });
    return { events: res.count, autoAssigned: 0 };
  }

  // Cofnięcie decyzji: alias znika, wiersze wracają do dopasowania automatycznego.
  const res = await prisma.$transaction(async (tx) => {
    await tx.clientAlias.deleteMany({ where: { alias: { in: d.keys } } });
    return tx.rentalHistory.updateMany({ where: { titleKey: { in: d.keys } }, data: { matchedByUserId: null } });
  });
  await rematchHistory();
  return { events: res.count, autoAssigned: 0 };
}
