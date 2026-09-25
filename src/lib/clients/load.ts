import { prisma } from "@/lib/prisma";
import { getHubspotContactUrl } from "@/lib/integrations/hubspot";
import { CATEGORY_TO_INTEREST, DEVICE_INTEREST_KEYS, type ClinicTypeKey, type DeviceInterestKey, type SourceKey } from "@/lib/clients/labels";
import { summarizeClient, type ClientRentalFact } from "@/lib/clients/summary";
import type { ClientStatus } from "@/lib/clients/status";

// Odczyt modułu Klienci (serwer). ZAWIERA PRZYCHÓD — wołać wyłącznie z
// miejsc dostępnych dla ADMIN/STAFF (strona /klienci, /api/clients/*),
// NIGDY z niczego dostępnego roli KIEROWCA (spec, sekcja 2 i 4).
// Status liczony przy odczycie (<1000 klientów — jedno zapytanie wystarcza,
// bez denormalizacji; spec, sekcja 2).

const RENTAL_FACT_SELECT = {
  startsAt: true,
  endsAt: true,
  eventType: true,
  deletedInGoogle: true,
  device: { select: { pricingCategory: true } },
  finance: { select: { confirmedAt: true, totalNet: true } },
} as const;

type RentalFactRow = {
  startsAt: Date;
  endsAt: Date;
  eventType: "WYNAJEM" | "SZKOLENIE";
  deletedInGoogle: boolean;
  device: { pricingCategory: string | null };
  finance: { confirmedAt: Date | null; totalNet: { toString(): string } } | null;
};

function toFact(r: RentalFactRow): ClientRentalFact {
  return {
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    eventType: r.eventType,
    deletedInGoogle: r.deletedInGoogle,
    confirmedAt: r.finance?.confirmedAt ?? null,
    totalNet: r.finance ? Number(r.finance.totalNet.toString()) : null,
    interest: r.device.pricingCategory ? (CATEGORY_TO_INTEREST[r.device.pricingCategory] ?? null) : null,
  };
}

function parseInterests(v: unknown): DeviceInterestKey[] {
  return Array.isArray(v) ? v.filter((x): x is DeviceInterestKey => DEVICE_INTEREST_KEYS.includes(x as DeviceInterestKey)) : [];
}

function personName(c: { firstName: string | null; lastName: string | null }): string | null {
  const n = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return n || null;
}

export type ClientListRow = {
  id: string;
  name: string;
  city: string | null;
  primaryName: string | null;
  primaryPhone: string | null;
  primaryEmail: string | null;
  hasPhone: boolean;
  status: ClientStatus;
  rentals12m: number;
  rentalsTotal: number;
  lastRentalAt: string | null;
  revenueNet: number;
  // Wynajmowane (od najczęstszego), potem deklarowane zainteresowania.
  devices: DeviceInterestKey[];
  // Urządzenia faktycznie wynajmowane — pod podpowiedź sezonową.
  rentedDevices: DeviceInterestKey[];
  source: SourceKey | null;
  clinicType: ClinicTypeKey | null;
  createdAt: string;
  // Indeks wyszukiwania (spec 3.2): nazwa, NIP, miasto, osoby, e-maile;
  // telefony osobno, same cyfry bez prefiksu 48 — „601 000 111” trafi.
  search: string;
  phoneDigits: string;
};

