// Zakładka „Wynajmy i faktury” (prompt 3B-karta, 2.2): jeden wiersz na
// wynajem z dołączoną fakturą; faktura bez wynajmu = osobny wiersz. Plus
// wskaźniki „W skrócie” na Przeglądzie. Czyste funkcje bez zależności.
import { invoicePaymentStatus, isUnpaid, rentalWithoutInvoiceStatus, type PaymentStatus } from "./payment-status";

export type TxRental = {
  id: string; // Rental.id albo RentalHistory.id
  source: "panel" | "kalendarz";
  startsAt: Date;
  deviceName: string;
  details: string | null; // „2 dni · 2 głowice”, „1 dzień + transport”
  totalNet: number | null; // z rozliczenia wynajmu w panelu
  fakturowniaInvoiceId: number | null; // RentalFinance.fakturowniaInvoiceId
  cashConfirmed: boolean; // gotówka odebrana (RentalFinance: CASH + confirmedAt)
};

export type TxInvoice = {
  id: string; // ClientInvoice.id
  fakturowniaInvoiceId: number;
  number: string;
  sellDate: Date;
  issueDate: Date;
  totalNet: number;
  paymentTo: Date | null;
  paymentType: string | null;
  paidAt: Date | null; // FakturowniaPayment.paidAt
  rentalId: string | null; // ClientInvoice.rentalId (faktura wynajmu z panelu)
  positions: string | null;
};

export type TxRow = {
  key: string;
  date: Date;
  source: "panel" | "kalendarz" | "faktura";
  rentalId: string | null; // tylko wynajmy z panelu — klik prowadzi do wynajmu
  title: string;
  details: string | null;
  net: number | null;
  invoice: { id: string; fakturowniaInvoiceId: number; number: string; issueDate: Date } | null;
  status: PaymentStatus;
};

const DAY = 86_400_000;
const WINDOW = 7 * DAY;

export function buildTransactions(rentals: TxRental[], invoices: TxInvoice[], today: Date): TxRow[] {
  const invByFakt = new Map(invoices.map((i) => [i.fakturowniaInvoiceId, i]));
  const used = new Set<string>();
  const attached = new Map<string, TxInvoice>(); // rental.id → faktura

  // 1) Faktura wystawiona z panelu dla wynajmu.
  for (const r of rentals) {
    const byRentalId = r.source === "panel" ? invoices.find((i) => i.rentalId === r.id && !used.has(i.id)) : undefined;
    const inv = byRentalId ?? (r.fakturowniaInvoiceId != null ? invByFakt.get(r.fakturowniaInvoiceId) : undefined);
    if (inv && !used.has(inv.id)) {
      attached.set(r.id, inv);
      used.add(inv.id);
    }
  }
  // 2) Pozostałe faktury → najbliższy wynajem bez faktury w ±7 dniach od daty sprzedaży.
  for (const inv of [...invoices].sort((a, b) => a.sellDate.getTime() - b.sellDate.getTime())) {
    if (used.has(inv.id) || inv.rentalId) continue;
    let best: TxRental | null = null;
    for (const r of rentals) {
      if (attached.has(r.id) || r.fakturowniaInvoiceId != null) continue;
      const dist = Math.abs(r.startsAt.getTime() - inv.sellDate.getTime());
      if (dist <= WINDOW && (!best || dist < Math.abs(best.startsAt.getTime() - inv.sellDate.getTime()))) best = r;
    }
    if (best) {
      attached.set(best.id, inv);
      used.add(inv.id);
    }
  }

  const invStatus = (inv: TxInvoice, cash: boolean) =>
    invoicePaymentStatus({ paidAt: inv.paidAt, paymentType: inv.paymentType, paymentTo: inv.paymentTo, cashConfirmed: cash }, today);

  const rows: TxRow[] = rentals.map((r) => {
    const inv = attached.get(r.id) ?? null;
    return {
      key: `r-${r.id}`,
      date: r.startsAt,
      source: r.source,
      rentalId: r.source === "panel" ? r.id : null,
      title: r.deviceName,
      details: r.details,
      net: inv ? inv.totalNet : r.totalNet,
      invoice: inv ? { id: inv.id, fakturowniaInvoiceId: inv.fakturowniaInvoiceId, number: inv.number, issueDate: inv.issueDate } : null,
      status: inv ? invStatus(inv, r.cashConfirmed) : rentalWithoutInvoiceStatus(r, today),
    };
  });
  for (const inv of invoices) {
    if (used.has(inv.id)) continue;
    rows.push({
      key: `i-${inv.id}`,
      date: inv.sellDate,
      source: "faktura",
      rentalId: null,
      title: inv.positions?.split(";")[0]?.trim() || "Faktura",
      details: null,
      net: inv.totalNet,
      invoice: { id: inv.id, fakturowniaInvoiceId: inv.fakturowniaInvoiceId, number: inv.number, issueDate: inv.issueDate },
      status: invStatus(inv, false),
    });
  }
  return rows.sort((a, b) => b.date.getTime() - a.date.getTime());
}

