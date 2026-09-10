// Serwerowe ładowanie danych dla dashboardu przychodów. Zwraca
// znormalizowane wiersze (RevenueRow) do dalszej agregacji po stronie
// klienta / serwera.
import { prisma } from "@/lib/prisma";
import { rentalDurationDays } from "@/lib/pricing/duration";
import type { RevenueRow } from "@/lib/revenue/aggregate";
import type { Period } from "@/lib/revenue/period";

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
