import { prisma } from "@/lib/prisma";
import { loadClientStatuses } from "@/lib/clients/load";
import type { ClientStatus } from "@/lib/clients/status";
import { DEVICE_INTEREST_KEYS, type DeviceInterestKey } from "@/lib/clients/labels";
import { hubspotDealUrl } from "@/lib/integrations/hubspot-deals";
import { loadQualifiedMap } from "@/lib/clients/qualify";
import type { LeadStageKey, LeadTypeKey } from "@/lib/leads/parse-deal";
import type { ActivityTypeKey, LostReasonKey } from "@/lib/leads/labels";
import { ARCHIVE_2025, FUNNEL_FROM, buildToday, maxStageReached } from "@/lib/leads/funnel";
import { STAGE_HISTORY_LABELS } from "@/lib/leads/labels";

// Odczyt modułu Sygnały (serwer). Tylko ADMIN/STAFF — strony i API
// sprawdzają rolę; KIEROWCA nie dostaje ani wiersza (prompt 2, sekcja 4).

function devices(v: unknown): DeviceInterestKey[] {
  return Array.isArray(v) ? v.filter((x): x is DeviceInterestKey => DEVICE_INTEREST_KEYS.includes(x as DeviceInterestKey)) : [];
}

function personName(c: { firstName: string | null; lastName: string | null } | null): string | null {
  if (!c) return null;
  return [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || null;
}

const ROW_SELECT = {
  id: true,
  title: true,
  type: true,
  stage: true,
  stageChangedAt: true,
  createdAt: true,
  clientId: true,
  contactName: true,
  contactPhone: true,
  contactEmail: true,
  deviceInterest: true,
  requestedFrom: true,
  requestedDays: true,
  location: true,
  message: true,
  firstContactAt: true,
  nextActionAt: true,
  nextStepType: true,
  nextStepNote: true,
  attempts: true,
  followUpNo: true,
  lastContactAt: true,
  sourceRef: true,
  lostReason: true,
  returnAt: true,
  postponeReason: true,
  returningClient: true,
  rentalId: true,
  ownerId: true,
  hubspotDealId: true,
  callList: true,
  client: { select: { name: true, city: true } },
  clientContact: { select: { firstName: true, lastName: true, phone: true, email: true } },
  owner: { select: { name: true } },
  rental: { select: { startsAt: true, device: { select: { name: true } } } },
  activities: { orderBy: { createdAt: "desc" as const }, take: 1, select: { type: true, createdAt: true, body: true } },
  _count: { select: { activities: { where: { type: "CALL_NO_ANSWER" as const } } } },
} as const;

export type LeadRow = {
  id: string;
  title: string;
  type: LeadTypeKey;
  stage: LeadStageKey;
  stageChangedAt: string;
  createdAt: string;
  clientId: string | null;
  clientName: string | null;
  clientStatus: ClientStatus | null;
  person: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  devices: DeviceInterestKey[];
  requestedFrom: string | null;
  requestedDays: number | null;
  message: string | null;
  firstContactAt: string | null;
  nextActionAt: string | null;
  // Lejek (L1): rodzaj i opis kroku, próby bez odebrania, follow-up oferty,
  // ostatni kontakt, odnośnik źródła.
  nextStepType: string | null;
  nextStepNote: string | null;
  attempts: number;
  followUpNo: number;
  lastContactAt: string | null;
  sourceRef: string | null;
  lostReason: LostReasonKey | null;
  // Lejek v2: Odłożone (data powrotu, powód) i ostatnia prawdziwa aktywność
  // (rozmowa, mail, SMS, notatka, zmiana etapu) — licznik gnicia.
  returnAt: string | null;
  postponeReason: string | null;
  lastWorkAt: string | null;
  // Zapytanie stałej klientki — poza konwersją nowych (lejek v2).
  returningClient: boolean;
  rentalId: string | null;
  rentalStartsAt: string | null;
  rentalDevice: string | null;
  ownerId: string | null;
  ownerName: string | null;
  fromHubspot: boolean;
  lastActivity: { type: ActivityTypeKey; at: string; body: string | null } | null;
  noAnswerCount: number;
  // Lista „Do obdzwonienia” (prompt 2 v2): zaległe zapytanie z 2026.
  callList: boolean;
  // Była rozmowa („Rozmawiałam”) albo odpowiedź mailem — zdejmuje z listy.
  talked: boolean;
  // Klient zakwalifikowany (jest na liście /klienci); false = „kontakt z zapytania”.
  clientQualified: boolean;
  // Najwyższy etap osiągnięty kiedykolwiek (tablica: konwersja; raport lejka).
  maxStage: LeadStageKey;
  search: string;
};

type RowSource = Awaited<ReturnType<typeof queryRows>>[number];

function queryRows(where: Parameters<typeof prisma.lead.findMany>[0] extends infer A ? (A extends { where?: infer W } ? W : never) : never) {
  return prisma.lead.findMany({ where, orderBy: { createdAt: "desc" }, select: ROW_SELECT });
}

type Extra = { statuses: Map<string, ClientStatus>; qualified: Map<string, boolean>; talked: Set<string>; stageBodies: Map<string, (string | null)[]>; lastWork: Map<string, Date> };

function toRow(l: RowSource, x: Extra): LeadRow {
  const statuses = x.statuses;
  const person = l.contactName ?? personName(l.clientContact);
  const phone = l.contactPhone ?? l.clientContact?.phone ?? null;
  const email = l.contactEmail ?? l.clientContact?.email ?? null;
  const last = l.activities[0];
  return {
    id: l.id,
    title: l.title,
    type: l.type,
    stage: l.stage,
    stageChangedAt: l.stageChangedAt.toISOString(),
    createdAt: l.createdAt.toISOString(),
    clientId: l.clientId,
    clientName: l.client?.name ?? null,
    clientStatus: l.clientId ? (statuses.get(l.clientId) ?? null) : null,
    person,
    phone,
    email,
    city: l.location ?? l.client?.city ?? null,
    devices: devices(l.deviceInterest),
    requestedFrom: l.requestedFrom?.toISOString() ?? null,
    requestedDays: l.requestedDays,
    message: l.message,
    firstContactAt: l.firstContactAt?.toISOString() ?? null,
    nextActionAt: l.nextActionAt?.toISOString() ?? null,
    nextStepType: l.nextStepType,
    nextStepNote: l.nextStepNote,
    attempts: l.attempts,
    followUpNo: l.followUpNo,
    lastContactAt: l.lastContactAt?.toISOString() ?? null,
    sourceRef: l.sourceRef,
    lostReason: l.lostReason,
    returnAt: l.returnAt?.toISOString() ?? null,
    postponeReason: l.postponeReason,
    lastWorkAt: x.lastWork.get(l.id)?.toISOString() ?? null,
    returningClient: l.returningClient,
    rentalId: l.rentalId,
    rentalStartsAt: l.rental?.startsAt.toISOString() ?? null,
    rentalDevice: l.rental?.device.name ?? null,
    ownerId: l.ownerId,
    ownerName: l.owner?.name ?? null,
    fromHubspot: Boolean(l.hubspotDealId),
    lastActivity: last ? { type: last.type, at: last.createdAt.toISOString(), body: last.body } : null,
    noAnswerCount: l._count.activities,
    callList: l.callList,
    talked: x.talked.has(l.id),
    clientQualified: l.clientId ? (x.qualified.get(l.clientId) ?? false) : false,
    maxStage: maxStageReached(l.stage, x.stageBodies.get(l.id) ?? [], STAGE_HISTORY_LABELS, Boolean(l.rentalId)),
    search: [l.title, l.client?.name, person, email, phone, l.location ?? l.client?.city, l.message].filter(Boolean).join(" ").toLowerCase(),
  };
}

async function loadExtra(leads: { id: string; clientId: string | null }[]): Promise<Extra> {
  const clientIds = [...new Set(leads.map((l) => l.clientId).filter((x): x is string => Boolean(x)))];
  const [statuses, qualified, talkedRows, stageRows, workRows] = await Promise.all([
    loadClientStatuses(clientIds),
    loadQualifiedMap(clientIds),
    prisma.leadActivity.groupBy({ by: ["leadId"], where: { leadId: { in: leads.map((l) => l.id) }, type: { in: ["CALL", "EMAIL"] } } }),
    prisma.leadActivity.findMany({ where: { leadId: { in: leads.map((l) => l.id) }, type: "STAGE_CHANGE" }, select: { leadId: true, body: true } }),
    prisma.leadActivity.groupBy({
      by: ["leadId"],
      where: { leadId: { in: leads.map((l) => l.id) }, type: { in: ["CALL", "CALL_NO_ANSWER", "SMS", "EMAIL", "NOTE", "STAGE_CHANGE"] } },
      _max: { createdAt: true },
    }),
  ]);
  const lastWork = new Map(workRows.filter((r) => r._max.createdAt).map((r) => [r.leadId as string, r._max.createdAt as Date]));
  const stageBodies = new Map<string, (string | null)[]>();
  for (const a of stageRows) stageBodies.set(a.leadId!, [...(stageBodies.get(a.leadId!) ?? []), a.body]);
  return { statuses, qualified, talked: new Set(talkedRows.map((r) => r.leadId as string)), stageBodies, lastWork };
}

export async function loadLeadRows(): Promise<LeadRow[]> {
  // Zarchiwizowane sygnały (Porządki → Archiwum) znikają z list i „Do obdzwonienia”.
  const leads = await queryRows({ archivedAt: null });
  const extra = await loadExtra(leads);
  return leads.map((l) => toRow(l, extra));
}

// Tablica → „Archiwum 2025”: sygnały sprzed 2026 bez kontaktu (do kampanii).
export async function loadArchived2025Rows(): Promise<LeadRow[]> {
  const leads = await queryRows({ archivedAt: { not: null }, archiveReason: ARCHIVE_2025 });
  const extra = await loadExtra(leads);
  return leads.map((l) => toRow(l, extra));
}

// Plakietka w menu: pozycje Listy „Na dziś” zalogowanej osoby (te same
// reguły co Plan dnia — buildToday).
export async function countLeadWork(userId: string, now = new Date()): Promise<number> {
  const leads = await prisma.lead.findMany({
    where: { archivedAt: null, ownerId: userId, stage: { in: ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA", "ODLOZONE"] }, createdAt: { gte: FUNNEL_FROM } },
    select: { id: true, stage: true, type: true, createdAt: true, firstContactAt: true, lastContactAt: true, stageChangedAt: true, nextActionAt: true, nextStepType: true, nextStepNote: true, attempts: true, ownerId: true, rentalId: true, contactPhone: true, returnAt: true },
  });
  return buildToday(leads.map((l) => ({ ...l, phone: l.contactPhone })), now).length;
}

// „Rezerwacje do spięcia”: podpowiedź wynajmu dla sygnału „Rezerwacja” bez
// wynajmu — ten sam klient albo telefon / e-mail, termin ±14 dni od zgłoszonego.
export async function loadLinkSuggestions(rows: LeadRow[]): Promise<Record<string, { id: string; startsAt: string; title: string; deviceName: string; clientId: string | null }>> {
  const todo = rows.filter((r) => (r.stage === "REZERWACJA" || (r.stage === "WYGRANA" && new Date(r.createdAt) >= FUNNEL_FROM)) && !r.rentalId);
  if (!todo.length) return {};
  // Wygrane bez wynajmu szukają też w starszych (odbytych) wynajmach z 2026.
  const since = todo.some((r) => r.stage === "WYGRANA") ? FUNNEL_FROM : new Date(Date.now() - 45 * 86_400_000);
  const rentals = await prisma.rental.findMany({
    where: { deletedInGoogle: false, lead: null, startsAt: { gte: since } },
    orderBy: { startsAt: "asc" },
    select: { id: true, startsAt: true, title: true, clientId: true, contactPhoneCache: true, contactEmailCache: true, device: { select: { name: true } } },
  });
  const digits = (p: string | null) => (p ?? "").replace(/\D/g, "").slice(-9);
  const out: Record<string, { id: string; startsAt: string; title: string; deviceName: string; clientId: string | null }> = {};
  for (const r of todo) {
    const around = r.requestedFrom ? new Date(r.requestedFrom).getTime() : null;
    const hit = rentals.find(
      (x) =>
        ((r.clientId && x.clientId === r.clientId) || (r.phone && digits(x.contactPhoneCache) === digits(r.phone)) || (r.email && x.contactEmailCache?.toLowerCase() === r.email.toLowerCase())) &&
        (around == null || Math.abs(x.startsAt.getTime() - around) <= 14 * 86_400_000),
    );
    if (hit) out[r.id] = { id: hit.id, startsAt: hit.startsAt.toISOString(), title: hit.title, deviceName: hit.device.name, clientId: hit.clientId };
  }
  return out;
}

// „Dziś obdzwoniono”: rozmowy i nieodebrane z dzisiaj (wszyscy).
export async function todayCallStats(now = new Date()): Promise<{ talked: number; noAnswer: number }> {
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const rows = await prisma.leadActivity.groupBy({ by: ["type"], where: { createdAt: { gte: since }, leadId: { not: null }, type: { in: ["CALL", "CALL_NO_ANSWER"] } }, _count: { _all: true } });
  return { talked: rows.find((r) => r.type === "CALL")?._count._all ?? 0, noAnswer: rows.find((r) => r.type === "CALL_NO_ANSWER")?._count._all ?? 0 };
}

export type LeadActivityDto = {
  id: string;
  type: ActivityTypeKey;
  body: string | null;
  at: string;
  userName: string | null;
  userRole: string | null; // AGENT → „agent” w historii, brak → „system”
  fromHubspot: boolean;
  otherLead: string | null; // aktywność klienta z innego sygnału / bez sygnału
  emailIds?: string[]; // e-mail z Gmaila (prompt 3C) — podgląd po kliknięciu
};

export type LeadDetail = LeadRow & {
  // Archiwum (Porządki): null = sygnał aktywny.
  archive: { at: string; reason: string | null; note: string | null } | null;
  lostNote: string | null;
  returnAt: string | null;
  location: string | null;
  hubspotUrl: string | null;
  activities: LeadActivityDto[];
  otherLeads: { id: string; title: string; stage: LeadStageKey; createdAt: string }[];
  clientRentals: { id: string; startsAt: string; deviceName: string }[];
  rentalOptions: { id: string; startsAt: string; deviceName: string; title: string }[];
};

export async function loadLeadDetail(id: string): Promise<LeadDetail | null> {
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { ...ROW_SELECT, lostNote: true, returnAt: true, location: true, archivedAt: true, archiveReason: true, archiveNote: true },
  });
  if (!lead) return null;
  const row = toRow(lead, await loadExtra([lead]));

  const [activities, otherLeads, clientRentals, rentalOptions, emails] = await Promise.all([
    prisma.leadActivity.findMany({
      where: { OR: [{ leadId: id }, ...(lead.clientId ? [{ clientId: lead.clientId }] : [])] },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, type: true, body: true, createdAt: true, hubspotEngagementId: true, leadId: true, user: { select: { name: true, role: true } }, lead: { select: { title: true } } },
    }),
    lead.clientId
      ? prisma.lead.findMany({
          where: { clientId: lead.clientId, id: { not: id } },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, title: true, stage: true, createdAt: true },
        })
      : Promise.resolve([]),
    lead.clientId
      ? prisma.rental.findMany({
          where: { clientId: lead.clientId, deletedInGoogle: false },
          orderBy: { startsAt: "desc" },
          take: 5,
          select: { id: true, startsAt: true, device: { select: { name: true } } },
        })
      : Promise.resolve([]),
    // Do „Powiąż z rezerwacją”: wynajmy klienta i wynajmy w pobliżu
    // zgłoszonego terminu, bez już powiązanych z innym sygnałem.
    prisma.rental.findMany({
      where: {
        deletedInGoogle: false,
        eventType: "WYNAJEM",
        lead: null,
        startsAt: { gte: new Date(Date.now() - 14 * 86_400_000) },
        OR: [
          ...(lead.clientId ? [{ clientId: lead.clientId }] : []),
          ...(lead.requestedFrom
            ? [{ startsAt: { gte: new Date(lead.requestedFrom.getTime() - 7 * 86_400_000), lte: new Date(lead.requestedFrom.getTime() + 7 * 86_400_000) } }]
            : []),
          { createdAt: { gte: lead.createdAt } },
        ],
      },
      orderBy: { startsAt: "asc" },
      take: 25,
      select: { id: true, startsAt: true, title: true, device: { select: { name: true } } },
    }),
    // E-maile klienta z ostatnich 30 dni (prompt 3, 4.4) — tylko metadane.
    lead.clientId
      ? prisma.emailMessage.findMany({
          where: { clientId: lead.clientId, sentAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
          orderBy: { sentAt: "desc" },
          take: 30,
          select: { id: true, direction: true, subject: true, snippet: true, sentAt: true, mailbox: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    ...row,
    archive: lead.archivedAt ? { at: lead.archivedAt.toISOString(), reason: lead.archiveReason, note: lead.archiveNote } : null,
    lostNote: lead.lostNote,
    returnAt: lead.returnAt?.toISOString() ?? null,
    location: lead.location,
    hubspotUrl: lead.hubspotDealId ? hubspotDealUrl(lead.hubspotDealId) : null,
    activities: [
      ...emails.map((e) => ({
        id: `email-${e.id}`,
        type: "EMAIL" as const,
        body: `${e.direction === "IN" ? "↓ od klienta" : "↑ do klienta"}: ${e.subject ?? "(bez tematu)"}${e.snippet ? ` — ${e.snippet}` : ""}`,
        at: e.sentAt.toISOString(),
        userName: null,
        userRole: null,
        fromHubspot: false,
        otherLead: e.mailbox,
        emailIds: [e.id],
      })),
      ...activities.map((a) => ({
      id: a.id,
      type: a.type,
      body: a.body,
      at: a.createdAt.toISOString(),
      userName: a.user?.name ?? null,
      userRole: a.user?.role ?? null,
      fromHubspot: Boolean(a.hubspotEngagementId),
      otherLead: a.leadId && a.leadId !== id ? (a.lead?.title ?? "inny sygnał") : a.leadId ? null : "bez sygnału",
      })),
    ].sort((a, b) => b.at.localeCompare(a.at)),
    otherLeads: otherLeads.map((l) => ({ id: l.id, title: l.title, stage: l.stage, createdAt: l.createdAt.toISOString() })),
    clientRentals: clientRentals.map((r) => ({ id: r.id, startsAt: r.startsAt.toISOString(), deviceName: r.device.name })),
    rentalOptions: rentalOptions.map((r) => ({ id: r.id, startsAt: r.startsAt.toISOString(), deviceName: r.device.name, title: r.title })),
  };
}

export async function loadStaffUsers(): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({ where: { role: { in: ["ADMIN", "STAFF"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

// Skrzynka → „Plan dnia” (złote zasady): dzisiejsze wynajmy (z kierowcą),
// ile sygnałów zalogowana osoba dziś obsłużyła (rozmowa, nieodebrane, mail,
// SMS, zmiana etapu), a w tygodniu — ile sygnałów doszło do oferty i do
// rezerwacji (od poniedziałku).
export type DayProgress = { rentalsToday: number; rentalsWithDriver: number; doneToday: number; weekOffers: number; weekReservations: number };

export async function loadDayProgress(userId: string, now = new Date()): Promise<DayProgress> {
  const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const eod = new Date(sod.getTime() + 86_400_000);
  const monday = new Date(sod.getTime() - ((sod.getDay() + 6) % 7) * 86_400_000);
  const [rentals, done, stageRows] = await Promise.all([
    prisma.rental.findMany({ where: { deletedInGoogle: false, eventType: "WYNAJEM", startsAt: { gte: sod, lt: eod } }, select: { driverId: true } }),
    prisma.leadActivity.groupBy({ by: ["leadId"], where: { userId, createdAt: { gte: sod }, leadId: { not: null }, type: { in: ["CALL", "CALL_NO_ANSWER", "EMAIL", "SMS", "STAGE_CHANGE"] } } }),
    prisma.leadActivity.findMany({ where: { type: "STAGE_CHANGE", createdAt: { gte: monday }, leadId: { not: null } }, select: { leadId: true, body: true } }),
  ]);
  const reached = (label: string) => new Set(stageRows.filter((r) => (r.body ?? "").includes(`→ ${label}`)).map((r) => r.leadId)).size;
  return {
    rentalsToday: rentals.length,
    rentalsWithDriver: rentals.filter((r) => r.driverId).length,
    doneToday: done.length,
    weekOffers: reached("Oferta wysłana"),
    weekReservations: reached("Rezerwacja"),
  };
}
