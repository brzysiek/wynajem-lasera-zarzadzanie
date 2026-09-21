// Ostrzeżenia "brak raportu kierowcy" — wynajmy/szkolenia, które się już
// zakończyły, ale kierowca nie zapisał w panelu żadnych danych rozliczenia
// (RentalFinance.cashCollected wciąż null) albo brakuje liczników impulsów
// tam, gdzie są wymagane. Moduł client-safe (bez Prismy) — reguła jest
// reużywana zarówno przez kafelki siatki kalendarza (calendar-view.tsx,
// liczone z danych już załadowanych do widoku) jak i przez serwerowy
// GET /api/rentals/report-alerts (src/lib/report-alerts-load.ts).
import type { DevicePricingCategory, RentalEventType } from "@prisma/client";
import { FLEX_VARIANT } from "@/lib/pricing/variants";
import { pluralWynajem } from "@/lib/rental-alerts";

export { pluralWynajem };

// Stały próg dolny — na starcie funkcji celowo ograniczony do świeżego
// tygodnia zaległości (ustalone z użytkownikiem), żeby lista od razu nie
// wypełniła się historycznymi wynajmami sprzed wdrożenia modułu finansowego.
// Od tej daty w przód reguła NIE ma już żadnego rolling-window — jeśli coś
// zostanie niezaraportowane dłużej, ma to zostać widoczne (to sygnał, że
// proces nie działa, a nie coś do automatycznego wygaszenia).
export const REPORT_ALERT_SINCE = new Date("2026-09-14T00:00:00.000Z");

export type ReportGapField = "cash" | "counters";

export const REPORT_FIELD_LABEL: Record<ReportGapField, string> = {
  cash: "brak informacji o płatności",
  counters: "brak liczników impulsów",
};

export const REPORT_FIELD_SHORT: Record<ReportGapField, string> = {
  cash: "płatność",
  counters: "liczniki",
};

export const REPORT_FIELD_ORDER: ReportGapField[] = ["cash", "counters"];

export type ReportAlert = {
  id: string;
  title: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  deviceName: string;
  deviceColor: string;
  eventType: RentalEventType;
  missing: ReportGapField[];
};

// Czy dane wariantu/kategorii wymagają liczników impulsów (LightSheer flex
// albo Alma Harmony) — dokładnie ta sama reguła co `needsCounters` w
// driver-finance-panel.tsx, wydzielona żeby dało się jej użyć też tu.
function needsPulseCounters(
  pricingCategory: DevicePricingCategory | null,
  deviceVariant: string | null,
  eventType: RentalEventType | undefined,
): boolean {
  if (eventType === "SZKOLENIE") return false;
  const isFlex = pricingCategory === "LIGHTSHEER_VARIANT" && deviceVariant === FLEX_VARIANT;
  const isAlma = pricingCategory === "ALMA_HARMONY";
  return isFlex || isAlma;
}

export type ReportGapInput = {
  eventType: RentalEventType | undefined;
  pricingCategory: DevicePricingCategory | null;
  finance: {
    deviceVariant: string | null;
    cashCollected: boolean | null;
    pulseCounterStart: number | null;
    pulseCounterEnd: number | null;
  } | null;
};

// Braki w rozliczeniu KONKRETNEGO wynajmu — niezależne od tego, czy się już
// zakończył (to sprawdza wywołujący, patrz `rentalNeedsReport` niżej).
export function computeReportGaps(input: ReportGapInput): ReportGapField[] {
  const gaps: ReportGapField[] = [];
  if (!input.finance || input.finance.cashCollected === null) gaps.push("cash");
  if (
    needsPulseCounters(input.pricingCategory, input.finance?.deviceVariant ?? null, input.eventType) &&
    (input.finance?.pulseCounterStart == null || input.finance?.pulseCounterEnd == null)
  ) {
    gaps.push("counters");
  }
  return gaps;
}

// Używane przez kafelki kalendarza: true = wynajem się skończył i ma
// przynajmniej jeden brak. Bez okna czasowego (REPORT_ALERT_SINCE dotyczy
// tylko globalnego zapytania serwerowego dla panelu powiadomień) — siatka i
// tak pokazuje tylko wynajmy z widocznego zakresu dat.
export function rentalNeedsReport(rental: {
  endsAt: string;
  eventType?: RentalEventType;
  device: { pricingCategory?: DevicePricingCategory | null };
  finance?: ReportGapInput["finance"];
}): boolean {
  if (new Date(rental.endsAt) > new Date()) return false;
  const gaps = computeReportGaps({
    eventType: rental.eventType,
    pricingCategory: rental.device.pricingCategory ?? null,
    finance: rental.finance ?? null,
  });
  return gaps.length > 0;
}
