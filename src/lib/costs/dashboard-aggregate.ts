// Agregacje dla dashboardu kosztów (/finanse/koszty, docs/prompt-claude-code-dashboard-kosztow.md
// sekcja 4). Czyste funkcje na plain data — Prisma zostaje w dashboard-load.ts,
// tak samo jak w module przychodów (src/lib/revenue/aggregate.ts + load.ts).

import { round2, fuelCostForRental, driverCostForRental, costPerPulse, costPerKm } from "./calc";

export type CostScope = "GENERAL" | "VEHICLE" | "DEVICE";

const MONTH_LABELS_SHORT = [
  "Sty", "Lut", "Mar", "Kwi", "Maj", "Cze",
  "Lip", "Sie", "Wrz", "Paź", "Lis", "Gru",
];

// Sekcja 4.2 — 6 miesięcy kończących się na (year, month), NIE zawsze na
// "dziś": tryb Miesiąc -> wybrany miesiąc, Sezon -> sierpień sezonu, Zakres
// -> miesiąc zawierający koniec zakresu (ustala wywołujący, patrz page.tsx).
export function last6MonthsEnding(year: number, month1to12: number): { year: number; month: number; label: string }[] {
  const out: { year: number; month: number; label: string }[] = [];
  let y = year;
  let m = month1to12;
  for (let i = 0; i < 6; i++) {
    out.unshift({ year: y, month: m, label: MONTH_LABELS_SHORT[m - 1] });
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

// "Wymiana lampy/elementu zużywalnego" — jedyna kategoria licząca się do
// kosztu na impuls (sekcja 3.3). Nazwa musi się zgadzać z seedem migracji.
export const LAMP_CATEGORY_NAME = "Wymiana lampy/elementu zużywalnego";

export type CostEntry = {
  id: string;
  amount: number; // netto
  date: string; // YYYY-MM-DD
  scope: CostScope;
  categoryId: string;
  categoryName: string;
  description: string | null;
  deviceId: string | null;
  deviceName: string | null;
  vehicleId: string | null;
  vehicleName: string | null;
};

// Jeden wynajem z przypisanym pojazdem w okresie — wejście do kosztu paliwa
// (sekcja 3.1) i sumy km per pojazd.
export type RentalFuelInput = {
  vehicleId: string;
  vehicleName: string;
  distanceKm: number | null; // Rental.contactDistanceKm
  fuelCostPerKm: number | null; // Vehicle.fuelCostPerKm
};

// Jeden wynajem z licznikami impulsów w okresie — wejście do kosztu na
// impuls (sekcja 3.3).
export type DevicePulseInput = {
  deviceId: string;
  deviceName: string;
  pulseCounterStart: number | null;
  pulseCounterEnd: number | null;
};

// Jeden wynajem z czasem kierowcy w okresie — wejście do kosztu pracy
// (sekcja 3.2). UWAGA BEZPIECZEŃSTWA: wołać tylko w kontekstach ADMIN,
// hourlyRate nigdy nie może trafić do roli KIEROWCA (schema.prisma, User.hourlyRate).
export type DriverLaborInput = {
  driverId: string;
  driverName: string;
  hourlyRate: number | null;
  deliveryMinutes: number | null;
  pickupMinutes: number | null;
};

export type ScopeTotals = { general: number; vehicle: number; device: number };

export function sumCostsByScope(costs: CostEntry[]): ScopeTotals {
  let general = 0;
  let vehicle = 0;
  let device = 0;
  for (const c of costs) {
    if (c.scope === "GENERAL") general += c.amount;
    else if (c.scope === "VEHICLE") vehicle += c.amount;
    else device += c.amount;
  }
  return { general: round2(general), vehicle: round2(vehicle), device: round2(device) };
}

// Suma kosztu paliwa (sekcja 3.1) — wynajmy z brakującymi danymi po prostu
// nie wnoszą wkładu (nie zerują całej sumy, nie blokują reszty).
export function totalFuelCost(inputs: RentalFuelInput[]): number {
  let sum = 0;
  for (const i of inputs) {
    const c = fuelCostForRental(i.distanceKm, i.fuelCostPerKm);
    if (c != null) sum += c;
  }
  return round2(sum);
}

export type VehicleRow = {
  vehicleId: string;
  vehicleName: string;
  fuelNet: number;
  otherNet: number;
  totalNet: number;
  totalKm: number;
  costPerKmValue: number | null;
  rentalCount: number;
};

// Zakładka Pojazdy (sekcja 4.3) — paliwo (auto) + inne Cost (scope=VEHICLE) +
// koszt/km. Wiersze bez żadnych kosztów/km w okresie pomijane (spójnie z
// resztą aplikacji — nie pokazujemy wierszy zerowych).
export function vehicleBreakdown(costs: CostEntry[], fuelInputs: RentalFuelInput[]): VehicleRow[] {
  const map = new Map<string, VehicleRow>();
  const ensure = (id: string, name: string): VehicleRow => {
    let row = map.get(id);
    if (!row) {
      row = { vehicleId: id, vehicleName: name, fuelNet: 0, otherNet: 0, totalNet: 0, totalKm: 0, costPerKmValue: null, rentalCount: 0 };
      map.set(id, row);
    }
    return row;
  };

  for (const i of fuelInputs) {
    const row = ensure(i.vehicleId, i.vehicleName);
    const fuel = fuelCostForRental(i.distanceKm, i.fuelCostPerKm);
    if (fuel != null) row.fuelNet = round2(row.fuelNet + fuel);
    if (i.distanceKm != null) row.totalKm = round2(row.totalKm + i.distanceKm);
    row.rentalCount += 1;
  }
  for (const c of costs) {
    if (c.scope !== "VEHICLE" || !c.vehicleId) continue;
    const row = ensure(c.vehicleId, c.vehicleName ?? "—");
    row.otherNet = round2(row.otherNet + c.amount);
  }
  for (const row of map.values()) {
    row.totalNet = round2(row.fuelNet + row.otherNet);
    row.costPerKmValue = costPerKm(row.fuelNet, row.otherNet, row.totalKm);
  }

  return [...map.values()]
    .filter((r) => r.fuelNet > 0 || r.otherNet > 0 || r.totalKm > 0)
    .sort((a, b) => b.totalNet - a.totalNet);
}

export type DeviceCostRow = {
  deviceId: string;
  deviceName: string;
  totalNet: number;
  pulses: number;
  costPerPulseValue: number | null;
};

// Zakładka Urządzenia (sekcja 4.3) — suma Cost (scope=DEVICE) + koszt na
// impuls z Cost kategorii "Wymiana lampy..." / suma impulsów w okresie.
export function deviceBreakdown(costs: CostEntry[], pulseInputs: DevicePulseInput[]): DeviceCostRow[] {
  const map = new Map<string, DeviceCostRow>();
  const lampSumByDevice = new Map<string, number>();
  const pulsesByDevice = new Map<string, number>();

  const ensure = (id: string, name: string): DeviceCostRow => {
    let row = map.get(id);
    if (!row) {
      row = { deviceId: id, deviceName: name, totalNet: 0, pulses: 0, costPerPulseValue: null };
      map.set(id, row);
    }
    return row;
  };

  for (const c of costs) {
    if (c.scope !== "DEVICE" || !c.deviceId) continue;
    const row = ensure(c.deviceId, c.deviceName ?? "—");
    row.totalNet = round2(row.totalNet + c.amount);
    if (c.categoryName === LAMP_CATEGORY_NAME) {
      lampSumByDevice.set(c.deviceId, round2((lampSumByDevice.get(c.deviceId) ?? 0) + c.amount));
    }
  }
  for (const p of pulseInputs) {
    if (p.pulseCounterStart == null || p.pulseCounterEnd == null) continue;
    const diff = p.pulseCounterEnd - p.pulseCounterStart;
    if (diff < 0) continue; // dane niespójne (koniec < start) — pomiń, nie psuj sumy
    ensure(p.deviceId, p.deviceName);
    pulsesByDevice.set(p.deviceId, (pulsesByDevice.get(p.deviceId) ?? 0) + diff);
  }
  for (const row of map.values()) {
    row.pulses = pulsesByDevice.get(row.deviceId) ?? 0;
    const lampSum = lampSumByDevice.get(row.deviceId) ?? 0;
    row.costPerPulseValue = costPerPulse(lampSum, row.pulses);
  }

  return [...map.values()]
    .filter((r) => r.totalNet > 0 || r.pulses > 0)
    .sort((a, b) => b.totalNet - a.totalNet);
}

export type DriverRow = {
  driverId: string;
  driverName: string;
  rentalCount: number;
  totalMinutes: number;
  laborCost: number | null; // null = brak stawki godzinowej (hourlyRate)
};

// Zakładka Kierowcy (sekcja 4.3) — TYLKO do wywołania w kontekstach ADMIN.
export function driverBreakdown(inputs: DriverLaborInput[]): DriverRow[] {
  type Acc = { driverId: string; driverName: string; rentalCount: number; totalMinutes: number; hourlyRate: number | null; costSum: number };
  const map = new Map<string, Acc>();

  for (const i of inputs) {
    const minutes = (i.deliveryMinutes ?? 0) + (i.pickupMinutes ?? 0);
    if (minutes <= 0) continue;
    let row = map.get(i.driverId);
    if (!row) {
      row = { driverId: i.driverId, driverName: i.driverName, rentalCount: 0, totalMinutes: 0, hourlyRate: i.hourlyRate, costSum: 0 };
      map.set(i.driverId, row);
    }
    row.rentalCount += 1;
    row.totalMinutes += minutes;
    const cost = driverCostForRental(i.deliveryMinutes, i.pickupMinutes, i.hourlyRate);
    if (cost != null) row.costSum = round2(row.costSum + cost);
  }

  return [...map.values()]
    .map((r) => ({
      driverId: r.driverId,
      driverName: r.driverName,
      rentalCount: r.rentalCount,
      totalMinutes: r.totalMinutes,
      laborCost: r.hourlyRate == null ? null : round2(r.costSum),
    }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes);
}

export type CategoryRow = {
  key: string;
  name: string;
  scope: CostScope;
  amount: number;
  auto: boolean; // ⚙ auto — tylko syntetyczny wiersz "Paliwo" (sekcja 4.3)
};

// Zakładka Kategorie (sekcja 4.3) — wszystkie trzy zakresy razem, malejąco,
// + syntetyczny wiersz "Paliwo" mimo braku własnej CostCategory.
export function categoryRanking(costs: CostEntry[], fuelTotalNet: number): CategoryRow[] {
  const map = new Map<string, CategoryRow>();
  for (const c of costs) {
    let row = map.get(c.categoryId);
    if (!row) {
      row = { key: c.categoryId, name: c.categoryName, scope: c.scope, amount: 0, auto: false };
      map.set(c.categoryId, row);
    }
    row.amount = round2(row.amount + c.amount);
  }
  const rows = [...map.values()];
  if (fuelTotalNet > 0) {
    rows.push({ key: "fuel-auto", name: "Paliwo", scope: "VEHICLE", amount: fuelTotalNet, auto: true });
  }
  return rows.sort((a, b) => b.amount - a.amount);
}

export type MonthlyCostPoint = {
  key: string; // YYYY-MM
  label: string; // "Wrz"
  general: number;
  vehicle: number;
  device: number;
  total: number;
  isCurrent: boolean;
};

export type TrendInsight = {
  monthLabel: string;
  segmentLabel: "Ogólne" | "Pojazdy" | "Urządzenia";
  increase: number;
  dominantNote: string | null;
} | null;

// Sekcja 4.2 — największy pojedynczy wzrost segmentu miesiąc-do-miesiąca w
// oknie 6 miesięcy. Zwraca null jeśli nic nie rosło (nie wymyślaj alarmu).
export function biggestIncreaseInsight(points: MonthlyCostPoint[]): TrendInsight {
  let best: { idx: number; segment: "general" | "vehicle" | "device"; increase: number } | null = null;
  for (let idx = 1; idx < points.length; idx++) {
    const prev = points[idx - 1];
    const cur = points[idx];
    for (const segment of ["general", "vehicle", "device"] as const) {
      const increase = round2(cur[segment] - prev[segment]);
      if (increase > 0 && (!best || increase > best.increase)) {
        best = { idx, segment, increase };
      }
    }
  }
  if (!best) return null;
  const segmentLabel = { general: "Ogólne" as const, vehicle: "Pojazdy" as const, device: "Urządzenia" as const }[best.segment];
  return { monthLabel: points[best.idx].label, segmentLabel, increase: best.increase, dominantNote: null };
}

// Rozszerza insight o wzmiankę pojedynczego wpisu Cost, jeśli odpowiada za
// >60% wzrostu segmentu w tym miesiącu (sekcja 4.2, "w miarę możliwości").
// Dotyczy tylko Ogólne/Urządzenia (realne wpisy Cost) — Pojazdy pomija się,
// bo wzrost tam może pochodzić z wyliczonego paliwa, bez pojedynczego wpisu.
export function withDominantEntryNote(
  insight: TrendInsight,
  monthCostsForSegment: CostEntry[],
): TrendInsight {
  if (!insight || insight.segmentLabel === "Pojazdy") return insight;
  const dominant = monthCostsForSegment.reduce<CostEntry | null>(
    (max, c) => (!max || c.amount > max.amount ? c : max),
    null,
  );
  if (dominant && dominant.amount / insight.increase > 0.6) {
    const label = dominant.description?.trim() || dominant.categoryName;
    return { ...insight, dominantNote: label };
  }
  return insight;
}
