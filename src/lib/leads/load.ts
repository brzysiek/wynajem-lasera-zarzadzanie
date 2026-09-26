import { prisma } from "@/lib/prisma";
import { loadClientStatuses } from "@/lib/clients/load";
import type { ClientStatus } from "@/lib/clients/status";
import { DEVICE_INTEREST_KEYS, type DeviceInterestKey } from "@/lib/clients/labels";
import { hubspotDealUrl } from "@/lib/integrations/hubspot-deals";
import { FRESH_DAYS } from "@/lib/leads/today";
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
  search: string;
};

type RowSource = Awaited<ReturnType<typeof queryRows>>[number];

function queryRows(where: Parameters<typeof prisma.lead.findMany>[0] extends infer A ? (A extends { where?: infer W } ? W : never) : never) {
  return prisma.lead.findMany({ where, orderBy: { createdAt: "desc" }, select: ROW_SELECT });
}

function toRow(l: RowSource, statuses: Map<string, ClientStatus>): LeadRow {
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
    search: [l.title, l.client?.name, person, email, phone, l.location ?? l.client?.city, l.message].filter(Boolean).join(" ").toLowerCase(),
  };
}

export async function loadLeadRows(): Promise<LeadRow[]> {
  const leads = await queryRows({});
  const statuses = await loadClientStatuses([...new Set(leads.map((l) => l.clientId).filter((x): x is string => Boolean(x)))]);
  return leads.map((l) => toRow(l, statuses));
}

// Plakietka w menu: nowe sygnały bez żadnego kontaktu (z ostatnich
// FRESH_DAYS dni — starsza zaległość z HubSpota nie krzyczy w menu).
export async function countFreshLeads(now = new Date()): Promise<number> {
  return prisma.lead.count({
    where: { stage: "SYGNAL", firstContactAt: null, createdAt: { gte: new Date(now.getTime() - FRESH_DAYS * 86_400_000) } },
  });
}

export type LeadActivityDto = {
  id: string;
  type: ActivityTypeKey;
  body: string | null;
  at: string;
  userName: string | null;
  fromHubspot: boolean;
  otherLead: string | null; // aktywność klienta z innego sygnału / bez sygnału
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
  const statuses = await loadClientStatuses(lead.clientId ? [lead.clientId] : []);
  const row = toRow(lead, statuses);

  const [activities, otherLeads, clientRentals, rentalOptions] = await Promise.all([
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
  ]);

  return {
    ...row,
    lostNote: lead.lostNote,
    returnAt: lead.returnAt?.toISOString() ?? null,
    location: lead.location,
    hubspotUrl: lead.hubspotDealId ? hubspotDealUrl(lead.hubspotDealId) : null,
    activities: activities.map((a) => ({
      id: a.id,
      type: a.type,
      body: a.body,
      at: a.createdAt.toISOString(),
      userName: a.user?.name ?? null,
      fromHubspot: Boolean(a.hubspotEngagementId),
      otherLead: a.leadId && a.leadId !== id ? (a.lead?.title ?? "inny sygnał") : a.leadId ? null : "bez sygnału",
    })),
    otherLeads: otherLeads.map((l) => ({ id: l.id, title: l.title, stage: l.stage, createdAt: l.createdAt.toISOString() })),
    clientRentals: clientRentals.map((r) => ({ id: r.id, startsAt: r.startsAt.toISOString(), deviceName: r.device.name })),
    rentalOptions: rentalOptions.map((r) => ({ id: r.id, startsAt: r.startsAt.toISOString(), deviceName: r.device.name, title: r.title })),
  };
}

export async function loadStaffUsers(): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({ where: { role: { in: ["ADMIN", "STAFF"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}
