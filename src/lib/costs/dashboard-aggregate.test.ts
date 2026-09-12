import { describe, expect, it } from "vitest";
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
  type DevicePulseInput,
  type DriverLaborInput,
  type MonthlyCostPoint,
  type RentalFuelInput,
} from "./dashboard-aggregate";

function cost(overrides: Partial<CostEntry> = {}): CostEntry {
  return {
    id: "c1",
    amount: 100,
    date: "2026-09-01",
    scope: "GENERAL",
    categoryId: "cat1",
    categoryName: "Marketing",
    description: null,
    deviceId: null,
    deviceName: null,
    vehicleId: null,
    vehicleName: null,
    ...overrides,
  };
}

describe("sumCostsByScope", () => {
  it("sumuje per zakres", () => {
    const totals = sumCostsByScope([
      cost({ amount: 100, scope: "GENERAL" }),
      cost({ amount: 50, scope: "GENERAL" }),
      cost({ amount: 200, scope: "VEHICLE" }),
      cost({ amount: 300, scope: "DEVICE" }),
    ]);
    expect(totals).toEqual({ general: 150, vehicle: 200, device: 300 });
  });

  it("pusta lista -> same zera", () => {
    expect(sumCostsByScope([])).toEqual({ general: 0, vehicle: 0, device: 0 });
  });
});

describe("totalFuelCost", () => {
  it("pomija wynajmy z brakującymi danymi zamiast zerować całość", () => {
    const inputs: RentalFuelInput[] = [
      { vehicleId: "v1", vehicleName: "Ford", distanceKm: 10, fuelCostPerKm: 2 },
      { vehicleId: "v1", vehicleName: "Ford", distanceKm: null, fuelCostPerKm: 2 },
      { vehicleId: "v1", vehicleName: "Ford", distanceKm: 5, fuelCostPerKm: null },
    ];
    expect(totalFuelCost(inputs)).toBe(20);
  });
});

describe("vehicleBreakdown", () => {
  it("liczy paliwo, inne koszty, razem i koszt/km", () => {
    const costs: CostEntry[] = [cost({ scope: "VEHICLE", vehicleId: "v1", vehicleName: "Ford", amount: 300, categoryName: "Serwis/przegląd" })];
    const fuel: RentalFuelInput[] = [
      { vehicleId: "v1", vehicleName: "Ford", distanceKm: 100, fuelCostPerKm: 2 },
      { vehicleId: "v1", vehicleName: "Ford", distanceKm: 50, fuelCostPerKm: 2 },
    ];
    const rows = vehicleBreakdown(costs, fuel);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ vehicleId: "v1", fuelNet: 300, otherNet: 300, totalNet: 600, totalKm: 150, rentalCount: 2 });
    expect(rows[0].costPerKmValue).toBe(4);
  });

  it("brak km w okresie -> koszt/km null, nie dzielenie przez zero", () => {
    const costs: CostEntry[] = [cost({ scope: "VEHICLE", vehicleId: "v1", vehicleName: "Ford", amount: 100 })];
    const rows = vehicleBreakdown(costs, []);
    expect(rows[0].costPerKmValue).toBeNull();
  });

  it("pomija pojazdy bez żadnych kosztów/km", () => {
    const rows = vehicleBreakdown([], [{ vehicleId: "v1", vehicleName: "Ford", distanceKm: null, fuelCostPerKm: null }]);
    expect(rows).toHaveLength(0);
  });
});

describe("deviceBreakdown", () => {
  it("liczy koszt na impuls z kategorii wymiany lampy", () => {
    const costs: CostEntry[] = [
      cost({ scope: "DEVICE", deviceId: "d1", deviceName: "Alma", amount: 2400, categoryName: "Wymiana lampy/elementu zużywalnego" }),
    ];
    const pulses: DevicePulseInput[] = [{ deviceId: "d1", deviceName: "Alma", pulseCounterStart: 100, pulseCounterEnd: 3300 }];
    const rows = deviceBreakdown(costs, pulses);
    expect(rows[0]).toMatchObject({ totalNet: 2400, pulses: 3200 });
    expect(rows[0].costPerPulseValue).toBe(0.75);
  });

  it("brak impulsów w okresie -> null, nie 0 ani Infinity", () => {
    const costs: CostEntry[] = [cost({ scope: "DEVICE", deviceId: "d1", deviceName: "LightSheer", amount: 350, categoryName: "Materiały eksploatacyjne" })];
    const rows = deviceBreakdown(costs, []);
    expect(rows[0].costPerPulseValue).toBeNull();
  });

  it("ignoruje niespójne liczniki (koniec < start)", () => {
    const pulses: DevicePulseInput[] = [{ deviceId: "d1", deviceName: "Alma", pulseCounterStart: 500, pulseCounterEnd: 100 }];
    const rows = deviceBreakdown([], pulses);
    expect(rows).toHaveLength(0);
  });
});

