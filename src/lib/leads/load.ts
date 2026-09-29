import { prisma } from "@/lib/prisma";
import { loadClientStatusInfo } from "@/lib/clients/load";
import type { ClientStatus } from "@/lib/clients/status";
import { CATEGORY_TO_INTEREST, DEVICE_INTEREST_KEYS, type DeviceInterestKey } from "@/lib/clients/labels";
import { hubspotDealUrl } from "@/lib/integrations/hubspot-deals";
import { loadQualifiedMap } from "@/lib/clients/qualify";
import type { LeadStageKey, LeadTypeKey } from "@/lib/leads/parse-deal";
import type { ActivityTypeKey, LostReasonKey } from "@/lib/leads/labels";
import { ARCHIVE_2025, FUNNEL_FROM, buildToday, maxStageReached } from "@/lib/leads/funnel";
import { STAGE_HISTORY_LABELS } from "@/lib/leads/labels";
import { SPRING_REF_PREFIX } from "@/lib/leads/season-goal";
import { freeDatesFor } from "@/lib/leads/offer-draft";
import { loadRentalCandidates, type RentalCandidate } from "@/lib/leads/rental-candidates";
import { loadOpenTasksFor, type OpenTaskDto } from "@/lib/task-links";
import { arrivalDates, arrivalGapDays, arrivalRhythmLabel } from "@/lib/clients/status";
import { loadUnassignedRentals } from "@/lib/clients/rental-match";

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
  client: { select: { name: true, shortName: true, city: true, distanceKm: true, contacts: { orderBy: { isPrimary: "desc" as const }, take: 1, select: { phone: true, email: true } } } },
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
  // Wniosek 24: klient w stanie „Zrezygnował” (poza pulą wiosny i Planem dnia).
  clientResigned: boolean;
  // Wniosek 27 D: dane z karty klienta, gdy sygnał ich nie ma — km, przyjazdy,
  // rytm, ostatni wynajem i urządzenie (także podpowiedź urządzenia).
  clientInfo: { distanceKm: number | null; arrivals: number; rhythm: string | null; lastRentalAt: string | null; lastDevice: string | null; lastInterest: DeviceInterestKey | null } | null;
  // Wniosek 25: ostatnia notatka / rozmowa (dymek kroku na Tablicy).
  lastNote: { at: string; by: string | null; body: string } | null;
  // Wniosek 26: otwarte zadania przy sygnale (znacznik na Tablicy, sekcja Na dziś).
  tasks: { count: number; first: { id: string; title: string; dueDate: string | null } | null };
  // Wniosek 21: sygnał „wraca z wiosny” (Plan dnia) — ostatni wynajem,
  // rytm i sugerowany wolny termin tego urządzenia; null u pozostałych.
  spring: { lastAt: string | null; device: string | null; rhythm: string | null; suggest: string | null; dueAt: string | null; note: { at: string; by: string | null; body: string } | null } | null;
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

type Extra = {
  clientInfo: Map<string, NonNullable<LeadRow["clientInfo"]>>;
  lastNote: Map<string, NonNullable<LeadRow["lastNote"]>>;
  tasks: Map<string, LeadRow["tasks"]>;
  statuses: Map<string, ClientStatus>;
  resigned: Set<string>; qualified: Map<string, boolean>; talked: Set<string>; stageBodies: Map<string, (string | null)[]>; lastWork: Map<string, Date> };

