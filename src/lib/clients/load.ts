import { prisma } from "@/lib/prisma";
import { loadClientAddresses, loadDeliverySettings, type DeliveryAddressDto } from "@/lib/clients/delivery";
import type { TransportZone } from "@/lib/clients/delivery-rules";
import { loadClientPrices, type ClientPriceDto } from "@/lib/clients/terms";
import { deviceCodeFor, invoiceNetOf, positionsSummary, type ClientPriceRow } from "@/lib/clients/terms-rules";
import { getHubspotContactUrl } from "@/lib/integrations/hubspot";
import type { ClinicTypeKey, DeviceInterestKey, SourceKey } from "@/lib/clients/labels";
import { summarizeClient } from "@/lib/clients/summary";
import { rentalDurationDays } from "@/lib/pricing/duration";
import { buildTransactions, rentalRhythmDays, transactionTotals, typicalPayment, type TxRental, type TxTotals } from "@/lib/clients/transactions";
import { paymentLabel, type PaymentStatus } from "@/lib/clients/payment-status";
import { loadCardExtras, profileDto, type ClientProfileDto, type FieldMetaDto, type LineageDto, type OpportunityDto } from "@/lib/clients/card-extras";
import type { PersonRole, TrainedOn } from "@/lib/clients/profile-fields";
import { rentalTimeOf } from "@/lib/rental-title";
import { computeRhythm, headsFromText, monthsLabel, type ClientRhythm, type RhythmRental } from "@/lib/clients/rhythm";
import { loadPaymentCoverage } from "@/lib/invoicing/bank-transfers";
import { gmailSummary } from "@/lib/gmail/sync";
import { isQualified } from "@/lib/clients/qualification";
import { isQualificationActive } from "@/lib/clients/qualify";
import type { ClientStatus } from "@/lib/clients/status";
import {
  HISTORY_FACT_SELECT,
  HISTORY_FACT_WHERE,
  INVOICE_FACT_SELECT,
  INVOICE_FACT_WHERE,
  RENTAL_FACT_SELECT,
  historyToFact,
  invoiceToFact,
  parseInterests,
  toFact,
  type RentalFactRow,
} from "@/lib/clients/facts";

export { loadClientRows, type ClientListRow } from "@/lib/clients/list-load";

