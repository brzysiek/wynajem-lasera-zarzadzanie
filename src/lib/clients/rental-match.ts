import { prisma } from "@/lib/prisma";
import { loadClassifier, rematchHistory } from "@/lib/history/calendar-import";
import { normalizeTitle } from "@/lib/history/normalize-title";
import { recordChanges, type ChangeEntry } from "@/lib/changelog/record";
import { qualifyClient } from "@/lib/clients/qualify";
import { logError, logInfo } from "@/lib/logger";
import { decideRentalClient, isGenericTitleKey, plausibleCandidate, seriesIndex, RENTAL_MATCH_LABEL, type CandidateNames, type RentalMatchMethod } from "@/lib/clients/rental-match-rules";
import { setEventClient } from "@/lib/integrations/google-calendar";
import { stripClientTag, withClientTag } from "@/lib/rental-client-tag";
import { clearResignedForRentals } from "@/lib/clients/resign";

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
    prisma.rental.findMany({ where: { clientId: { not: null }, deletedInGoogle: false }, select: { title: true, clientId: true, recurringEventId: true } }),
    prisma.rentalHistory.findMany({ where: { clientId: { not: null }, matchState: { in: ["AUTO", "CONFIRMED"] } }, select: { titleKey: true, clientId: true } }),
    prisma.client.findMany({ where: { archivedAt: { not: null } }, select: { id: true } }),
  ]);
  const series = seriesIndex([
    ...rentals.map((r) => ({ key: normalizeTitle(r.title).key, clientId: r.clientId as string })),
    ...history.map((h) => ({ key: h.titleKey, clientId: h.clientId as string })),
  ]);
  // Seria Google (wydarzenie cykliczne) → klient, gdy jednoznaczny.
  const recurring = seriesIndex(rentals.filter((r) => r.recurringEventId).map((r) => ({ key: `rec:${r.recurringEventId}`, clientId: r.clientId as string })));
  // Podobny tytuł wcześniejszej rezerwacji (wniosek 23: „Rdzawka Aneta zając”
  // → „Aneta Rdzawka”): wyraz ≥ 5 liter z tytułów tylko jednego klienta —
  // wyłącznie kandydat, nigdy przypisanie.
  const wordClients = new Map<string, Set<string>>();
  for (const [key, clientId] of [...rentals.map((r) => [normalizeTitle(r.title).key, r.clientId as string] as const), ...history.map((h) => [h.titleKey, h.clientId as string] as const)]) {
    for (const w of (key ?? "").split(" ")) if (w.length >= 5) wordClients.set(w, (wordClients.get(w) ?? new Set()).add(clientId));
  }
  return { classify, series, recurring, wordClients, archived: new Set(archived.map((a) => a.id)) };
}

type UnassignedRow = { id: string; title: string; description: string | null; hubspotContactId: string | null; eventClientId: string | null; recurringEventId: string | null };

async function hubspotContacts(rows: UnassignedRow[]) {
  const ids = [...new Set(rows.map((r) => r.hubspotContactId).filter((x): x is string => !!x))];
  if (ids.length === 0) return new Map<string, { clientId: string; contactId: string }>();
  const contacts = await prisma.clientContact.findMany({ where: { hubspotContactId: { in: ids } }, select: { id: true, clientId: true, hubspotContactId: true } });
  return new Map(contacts.map((c) => [c.hubspotContactId as string, { clientId: c.clientId, contactId: c.id }]));
}

function decide(ctx: Ctx, r: UnassignedRow, hs: Map<string, { clientId: string; contactId: string }>, known: Set<string>) {
  const classification = ctx.classify(r.title, r.description);
  const d = decideRentalClient({
    classification,
    // Klient z wydarzenia — tylko istniejący (skopiowany znacznik po scaleniu może wskazywać nieistniejącego).
    eventClientId: r.eventClientId && known.has(r.eventClientId) ? r.eventClientId : null,
    recurringClientId: r.recurringEventId ? (ctx.recurring.get(`rec:${r.recurringEventId}`) ?? null) : null,
    hubspotContact: r.hubspotContactId ? (hs.get(r.hubspotContactId) ?? null) : null,
    series: ctx.series,
  });
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
    select: { id: true, title: true, description: true, hubspotContactId: true, eventClientId: true, recurringEventId: true },
  });
  if (rows.length === 0) return { assigned: 0, pending: 0 };
  const ctx = await loadContext();
  const hs = await hubspotContacts(rows);
  const known = await knownClients(rows);
  const byMethod = new Map<RentalMatchMethod, number>();
  const clients = new Set<string>();
  let assigned = 0;
  let pending = 0;
  const linked: string[] = [];
  for (const r of rows) {
    const { decision: d } = decide(ctx, r, hs, known);
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
    linked.push(r.id);
  }
  for (const id of clients) await qualifyClient(id, "RENTAL");
  if (assigned > 0) {
    logInfo("rentals_client_linked", { assigned, pending, byMethod: Object.fromEntries(byMethod) });
    await writeEventClientsSafe({ rentalIds: linked });
    await clearResignedForRentals(linked, opts.userId ?? "");
  }
  return { assigned, pending };
}

