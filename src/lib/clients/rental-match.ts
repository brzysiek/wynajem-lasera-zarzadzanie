import { prisma } from "@/lib/prisma";
import { loadClassifier, rematchHistory } from "@/lib/history/calendar-import";
import { normalizeTitle } from "@/lib/history/normalize-title";
import { recordChanges, type ChangeEntry } from "@/lib/changelog/record";
import { qualifyClient } from "@/lib/clients/qualify";
import { logError, logInfo } from "@/lib/logger";
import { decideRentalClient, seriesIndex, RENTAL_MATCH_LABEL, type RentalMatchMethod } from "@/lib/clients/rental-match-rules";

// Rezerwacje bez klienta (wniosek nr 13). Wynajem z kalendarza dostawał
// klienta tylko przez kontakt HubSpot — rezerwacje wpisane w kalendarzu
// („MIWINI”, „Dorota Nowak Bronowice”) zostawały bez klienta, więc lista i
// karta pokazywały „brak rezerwacji”, a klientki trafiały do przypomnień.
// Ustawiamy WYŁĄCZNIE rentals.clientId (i osobę przy kontakcie HubSpot) —
// cache kontaktu na wynajmie (telefon do SMS-ów) zostaje bez zmian.

type Ctx = Awaited<ReturnType<typeof loadContext>>;

async function loadContext() {
  const [classify, rentals, history, archived] = await Promise.all([
    loadClassifier(),
    prisma.rental.findMany({ where: { clientId: { not: null }, deletedInGoogle: false }, select: { title: true, clientId: true } }),
    prisma.rentalHistory.findMany({ where: { clientId: { not: null }, matchState: { in: ["AUTO", "CONFIRMED"] } }, select: { titleKey: true, clientId: true } }),
    prisma.client.findMany({ where: { archivedAt: { not: null } }, select: { id: true } }),
  ]);
  const series = seriesIndex([
    ...rentals.map((r) => ({ key: normalizeTitle(r.title).key, clientId: r.clientId as string })),
    ...history.map((h) => ({ key: h.titleKey, clientId: h.clientId as string })),
  ]);
  return { classify, series, archived: new Set(archived.map((a) => a.id)) };
}

type UnassignedRow = { id: string; title: string; description: string | null; hubspotContactId: string | null };

async function hubspotContacts(rows: UnassignedRow[]) {
  const ids = [...new Set(rows.map((r) => r.hubspotContactId).filter((x): x is string => !!x))];
  if (ids.length === 0) return new Map<string, { clientId: string; contactId: string }>();
  const contacts = await prisma.clientContact.findMany({ where: { hubspotContactId: { in: ids } }, select: { id: true, clientId: true, hubspotContactId: true } });
  return new Map(contacts.map((c) => [c.hubspotContactId as string, { clientId: c.clientId, contactId: c.id }]));
}

function decide(ctx: Ctx, r: UnassignedRow, hs: Map<string, { clientId: string; contactId: string }>) {
  const classification = ctx.classify(r.title, r.description);
  const d = decideRentalClient({ classification, hubspotContact: r.hubspotContactId ? (hs.get(r.hubspotContactId) ?? null) : null, series: ctx.series });
  // Zarchiwizowany klient nigdy nie dostaje nowej rezerwacji automatycznie.
  if (d.type === "assign" && ctx.archived.has(d.clientId)) return { classification, decision: { type: "pending" as const, candidates: [] } };
  return { classification, decision: d };
}

// Przypisuje klienta rezerwacjom bez klienta, gdy pewność jest wysoka.
// Wołane po synchronizacji kalendarzy (cron co 5 min, „Synchronizuj”), po
// utworzeniu rezerwacji w panelu i po potwierdzeniu w dopasowaniach —
// pierwsze wywołanie po wdrożeniu przypisuje istniejące rezerwacje.
export async function linkUnassignedRentals(opts: { userId?: string; rentalIds?: string[] } = {}): Promise<{ assigned: number; pending: number }> {
  const rows = await prisma.rental.findMany({
    where: { clientId: null, deletedInGoogle: false, ...(opts.rentalIds ? { id: { in: opts.rentalIds } } : {}) },
    select: { id: true, title: true, description: true, hubspotContactId: true },
  });
  if (rows.length === 0) return { assigned: 0, pending: 0 };
  const ctx = await loadContext();
  const hs = await hubspotContacts(rows);
  const byMethod = new Map<RentalMatchMethod, number>();
  const clients = new Set<string>();
  let assigned = 0;
  let pending = 0;
  for (const r of rows) {
    const { decision: d } = decide(ctx, r, hs);
    if (d.type === "pending") pending++;
    if (d.type !== "assign") continue;
    const entries: ChangeEntry[] = [{ entity: "RENTAL", entityId: r.id, operation: "MATCH_ASSIGN", clientId: d.clientId, field: "clientId", before: null, after: d.clientId }];
    // updateMany z clientId: null — równoległe przypisanie przez biuro wygrywa.
    const res = await prisma.$transaction(async (tx) => {
      const u = await tx.rental.updateMany({ where: { id: r.id, clientId: null }, data: { clientId: d.clientId, ...(d.contactId ? { clientContactId: d.contactId } : {}) } });
      if (u.count > 0) {
        await recordChanges(tx, { userId: opts.userId ?? "", provenance: { source: `automatycznie: ${RENTAL_MATCH_LABEL[d.method]} („${r.title.slice(0, 120)}”)`, confidence: "HIGH", batch: null } }, entries);
      }
      return u.count;
    });
    if (res === 0) continue;
    assigned++;
    clients.add(d.clientId);
    byMethod.set(d.method, (byMethod.get(d.method) ?? 0) + 1);
  }
  for (const id of clients) await qualifyClient(id, "RENTAL");
  if (assigned > 0) logInfo("rentals_client_linked", { assigned, pending, byMethod: Object.fromEntries(byMethod) });
  return { assigned, pending };
}

