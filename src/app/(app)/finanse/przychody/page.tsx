import { requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { loadNewClientIds, loadRevenueRows, loadUnpricedRentals } from "@/lib/revenue/load";
import { computeKpis } from "@/lib/revenue/aggregate";
import {
  comparisonLabel,
  comparisonPeriod,
  isoDate,
  periodFromParams,
} from "@/lib/revenue/period";
import { RevenueDashboard } from "@/components/revenue-dashboard";

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  const period = periodFromParams(sp);
  const cmp = comparisonPeriod(period);

  const [rows, cmpRows, devices, unpriced] = await Promise.all([
    loadRevenueRows(period),
    cmp ? loadRevenueRows(cmp) : Promise.resolve(null),
    prisma.device.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    loadUnpricedRentals(period),
  ]);

  const cmpKpis = cmpRows ? computeKpis(cmpRows) : null;

  const contactIds = [...new Set(rows.map((r) => r.hubspotContactId).filter((v): v is string => v !== null))];
  const newClientIds = [...(await loadNewClientIds(contactIds, period.start))];

  return (
    <RevenueDashboard
      period={{
        mode: period.mode,
        label: period.label,
        dayCount: period.dayCount,
        start: isoDate(period.start),
        end: isoDate(period.end),
      }}
      rows={rows}
      deviceList={devices}
      unpriced={unpriced}
      newClientIds={newClientIds}
      comparison={
        cmpKpis
          ? {
              label: comparisonLabel(period),
              revenueNet: cmpKpis.revenueNet,
              rentalCount: cmpKpis.rentalCount,
              avgValue: cmpKpis.avgValue,
            }
          : null
      }
    />
  );
}
