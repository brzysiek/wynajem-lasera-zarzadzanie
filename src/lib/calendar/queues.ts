import { prisma } from "@/lib/prisma";
import { loadUnassignedRentals } from "@/lib/clients/rental-match";
import { loadFvWithoutInvoice } from "@/lib/invoicing/fv-check-load";
import { rentalIssues } from "@/lib/task-link-rules";
import { loadRentalAlerts } from "@/lib/rental-alerts-load";
import { ALERT_FIELD_LABEL } from "@/lib/rental-alerts";
import { loadReportAlerts } from "@/lib/report-alerts-load";
import { REPORT_FIELD_LABEL } from "@/lib/report-alerts";
import { loadMissingEmailAlerts } from "@/lib/missing-email-alerts-load";

// Kalendarz → „Do dopięcia” (wniosek 26): kolejki liczone na bieżąco z danych,
// bez zadań. Każda pozycja linkuje do karty rezerwacji (/kalendarz?wynajem=).
// Wniosek 34: „Bez klienta”, „Kwota / wariant” i „Transport do zatwierdzenia”
// liczą tylko sprawy w horyzoncie (Setting calendar_queue_horizon_days,
// domyślnie 14 dni) — dalsze w `later` („+ N dalszych”). „Wydania jutro” =
// jutro, w piątek też weekend i poniedziałek. FV bez zmian.

// link: podpowiedź faktury z Fakturowni („prawdopodobnie wystawiona”) — przycisk
// „Podepnij” (POST /api/rentals/[id]/invoice-link).
export type QueueItem = {
  rentalId: string;
  title: string;
  startsAt: string;
  device: string;
  note: string;
  link?: { invoiceId: string; number: string; amount: string; amountDiffers: boolean };
};
export type CalendarQueueKey = "unassigned" | "amounts" | "transport" | "driver" | "tomorrow" | "report" | "invoices" | "invoiceLink" | "email";
export type CalendarQueue = { key: CalendarQueueKey; label: string; items: QueueItem[]; later?: QueueItem[]; horizon?: string };

export const QUEUE_HORIZON_KEY = "calendar_queue_horizon_days";
export const QUEUE_HORIZON_DEFAULT = 14;
// Menu (licznik „Kalendarz”): pilne = sprawy z terminem ≤ 7 dni.
export const NAV_URGENT_DAYS = 7;

async function horizonDays(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: QUEUE_HORIZON_KEY } }).catch(() => null);
  const n = Number(row?.value);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : QUEUE_HORIZON_DEFAULT;
}

// Dni „Wydania jutro”: jutro, a w piątek sobota, niedziela i poniedziałek.
export function releaseWindow(today: Date): { from: Date; to: Date } {
  const from = new Date(today.getTime() + 86_400_000);
  const days = today.getDay() === 5 ? 3 : 1;
  return { from, to: new Date(from.getTime() + days * 86_400_000) };
}

const num = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));

