import { prisma } from "@/lib/prisma";
import { loadClientStatuses } from "@/lib/clients/load";
import type { ClientStatus } from "@/lib/clients/status";
import { DEVICE_INTEREST_KEYS, type DeviceInterestKey } from "@/lib/clients/labels";
import { hubspotDealUrl } from "@/lib/integrations/hubspot-deals";
import { loadQualifiedMap } from "@/lib/clients/qualify";
import type { LeadStageKey, LeadTypeKey } from "@/lib/leads/parse-deal";
import type { ActivityTypeKey, LostReasonKey } from "@/lib/leads/labels";

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
  lostReason: true,
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
  lostReason: LostReasonKey | null;
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
  search: string;
};

type RowSource = Awaited<ReturnType<typeof queryRows>>[number];

function queryRows(where: Parameters<typeof prisma.lead.findMany>[0] extends infer A ? (A extends { where?: infer W } ? W : never) : never) {
  return prisma.lead.findMany({ where, orderBy: { createdAt: "desc" }, select: ROW_SELECT });
}

type Extra = { statuses: Map<string, ClientStatus>; qualified: Map<string, boolean>; talked: Set<string> };

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
    lostReason: l.lostReason,
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
    search: [l.title, l.client?.name, person, email, phone, l.location ?? l.client?.city, l.message].filter(Boolean).join(" ").toLowerCase(),
  };
}

async function loadExtra(leads: { id: string; clientId: string | null }[]): Promise<Extra> {
  const clientIds = [...new Set(leads.map((l) => l.clientId).filter((x): x is string => Boolean(x)))];
  const [statuses, qualified, talkedRows] = await Promise.all([
    loadClientStatuses(clientIds),
    loadQualifiedMap(clientIds),
    prisma.leadActivity.groupBy({ by: ["leadId"], where: { leadId: { in: leads.map((l) => l.id) }, type: { in: ["CALL", "EMAIL"] } } }),
  ]);
  return { statuses, qualified, talked: new Set(talkedRows.map((r) => r.leadId as string)) };
}

export async function loadLeadRows(): Promise<LeadRow[]> {
  const leads = await queryRows({});
  const extra = await loadExtra(leads);
  return leads.map((l) => toRow(l, extra));
}

// Plakietka w menu: nowe sygnały z „Na dziś” bez żadnego kontaktu — bez
// listy „Do obdzwonienia” (prompt 2 v2, 1.0a).
export async function countFreshLeads(): Promise<number> {
  return prisma.lead.count({ where: { stage: "SYGNAL", firstContactAt: null, callList: false } });
}

export type LeadActivityDto = {
  id: string;
  type: ActivityTypeKey;
  body: string | null;
  at: string;
  userName: string | null;
  fromHubspot: boolean;
  otherLead: string | null; // aktywność klienta z innego sygnału / bez sygnału
  emailIds?: string[]; // e-mail z Gmaila (prompt 3C) — podgląd po kliknięciu
};

export type LeadDetail = LeadRow & {
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
    select: { ...ROW_SELECT, lostNote: true, returnAt: true, location: true },
  });
  if (!lead) return null;
  const row = toRow(lead, await loadExtra([lead]));

  const [activities, otherLeads, clientRentals, rentalOptions, emails] = await Promise.all([
    prisma.leadActivity.findMany({
      where: { OR: [{ leadId: id }, ...(lead.clientId ? [{ clientId: lead.clientId }] : [])] },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, type: true, body: true, createdAt: true, hubspotEngagementId: true, leadId: true, user: { select: { name: true } }, lead: { select: { title: true } } },
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
