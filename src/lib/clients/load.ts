import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getHubspotContactUrl } from "@/lib/integrations/hubspot";
import { CATEGORY_TO_INTEREST, DEVICE_INTEREST_KEYS, type ClinicTypeKey, type DeviceInterestKey, type SourceKey } from "@/lib/clients/labels";
import { summarizeClient, type ClientInvoiceFact, type ClientRentalFact } from "@/lib/clients/summary";
import { interestsFromText } from "@/lib/history/invoices";
import { rentalDurationDays } from "@/lib/pricing/duration";
import { buildTransactions, rentalRhythmDays, transactionTotals, typicalPayment, type TxRental, type TxTotals } from "@/lib/clients/transactions";
import { paymentLabel, type PaymentStatus } from "@/lib/clients/payment-status";
import { gmailSummary } from "@/lib/gmail/sync";
import { isQualified } from "@/lib/clients/qualification";
import { isQualificationActive } from "@/lib/clients/qualify";
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

// Historia z kalendarzy (prompt 3A): liczą się tylko wpisy przypisane
// automatycznie albo potwierdzone — propozycje (SUGGESTED) dopiero po
// potwierdzeniu. Bez kwot: nie wpływają na przychód.
const HISTORY_FACT_WHERE: Prisma.RentalHistoryWhereInput = {
  matchState: { in: ["AUTO", "CONFIRMED"] },
  kind: { in: ["WYNAJEM", "SZKOLENIE"] },
};
const HISTORY_FACT_SELECT = {
  startsAt: true,
  endsAt: true,
  kind: true,
  device: { select: { pricingCategory: true } },
} as const;

type HistoryFactRow = { startsAt: Date; endsAt: Date; kind: string; device: { pricingCategory: string | null } };

function historyToFact(h: HistoryFactRow): ClientRentalFact {
  return {
    startsAt: h.startsAt,
    endsAt: h.endsAt,
    eventType: h.kind === "SZKOLENIE" ? "SZKOLENIE" : "WYNAJEM",
    deletedInGoogle: false,
    confirmedAt: null,
    totalNet: null,
    interest: h.device.pricingCategory ? (CATEGORY_TO_INTEREST[h.device.pricingCategory] ?? null) : null,
    historical: true,
  };
}

// Faktury przypisane do klienta (prompt 3B) — dowód wynajmu, gdy nie ma go
// w kalendarzu (summary.ts), i suma „zafakturowano”.
const INVOICE_FACT_WHERE: Prisma.ClientInvoiceWhereInput = { matchState: { in: ["AUTO", "CONFIRMED"] } };
const INVOICE_FACT_SELECT = { sellDate: true, totalNet: true, rentalId: true, positionsSummary: true } as const;