export async function loadClientRows(today = new Date()): Promise<ClientListRow[]> {
  const clients = await prisma.client.findMany({
    select: {
      id: true,
      name: true,
      city: true,
      nip: true,
      statusOverride: true,
      source: true,
      clinicType: true,
      deviceInterests: true,
      createdAt: true,
      contacts: {
        select: { firstName: true, lastName: true, phone: true, email: true, isPrimary: true },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
      rentals: { select: RENTAL_FACT_SELECT },
    },
  });

  return clients.map((c) => {
    const summary = summarizeClient({
      statusOverride: c.statusOverride,
      rentals: (c.rentals as RentalFactRow[]).map(toFact),
      today,
    });
    const primary = c.contacts[0] ?? null;
    const interests = parseInterests(c.deviceInterests);
    return {
      id: c.id,
      name: c.name,
      city: c.city,
      primaryName: primary ? personName(primary) : null,
      primaryPhone: primary?.phone ?? null,
      primaryEmail: primary?.email ?? null,
      hasPhone: c.contacts.some((p) => Boolean(p.phone?.trim())),
      status: summary.status,
      rentals12m: summary.rentals12m,
      rentalsTotal: summary.rentalsTotal,
      lastRentalAt: summary.lastRentalAt?.toISOString() ?? null,
      revenueNet: summary.revenueNet,
      devices: [...new Set([...summary.rentedDevices, ...interests])],
      rentedDevices: summary.rentedDevices,
      source: c.source,
      clinicType: c.clinicType,
      createdAt: c.createdAt.toISOString(),
      search: [c.name, c.nip, c.city, ...c.contacts.flatMap((p) => [personName(p), p.email])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
      phoneDigits: c.contacts
        .map((p) => (p.phone ?? "").replace(/\D/g, "").replace(/^48(?=\d{9}$)/, ""))
        .filter(Boolean)
        .join(" "),
    };
  });
}

export type ClientContactDto = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  role: string | null;
  isPrimary: boolean;
  hubspotContactId: string | null;
  rentalsCount: number;
};

export type ClientHistoryItem =
  | {
      kind: "rental";
      id: string;
      at: string;
      title: string;
      deviceName: string;
      eventType: "WYNAJEM" | "SZKOLENIE";
      totalNet: number | null;
      settled: boolean; // kierowca potwierdził odbiór
      upcoming: boolean;
      deleted: boolean;
    }
  | { kind: "message"; id: string; at: string; channel: string; body: string; failed: boolean };

export type ClientDetail = {
  id: string;
  name: string;
  nip: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  transportPriceNet: string | null;
  distanceKm: string | null;
  clinicType: ClinicTypeKey | null;
  source: SourceKey | null;
  deviceInterests: DeviceInterestKey[];
  statusOverride: "NIE_KONTAKTOWAC" | null;
  notes: string | null;
  hubspotCompanyId: string | null;
  legacyHubspotTag: string | null;
  hubspotContactIds: string[];
  // Link „Otwórz w HubSpot” (okres przejściowy) — null, gdy brak mapowania
  // albo HUBSPOT_PORTAL_ID w .env.
  hubspotUrl: string | null;
  contacts: ClientContactDto[];
  summary: {
    status: ClientStatus;
    rentals12m: number;
    rentalsTotal: number;
    lastRentalAt: string | null;
    revenueNet: number;
    avgRentalNet: number | null;
    favoriteDevice: DeviceInterestKey | null;
  };
  history: ClientHistoryItem[];
};

export async function loadClientDetail(id: string, today = new Date()): Promise<ClientDetail | null> {
  const c = await prisma.client.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], include: { _count: { select: { rentals: true } } } },
      rentals: {
        orderBy: { startsAt: "desc" },
        select: {
          ...RENTAL_FACT_SELECT,
          id: true,
          title: true,
          device: { select: { name: true, pricingCategory: true } },
          messages: { select: { id: true, channel: true, body: true, status: true, sentAt: true } },
        },
      },
    },
  });
  if (!c) return null;

  const summary = summarizeClient({
    statusOverride: c.statusOverride,
    rentals: (c.rentals as unknown as RentalFactRow[]).map(toFact),
    today,
  });

  const history: ClientHistoryItem[] = [];
  const seenMessages = new Set<string>();
  // Wiadomości wysłane poza wynajmem (np. SMS z karty klienta) nie mają
  // rentalId — dopasowujemy je po numerze osoby kontaktowej (E.164, tak jak
  // zapisuje je POST /api/sms/send). Message.clientId dojdzie w etapie 2.
  const phones = c.contacts.map((p) => p.phone).filter((p): p is string => Boolean(p && p.startsWith("+")));
  const looseMessages = phones.length
    ? await prisma.message.findMany({
        where: { rentalId: null, recipient: { in: phones } },
        select: { id: true, channel: true, body: true, status: true, sentAt: true },
      })
    : [];
  for (const m of looseMessages) {
    seenMessages.add(m.id);
    history.push({ kind: "message", id: m.id, at: m.sentAt.toISOString(), channel: m.channel, body: m.body, failed: m.status === "FAILED" });
  }
  for (const r of c.rentals) {
    history.push({
      kind: "rental",
      id: r.id,
      at: r.startsAt.toISOString(),
      title: r.title,
      deviceName: r.device.name,
      eventType: r.eventType,
      totalNet: r.finance ? Number(r.finance.totalNet.toString()) : null,
      settled: r.finance?.confirmedAt != null,
      upcoming: r.startsAt > today,
      deleted: r.deletedInGoogle,
    });
    for (const m of r.messages) {
      if (seenMessages.has(m.id)) continue;
      history.push({
        kind: "message",
        id: m.id,
        at: m.sentAt.toISOString(),
        channel: m.channel,
        body: m.body,
        failed: m.status === "FAILED",
      });
    }
  }
  history.sort((a, b) => b.at.localeCompare(a.at));

  return {
    id: c.id,
    name: c.name,
    nip: c.nip,
    street: c.street,
    zip: c.zip,
    city: c.city,
    country: c.country,
    transportPriceNet: c.transportPriceNet?.toString() ?? null,
    distanceKm: c.distanceKm?.toString() ?? null,
    clinicType: c.clinicType,
    source: c.source,
    deviceInterests: parseInterests(c.deviceInterests),
    statusOverride: c.statusOverride,
    notes: c.notes,
    hubspotCompanyId: c.hubspotCompanyId,
    legacyHubspotTag: c.legacyHubspotTag,
    hubspotContactIds: c.contacts.map((p) => p.hubspotContactId).filter((x): x is string => Boolean(x)),
    hubspotUrl: (() => {
      const primaryHs = c.contacts.find((p) => p.hubspotContactId)?.hubspotContactId;
      return primaryHs ? getHubspotContactUrl(primaryHs) : null;
    })(),
    contacts: c.contacts.map((p) => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      phone: p.phone,
      email: p.email,
      role: p.role,
      isPrimary: p.isPrimary,
      hubspotContactId: p.hubspotContactId,
      rentalsCount: p._count.rentals,
    })),
    summary: {
      status: summary.status,
      rentals12m: summary.rentals12m,
      rentalsTotal: summary.rentalsTotal,
      lastRentalAt: summary.lastRentalAt?.toISOString() ?? null,
      revenueNet: summary.revenueNet,
      avgRentalNet: summary.avgRentalNet,
      favoriteDevice: summary.favoriteDevice,
    },
    history,
  };
}
