import { prisma } from "@/lib/prisma";
import { archiveRecords } from "@/lib/porzadki/archive";
import { recordChanges } from "@/lib/changelog/record";
import { toLogValue } from "@/lib/changelog/diff";
import { logError } from "@/lib/logger";
import { namesMatch } from "./meta-rules";

// Propozycje połączenia (wniosek 42, pkt 5). Samo imię i nazwisko = zawsze
// propozycja do potwierdzenia, widoczna na kafelkach obu sygnałów. „Połącz”
// scala w jeden sygnał (zostaje starszy, z historią), „To ktoś inny” chowa.

const OPEN = ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA", "ODLOZONE"] as const;
const STAGE_RANK: Record<string, number> = { SYGNAL: 0, WYWIAD: 1, ODLOZONE: 1, OFERTA: 2, REZERWACJA: 3 };
const CHAT_TYPES = ["MESSENGER", "INSTAGRAM"];

export class MergeError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

type LeadForMatch = { id: string; type: string; contactName: string | null; clientId: string | null; client: { name: string } | null };

const nameOf = (l: { contactName: string | null; client: { name: string } | null }) => l.contactName ?? l.client?.name ?? null;

// Szuka dopasowań po imieniu i nazwisku dla świeżo założonego sygnału. Sygnał z
// czatu: kandydaci to wszystkie otwarte sygnały i klientki bez otwartego sygnału;
// sygnał z innego źródła (np. mail): tylko otwarte sygnały z Messengera / Instagrama.
export async function suggestMergesForLead(leadId: string): Promise<number> {
  const lead = (await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, type: true, contactName: true, clientId: true, client: { select: { name: true } } } })) as LeadForMatch | null;
  const name = lead ? nameOf(lead) : null;
  if (!lead || !name) return 0;
  const isChat = CHAT_TYPES.includes(lead.type);
  const candidates = await prisma.lead.findMany({
    where: { id: { not: leadId }, archivedAt: null, stage: { in: [...OPEN] }, ...(isChat ? {} : { type: { in: CHAT_TYPES as never } }), ...(lead.clientId ? { OR: [{ clientId: null }, { clientId: { not: lead.clientId } }] } : {}) },
    select: { id: true, type: true, contactName: true, clientId: true, client: { select: { name: true } } },
    take: 2000,
  });
  const existing = await prisma.leadMergeSuggestion.findMany({ where: { OR: [{ leadId }, { otherLeadId: leadId }] }, select: { leadId: true, otherLeadId: true, otherClientId: true } });
  const known = (otherLeadId: string | null, otherClientId: string | null) =>
    existing.some((e) => (otherLeadId && ((e.leadId === leadId && e.otherLeadId === otherLeadId) || (e.leadId === otherLeadId && e.otherLeadId === leadId))) || (otherClientId && e.otherClientId === otherClientId));
  let created = 0;
  const openClientIds = new Set<string>(candidates.map((c) => c.clientId).filter((x): x is string => !!x));
  for (const c of candidates) {
    const other = nameOf(c);
    if (!namesMatch(name, other) || known(c.id, null)) continue;
    await prisma.leadMergeSuggestion.create({ data: { leadId, otherLeadId: c.id, label: (other ?? name).slice(0, 190), reason: "to samo imię i nazwisko (sygnał)" } });
    created++;
  }
  if (isChat) {
    const clients = await prisma.client.findMany({
      where: { archivedAt: null, id: { notIn: [...openClientIds, ...(lead.clientId ? [lead.clientId] : [])] } },
      select: { id: true, name: true, contacts: { select: { firstName: true, lastName: true } } },
      take: 5000,
    });
    for (const cl of clients) {
      const hit = namesMatch(name, cl.name) || cl.contacts.some((p) => namesMatch(name, [p.firstName, p.lastName].filter(Boolean).join(" ")));
      if (!hit || known(null, cl.id)) continue;
      await prisma.leadMergeSuggestion.create({ data: { leadId, otherClientId: cl.id, label: cl.name.slice(0, 190), reason: "to samo imię i nazwisko (klientka z bazy)" } });
      created++;
    }
  }
  return created;
}

export type MergeBadge = { id: string; label: string; otherLeadId: string | null };