export async function loadCalendarQueues(now = new Date()): Promise<CalendarQueue[]> {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const release = releaseWindow(today);
  const horizon = await horizonDays();
  const horizonEnd = new Date(today.getTime() + (horizon + 1) * 86_400_000);
  const [unassigned, future, fv, rentalAlerts, reportAlerts, emailAlerts] = await Promise.all([
    loadUnassignedRentals({ now }).catch(() => []),
    prisma.rental.findMany({
      where: { deletedInGoogle: false, eventType: "WYNAJEM", endsAt: { gte: today }, clientId: { not: null } },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        title: true,
        startsAt: true,
        eventType: true,
        clientId: true,
        client: { select: { name: true, shortName: true, transportPriceNet: true } },
        deliveryAddress: true,
        deliveryAddressId: true,
        deliveryTime: true,
        device: { select: { name: true, variantOptions: true } },
        finance: {
          select: {
            deviceVariant: true,
            totalNet: true,
            baseRentalPriceNet: true,
            pulseSurchargeNet: true,
            transportPriceNet: true,
            transportPaidSeparately: true,
            capUsedHS: true,
            capCountHS: true,
            capFeeNet: true,
            membraneUsed: true,
            membraneCount: true,
            membraneFeeNet: true,
          },
        },
      },
    }),
    loadFvWithoutInvoice(now).catch(() => []),
    // Dawne ikony prawego paska (powiadomienia, raport kierowcy, brak e-maila)
    // — od 30.09 kafle tego paska.
    loadRentalAlerts().catch(() => []),
    loadReportAlerts().catch(() => []),
    loadMissingEmailAlerts().catch(() => []),
  ]);
  // FV — jedna reguła (fv-check): zakończone z FV, bez podpiętej faktury.
  // Faktura z Fakturowni tego klienta / NIP z datą w trakcie wynajmu =
  // „prawdopodobnie wystawiona” → „FV do podpięcia”, nie „do wystawienia”.
  const fvIssue: QueueItem[] = [];
  const fvLink: QueueItem[] = [];
  for (const x of fv) {
    const base = { rentalId: x.rentalId, title: x.title, startsAt: x.startsAt, device: x.deviceName };
    const sure = x.suggestions.find((sg) => sg.reasons.includes("data w trakcie wynajmu"));
    if (sure) {
      const differs = sure.reasons.some((r) => r.startsWith("kwota ≠"));
      fvLink.push({
        ...base,
        note: `${x.clientName} · prawdopodobnie wystawiona: ${sure.number}, ${Number(sure.totalGross).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł brutto${differs ? " · kwota inna niż „Na FV”" : ""}`,
        link: { invoiceId: sure.id, number: sure.number, amount: sure.totalGross, amountDiffers: differs },
      });
    } else fvIssue.push({ ...base, note: `${x.clientName} · ${x.daysSinceEnd} dni po wynajmie${x.suggestions[0] ? ` · może ${x.suggestions[0].number}?` : ""}` });
  }

  const amounts: QueueItem[] = [];
  const tomorrowItems: QueueItem[] = [];
  // Wniosek 28: klient bez transportu ustalonego — jedna pozycja na klienta
  // (najbliższa rezerwacja), dopóki biuro nie wpisze kwoty na karcie.
  const transportItems: QueueItem[] = [];
  const transportSeen = new Set<string>();
  for (const r of future) {
    if (r.client && r.client.transportPriceNet == null && r.clientId && !transportSeen.has(r.clientId)) {
      transportSeen.add(r.clientId);
      transportItems.push({ rentalId: r.id, title: r.title, startsAt: r.startsAt.toISOString(), device: r.device.name, note: `${r.client.shortName ?? r.client.name}: transport do zatwierdzenia` });
    }
    const f = r.finance;
    const variants = Array.isArray(r.device.variantOptions) ? (r.device.variantOptions as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const issues = rentalIssues({
      eventType: r.eventType,
      clientId: r.clientId,
      variantOptions: variants,
      finance: f
        ? {
            deviceVariant: f.deviceVariant,
            totalNet: num(f.totalNet) ?? 0,
            baseNet: num(f.baseRentalPriceNet) ?? 0,
            pulseNet: num(f.pulseSurchargeNet),
            transportNet: num(f.transportPriceNet),
            transportSeparate: f.transportPaidSeparately,
            capUsed: f.capUsedHS,
            capCount: f.capCountHS,
            capFee: num(f.capFeeNet),
            membraneUsed: f.membraneUsed,
            membraneCount: f.membraneCount,
            membraneFee: num(f.membraneFeeNet),
          }
        : null,
    });
    if (issues.length) amounts.push({ rentalId: r.id, title: r.title, startsAt: r.startsAt.toISOString(), device: r.device.name, note: issues.join(" · ") });
    // Wydania na jutro (w piątek do poniedziałku) bez adresu dostawy albo godziny.
    if (r.startsAt >= release.from && r.startsAt < release.to) {
      const missing = [!r.deliveryAddressId && !r.deliveryAddress?.trim() ? "brak adresu" : null, !r.deliveryTime ? "brak godziny" : null].filter(Boolean);
      if (missing.length) tomorrowItems.push({ rentalId: r.id, title: r.title, startsAt: r.startsAt.toISOString(), device: r.device.name, note: missing.join(" · ") });
    }
  }
  const split = (items: QueueItem[]) => ({
    items: items.filter((i) => new Date(i.startsAt) < horizonEnd),
    later: items.filter((i) => new Date(i.startsAt) >= horizonEnd),
    horizon: horizonEnd.toISOString(),
  });
  return [
    {
      key: "unassigned",
      label: "Bez klienta",
      ...split(unassigned.map((u) => ({ rentalId: u.id, title: u.title, startsAt: u.startsAt, device: u.deviceName, note: u.candidates[0] ? `kandydat: ${u.candidates[0].shortName ?? u.candidates[0].name} (${u.candidates[0].reason})` : "brak kandydata" }))),
    },
    { key: "amounts", label: "Kwota / wariant", ...split(amounts) },
    { key: "transport", label: "Transport do zatwierdzenia", ...split(transportItems) },
    {
      key: "driver",
      label: "Kierowca / telefon",
      // „brak kontaktu” = kafel „Bez klienta”; tu tylko kierowca i telefon (10 dni).
      items: rentalAlerts
        .filter((a) => a.missing.includes("driver") || a.missing.includes("phone"))
        .map((a) => ({ rentalId: a.id, title: a.title, startsAt: a.startsAt, device: a.deviceName, note: a.missing.filter((m) => m !== "contact").map((m) => ALERT_FIELD_LABEL[m]).join(" · ") })),
    },
    { key: "tomorrow", label: today.getDay() === 5 ? "Wydania sob.–pon." : "Wydania jutro", items: tomorrowItems },
    {
      key: "report",
      label: "Raport kierowcy",
      items: reportAlerts.map((a) => ({ rentalId: a.id, title: a.title, startsAt: a.startsAt, device: a.deviceName, note: a.missing.map((m) => REPORT_FIELD_LABEL[m]).join(" · ") })),
    },
    { key: "invoices", label: "FV do wystawienia", items: fvIssue },
    { key: "invoiceLink", label: "FV do podpięcia", items: fvLink },
    {
      key: "email",
      label: "Brak e-maila",
      items: emailAlerts.map((a) => ({ rentalId: a.id, title: a.title, startsAt: a.endsAt, device: a.deviceName, note: `${a.contactName ?? "kontakt"} bez e-maila — szkic FV / przypomnienie` })),
    },
  ];
}

// Licznik w menu (wniosek 34): tylko pilne — wydania bez adresu / godziny,
// sprawy z terminem ≤ 7 dni i FV do wystawienia.
export async function countCalendarQueues(now = new Date()): Promise<number> {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const urgentEnd = new Date(today.getTime() + (NAV_URGENT_DAYS + 1) * 86_400_000);
  return (await loadCalendarQueues(now)).reduce(
    (s, q) =>
      s +
      (q.key === "tomorrow" || q.key === "invoices"
        ? q.items.length
        : q.key === "report" || q.key === "invoiceLink" || q.key === "email"
          ? 0
          : q.items.filter((i) => new Date(i.startsAt) < urgentEnd).length),
    0,
  );
}
