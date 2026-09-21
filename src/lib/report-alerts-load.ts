import { prisma } from "@/lib/prisma";
import { REPORT_ALERT_SINCE, computeReportGaps, type ReportAlert } from "@/lib/report-alerts";

// Serwerowa (Prisma) część modelu "brak raportu kierowcy" — src/lib/report-alerts.ts
// ma tylko typy/regułę i jest client-safe. Odpytywane przez
// GET /api/rentals/report-alerts (pasek ikon — notifications-context.tsx).
export async function loadReportAlerts(): Promise<ReportAlert[]> {
  const now = new Date();

  const rows = await prisma.rental.findMany({
    where: {
      deletedInGoogle: false,
      endsAt: { lte: now, gte: REPORT_ALERT_SINCE },
    },
    orderBy: { endsAt: "desc" },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      eventType: true,
      device: { select: { name: true, color: true, pricingCategory: true } },
      finance: {
        select: { deviceVariant: true, cashCollected: true, pulseCounterStart: true, pulseCounterEnd: true },
      },
    },
  });

  return rows
    .map((r): ReportAlert => ({
      id: r.id,
      title: r.title,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      deviceName: r.device.name,
      deviceColor: r.device.color,
      eventType: r.eventType,
      missing: computeReportGaps({
        eventType: r.eventType,
        pricingCategory: r.device.pricingCategory,
        finance: r.finance,
      }),
    }))
    .filter((a) => a.missing.length > 0);
}
