// Serwerowe ładowanie danych dla dashboardu przychodów. Zwraca
// znormalizowane wiersze (RevenueRow) do dalszej agregacji po stronie
// klienta / serwera.
import { prisma } from "@/lib/prisma";
import { rentalDurationDays } from "@/lib/pricing/duration";
import type { RevenueRow } from "@/lib/revenue/aggregate";
import type { Period } from "@/lib/revenue/period";

// YYYY-MM-DD wg lokalnych składowych daty (serwer działa w Europe/Warsaw —
// tak samo jak rentalDurationDays / reszta aplikacji).
function localDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Wydarzenia przypisane do okresu wg Rental.startsAt (sekcja 2). Warunki:
//  - nie usunięte w Google (deletedInGoogle = false)
//  - mają rekord RentalFinance z jakąkolwiek wartością totalNet
//  - eventType WYNAJEM lub SZKOLENIE (oba to przychód)
// Nie filtrujemy po baseRentalPriceSource / pulseCalculationStatus — wartości
// tymczasowe też liczymy, tylko sygnalizujemy (sekcja 10).
export async function loadRevenueRows(period: Period): Promise<RevenueRow[]> {
  const rentals = await prisma.rental.findMany({
    where: {
      deletedInGoogle: false,
      startsAt: { gte: period.start, lte: period.end },
      finance: { isNot: null },
    },
    select: {
      id: true,
      eventType: true,
      deviceId: true,
      startsAt: true,
      endsAt: true,
      hubspotContactId: true,
      contactNameCache: true,
      contactCompanyCache: true,
      device: { select: { name: true } },
      finance: {
        select: {
          totalNet: true,
          paymentMethod: true,
          pulseCalculationStatus: true,
        },
      },
    },
  });

  const rows: RevenueRow[] = [];
  for (const r of rentals) {
    if (!r.finance) continue;
    rows.push({
      id: r.id,
      eventType: r.eventType === "SZKOLENIE" ? "SZKOLENIE" : "WYNAJEM",
      deviceId: r.deviceId,
      deviceName: r.device.name,
      startsAt: r.startsAt.toISOString(),
      startDate: localDateKey(r.startsAt),
      endDate: localDateKey(r.endsAt),
      durationDays: rentalDurationDays(r.startsAt, r.endsAt),
      totalNet: Number(r.finance.totalNet),
      paymentMethod: r.finance.paymentMethod === "CASH" ? "CASH" : "TRANSFER",
      pulsePending: r.finance.pulseCalculationStatus === "PENDING",
      hubspotContactId: r.hubspotContactId,
      contactLabel: r.contactCompanyCache?.trim() || r.contactNameCache?.trim() || null,
    });
  }
  return rows;
}

// Odznaka „Nowy" (sekcja 12): klient jest nowy w okresie, jeśli jego
// NAJWCZEŚNIEJSZY wynajem w całej historii ma startsAt >= początek okresu
// (czyli nie ma żadnego wcześniejszego). Liczone na żywo, nie flaga w bazie.
export async function loadNewClientIds(
  contactIds: string[],
  periodStart: Date,
): Promise<Set<string>> {
  if (contactIds.length === 0) return new Set();
  const grouped = await prisma.rental.groupBy({
    by: ["hubspotContactId"],
    where: { hubspotContactId: { in: contactIds }, deletedInGoogle: false },
    _min: { startsAt: true },
  });
  const isNew = new Set<string>();
  for (const g of grouped) {
    if (g.hubspotContactId && g._min.startsAt && g._min.startsAt >= periodStart) {
      isNew.add(g.hubspotContactId);
    }
  }
  return isNew;
}
