// Ostrzeżenia "brak faktury" — wynajmy zakończone, z doliczonym VAT
// (vatApplicable), dla których nie wystawiono jeszcze faktury w Fakturowni
// (RentalFinance.fakturowniaInvoiceId wciąż null). Moduł client-safe (bez
// Prismy) — reguła reużywana zarówno przez kafelki siatki kalendarza
// (calendar-view.tsx, liczone z danych już załadowanych do widoku) jak i
// przez serwerowy GET /api/rentals/invoice-alerts (src/lib/invoice-alerts-load.ts).
import { pluralWynajem } from "@/lib/rental-alerts";

export { pluralWynajem };

// Ten sam próg dolny co "brak raportu kierowcy" (src/lib/report-alerts.ts)
// — obie funkcje (raportowanie i fakturowanie) wystartowały w tej samej
// sesji, więc nie ma sensu osobno dozować "świeżego tygodnia zaległości".
export { REPORT_ALERT_SINCE as INVOICE_ALERT_SINCE } from "@/lib/report-alerts";

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
// "none" = wynajem się nie skończył, albo VAT niedoliczony (nie dotyczy).
export function rentalInvoiceStatus(rental: {
  endsAt: string;
  finance?: { vatApplicable: boolean; fakturowniaInvoiceId: number | null } | null;
}): InvoiceStatus {
  if (new Date(rental.endsAt) > new Date()) return "none";
  if (!rental.finance?.vatApplicable) return "none";
  return rental.finance.fakturowniaInvoiceId ? "issued" : "needed";
}