function invoiceToFact(i: { sellDate: Date; totalNet: { toString(): string }; rentalId: string | null; positionsSummary: string | null }): ClientInvoiceFact {
  return {
    sellDate: i.sellDate,
    totalNet: Number(i.totalNet.toString()),
    hasRental: i.rentalId != null,
    interest: interestsFromText(i.positionsSummary).find((k) => k !== "SZKOLENIE") ?? null,
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
  // Ostatni kontakt = najnowsze z: e-mail (Gmail), SMS/rozmowa z panelu, wynajem.
  lastContactAt: string | null;
  // Klient vs „kontakt z zapytania” (prompt 2 v2, 1.0) i ostatni sygnał.
  qualified: boolean;
  lastInquiry: { leadId: string; at: string } | null;
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

// Najnowszy kontakt z klientem (e-mail z Gmaila, SMS i rozmowy z panelu).
async function lastContacts(): Promise<Map<string, Date>> {
  const [emails, messages, calls] = await Promise.all([
    prisma.emailMessage.groupBy({ by: ["clientId"], where: { clientId: { not: null } }, _max: { sentAt: true } }),
    prisma.message.groupBy({ by: ["clientId"], where: { clientId: { not: null } }, _max: { sentAt: true } }),
    prisma.leadActivity.groupBy({ by: ["clientId"], where: { clientId: { not: null }, type: { in: ["CALL", "CALL_NO_ANSWER", "SMS", "EMAIL"] } }, _max: { createdAt: true } }),
  ]);
  const out = new Map<string, Date>();
  const put = (id: string | null, d: Date | null | undefined) => {
    if (!id || !d) return;
    const prev = out.get(id);
    if (!prev || d > prev) out.set(id, d);
  };
  for (const e of emails) put(e.clientId, e._max.sentAt);
  for (const m of messages) put(m.clientId, m._max.sentAt);
  for (const c of calls) put(c.clientId, c._max.createdAt);
  return out;
}

export async function loadClientRows(today = new Date()): Promise<ClientListRow[]> {
  const [contactsAt, qualificationActive] = await Promise.all([lastContacts(), isQualificationActive()]);
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
        select: { firstName: true, lastName: true, phone: true, phone2: true, email: true, isPrimary: true },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
      rentals: { select: RENTAL_FACT_SELECT },
      history: { where: HISTORY_FACT_WHERE, select: HISTORY_FACT_SELECT },
      invoices: { where: INVOICE_FACT_WHERE, select: INVOICE_FACT_SELECT },
      qualifiedAt: true,
      leads: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, createdAt: true } },
    },
  });

  return clients.map((c) => {
    const summary = summarizeClient({
      statusOverride: c.statusOverride,
      rentals: [...(c.rentals as RentalFactRow[]).map(toFact), ...c.history.map(historyToFact)],
      invoices: c.invoices.map(invoiceToFact),
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
      hasPhone: c.contacts.some((p) => Boolean(p.phone?.trim() || p.phone2?.trim())),
      status: summary.status,
      rentals12m: summary.rentals12m,
      rentalsTotal: summary.rentalsTotal,
      lastRentalAt: summary.lastRentalAt?.toISOString() ?? null,
      lastContactAt: (() => {
        const d = [contactsAt.get(c.id), summary.lastRentalAt && summary.lastRentalAt <= today ? summary.lastRentalAt : null]
          .filter((x): x is Date => Boolean(x))
          .sort((a, b) => b.getTime() - a.getTime())[0];
        return d?.toISOString() ?? null;
      })(),
      revenueNet: summary.revenueNet,
      qualified: isQualified({ qualifiedAt: c.qualifiedAt, rentals: c.rentals.length, history: c.history.length, invoices: c.invoices.length }, qualificationActive),
      lastInquiry: c.leads[0] ? { leadId: c.leads[0].id, at: c.leads[0].createdAt.toISOString() } : null,
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
        .flatMap((p) => [p.phone, p.phone2])
        .map((ph) => (ph ?? "").replace(/\D/g, "").replace(/^48(?=\d{9}$)/, ""))
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
  phone2: string | null;
  phone2Label: string | null;
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
  | { kind: "message"; id: string; at: string; channel: string; body: string; failed: boolean }
  // Wydarzenie z historii kalendarzy (prompt 3A) — bez kwot.
  | { kind: "history"; id: string; at: string; title: string; deviceName: string; eventType: "WYNAJEM" | "SZKOLENIE" }
  // Faktura z Fakturowni (prompt 3B) — data sprzedaży, kwota netto.
  | { kind: "invoice"; id: string; at: string; number: string; totalNet: number; positions: string | null; fromPanel: boolean }
  // Wątek e-maili z Gmaila (prompt 3C) — zwinięty do jednej pozycji; treść
  // pobierana z Gmaila dopiero przy otwarciu (messageIds od najnowszej).
  | {
      kind: "email";
      id: string;
      at: string;
      subject: string | null;
      snippet: string | null;
      direction: "IN" | "OUT";
      count: number;
      hasAttachments: boolean;
      mailbox: string;
      messageIds: string[];
      thread: { id: string; direction: "IN" | "OUT"; from: string; at: string; snippet: string | null }[];
    }
  // Rozmowa / notatka (LeadActivity przy kliencie lub jego sygnale).
  | {
      kind: "activity";
      id: string;
      at: string;
      type: "CALL" | "CALL_NO_ANSWER" | "NOTE";
      body: string | null;
      userName: string | null;
      fromHubspot: boolean;
      leadTitle: string | null;
    };

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
    firstSeenAt: string | null;
    revenueNet: number;
    avgRentalNet: number | null;
    invoicedNet: number;
    invoicesCount: number;
    favoriteDevice: DeviceInterestKey | null;
  };
  history: ClientHistoryItem[];
  // Adresy z firmowej domeny klienta, z których przyszły e-maile, a których
  // nie ma wśród osób kontaktowych — propozycja „Dodaj osobę” (prompt 3, 4.3).
  suggestedEmails: string[];
  // Zakładka „Wynajmy i faktury” (prompt 3B-karta) — daty jako ISO.
  transactions: {
    key: string;
    date: string;
    source: "panel" | "kalendarz" | "faktura";
    rentalId: string | null;
    title: string;
    details: string | null;
    net: number | null;
    invoice: { id: string; fakturowniaInvoiceId: number; number: string; issueDate: string } | null;
    status: { kind: PaymentStatus["kind"]; label: string; days: number | null; paidAt: string | null };
  }[];
  txTotals: TxTotals;
  // Przegląd: kafelki i „W skrócie”.
  overview: {
    revenue12m: number;
    avg12m: number | null;
    nextRental: { startsAt: string; deviceName: string } | null;
    favoriteDeviceName: string | null;
    favoriteDeviceCount: number;
    realizedCount: number;
    rhythmDays: number | null;
    lastContact: { at: string; label: string } | null;
    typicalPayment: string | null;
    nextStep: { text: string; at: string | null; overdue: boolean; href: string | null } | null;
  };
  aliases: string[];
  gmail: { enabled: boolean; mailboxes: string[]; lastSyncAt: string | null };
  // Klient vs „kontakt z zapytania” (prompt 2 v2, 1.0).
  qualification: { active: boolean; qualified: boolean; at: string | null; reason: string | null; derived: boolean };
  // Sygnały klienta (CRM, prompt 2) — otwarte i zamknięte.
  leads: {
    id: string;
    title: string;
    stage: "SYGNAL" | "WYWIAD" | "OFERTA" | "REZERWACJA" | "WYGRANA" | "PRZEGRANA";
    createdAt: string;
    nextActionAt: string | null;
  }[];
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
          finance: {
            select: {
              confirmedAt: true,
              totalNet: true,
              deviceVariant: true,
              pulseCounterStart: true,
              pulseCounterEnd: true,
              transportPriceNet: true,
              paymentMethod: true,
              fakturowniaInvoiceId: true,
            },
          },
        },
      },
      history: {
        where: HISTORY_FACT_WHERE,
        orderBy: { startsAt: "desc" },
        select: { ...HISTORY_FACT_SELECT, id: true, title: true, device: { select: { name: true, pricingCategory: true } } },
      },
      invoices: {
        where: INVOICE_FACT_WHERE,
        orderBy: { sellDate: "desc" },
        select: { ...INVOICE_FACT_SELECT, id: true, number: true, fakturowniaInvoiceId: true, issueDate: true, paymentTo: true, paymentType: true },
      },
      leads: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, title: true, stage: true, createdAt: true, nextActionAt: true } },
      aliases: { orderBy: { alias: "asc" }, select: { alias: true } },
    },
  });
  if (!c) return null;

  const summary = summarizeClient({
    statusOverride: c.statusOverride,
    rentals: [...(c.rentals as unknown as RentalFactRow[]).map(toFact), ...c.history.map(historyToFact)],
    invoices: c.invoices.map(invoiceToFact),
    today,
  });

  const history: ClientHistoryItem[] = [];
  const seenMessages = new Set<string>();
  // Wiadomości wysłane poza wynajmem (np. SMS z karty klienta) nie mają
  // rentalId — dopasowujemy je po numerze osoby kontaktowej (E.164, tak jak
  // zapisuje je POST /api/sms/send). Message.clientId dojdzie w etapie 2.
  const phones = c.contacts.flatMap((p) => [p.phone, p.phone2]).filter((p): p is string => Boolean(p && p.startsWith("+")));
  const looseMessages = await prisma.message.findMany({
    where: { rentalId: null, OR: [{ clientId: id }, ...(phones.length ? [{ recipient: { in: phones } }] : [])] },
    select: { id: true, channel: true, body: true, status: true, sentAt: true },
  });
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
  for (const h of c.history) {
    history.push({
      kind: "history",
      id: h.id,
      at: h.startsAt.toISOString(),
      title: h.title,
      deviceName: h.device.name,
      eventType: h.kind === "SZKOLENIE" ? "SZKOLENIE" : "WYNAJEM",
    });
  }
  for (const i of c.invoices) {
    history.push({
      kind: "invoice",
      id: i.id,
      at: i.sellDate.toISOString(),
      number: i.number,
      totalNet: Number(i.totalNet.toString()),
      positions: i.positionsSummary,
      fromPanel: i.rentalId != null,
    });
  }
  // E-maile z Gmaila zwinięte do wątków.
  const emails = await prisma.emailMessage.findMany({
    where: { clientId: id },
    orderBy: { sentAt: "desc" },
    take: 500,
    select: {
      id: true,
      gmailThreadId: true,
      mailbox: true,
      direction: true,
      subject: true,
      snippet: true,
      hasAttachments: true,
      sentAt: true,
      fromAddress: true,
      toAddresses: true,
      matchMethod: true,
    },
  });
  const threads = new Map<string, (typeof emails)[number][]>();
  for (const e of emails) {
    const k = `${e.mailbox}|${e.gmailThreadId}`;
    threads.set(k, [...(threads.get(k) ?? []), e]);
  }
  for (const list of threads.values()) {
    const latest = list[0];
    history.push({
      kind: "email",
      id: latest.id,
      at: latest.sentAt.toISOString(),
      subject: list[list.length - 1].subject ?? latest.subject,
      snippet: latest.snippet,
      direction: latest.direction,
      count: list.length,
      hasAttachments: list.some((e) => e.hasAttachments),
      mailbox: latest.mailbox,
      messageIds: list.map((e) => e.id),
      thread: [...list].reverse().map((e) => ({ id: e.id, direction: e.direction, from: e.fromAddress, at: e.sentAt.toISOString(), snippet: e.snippet })),
    });
  }

  // Rozmowy i notatki (LeadActivity klienta — także z jego sygnałów i z HubSpota).
  const activities = await prisma.leadActivity.findMany({
    where: { OR: [{ clientId: id }, { lead: { clientId: id } }], type: { in: ["CALL", "CALL_NO_ANSWER", "NOTE"] } },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: { id: true, type: true, body: true, createdAt: true, hubspotEngagementId: true, user: { select: { name: true } }, lead: { select: { title: true } } },
  });
  for (const a of activities) {
    history.push({
      kind: "activity",
      id: a.id,
      at: a.createdAt.toISOString(),
      type: a.type as "CALL" | "CALL_NO_ANSWER" | "NOTE",
      body: a.body,
      userName: a.user?.name ?? null,
      fromHubspot: Boolean(a.hubspotEngagementId),
      leadTitle: a.lead?.title ?? null,
    });
  }
  const known = new Set(c.contacts.map((p) => p.email?.toLowerCase()).filter(Boolean));
  const suggestedEmails = [
    ...new Set(
      emails
        .filter((e) => e.matchMethod === "DOMAIN")
        .flatMap((e) => (e.direction === "IN" ? [e.fromAddress] : ((e.toAddresses as string[]) ?? [])))
        .map((a) => a.toLowerCase())
        .filter((a) => !known.has(a) && known.size > 0 && [...known].some((k) => k!.split("@")[1] === a.split("@")[1])),
    ),
  ];
  history.sort((a, b) => b.at.localeCompare(a.at));

  // --- Wynajmy i faktury ---
  const payments = await prisma.fakturowniaPayment.findMany({
    where: { fakturowniaInvoiceId: { in: c.invoices.map((i) => i.fakturowniaInvoiceId) } },
    select: { fakturowniaInvoiceId: true, paidAt: true },
  });
  const paidAt = new Map(payments.map((p) => [p.fakturowniaInvoiceId, p.paidAt]));
  const txRentals: TxRental[] = [
    ...c.rentals
      .filter((r) => !r.deletedInGoogle && r.eventType === "WYNAJEM")
      .map((r) => {
        const f = r.finance;
        const days = rentalDurationDays(r.startsAt, r.endsAt);
        const pulses = f?.pulseCounterStart != null && f?.pulseCounterEnd != null ? f.pulseCounterEnd - f.pulseCounterStart : null;
        const parts = [
          `${days} ${days === 1 ? "dzień" : "dni"}`,
          f?.deviceVariant === "double" ? "2 głowice" : null,
          pulses && pulses > 0 ? `${pulses.toLocaleString("pl-PL")} impulsów` : null,
          f?.transportPriceNet && Number(f.transportPriceNet.toString()) > 0 ? "transport" : null,
        ].filter(Boolean);
        return {
          id: r.id,
          source: "panel" as const,
          startsAt: r.startsAt,
          deviceName: r.device.name,
          details: parts.join(" · "),
          totalNet: f ? Number(f.totalNet.toString()) : null,
          fakturowniaInvoiceId: f?.fakturowniaInvoiceId ?? null,
          cashConfirmed: f?.paymentMethod === "CASH" && f.confirmedAt != null,
        };
      }),
    ...c.history
      .filter((h) => h.kind === "WYNAJEM")
      .map((h) => ({
        id: h.id,
        source: "kalendarz" as const,
        startsAt: h.startsAt,
        deviceName: h.device.name,
        details: "z kalendarza",
        totalNet: null,
        fakturowniaInvoiceId: null,
        cashConfirmed: false,
      })),
  ];
  const txRows = buildTransactions(
    txRentals,
    c.invoices.map((i) => ({
      id: i.id,
      fakturowniaInvoiceId: i.fakturowniaInvoiceId,
      number: i.number,
      sellDate: i.sellDate,
      issueDate: i.issueDate,
      totalNet: Number(i.totalNet.toString()),
      paymentTo: i.paymentTo,
      paymentType: i.paymentType,
      paidAt: paidAt.get(i.fakturowniaInvoiceId) ?? null,
      rentalId: i.rentalId,
      positions: i.positionsSummary,
    })),
    today,
  );

  // --- Przegląd ---
  const yearAgo = new Date(today.getTime() - 365 * 86_400_000);
  const finished12 = c.rentals.filter(
    (r) => !r.deletedInGoogle && r.finance && r.endsAt <= today && r.startsAt >= yearAgo,
  );
  const revenue12m = Math.round(finished12.reduce((s, r) => s + Number(r.finance!.totalNet.toString()), 0) * 100) / 100;
  const next = c.rentals
    .filter((r) => !r.deletedInGoogle && r.eventType === "WYNAJEM" && r.startsAt > today)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  const realizedDates = txRentals.filter((r) => r.startsAt <= today).map((r) => r.startsAt);
  const deviceCounts = new Map<string, number>();
  for (const r of txRentals) if (r.startsAt <= today) deviceCounts.set(r.deviceName, (deviceCounts.get(r.deviceName) ?? 0) + 1);
  const fav = [...deviceCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const lastComm = history.find((h) => h.kind === "email" || h.kind === "message" || (h.kind === "activity" && h.type !== "NOTE"));
  const commLabel = (h: ClientHistoryItem) =>
    h.kind === "email" ? "e-mail" : h.kind === "message" ? (h.channel === "SMS" ? "SMS" : "e-mail z panelu") : "rozmowa";
  // Następny krok: najbliższy z otwartych sygnałów i otwartych zadań klienta.
  const openLeadIds = c.leads.filter((l) => ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA"].includes(l.stage)).map((l) => l.id);
  const tasks = await prisma.task.findMany({
    where: { status: "OPEN", OR: [{ clientId: id }, ...(openLeadIds.length ? [{ leadId: { in: openLeadIds } }] : [])] },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    take: 5,
    select: { title: true, dueDate: true, leadId: true },
  });
  const steps = [
    ...c.leads
      .filter((l) => openLeadIds.includes(l.id) && l.nextActionAt)
      .map((l) => ({ text: `${l.title} — zaplanowany kontakt`, at: l.nextActionAt as Date | null, href: `/sygnaly?id=${l.id}` })),
    ...tasks.map((t) => ({ text: t.title, at: t.dueDate, href: t.leadId ? `/sygnaly?id=${t.leadId}` : null })),
  ].sort((a, b) => (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity));
  const step = steps[0];
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

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
      phone2: p.phone2,
      phone2Label: p.phone2Label,
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
      firstSeenAt: summary.firstSeenAt?.toISOString() ?? null,
      revenueNet: summary.revenueNet,
      avgRentalNet: summary.avgRentalNet,
      invoicedNet: summary.invoicedNet,
      invoicesCount: summary.invoicesCount,
      favoriteDevice: summary.favoriteDevice,
    },
    history,
    transactions: txRows.map((r) => ({
      key: r.key,
      date: r.date.toISOString(),
      source: r.source,
      rentalId: r.rentalId,
      title: r.title,
      details: r.details,
      net: r.net,
      invoice: r.invoice ? { ...r.invoice, issueDate: r.invoice.issueDate.toISOString() } : null,
      status: {
        kind: r.status.kind,
        label: paymentLabel(r.status),
        days: r.status.kind === "PO_TERMINIE" ? r.status.days : null,
        paidAt: r.status.kind === "ZAPLACONA" ? r.status.paidAt.toISOString() : null,
      },
    })),
    txTotals: transactionTotals(txRows, today),
    overview: {
      revenue12m,
      avg12m: finished12.length ? Math.round((revenue12m / finished12.length) * 100) / 100 : null,
      nextRental: next ? { startsAt: next.startsAt.toISOString(), deviceName: next.device.name } : null,
      favoriteDeviceName: fav?.[0] ?? null,
      favoriteDeviceCount: fav?.[1] ?? 0,
      realizedCount: realizedDates.length,
      rhythmDays: rentalRhythmDays(realizedDates),
      lastContact: lastComm ? { at: lastComm.at, label: commLabel(lastComm) } : null,
      typicalPayment: typicalPayment(txRows),
      nextStep: step
        ? { text: step.text, at: step.at?.toISOString() ?? null, overdue: Boolean(step.at && step.at < startOfToday), href: step.href }
        : null,
    },
    aliases: c.aliases.map((a) => a.alias),
    gmail: await gmailSummary(),
    qualification: await (async () => {
      const active = await isQualificationActive();
      const derived = c.rentals.length > 0 || c.history.length > 0 || c.invoices.length > 0;
      return {
        active,
        qualified: isQualified({ qualifiedAt: c.qualifiedAt, rentals: c.rentals.length, history: c.history.length, invoices: c.invoices.length }, active),
        at: c.qualifiedAt?.toISOString() ?? null,
        reason: c.qualifiedReason,
        derived,
      };
    })(),
    suggestedEmails,
    leads: c.leads.map((l) => ({ id: l.id, title: l.title, stage: l.stage, createdAt: l.createdAt.toISOString(), nextActionAt: l.nextActionAt?.toISOString() ?? null })),
  };
}

// Status wybranych klientów (np. przy sygnałach: „Powracająca klientka”,
// „Nie kontaktować”) — ta sama reguła co lista klientów, bez przychodu.
export async function loadClientStatuses(ids: string[], today = new Date()): Promise<Map<string, ClientStatus>> {
  if (ids.length === 0) return new Map();
  const clients = await prisma.client.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      statusOverride: true,
      rentals: { select: RENTAL_FACT_SELECT },
      history: { where: HISTORY_FACT_WHERE, select: HISTORY_FACT_SELECT },
      invoices: { where: INVOICE_FACT_WHERE, select: INVOICE_FACT_SELECT },
    },
  });
  return new Map(
    clients.map((c) => [
      c.id,
      summarizeClient({
        statusOverride: c.statusOverride,
        rentals: [...(c.rentals as RentalFactRow[]).map(toFact), ...c.history.map(historyToFact)],
        invoices: c.invoices.map(invoiceToFact),
        today,
      }).status,
    ]),
  );
}