// Plakietki dla listy sygnałów: sygnał dostaje propozycję, gdy jest stroną (leadId lub otherLeadId).
export async function loadMergeBadges(leadIds: string[]): Promise<Map<string, MergeBadge>> {
  const out = new Map<string, MergeBadge>();
  if (!leadIds.length) return out;
  const rows = await prisma.leadMergeSuggestion.findMany({
    where: { status: "PENDING", OR: [{ leadId: { in: leadIds } }, { otherLeadId: { in: leadIds } }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, leadId: true, otherLeadId: true, label: true, lead: { select: { contactName: true, client: { select: { name: true } } } } },
  });
  const ids = new Set(leadIds);
  for (const r of rows) {
    if (ids.has(r.leadId) && !out.has(r.leadId)) out.set(r.leadId, { id: r.id, label: r.label, otherLeadId: r.otherLeadId });
    // Druga strona widzi nazwę tego, kto zgłosił propozycję.
    if (r.otherLeadId && ids.has(r.otherLeadId) && !out.has(r.otherLeadId)) out.set(r.otherLeadId, { id: r.id, label: nameOf(r.lead) ?? r.label, otherLeadId: r.leadId });
  }
  return out;
}

export async function countPendingMerges(): Promise<number> {
  return prisma.leadMergeSuggestion.count({ where: { status: "PENDING" } });
}

export async function dismissMerge(id: string, userId: string): Promise<void> {
  const s = await prisma.leadMergeSuggestion.findUnique({ where: { id }, select: { status: true, leadId: true } });
  if (!s) throw new MergeError("Nie ma takiej propozycji.", 404);
  if (s.status !== "PENDING") throw new MergeError("Ta propozycja została już rozstrzygnięta.", 409);
  await prisma.leadMergeSuggestion.update({ where: { id }, data: { status: "DISMISSED", decidedById: userId, decidedAt: new Date() } });
  await recordChanges(prisma, { userId }, [{ entity: "LEAD", entityId: s.leadId, clientId: null, operation: "FIELD_CHANGE", field: "propozycja_polaczenia", before: toLogValue("oczekuje"), after: toLogValue("to ktoś inny") }]);
}

type FullLead = {
  id: string;
  title: string;
  stage: string;
  type: string;
  clientId: string | null;
  clientContactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  firstContactAt: Date | null;
  lastContactAt: Date | null;
  nextActionAt: Date | null;
  nextStepType: string | null;
  nextStepNote: string | null;
  createdAt: Date;
  stageChangedAt: Date;
};

const SELECT = {
  id: true, title: true, stage: true, type: true, clientId: true, clientContactId: true, contactName: true, contactPhone: true, contactEmail: true,
  firstContactAt: true, lastContactAt: true, nextActionAt: true, nextStepType: true, nextStepNote: true, createdAt: true, stageChangedAt: true,
} as const;

// Klient założony automatycznie przy tym sygnale (bez innych sygnałów, wynajmów,
// historii i faktur) — po scaleniu można go zarchiwizować.
async function isStubClient(clientId: string, exceptLeadId: string): Promise<boolean> {
  const [leads, rentals, history, invoices] = await Promise.all([
    prisma.lead.count({ where: { clientId, id: { not: exceptLeadId }, archivedAt: null } }),
    prisma.rental.count({ where: { clientId } }),
    prisma.rentalHistory.count({ where: { clientId } }),
    prisma.clientInvoice.count({ where: { clientId } }),
  ]);
  return leads + rentals + history + invoices === 0;
}

export async function mergeSuggestion(id: string, actor: { userId: string; role: string }): Promise<{ leadId: string }> {
  const s = await prisma.leadMergeSuggestion.findUnique({ where: { id } });
  if (!s) throw new MergeError("Nie ma takiej propozycji.", 404);
  if (s.status !== "PENDING") throw new MergeError("Ta propozycja została już rozstrzygnięta.", 409);
  const a = (await prisma.lead.findUnique({ where: { id: s.leadId }, select: SELECT })) as FullLead | null;
  if (!a) throw new MergeError("Sygnał nie istnieje.", 404);

  let keepId: string;
  if (s.otherLeadId) {
    const b = (await prisma.lead.findUnique({ where: { id: s.otherLeadId }, select: SELECT })) as FullLead | null;
    if (!b) throw new MergeError("Drugi sygnał nie istnieje.", 404);
    const [keep, drop] = a.createdAt <= b.createdAt ? [a, b] : [b, a];
    keepId = keep.id;
    const higher = (STAGE_RANK[drop.stage] ?? 0) > (STAGE_RANK[keep.stage] ?? 0);
    const takeStep = drop.nextActionAt && (!keep.nextActionAt || drop.nextActionAt < keep.nextActionAt);
    const min = (x: Date | null, y: Date | null) => (x && y ? (x < y ? x : y) : (x ?? y));
    const max = (x: Date | null, y: Date | null) => (x && y ? (x > y ? x : y) : (x ?? y));
    await prisma.$transaction([
      prisma.leadActivity.updateMany({ where: { leadId: drop.id }, data: { leadId: keep.id } }),
      prisma.chatThread.updateMany({ where: { leadId: drop.id }, data: { leadId: keep.id, ...(keep.clientId ? { clientId: keep.clientId } : {}) } }),
      prisma.lead.update({
        where: { id: keep.id },
        data: {
          ...(keep.clientId ? {} : drop.clientId ? { client: { connect: { id: drop.clientId } }, ...(drop.clientContactId ? { clientContact: { connect: { id: drop.clientContactId } } } : {}) } : {}),
          contactName: keep.contactName ?? drop.contactName,
          contactPhone: keep.contactPhone ?? drop.contactPhone,
          contactEmail: keep.contactEmail ?? drop.contactEmail,
          firstContactAt: min(keep.firstContactAt, drop.firstContactAt),
          lastContactAt: max(keep.lastContactAt, drop.lastContactAt),
          ...(higher ? { stage: drop.stage as never, stageChangedAt: drop.stageChangedAt } : {}),
          ...(takeStep ? { nextActionAt: drop.nextActionAt, nextStepType: drop.nextStepType, nextStepNote: drop.nextStepNote } : {}),
        },
      }),
      prisma.leadActivity.create({ data: { leadId: keep.id, clientId: keep.clientId ?? drop.clientId, type: "SYSTEM", body: `Scalono z sygnałem „${drop.title}” (propozycja połączenia: to ta sama osoba)`, userId: actor.userId } }),
      prisma.leadMergeSuggestion.updateMany({ where: { status: "PENDING", OR: [{ leadId: drop.id }, { otherLeadId: drop.id }] }, data: { status: "MERGED", decidedById: actor.userId, decidedAt: new Date() } }),
    ]);
    await archiveRecords("lead", [drop.id], { reason: "DUPLIKAT", note: `Scalono z sygnałem ${keep.id} (propozycja połączenia)`, batch: "polaczenie-sygnalow" }, actor);
    if (drop.clientId && drop.clientId !== (keep.clientId ?? drop.clientId) && (await isStubClient(drop.clientId, keep.id).catch(() => false))) {
      await archiveRecords("client", [drop.clientId], { reason: "DUPLIKAT", note: "Konto założone automatycznie przy sygnale z czatu, scalone z istniejącym", batch: "polaczenie-sygnalow" }, actor).catch((err) => logError("chat_merge_client_archive_failed", err));
    }
    await recordChanges(prisma, { userId: actor.userId }, [{ entity: "LEAD", entityId: keep.id, clientId: keep.clientId, operation: "FIELD_CHANGE", field: "scalenie_sygnalow", before: toLogValue(drop.id), after: toLogValue(keep.id) }]);
  } else if (s.otherClientId) {
    keepId = a.id;
    const target = await prisma.client.findUnique({ where: { id: s.otherClientId }, select: { id: true, name: true, contacts: { where: { isPrimary: true }, take: 1, select: { id: true } } } });
    if (!target) throw new MergeError("Klientka nie istnieje.", 404);
    const oldClientId = a.clientId;
    await prisma.$transaction([
      prisma.lead.update({ where: { id: a.id }, data: { client: { connect: { id: target.id } }, ...(target.contacts[0] ? { clientContact: { connect: { id: target.contacts[0].id } } } : {}) } }),
      prisma.chatThread.updateMany({ where: { leadId: a.id }, data: { clientId: target.id } }),
      prisma.leadActivity.create({ data: { leadId: a.id, clientId: target.id, type: "SYSTEM", body: `Dopięto do klientki „${target.name}” (propozycja połączenia: to ta sama osoba)`, userId: actor.userId } }),
      prisma.leadMergeSuggestion.update({ where: { id }, data: { status: "MERGED", decidedById: actor.userId, decidedAt: new Date() } }),
    ]);
    if (oldClientId && oldClientId !== target.id && (await isStubClient(oldClientId, a.id).catch(() => false))) {
      await archiveRecords("client", [oldClientId], { reason: "DUPLIKAT", note: "Konto założone automatycznie przy sygnale z czatu, scalone z istniejącym", batch: "polaczenie-sygnalow" }, actor).catch((err) => logError("chat_merge_client_archive_failed", err));
    }
    await recordChanges(prisma, { userId: actor.userId }, [{ entity: "LEAD", entityId: a.id, clientId: target.id, operation: "FIELD_CHANGE", field: "klient", before: toLogValue(oldClientId), after: toLogValue(target.id) }]);
  } else {
    throw new MergeError("Propozycja bez celu.", 400);
  }
  await prisma.leadMergeSuggestion.update({ where: { id }, data: { status: "MERGED", decidedById: actor.userId, decidedAt: new Date() } }).catch(() => undefined);
  return { leadId: keepId };
}