function toRow(l: RowSource, x: Extra): LeadRow {
  const statuses = x.statuses;
  const person = l.contactName ?? personName(l.clientContact);
  // Wniosek 27 D: gdy sygnał nie ma telefonu / e-maila — z karty klienta.
  const phone = l.contactPhone ?? l.clientContact?.phone ?? l.client?.contacts[0]?.phone ?? null;
  const email = l.contactEmail ?? l.clientContact?.email ?? l.client?.contacts[0]?.email ?? null;
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
    spring: null,
    clientResigned: l.clientId ? x.resigned.has(l.clientId) : false,
    clientInfo: l.clientId ? (x.clientInfo.get(l.clientId) ?? null) : null,
    lastNote: x.lastNote.get(l.id) ?? null,
    tasks: x.tasks.get(l.id) ?? { count: 0, first: null },
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
  const [info, qualified, talkedRows, stageRows, workRows, resignedRows] = await Promise.all([
    loadClientStatusInfo(clientIds),
    loadQualifiedMap(clientIds),
    prisma.leadActivity.groupBy({ by: ["leadId"], where: { leadId: { in: leads.map((l) => l.id) }, type: { in: ["CALL", "EMAIL"] } } }),
    prisma.leadActivity.findMany({ where: { leadId: { in: leads.map((l) => l.id) }, type: "STAGE_CHANGE" }, select: { leadId: true, body: true } }),
    prisma.leadActivity.groupBy({
      by: ["leadId"],
      where: { leadId: { in: leads.map((l) => l.id) }, type: { in: ["CALL", "CALL_NO_ANSWER", "SMS", "EMAIL", "NOTE", "STAGE_CHANGE"] } },
      _max: { createdAt: true },
    }),
    prisma.client.findMany({ where: { id: { in: clientIds }, resignedAt: { not: null } }, select: { id: true } }),
  ]);
  const leadIds = leads.map((l) => l.id);
  const now = new Date();
  const [lastRentals, lastHistory, clientRows, noteRows, taskRows] = await Promise.all([
    prisma.rental.findMany({
      where: { clientId: { in: clientIds }, deletedInGoogle: false, eventType: "WYNAJEM", startsAt: { lte: now } },
      orderBy: { startsAt: "desc" },
      distinct: ["clientId"],
      select: { clientId: true, startsAt: true, device: { select: { name: true, pricingCategory: true } } },
    }),
    prisma.rentalHistory.findMany({
      where: { clientId: { in: clientIds }, kind: "WYNAJEM", matchState: { in: ["AUTO", "CONFIRMED"] } },
      orderBy: { startsAt: "desc" },
      distinct: ["clientId"],
      select: { clientId: true, startsAt: true, device: { select: { name: true, pricingCategory: true } } },
    }),
    prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, distanceKm: true } }),
    prisma.leadActivity.findMany({
      where: { leadId: { in: leadIds }, type: { in: ["NOTE", "CALL", "SMS", "EMAIL", "CALL_NO_ANSWER"] }, body: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 3000,
      select: { leadId: true, createdAt: true, body: true, user: { select: { name: true } } },
    }),
    prisma.task.findMany({
      where: { status: "OPEN", OR: [{ leadId: { in: leadIds } }, { links: { some: { kind: "LEAD", refId: { in: leadIds } } } }] },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true, dueDate: true, leadId: true, links: { where: { kind: "LEAD" }, select: { refId: true } } },
    }),
  ]);
  const clientInfo = new Map<string, NonNullable<LeadRow["clientInfo"]>>();
  for (const c of clientRows) {
    const realized = info.get(c.id)?.realized ?? [];
    const lr = lastRentals.find((r) => r.clientId === c.id);
    const lh = lastHistory.find((h) => h.clientId === c.id);
    const last = lr && (!lh || lr.startsAt >= lh.startsAt) ? lr : (lh ?? null);
    clientInfo.set(c.id, {
      distanceKm: c.distanceKm != null ? Number(c.distanceKm.toString()) : null,
      arrivals: arrivalDates(realized).length,
      rhythm: arrivalRhythmLabel(realized),
      lastRentalAt: last?.startsAt.toISOString() ?? null,
      lastDevice: last?.device.name ?? null,
      lastInterest: last?.device.pricingCategory ? ((CATEGORY_TO_INTEREST[last.device.pricingCategory] as DeviceInterestKey | undefined) ?? null) : null,
    });
  }
  const lastNote = new Map<string, NonNullable<LeadRow["lastNote"]>>();
  for (const n of noteRows) {
    if (!n.leadId || lastNote.has(n.leadId) || !n.body?.trim()) continue;
    lastNote.set(n.leadId, { at: n.createdAt.toISOString(), by: n.user?.name ?? null, body: n.body.trim().slice(0, 240) });
  }
  const tasks = new Map<string, LeadRow["tasks"]>();
  for (const t of taskRows) {
    for (const lid of new Set([t.leadId, ...t.links.map((l) => l.refId)].filter((x): x is string => !!x && leadIds.includes(x)))) {
      const cur = tasks.get(lid) ?? { count: 0, first: null };
      tasks.set(lid, { count: cur.count + 1, first: cur.first ?? { id: t.id, title: t.title, dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null } });
    }
  }
  const lastWork = new Map(workRows.filter((r) => r._max.createdAt).map((r) => [r.leadId as string, r._max.createdAt as Date]));
  const stageBodies = new Map<string, (string | null)[]>();
  for (const a of stageRows) stageBodies.set(a.leadId!, [...(stageBodies.get(a.leadId!) ?? []), a.body]);
  const statuses = new Map([...info].map(([id, x]) => [id, x.status]));
  return { clientInfo, lastNote, tasks, statuses, resigned: new Set(resignedRows.map((r) => r.id)), qualified, talked: new Set(talkedRows.map((r) => r.leadId as string)), stageBodies, lastWork };
}