// Best-effort po synchronizacji — błąd przypisania nie może zepsuć synchronizacji.
export async function linkUnassignedRentalsSafe(opts: { userId?: string; rentalIds?: string[] } = {}) {
  try {
    return await linkUnassignedRentals(opts);
  } catch (err) {
    logError("rentals_client_link_failed", err);
    return null;
  }
}

export type UnassignedRental = {
  id: string;
  title: string;
  titleKey: string;
  startsAt: string;
  endsAt: string;
  deviceName: string;
  eventType: "WYNAJEM" | "SZKOLENIE";
  candidates: { clientId: string; name: string; shortName: string | null; city: string | null; score: number }[];
};

function startOfToday(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Przyszłe (od dziś) rezerwacje bez klienta, które są wynajmem u klienta
// (bez serwisów i tytułów pominiętych przez biuro), z propozycją klienta.
export async function loadUnassignedRentals(opts: { now?: Date } = {}): Promise<UnassignedRental[]> {
  const rows = await prisma.rental.findMany({
    where: { clientId: null, deletedInGoogle: false, endsAt: { gte: startOfToday(opts.now) } },
    orderBy: { startsAt: "asc" },
    select: { id: true, title: true, description: true, hubspotContactId: true, startsAt: true, endsAt: true, eventType: true, device: { select: { name: true } } },
  });
  if (rows.length === 0) return [];
  const ctx = await loadContext();
  const hs = await hubspotContacts(rows);
  const out: (UnassignedRental & { rawCandidates: { clientId: string; score: number }[] })[] = [];
  for (const r of rows) {
    const { classification, decision } = decide(ctx, r, hs);
    if (decision.type === "skip") continue;
    // „assign” tutaj = zaraz przypisze się samo (cron) — pokazujemy jako pewną propozycję.
    const raw = decision.type === "assign" ? [{ clientId: decision.clientId, score: 1 }] : decision.candidates;
    out.push({
      id: r.id,
      title: r.title,
      titleKey: classification.titleKey,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      deviceName: r.device.name,
      eventType: r.eventType,
      candidates: [],
      rawCandidates: raw,
    });
  }
  const ids = [...new Set(out.flatMap((o) => o.rawCandidates.map((c) => c.clientId)))];
  const clients = ids.length ? await prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, shortName: true, city: true } }) : [];
  const byId = new Map(clients.map((c) => [c.id, c]));
  return out.map(({ rawCandidates, ...o }) => ({
    ...o,
    candidates: rawCandidates.flatMap((c) => {
      const cl = byId.get(c.clientId);
      return cl ? [{ clientId: cl.id, name: cl.name, shortName: cl.shortName, city: cl.city, score: c.score }] : [];
    }),
  }));
}

// Potwierdzenie biura: rezerwacje → klient. Klucz tytułu staje się aliasem
// (jak w dopasowaniach historii), więc kolejne rezerwacje z tym tytułem
// przypiszą się same. Istniejącego aliasu innego klienta nie nadpisujemy.
export async function assignRentalsToClient(input: { rentalIds: string[]; clientId: string; userId: string }): Promise<{ assigned: number; autoAssigned: number }> {
  const client = await prisma.client.findUnique({ where: { id: input.clientId }, select: { id: true, archivedAt: true } });
  if (!client || client.archivedAt) throw new Error("Klient nie istnieje albo jest w archiwum.");
  const rows = await prisma.rental.findMany({ where: { id: { in: input.rentalIds }, clientId: null }, select: { id: true, title: true } });
  const keys = [...new Set(rows.map((r) => normalizeTitle(r.title).key).filter(Boolean))];
  await prisma.$transaction(async (tx) => {
    await tx.rental.updateMany({ where: { id: { in: rows.map((r) => r.id) }, clientId: null }, data: { clientId: input.clientId } });
    for (const alias of keys) {
      const existing = await tx.clientAlias.findUnique({ where: { alias } });
      if (!existing) await tx.clientAlias.create({ data: { alias, clientId: input.clientId, createdByUserId: input.userId } });
    }
    await recordChanges(
      tx,
      { userId: input.userId, provenance: { source: "potwierdzenie w dopasowaniach (rezerwacje bez klienta)", confidence: "HIGH", batch: null } },
      rows.map((r) => ({ entity: "RENTAL", entityId: r.id, operation: "MATCH_ASSIGN", clientId: input.clientId, field: "clientId", before: null, after: input.clientId })),
    );
  });
  await qualifyClient(input.clientId, "RENTAL");
  // Nowy alias uczy dopasowanie: inne rezerwacje i historia z tym tytułem.
  const more = keys.length ? await linkUnassignedRentals({ userId: input.userId }) : { assigned: 0 };
  if (keys.length) await rematchHistory();
  return { assigned: rows.length, autoAssigned: more.assigned };
}
