import { requireAdmin } from "@/lib/auth-guards";
import { loadRevenueRows } from "@/lib/revenue/load";
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

  const [rows, cmpRows] = await Promise.all([
    loadRevenueRows(period),
    cmp ? loadRevenueRows(cmp) : Promise.resolve(null),
  ]);

  const cmpKpis = cmpRows ? computeKpis(cmpRows) : null;

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