async function knownClients(rows: { eventClientId: string | null }[]): Promise<Set<string>> {
  const ids = [...new Set(rows.map((r) => r.eventClientId).filter((x): x is string => !!x))];
  if (!ids.length) return new Set();
  return new Set((await prisma.client.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { id: true } })).map((c) => c.id));
}

// Wniosek 23: klient z panelu zapisany w wydarzeniu Google (extendedProperties
// + znacznik w opisie), żeby zmiana tytułu w Google nie gubiła powiązania.
// Tylko przyszłe / trwające rezerwacje, gdzie klient w wydarzeniu różni się
// od klienta w panelu. Best-effort: błąd Google nie psuje przypisania.
export async function writeEventClients(opts: { rentalIds?: string[]; limit?: number } = {}): Promise<{ written: number; failed: number }> {
  const today = new Date(new Date().setHours(0, 0, 0, 0));
  const rows = await prisma.rental.findMany({
    where: {
      deletedInGoogle: false,
      endsAt: { gte: today },
      ...(opts.rentalIds ? { id: { in: opts.rentalIds } } : {}),
    },
    select: { id: true, clientId: true, eventClientId: true, googleCalendarId: true, googleEventId: true, description: true },
  });
  let written = 0;
  let failed = 0;
  // Czyszczenie klienta w wydarzeniu tylko dla wskazanych (odpięcie w karcie).
  const todo = rows.filter((x) => (x.clientId ?? null) !== (x.eventClientId ?? null) && (x.clientId || opts.rentalIds)).slice(0, opts.limit ?? 500);
  for (const r of todo) {
    try {
      await setEventClient(r.googleCalendarId, r.googleEventId, r.clientId, stripClientTag(r.description));
      await prisma.rental.update({ where: { id: r.id }, data: { eventClientId: r.clientId, description: withClientTag(r.description, r.clientId) } });
      written++;
    } catch (err) {
      failed++;
      logError("rental_event_client_write_failed", err, { rentalId: r.id });
    }
  }
  if (written || failed) logInfo("rental_event_clients_written", { written, failed });
  return { written, failed };
}

export async function writeEventClientsSafe(opts: { rentalIds?: string[]; limit?: number } = {}) {
  try {
    return await writeEventClients(opts);
  } catch (err) {
    logError("rental_event_clients_failed", err);
    return null;
  }
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
  // reason — uzasadnienie (wniosek 23): „alias”, „ta sama seria”, „telefon w opisie”,
  // „HubSpot”, „podobna nazwa 0,83 – sprawdź”, „podobny tytuł wcześniejszej rezerwacji”.
  candidates: { clientId: string; name: string; shortName: string | null; city: string | null; score: number; reason: string }[];
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
    select: { id: true, title: true, description: true, hubspotContactId: true, eventClientId: true, recurringEventId: true, startsAt: true, endsAt: true, eventType: true, device: { select: { name: true } } },
  });
  if (rows.length === 0) return [];
  const ctx = await loadContext();
  const hs = await hubspotContacts(rows);
  const known = await knownClients(rows);
  const out: (UnassignedRental & { rawCandidates: { clientId: string; score: number; reason: string }[]; sure: boolean })[] = [];
  for (const r of rows) {
    const { classification, decision } = decide(ctx, r, hs, known);
    if (decision.type === "skip") continue;
    // „assign” tutaj = zaraz przypisze się samo (cron) — pokazujemy jako pewną propozycję.
    const raw = decision.type === "assign" ? [{ clientId: decision.clientId, score: 1, reason: RENTAL_MATCH_LABEL[decision.method] }] : [...decision.candidates];
    // Podobny tytuł wcześniejszej rezerwacji (jednego klienta) — kandydat.
    if (decision.type === "pending") {
      for (const w of classification.titleKey.split(" ")) {
        const set = ctx.wordClients.get(w);
        if (w.length >= 5 && set?.size === 1) {
          const id = [...set][0];
          if (!raw.some((c) => c.clientId === id)) raw.push({ clientId: id, score: 0.8, reason: "podobny tytuł wcześniejszej rezerwacji" });
        }
      }
    }
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
      sure: decision.type === "assign",
    });
  }
  const ids = [...new Set(out.flatMap((o) => o.rawCandidates.map((c) => c.clientId)))];
  const clients = ids.length
    ? await prisma.client.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, shortName: true, city: true, contacts: { select: { firstName: true, lastName: true } }, aliases: { select: { alias: true } } },
      })
    : [];
  const byId = new Map(clients.map((c) => [c.id, c]));
  const tokens = (s: string | null | undefined) => (s ? normalizeTitle(s).tokens : []);
  const names = new Map<string, CandidateNames>(
    clients.map((c) => [
      c.id,
      {
        nameTokens: [...tokens(c.name), ...tokens(c.shortName)],
        persons: c.contacts.map((p) => ({ first: tokens(p.firstName), last: tokens(p.lastName) })),
        aliasTokens: c.aliases.map((a) => a.alias.split(" ").filter(Boolean)),
        cityTokens: tokens(c.city),
      },
    ]),
  );
  return out.map(({ rawCandidates, sure, ...o }) => ({
    ...o,
    candidates: rawCandidates.flatMap((c) => {
      const cl = byId.get(c.clientId);
      if (!cl) return [];
      // Pewne przypisanie (znacznik, alias, seria, telefon), HubSpot i podobny
      // tytuł zostają; propozycje po nazwie tylko, gdy zgadza się nazwisko /
      // nazwa / alias (wniosek 13).
      if (!sure && c.reason.startsWith("podobna nazwa") && !plausibleCandidate(tokens(o.title), names.get(cl.id)!)) return [];
      return [{ clientId: cl.id, name: cl.name, shortName: cl.shortName, city: cl.city, score: c.score, reason: c.reason }];
    }),
  }));
}

