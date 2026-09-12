import { requireAdmin } from "@/lib/auth-guards";
import { comparisonLabel, comparisonPeriod, isoDate, periodFromParams } from "@/lib/revenue/period";
import { loadRevenueRows } from "@/lib/revenue/load";
import { round2 as _round2 } from "@/lib/costs/calc";
import {
  loadCostsInPeriod,
  loadDevicePulseInputs,
  loadDriverLaborInputs,
  loadMonthlyCostData,
  loadRentalFuelInputs,
} from "@/lib/costs/dashboard-load";
import {
  biggestIncreaseInsight,
  categoryRanking,
  deviceBreakdown,
  driverBreakdown,
  last6MonthsEnding,
  sumCostsByScope,
  totalFuelCost,
  vehicleBreakdown,
  withDominantEntryNote,
  type CostEntry,
  type MonthlyCostPoint,
} from "@/lib/costs/dashboard-aggregate";
import { CostsDashboard } from "@/components/costs-dashboard";

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const period = periodFromParams(sp);
  const cmp = comparisonPeriod(period);

  const [costs, fuelInputs, pulseInputs, driverInputs, revenueRows, cmpCosts, cmpFuelInputs] = await Promise.all([
    loadCostsInPeriod(period),
    loadRentalFuelInputs(period),
    loadDevicePulseInputs(period),
    loadDriverLaborInputs(period),
    loadRevenueRows(period),
    cmp ? loadCostsInPeriod(cmp) : Promise.resolve<CostEntry[]>([]),
    cmp ? loadRentalFuelInputs(cmp) : Promise.resolve([]),
  ]);

  const scopeTotals = sumCostsByScope(costs);
  const fuelTotal = totalFuelCost(fuelInputs);
  const vehicleTotal = _round2(scopeTotals.vehicle + fuelTotal);
  const totalAll = _round2(scopeTotals.general + vehicleTotal + scopeTotals.device);

  const rentalCount = revenueRows.length;
  const costPerRental = rentalCount > 0 ? _round2(totalAll / rentalCount) : null;

  let trendValue: number | null = null;
  if (cmp) {
    const cmpScope = sumCostsByScope(cmpCosts);
    const cmpFuel = totalFuelCost(cmpFuelInputs);
    const cmpTotal = _round2(cmpScope.general + _round2(cmpScope.vehicle + cmpFuel) + cmpScope.device);
    trendValue = cmpTotal === 0 ? null : _round2(((totalAll - cmpTotal) / cmpTotal) * 100);
  }

  // ---- trend 6-miesięczny (sekcja 4.2) — kończy się na miesiącu, w którym
  // leży KONIEC wybranego okresu (spójnie dla Miesiąc/Zakres/Sezon: dla
  // Miesiąc i Sezon period.end i tak wypada w "ostatnim" miesiącu). ----
  const refYear = period.end.getFullYear();
  const refMonth = period.end.getMonth() + 1;
  const months = last6MonthsEnding(refYear, refMonth);
  const monthlyData = await Promise.all(months.map((m) => loadMonthlyCostData(m.year, m.month)));

  const points: MonthlyCostPoint[] = monthlyData.map(({ costs: mCosts, fuelInputs: mFuel }, idx) => {
    const scope = sumCostsByScope(mCosts);
    const fuel = totalFuelCost(mFuel);
    const vehicle = _round2(scope.vehicle + fuel);
    const total = _round2(scope.general + vehicle + scope.device);
    return {
      key: `${months[idx].year}-${String(months[idx].month).padStart(2, "0")}`,
      label: months[idx].label,
      general: scope.general,
      vehicle,
      device: scope.device,
      total,
      isCurrent: months[idx].year === refYear && months[idx].month === refMonth,
    };
  });

  let insight = biggestIncreaseInsight(points);
  if (insight) {
    const peakIdx = points.findIndex((p) => p.label === insight!.monthLabel);
    const scopeKey = insight.segmentLabel === "Ogólne" ? "GENERAL" : insight.segmentLabel === "Urządzenia" ? "DEVICE" : null;
    if (peakIdx >= 0 && scopeKey) {
      const peakCosts = monthlyData[peakIdx].costs.filter((c) => c.scope === scopeKey);
      insight = withDominantEntryNote(insight, peakCosts);
    }
  }

  const vehicles = vehicleBreakdown(costs, fuelInputs);
  const devices = deviceBreakdown(costs, pulseInputs);
  const drivers = driverBreakdown(driverInputs);
  const categories = categoryRanking(costs, fuelTotal);

  return (
    <CostsDashboard
      period={{
        mode: period.mode,
        label: period.label,
        start: isoDate(period.start),
        end: isoDate(period.end),
      }}
      kpis={{
        totalAll,
        general: scopeTotals.general,
        vehicle: vehicleTotal,
        device: scopeTotals.device,
        costPerRental,
        rentalCount,
      }}
      trend={cmp ? { value: trendValue, label: comparisonLabel(period) } : null}
      months={points}
      insight={insight}
      categories={categories}
      vehicles={vehicles}
      devices={devices}
      drivers={drivers}
    />
  );
}