export async function loadLeadRows(): Promise<LeadRow[]> {
  // Zarchiwizowane sygnały (Porządki → Archiwum) znikają z list i „Do obdzwonienia”.
  const leads = await queryRows({ archivedAt: null });
  const [extra, spring] = await Promise.all([loadExtra(leads), loadSpringInfo(leads)]);
  return leads.map((l) => ({ ...toRow(l, extra), spring: spring.get(l.id) ?? null }));
}

// Wiersz „Wracają z wiosny” (wniosek 21): ostatni odbyty wynajem (panel albo
// historia kalendarzy), rytm z przyjazdów i najbliższy wolny dzień tego
// urządzenia. Tylko otwarte sygnały z listy wiosny (≤ 19).
async function loadSpringInfo(leads: { id: string; clientId: string | null; stage: string; sourceRef: string | null }[]): Promise<Map<string, NonNullable<LeadRow["spring"]>>> {
  const todo = leads.filter((l) => l.clientId && l.sourceRef?.startsWith(SPRING_REF_PREFIX) && ["WYWIAD", "OFERTA", "ODLOZONE"].includes(l.stage));
  const out = new Map<string, NonNullable<LeadRow["spring"]>>();
  if (!todo.length) return out;
  const ids = todo.map((l) => l.clientId as string);
  const now = new Date();
  const [rentals, history, info, notes] = await Promise.all([
    prisma.rental.findMany({
      where: { clientId: { in: ids }, eventType: "WYNAJEM", deletedInGoogle: false, startsAt: { lte: now } },
      select: { clientId: true, startsAt: true, device: { select: { name: true, pricingCategory: true } } },
    }),
    prisma.rentalHistory.findMany({
      where: { clientId: { in: ids }, kind: "WYNAJEM", matchState: { in: ["AUTO", "CONFIRMED"] } },
      select: { clientId: true, startsAt: true, device: { select: { name: true, pricingCategory: true } } },
    }),
    loadClientStatusInfo(ids),
    // Wniosek 18 d): notatka z ostatnich 14 dni (sygnał albo karta klienta),
    // żeby nie dzwonić drugi raz do tej samej osoby.
    prisma.leadActivity.findMany({
      where: { clientId: { in: ids }, type: { in: ["NOTE", "CALL", "CALL_NO_ANSWER", "SMS"] }, createdAt: { gte: new Date(now.getTime() - 14 * 86_400_000) }, body: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { clientId: true, createdAt: true, body: true, user: { select: { name: true } } },
    }),
  ]);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  for (const l of todo) {
    const all = [...rentals, ...history].filter((r) => r.clientId === l.clientId).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
    const last = all[0] ?? null;
    const cat = last?.device.pricingCategory ?? null;
    const free = cat ? (await freeDatesFor([cat], tomorrow, 1)).dates[0] : null;
    const realized = info.get(l.clientId as string)?.realized ?? [];
    const gap = arrivalGapDays(realized);
    const lastArrival = realized.length ? Math.max(...realized.map((x) => x.getTime())) : null;
    const note = notes.find((n) => n.clientId === l.clientId && n.body?.trim());
    out.set(l.id, {
      lastAt: last?.startsAt.toISOString() ?? null,
      device: last?.device.name ?? null,
      rhythm: arrivalRhythmLabel(realized),
      suggest: free?.toISOString() ?? null,
      // Wniosek 21: „komu zbliża się termin” — ostatni przyjazd + rytm.
      dueAt: lastArrival != null && gap != null ? new Date(lastArrival + gap * 86_400_000).toISOString() : null,
      note: note ? { at: note.createdAt.toISOString(), by: note.user?.name ?? null, body: (note.body ?? "").trim().slice(0, 160) } : null,
    });
  }
  return out;
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
    select: { id: true, stage: true, type: true, createdAt: true, firstContactAt: true, lastContactAt: true, stageChangedAt: true, nextActionAt: true, nextStepType: true, nextStepNote: true, attempts: true, ownerId: true, rentalId: true, contactPhone: true, returnAt: true, sourceRef: true },
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
  rentalOptions: RentalCandidate[];
  // Wniosek 22: otwarte zadania powiązane z sygnałem.
  openTasks: OpenTaskDto[];
};

export async function loadLeadDetail(id: string): Promise<LeadDetail | null> {
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { ...ROW_SELECT, lostNote: true, returnAt: true, location: true, archivedAt: true, archiveReason: true, archiveNote: true },
  });
  if (!lead) return null;
  const row = toRow(lead, await loadExtra([lead]));

  const [activities, otherLeads, clientRentals, rentalOptions, emails, openTasks] = await Promise.all([
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
    // Do „Powiąż z wynajmem” (wniosek 18 b): kandydaci od razu w karcie.
    lead.rentalId ? Promise.resolve([]) : loadRentalCandidates(id),
    // E-maile klienta z ostatnich 30 dni (prompt 3, 4.4) — tylko metadane.
    lead.clientId
      ? prisma.emailMessage.findMany({
          where: { clientId: lead.clientId, sentAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
          orderBy: { sentAt: "desc" },
          take: 30,
          select: { id: true, direction: true, subject: true, snippet: true, sentAt: true, mailbox: true },
        })
      : Promise.resolve([]),
    loadOpenTasksFor("LEAD", id),
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
    rentalOptions,
    openTasks,
  };
}

export async function loadStaffUsers(): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({ where: { role: { in: ["ADMIN", "STAFF"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

// Skrzynka → „Plan dnia” (złote zasady): dzisiejsze wynajmy (z kierowcą),
// ile sygnałów zalogowana osoba dziś obsłużyła (rozmowa, nieodebrane, mail,
// SMS, zmiana etapu), a w tygodniu — ile sygnałów doszło do oferty i do
// rezerwacji (od poniedziałku).
// doneToday — sygnały, przy których ktoś z biura (nie agent, nie automat,
// nie migracja) zrobił dziś coś sam: rozmowa, nieodebrany, oferta, SMS, zmiana
// etapu (też przegrana i odłożenie). doneByUser — to samo per osoba (filtr
// „Moje”). Akceptacja propozycji agenta idzie na konto agenta, więc się nie liczy.
export type DayProgress = {
  rentalsToday: number;
  rentalsWithDriver: number;
  doneToday: number;
  doneByUser: Record<string, number>;
  weekOffers: number;
  weekReservations: number;
  // Wniosek 18 c): otwarte zadania na dziś i zaległe — per odpowiedzialna osoba.
  tasksByUser: Record<string, { today: number; overdue: number }>;
  // Wniosek 23: rezerwacje bez klienta — „Przypisz klienta (N)”, najbliższa pierwsza.
  unassigned: { count: number; nextAt: string | null; firstId: string | null };
};

export async function loadDayProgress(now = new Date()): Promise<DayProgress> {
  const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const eod = new Date(sod.getTime() + 86_400_000);
  const monday = new Date(sod.getTime() - ((sod.getDay() + 6) % 7) * 86_400_000);
  const [rentals, done, stageRows, dueTasks, unassigned] = await Promise.all([
    prisma.rental.findMany({ where: { deletedInGoogle: false, eventType: "WYNAJEM", startsAt: { gte: sod, lt: eod } }, select: { driverId: true } }),
    prisma.leadActivity.groupBy({
      by: ["leadId", "userId"],
      where: { createdAt: { gte: sod }, leadId: { not: null }, user: { role: { in: ["ADMIN", "STAFF"] } }, type: { in: ["CALL", "CALL_NO_ANSWER", "EMAIL", "SMS", "STAGE_CHANGE"] } },
    }),
    prisma.leadActivity.findMany({ where: { type: "STAGE_CHANGE", createdAt: { gte: monday }, leadId: { not: null } }, select: { leadId: true, body: true } }),
    prisma.task.findMany({ where: { status: "OPEN", assigneeId: { not: null }, dueDate: { lt: eod } }, select: { assigneeId: true, dueDate: true } }),
    loadUnassignedRentals({ now }).catch(() => []),
  ]);
  const tasksByUser: DayProgress["tasksByUser"] = {};
  for (const t of dueTasks) {
    const u = (tasksByUser[t.assigneeId as string] ??= { today: 0, overdue: 0 });
    if (t.dueDate && t.dueDate < sod) u.overdue++;
    else u.today++;
  }
  const reached = (label: string) => new Set(stageRows.filter((r) => (r.body ?? "").includes(`→ ${label}`)).map((r) => r.leadId)).size;
  return {
    rentalsToday: rentals.length,
    rentalsWithDriver: rentals.filter((r) => r.driverId).length,
    doneToday: new Set(done.map((d) => d.leadId)).size,
    doneByUser: done.reduce<Record<string, number>>((m, d) => (d.userId ? { ...m, [d.userId]: (m[d.userId] ?? 0) + 1 } : m), {}),
    weekOffers: reached("Oferta wysłana"),
    weekReservations: reached("Rezerwacja"),
    tasksByUser,
    unassigned: { count: unassigned.length, nextAt: unassigned[0]?.startsAt ?? null, firstId: unassigned[0]?.id ?? null },
  };
}