export type TxTotals = {
  year: number;
  invoicedNet: number;
  invoicedCount: number;
  paidNet: number;
  paidCount: number;
  overdueNet: number;
  overdueCount: number;
  oldestOverdue: { number: string; days: number } | null;
  dueNet: number; // oczekuje + po terminie
  dueCount: number;
  withoutInvoice: number;
  withoutInvoiceAllCalendar: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function transactionTotals(rows: TxRow[], today: Date): TxTotals {
  const year = today.getFullYear();
  const withInv = rows.filter((r) => r.invoice);
  const thisYear = withInv.filter((r) => r.invoice!.issueDate.getFullYear() === year);
  const paid = withInv.filter((r) => r.status.kind === "ZAPLACONA" || r.status.kind === "GOTOWKA");
  const overdue = withInv.filter((r) => r.status.kind === "PO_TERMINIE");
  const due = withInv.filter((r) => isUnpaid(r.status));
  const oldest = [...overdue].sort((a, b) => (b.status.kind === "PO_TERMINIE" ? b.status.days : 0) - (a.status.kind === "PO_TERMINIE" ? a.status.days : 0))[0];
  const noInvoice = rows.filter((r) => r.status.kind === "BEZ_FAKTURY");
  return {
    year,
    invoicedNet: round2(thisYear.reduce((s, r) => s + (r.net ?? 0), 0)),
    invoicedCount: thisYear.length,
    paidNet: round2(paid.reduce((s, r) => s + (r.net ?? 0), 0)),
    paidCount: paid.length,
    overdueNet: round2(overdue.reduce((s, r) => s + (r.net ?? 0), 0)),
    overdueCount: overdue.length,
    oldestOverdue: oldest && oldest.status.kind === "PO_TERMINIE" ? { number: oldest.invoice!.number, days: oldest.status.days } : null,
    dueNet: round2(due.reduce((s, r) => s + (r.net ?? 0), 0)),
    dueCount: due.length,
    withoutInvoice: noInvoice.length,
    withoutInvoiceAllCalendar: noInvoice.length > 0 && noInvoice.every((r) => r.source === "kalendarz"),
  };
}

// Mediana odstępu między wynajmami (dni) — gdy są co najmniej 3 wynajmy.
export function rentalRhythmDays(dates: Date[]): number | null {
  if (dates.length < 3) return null;
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const gaps = sorted.slice(1).map((d, i) => (d.getTime() - sorted[i].getTime()) / DAY).sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return Math.round(gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2);
}

export function rhythmLabel(days: number): string {
  if (days < 10) return `co ok. ${days} dni`;
  if (days < 60) return `co ok. ${Math.round(days / 7)} ${Math.round(days / 7) < 5 ? "tygodnie" : "tygodni"}`;
  const m = Math.round(days / 30.4);
  return `co ok. ${m} ${m < 5 ? "miesiące" : "miesięcy"}`;
}

// Typowa forma płatności: z faktur (przelew / gotówka) + czy zwykle w terminie.
export function typicalPayment(rows: TxRow[]): string | null {
  const inv = rows.filter((r) => r.invoice || r.status.kind === "GOTOWKA");
  if (inv.length === 0) return null;
  const cash = inv.filter((r) => r.status.kind === "GOTOWKA").length;
  if (cash > inv.length / 2) return "gotówka";
  const paid = inv.filter((r) => r.status.kind === "ZAPLACONA");
  const overdue = inv.filter((r) => r.status.kind === "PO_TERMINIE").length;
  if (paid.length === 0) return overdue ? "przelew, zaległości" : "przelew";
  return overdue > paid.length / 3 ? "przelew, bywa po terminie" : "przelew, zwykle w terminie";
}