// Odczyt modułu Klienci (serwer). ZAWIERA PRZYCHÓD — wołać wyłącznie z
// miejsc dostępnych dla ADMIN/STAFF (strona /klienci, /api/clients/*),
// NIGDY z niczego dostępnego roli KIEROWCA (spec, sekcja 2 i 4).
// Status liczony przy odczycie (<1000 klientów — jedno zapytanie wystarcza,
// bez denormalizacji; spec, sekcja 2).

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
  // Karta klienta, sekcja 3.
  roles: PersonRole[];
  preferredChannel: string | null;
  salutation: string | null;
  trainedOn: TrainedOn[];
  fieldMeta: FieldMetaDto;
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
      time?: string | null; // godzina dostawy (deliveryTime / prefiks tytułu); null = do ustalenia
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
      hidden?: "EXCLUDED" | "ENGINEERING" | "MANUAL" | null;
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
  // Archiwum (Porządki): null = klient aktywny.
  archive: { at: string; reason: string | null; note: string | null; batch: string | null } | null;
  statusOverride: "NIE_KONTAKTOWAC" | null;
  notes: string | null;
  hubspotCompanyId: string | null;
  legacyHubspotTag: string | null;
  hubspotContactIds: string[];
  // Link „Otwórz w HubSpot” (okres przejściowy) — null, gdy brak mapowania
  // albo HUBSPOT_PORTAL_ID w .env.
  hubspotUrl: string | null;
  contacts: ClientContactDto[];
  // Karta klienta, sekcja 3: nowe pola, pochodzenie pól, szanse, powiązania.
  profile: ClientProfileDto;
  // Paszport dostawy (etap B): adresy z trasą od bazy i uwagami kierowców.
  delivery: { addresses: DeliveryAddressDto[]; zones: TransportZone[]; baseAddress: string };
  // Warunki handlowe (etap C): ceny klienta i cennik ogólny w kodach tabeli cen.
  terms: { prices: ClientPriceDto[]; priceList: ClientPriceRow[] };
  fieldMeta: FieldMetaDto;
  opportunities: OpportunityDto[];
  lineage: LineageDto;
  // Fakty do karty: zgodność NIP z fakturami, typowa godzina i czas wynajmu,
  // ostatni SMS.
  cardFacts: {
    nipInvoiceCount: number;
    usualStartTime: { time: string; fromAt: string } | null;
    typicalDays: number | null;
    lastSmsAt: string | null;
    // Przychód 12 mies.: znane kwoty (faktury, rozliczenia) + liczba
    // wynajmów bez kwoty (z kalendarzy) do szacunku z ceny ustalonej.
    revenue12m: { known: number; withoutAmount: number };
  };
  // Zadania klienta (oś zdarzeń na karcie) — otwarte i ostatnie zamknięte.
  tasks: { id: string; title: string; status: string; dueDate: string | null; completedAt: string | null; createdAt: string; assigneeName: string | null }[];
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
  // Wątki ukryte w historii (wniosek 7: inżynieria, wykluczone domeny, ręcznie)
  // — osobno, żeby żaden widok nie pokazał ich przypadkiem.
  hiddenThreads: ClientHistoryItem[];
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
    positions: string | null;
    rentalNet: number | null;
    onInvoiceNet: number | null;
    invoice: { id: string; fakturowniaInvoiceId: number; number: string; issueDate: string; totalGross: number | null } | null;
    status: { kind: PaymentStatus["kind"]; label: string; days: number | null; paidAt: string | null; method: string | null };
  }[];
  txTotals: TxTotals;
  // Pola liczone (karta klienta, sekcja 4): rytm, dzień tygodnia, urządzenie,
  // przerwa sezonowa, prognoza, ryzyko odejścia, siatka lata × miesiące.
  rhythm: Omit<ClientRhythm, "forecast" | "churnRisk"> & {
    seasonalBreakLabel: string;
    forecast: string[];
    churnRisk: { level: "niskie" | "średnie" | "wysokie"; ratio: number; lastAt: string } | null;
    lastPlannedAt: string | null;
  };
  // Przegląd: kafelki i „W skrócie”.
  overview: {
    revenue12m: number;
    avg12m: number | null;
    nextRental: { startsAt: string; time: string | null; deviceName: string; heads: number | null; smsSentAt: string | null } | null;
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
          deliveryTime: true,
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
              baseRentalPriceNet: true,
              pulseSurchargeNet: true,
              pulseCalculationStatus: true,
              capUsedHS: true,
              capCountHS: true,
              capFeeNet: true,
              membraneUsed: true,
              membraneCount: true,
              membraneFeeNet: true,
              vatApplicable: true,
              invoiceNet: true,
              transportPaidSeparately: true,
            },
          },
        },
      },
      history: {
        where: HISTORY_FACT_WHERE,
        orderBy: { startsAt: "desc" },
        select: { ...HISTORY_FACT_SELECT, id: true, title: true, description: true, device: { select: { name: true, pricingCategory: true } } },
      },
      invoices: {
        where: INVOICE_FACT_WHERE,
        orderBy: { sellDate: "desc" },
        select: {
          ...INVOICE_FACT_SELECT,
          id: true,
          number: true,
          fakturowniaInvoiceId: true,
          issueDate: true,
          paymentTo: true,
          paymentType: true,
          totalGross: true,
        },
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
      time: rentalTimeOf(r),
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
      hiddenReason: true,
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
      // Ukryty wątek (wniosek 7): inżynieria / wykluczona domena / ręcznie.
      hidden: list.every((e) => e.hiddenReason && e.hiddenReason !== "SHOWN") ? (latest.hiddenReason as "EXCLUDED" | "ENGINEERING" | "MANUAL") : null,
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
    select: { fakturowniaInvoiceId: true, paidAt: true, bankTransferId: true, method: true, receivedBy: true },
  });
  const paymentBy = new Map(payments.map((p) => [p.fakturowniaInvoiceId, p]));
  const paidAt = new Map(payments.map((p) => [p.fakturowniaInvoiceId, p.paidAt]));
  const transferIds = payments.map((p) => p.bankTransferId).filter((x): x is string => !!x);
  const transfers = transferIds.length ? await prisma.bankTransfer.findMany({ where: { id: { in: transferIds } }, select: { id: true, amount: true } }) : [];
  const transferAmount = new Map(transfers.map((t) => [t.id, Number(t.amount.toString())]));
  const paidAmount = new Map(payments.map((p) => [p.fakturowniaInvoiceId, p.bankTransferId ? (transferAmount.get(p.bankTransferId) ?? null) : null]));
  const coverage = await loadPaymentCoverage();
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
          positions: f
            ? positionsSummary({
                eventType: r.eventType,
                baseNet: Number(f.baseRentalPriceNet),
                transportNet: f.transportPriceNet != null ? Number(f.transportPriceNet) : null,
                pulseSurchargeNet: f.pulseSurchargeNet != null ? Number(f.pulseSurchargeNet) : null,
                pulsesPending: f.pulseCalculationStatus === "PENDING",
                capNet: f.capUsedHS && f.capFeeNet ? Number(f.capFeeNet) * Math.max(1, f.capCountHS) : null,
                membraneNet: f.membraneUsed && f.membraneFeeNet ? Number(f.membraneFeeNet) * Math.max(1, f.membraneCount) : null,
              })
            : null,
          onInvoiceNet: f ? invoiceNetOf({ vatApplicable: f.vatApplicable, invoiceNet: f.invoiceNet != null ? Number(f.invoiceNet) : null, totalNet: Number(f.totalNet) }) : null,
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
      totalGross: Number(i.totalGross.toString()),
      paidAt: paidAt.get(i.fakturowniaInvoiceId) ?? null,
      paidAmount: paidAmount.get(i.fakturowniaInvoiceId) ?? null,
      paidMethod: (paymentBy.get(i.fakturowniaInvoiceId)?.method as "CASH" | "TRANSFER" | "MANUAL" | null | undefined) ?? null,
      paidReceivedBy: paymentBy.get(i.fakturowniaInvoiceId)?.receivedBy ?? null,
      rentalId: i.rentalId,
      positions: i.positionsSummary,
    })),
    today,
    coverage,
    c.paymentForm,
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
  const rhythmRentals: RhythmRental[] = [
    ...c.rentals
      .filter((r) => !r.deletedInGoogle && r.eventType === "WYNAJEM")
      .map((r) => ({
        at: r.startsAt,
        device: r.device.name,
        heads: r.finance?.deviceVariant === "double" ? 2 : r.finance?.deviceVariant?.startsWith("single") ? 1 : headsFromText(r.title),
      })),
    ...c.history.filter((h) => h.kind === "WYNAJEM").map((h) => ({ at: h.startsAt, device: h.device.name, heads: headsFromText(`${h.title} ${h.description ?? ""}`) })),
  ];
  // Typowa godzina dostawy: najczęstsza godzina startu wynajmów z panelu
  // (Europe/Warsaw); źródło = najbliższy (albo ostatni) wynajem z tą godziną.
  const timed = c.rentals
    .filter((r) => !r.deletedInGoogle && r.eventType === "WYNAJEM")
    .map((r) => ({ at: r.startsAt, t: rentalTimeOf(r) }))
    .filter((x): x is { at: Date; t: string } => !!x.t);
  const timeCounts = new Map<string, number>();
  for (const x of timed) timeCounts.set(x.t, (timeCounts.get(x.t) ?? 0) + 1);
  const topTime = [...timeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const topTimeRental = topTime ? (timed.filter((x) => x.t === topTime && x.at > today).sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? timed.find((x) => x.t === topTime)) : null;
  const durations = [
    ...c.rentals.filter((r) => !r.deletedInGoogle && r.eventType === "WYNAJEM").map((r) => rentalDurationDays(r.startsAt, r.endsAt)),
    ...c.history.filter((h) => h.kind === "WYNAJEM").map((h) => rentalDurationDays(h.startsAt, h.endsAt)),
  ].sort((a, b) => a - b);
  const nipInvoiceCount = c.nip ? await prisma.clientInvoice.count({ where: { clientId: c.id, buyerTaxNo: c.nip } }) : 0;
  const lastSms = c.rentals
    .flatMap((r) => r.messages)
    .filter((m) => m.channel === "SMS" && m.status === "SENT" && m.sentAt)
    .map((m) => m.sentAt!.getTime());
  const [extras, deliveryAddresses, deliverySettings, clientPrices, priceRules] = await Promise.all([
    loadCardExtras(c.id, [c.fieldMeta, ...c.contacts.map((p) => p.fieldMeta)]),
    loadClientAddresses(c.id),
    loadDeliverySettings(),
    loadClientPrices(c.id),
    prisma.priceRule.findMany({ select: { pricingCategory: true, variant: true, durationDays: true, priceNet: true } }),
  ]);
  const rhythm = computeRhythm({ realized: rhythmRentals.filter((x) => x.at <= today), planned: rhythmRentals.filter((x) => x.at > today), today });
  const deviceCounts = new Map<string, number>();
  for (const r of txRentals) if (r.startsAt <= today) deviceCounts.set(r.deviceName, (deviceCounts.get(r.deviceName) ?? 0) + 1);
  const fav = [...deviceCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const hiddenThreads = history.filter((h) => h.kind === "email" && h.hidden);
  for (const h of hiddenThreads) history.splice(history.indexOf(h), 1);
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
  const clientTasks = await prisma.task.findMany({
    where: { clientId: id },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { id: true, title: true, status: true, dueDate: true, completedAt: true, createdAt: true, assignee: { select: { name: true } } },
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
    archive: c.archivedAt ? { at: c.archivedAt.toISOString(), reason: c.archiveReason, note: c.archiveNote, batch: c.archiveBatch } : null,
    statusOverride: c.statusOverride,
    notes: c.notes,
    hubspotCompanyId: c.hubspotCompanyId,
    legacyHubspotTag: c.legacyHubspotTag,
    hubspotContactIds: c.contacts.map((p) => p.hubspotContactId).filter((x): x is string => Boolean(x)),
    hubspotUrl: (() => {
      const primaryHs = c.contacts.find((p) => p.hubspotContactId)?.hubspotContactId;
      return primaryHs ? getHubspotContactUrl(primaryHs) : null;
    })(),
    profile: profileDto(c),
    delivery: { addresses: deliveryAddresses, zones: deliverySettings.zones, baseAddress: deliverySettings.base.address },
    terms: {
      prices: clientPrices,
      priceList: priceRules.flatMap((r) => {
        const code = deviceCodeFor("WYNAJEM", r.pricingCategory, r.variant);
        return code ? [{ device: code, days: r.durationDays, priceNet: Number(r.priceNet) }] : [];
      }),
    },
    fieldMeta: extras.withNames(c.fieldMeta),
    opportunities: extras.opportunities,
    lineage: extras.lineage,
    cardFacts: {
      nipInvoiceCount,
      usualStartTime: topTime && topTimeRental ? { time: topTime, fromAt: topTimeRental.at.toISOString() } : null,
      typicalDays: durations.length ? durations[Math.floor(durations.length / 2)] : null,
      lastSmsAt: lastSms.length ? new Date(Math.max(...lastSms)).toISOString() : null,
      revenue12m: (() => {
        const rows = txRows.filter((x) => x.date >= yearAgo && x.date <= today);
        return {
          known: Math.round(rows.filter((x) => x.net != null).reduce((s, x) => s + (x.net ?? 0), 0) * 100) / 100,
          withoutAmount: rows.filter((x) => x.net == null && x.source !== "faktura").length,
        };
      })(),
    },
    tasks: clientTasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      dueDate: t.dueDate?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      assigneeName: t.assignee?.name ?? null,
    })),
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
      roles: Array.isArray(p.roles) ? (p.roles as PersonRole[]) : [],
      preferredChannel: p.preferredChannel,
      salutation: p.salutation,
      trainedOn: Array.isArray(p.trainedOn) ? (p.trainedOn as TrainedOn[]) : [],
      fieldMeta: extras.withNames(p.fieldMeta),
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
      positions: r.positions,
      rentalNet: r.rentalNet,
      onInvoiceNet: r.onInvoiceNet,
      invoice: r.invoice ? { ...r.invoice, issueDate: r.invoice.issueDate.toISOString() } : null,
      status: {
        kind: r.status.kind,
        label: paymentLabel(r.status),
        days: r.status.kind === "PO_TERMINIE" || r.status.kind === "BRAK_PRZELEWU" ? r.status.days : null,
        paidAt: r.status.kind === "ZAPLACONA" ? r.status.paidAt.toISOString() : null,
        method: r.status.kind === "ZAPLACONA" ? (r.status.method ?? null) : null,
      },
    })),
    txTotals: transactionTotals(txRows, today, coverage),
    rhythm: (() => {
      const r = rhythm;
      const plannedDates = rhythmRentals.filter((x) => x.at > today).map((x) => x.at.getTime());
      return {
        ...r,
        seasonalBreakLabel: monthsLabel(r.seasonalBreak),
        forecast: r.forecast.map((d) => d.toISOString()),
        churnRisk: r.churnRisk ? { ...r.churnRisk, lastAt: r.churnRisk.lastAt.toISOString() } : null,
        lastPlannedAt: plannedDates.length ? new Date(Math.max(...plannedDates)).toISOString() : null,
      };
    })(),
    overview: {
      revenue12m,
      avg12m: finished12.length ? Math.round((revenue12m / finished12.length) * 100) / 100 : null,
      nextRental: next
        ? {
            startsAt: next.startsAt.toISOString(),
            time: rentalTimeOf(next),
            deviceName: next.device.name,
            heads: next.finance?.deviceVariant === "double" ? 2 : next.finance?.deviceVariant?.startsWith("single") ? 1 : headsFromText(next.title),
            smsSentAt:
              next.messages
                .filter((m) => m.channel === "SMS" && m.status !== "FAILED" && m.sentAt)
                .map((m) => m.sentAt!.toISOString())
                .sort()
                .pop() ?? null,
          }
        : null,
      favoriteDeviceName: fav?.[0] ?? null,
      favoriteDeviceCount: fav?.[1] ?? 0,
      realizedCount: realizedDates.length,
      rhythmDays: rhythm.rhythmDays ?? rentalRhythmDays(realizedDates),
      lastContact: lastComm ? { at: lastComm.at, label: commLabel(lastComm) } : null,
      typicalPayment: typicalPayment(txRows, c.paymentForm),
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
    hiddenThreads,
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