describe("driverBreakdown", () => {
  it("liczy godziny i koszt pracy per kierowca", () => {
    const inputs: DriverLaborInput[] = [
      { driverId: "u1", driverName: "Jan", hourlyRate: 50, deliveryMinutes: 60, pickupMinutes: 30 },
      { driverId: "u1", driverName: "Jan", hourlyRate: 50, deliveryMinutes: 30, pickupMinutes: null },
    ];
    const rows = driverBreakdown(inputs);
    expect(rows[0]).toMatchObject({ driverId: "u1", rentalCount: 2, totalMinutes: 120, laborCost: 100 });
  });

  it("brak stawki godzinowej -> laborCost null, ale godziny/liczba nadal liczone", () => {
    const inputs: DriverLaborInput[] = [{ driverId: "u2", driverName: "Ola", hourlyRate: null, deliveryMinutes: 60, pickupMinutes: 0 }];
    const rows = driverBreakdown(inputs);
    expect(rows[0]).toMatchObject({ rentalCount: 1, totalMinutes: 60, laborCost: null });
  });

  it("pomija wynajmy bez żadnego czasu", () => {
    const inputs: DriverLaborInput[] = [{ driverId: "u1", driverName: "Jan", hourlyRate: 50, deliveryMinutes: null, pickupMinutes: null }];
    expect(driverBreakdown(inputs)).toHaveLength(0);
  });
});

describe("categoryRanking", () => {
  it("łączy wszystkie zakresy i dokłada syntetyczny wiersz Paliwo", () => {
    const costs: CostEntry[] = [
      cost({ categoryId: "c1", categoryName: "Marketing", scope: "GENERAL", amount: 1200 }),
      cost({ categoryId: "c2", categoryName: "Serwis/przegląd", scope: "VEHICLE", amount: 1070 }),
    ];
    const rows = categoryRanking(costs, 1680);
    expect(rows.map((r) => r.name)).toEqual(["Paliwo", "Marketing", "Serwis/przegląd"]);
    expect(rows[0].auto).toBe(true);
  });

  it("bez kosztu paliwa -> brak wiersza Paliwo", () => {
    const rows = categoryRanking([], 0);
    expect(rows).toHaveLength(0);
  });
});

describe("biggestIncreaseInsight", () => {
  it("znajduje największy pojedynczy wzrost segmentu", () => {
    const points: MonthlyCostPoint[] = [
      { key: "2026-06", label: "Cze", general: 100, vehicle: 100, device: 100, total: 300, isCurrent: false },
      { key: "2026-07", label: "Lip", general: 100, vehicle: 100, device: 500, total: 700, isCurrent: false },
      { key: "2026-08", label: "Sie", general: 110, vehicle: 100, device: 400, total: 610, isCurrent: false },
      { key: "2026-09", label: "Wrz", general: 110, vehicle: 100, device: 400, total: 610, isCurrent: true },
    ];
    const insight = biggestIncreaseInsight(points);
    expect(insight).toMatchObject({ monthLabel: "Lip", segmentLabel: "Urządzenia", increase: 400 });
  });

  it("wszystko płaskie/malejące -> null, bez fałszywego alarmu", () => {
    const points: MonthlyCostPoint[] = [
      { key: "2026-08", label: "Sie", general: 200, vehicle: 200, device: 200, total: 600, isCurrent: false },
      { key: "2026-09", label: "Wrz", general: 150, vehicle: 180, device: 190, total: 520, isCurrent: true },
    ];
    expect(biggestIncreaseInsight(points)).toBeNull();
  });
});

describe("withDominantEntryNote", () => {
  it("dokleja nazwę wpisu odpowiadającego za >60% wzrostu", () => {
    const insight = { monthLabel: "Lip", segmentLabel: "Urządzenia" as const, increase: 400, dominantNote: null };
    const monthCosts: CostEntry[] = [cost({ amount: 350, categoryName: "Wymiana lampy/elementu zużywalnego" }), cost({ amount: 50 })];
    const result = withDominantEntryNote(insight, monthCosts);
    expect(result?.dominantNote).toBe("Wymiana lampy/elementu zużywalnego");
  });

  it("brak dominującego wpisu -> nota zostaje null", () => {
    const insight = { monthLabel: "Lip", segmentLabel: "Ogólne" as const, increase: 400, dominantNote: null };
    const monthCosts: CostEntry[] = [cost({ amount: 100 }), cost({ amount: 100 })];
    expect(withDominantEntryNote(insight, monthCosts)?.dominantNote).toBeNull();
  });

  it("pomija segment Pojazdy (wzrost może być z paliwa, nie pojedynczego wpisu)", () => {
    const insight = { monthLabel: "Lip", segmentLabel: "Pojazdy" as const, increase: 400, dominantNote: null };
    expect(withDominantEntryNote(insight, [cost({ amount: 400 })])?.dominantNote).toBeNull();
  });
});

describe("last6MonthsEnding", () => {
  it("zwraca 6 miesięcy kończących się na podanym, w kolejności rosnącej", () => {
    const months = last6MonthsEnding(2026, 3);
    expect(months.map((m) => `${m.year}-${m.month}`)).toEqual([
      "2025-10", "2025-11", "2025-12", "2026-1", "2026-2", "2026-3",
    ]);
    expect(months[months.length - 1].label).toBe("Mar");
    expect(months[0].label).toBe("Paź");
  });

  it("obsługuje przejście przez styczeń", () => {
    const months = last6MonthsEnding(2026, 1);
    expect(months[0]).toEqual({ year: 2025, month: 8, label: "Sie" });
    expect(months[5]).toEqual({ year: 2026, month: 1, label: "Sty" });
  });
});