// Potwierdzenie biura: rezerwacje → klient. Klucz tytułu staje się aliasem
// (jak w dopasowaniach historii), więc kolejne rezerwacje z tym tytułem
// przypiszą się same. Istniejącego aliasu innego klienta nie nadpisujemy.
export async function assignRentalsToClient(input: { rentalIds: string[]; clientId: string; userId: string; alias?: boolean; source?: string }): Promise<{ assigned: number; autoAssigned: number }> {
  const client = await prisma.client.findUnique({ where: { id: input.clientId }, select: { id: true, archivedAt: true } });
  if (!client || client.archivedAt) throw new Error("Klient nie istnieje albo jest w archiwum.");
  const rows = await prisma.rental.findMany({ where: { id: { in: input.rentalIds }, clientId: null }, select: { id: true, title: true } });
  // Alias z tytułu (domyślnie tak) — nigdy z ogólnego tytułu („NOWA PaNI”).
  const keys = input.alias === false ? [] : [...new Set(rows.map((r) => normalizeTitle(r.title).key).filter((k) => k && !isGenericTitleKey(k)))];
  await prisma.$transaction(async (tx) => {
    await tx.rental.updateMany({ where: { id: { in: rows.map((r) => r.id) }, clientId: null }, data: { clientId: input.clientId } });
    for (const alias of keys) {
      const existing = await tx.clientAlias.findUnique({ where: { alias } });
      if (!existing) await tx.clientAlias.create({ data: { alias, clientId: input.clientId, createdByUserId: input.userId } });
    }
    await recordChanges(
      tx,
      { userId: input.userId, provenance: { source: input.source ?? "przypisanie klienta w panelu", confidence: "HIGH", batch: null } },
      rows.map((r) => ({ entity: "RENTAL", entityId: r.id, operation: "MATCH_ASSIGN", clientId: input.clientId, field: "clientId", before: null, after: input.clientId })),
    );
  });
  await qualifyClient(input.clientId, "RENTAL");
  // Nowy alias uczy dopasowanie: inne rezerwacje i historia z tym tytułem.
  const more = keys.length ? await linkUnassignedRentals({ userId: input.userId }) : { assigned: 0 };
  if (keys.length) await rematchHistory();
  await writeEventClientsSafe({ rentalIds: rows.map((r) => r.id) });
  await clearResignedForRentals(rows.map((r) => r.id), input.userId);
  return { assigned: rows.length, autoAssigned: more.assigned };
}

// „Zmień klienta” w karcie rezerwacji (wniosek 23) — także odpięcie (null).
// Dziennik: przed → po, kto. Klient zapisany z powrotem w wydarzeniu Google.
export async function changeRentalClient(input: { rentalId: string; clientId: string | null; userId: string; alias?: boolean }): Promise<{ changed: boolean; autoAssigned: number }> {
  const r = await prisma.rental.findUnique({ where: { id: input.rentalId }, select: { id: true, clientId: true } });
  if (!r) throw new Error("Rezerwacja nie istnieje.");
  if (r.clientId === input.clientId) return { changed: false, autoAssigned: 0 };
  if (!r.clientId && input.clientId) {
    const res = await assignRentalsToClient({ rentalIds: [r.id], clientId: input.clientId, userId: input.userId, alias: input.alias });
    return { changed: true, autoAssigned: res.autoAssigned };
  }
  if (input.clientId) {
    const c = await prisma.client.findUnique({ where: { id: input.clientId }, select: { archivedAt: true } });
    if (!c || c.archivedAt) throw new Error("Klient nie istnieje albo jest w archiwum.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.rental.update({ where: { id: r.id }, data: { clientId: input.clientId, clientContactId: null, deliveryAddressId: null } });
    await recordChanges(tx, { userId: input.userId, provenance: { source: "zmiana klienta w karcie rezerwacji", confidence: "HIGH", batch: null } }, [
      { entity: "RENTAL", entityId: r.id, operation: "FIELD_CHANGE", clientId: input.clientId ?? r.clientId, field: "clientId", before: JSON.stringify(r.clientId), after: JSON.stringify(input.clientId) },
    ]);
  });
  if (input.clientId) await qualifyClient(input.clientId, "RENTAL");
  await writeEventClientsSafe({ rentalIds: [r.id] });
  await clearResignedForRentals([r.id], input.userId);
  return { changed: true, autoAssigned: 0 };
}
