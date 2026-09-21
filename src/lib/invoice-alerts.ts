// Ostrzeżenia "brak faktury" — wynajmy zakończone, z doliczonym VAT
// (vatApplicable), dla których nie wystawiono jeszcze faktury w Fakturowni
// (RentalFinance.fakturowniaInvoiceId wciąż null). Moduł client-safe (bez
// Prismy) — reguła reużywana zarówno przez kafelki siatki kalendarza
// (calendar-view.tsx, liczone z danych już załadowanych do widoku) jak i
// przez serwerowy GET /api/rentals/invoice-alerts (src/lib/invoice-alerts-load.ts).
import { pluralWynajem } from "@/lib/rental-alerts";

export { pluralWynajem };

// WŁASNY próg dolny, inny niż "brak raportu kierowcy" (REPORT_ALERT_SINCE) —
// ustalony z użytkownikiem: faktury sprzed 18.09 były wystawiane ręcznie w
// Fakturowni, z pominięciem tej apki, więc nie mają i nigdy nie będą mieć
// fakturowniaInvoiceId — oznaczanie ich jako "brak faktury" byłoby fałszywym
// alarmem. Wynajmy kończące się wcześniej niż ta data w ogóle nie dostają
// statusu faktury (patrz rentalInvoiceStatus niżej), nie tylko są pomijane
// w powiadomieniach.
export const INVOICE_ALERT_SINCE = new Date("2026-09-18T00:00:00.000Z");

export type InvoiceAlert = {
  id: string;
  title: string;
  endsAt: string; // ISO
  deviceName: string;
  deviceColor: string;
  amount: string; // kwota do zafakturowania (netto/brutto wg vatApplicable), sformatowana
};

export type InvoiceStatus = "none" | "needed" | "issued";

// Status faktury KONKRETNEGO wynajmu — używane przez kafelki kalendarza.
// "none" = wynajem się nie skończył, kończy się przed INVOICE_ALERT_SINCE,
// albo VAT niedoliczony (nie dotyczy).
export function rentalInvoiceStatus(rental: {
  endsAt: string;
  finance?: { vatApplicable: boolean; fakturowniaInvoiceId: number | null } | null;
}): InvoiceStatus {
  const endsAt = new Date(rental.endsAt);
  if (endsAt > new Date()) return "none";
  if (endsAt < INVOICE_ALERT_SINCE) return "none";
  if (!rental.finance?.vatApplicable) return "none";
  return rental.finance.fakturowniaInvoiceId ? "issued" : "needed";
}
