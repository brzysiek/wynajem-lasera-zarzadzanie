// Serwerowe ładowanie danych dla dashboardu kosztów (/finanse/koszty).
// Zwraca znormalizowane wiersze do dalszej agregacji w dashboard-aggregate.ts
// — ten sam podział odpowiedzialności co w module przychodów
// (src/lib/revenue/load.ts + aggregate.ts).
import { prisma } from "@/lib/prisma";
import { monthPeriod } from "@/lib/revenue/period";
import { vehicleFuelCostPerKm } from "./calc";
import type { CostEntry, DevicePulseInput, DriverLaborInput, RentalFuelInput } from "./dashboard-aggregate";
import type { Period } from "@/lib/revenue/period";

// Jeden, współdzielony parametr ceny paliwa (PricingSetting["fuel_price_per_liter"])
// zamiast osobnego kosztu/km per pojazd — patrz Vehicle.fuelConsumptionL100km
// w schema.prisma. null gdy ADMIN jeszcze nigdy go nie ustawił (nie zgadujemy).
export async function loadFuelPricePerLiter(): Promise<number | null> {
  const setting = await prisma.pricingSetting.findUnique({ where: { key: "fuel_price_per_liter" } });
  return setting ? Number(setting.value) : null;
}

function localDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Wpisy Cost w okresie (filtr po Cost.date, sekcja 4 punkt 2).
export async function loadCostsInPeriod(period: Period): Promise<CostEntry[]> {
  const costs = await prisma.cost.findMany({
    where: { date: { gte: period.start, lte: period.end } },
    include: {
      category: { select: { name: true } },
      device: { select: { name: true } },
      vehicle: { select: { name: true } },
    },
  });
  return costs.map((c) => ({
    id: c.id,
    amount: Number(c.amount),
    date: localDateKey(c.date),
    scope: c.scope,
    categoryId: c.categoryId,
    categoryName: c.category.name,
    description: c.description,
    deviceId: c.deviceId,
    deviceName: c.device?.name ?? null,
    vehicleId: c.vehicleId,
    vehicleName: c.vehicle?.name ?? null,
  }));
}

// Wynajmy z przypisanym pojazdem w okresie (Rental.startsAt decyduje o
// okresie — ta sama reguła co reszta aplikacji) — wejście do kosztu paliwa
// i sumy km per pojazd (sekcja 3.1, 4.3).
export async function loadRentalFuelInputs(period: Period): Promise<RentalFuelInput[]> {
  const [rentals, pricePerLiter] = await Promise.all([
    prisma.rental.findMany({
      where: {
        deletedInGoogle: false,
        startsAt: { gte: period.start, lte: period.end },
        vehicleId: { not: null },
      },
      select: {
        vehicleId: true,
        contactDistanceKm: true,
        vehicle: { select: { name: true, fuelConsumptionL100km: true } },
        finance: {
          select: {
            pickupVehicleId: true,
            pickupVehicle: { select: { name: true, fuelConsumptionL100km: true } },
          },
        },
      },
    }),
    loadFuelPricePerLiter(),
  ]);
  return rentals
    .filter((r): r is typeof r & { vehicleId: string; vehicle: NonNullable<typeof r.vehicle> } => r.vehicleId !== null && r.vehicle !== null)
    .map((r) => {
      const deliveryFuelCostPerKm = vehicleFuelCostPerKm(Number(r.vehicle.fuelConsumptionL100km), pricePerLiter);
      const pickupVehicle = r.finance?.pickupVehicle ?? null;
      return {
        distanceKm: r.contactDistanceKm !== null ? Number(r.contactDistanceKm) : null,
        deliveryVehicleId: r.vehicleId,
        deliveryVehicleName: r.vehicle.name,
        deliveryFuelCostPerKm,
        // Brak pickupVehicle (kierowca nie zaznaczył innego) -> ten sam
        // pojazd/koszt co dostawa.
        pickupVehicleId: pickupVehicle ? r.finance!.pickupVehicleId! : r.vehicleId,
        pickupVehicleName: pickupVehicle ? pickupVehicle.name : r.vehicle.name,
        pickupFuelCostPerKm: pickupVehicle
          ? vehicleFuelCostPerKm(Number(pickupVehicle.fuelConsumptionL100km), pricePerLiter)
          : deliveryFuelCostPerKm,
      };
    });
}

// Wynajmy z licznikami impulsów w okresie — wejście do kosztu na impuls
// (sekcja 3.3). Ta sama reguła przypisania do okresu co w dashboardzie
// przychodów (startsAt).
export async function loadDevicePulseInputs(period: Period): Promise<DevicePulseInput[]> {
  const rentals = await prisma.rental.findMany({
    where: {
      deletedInGoogle: false,
      startsAt: { gte: period.start, lte: period.end },
      finance: { isNot: null },
    },
    select: {
      deviceId: true,
      device: { select: { name: true } },
      finance: { select: { pulseCounterStart: true, pulseCounterEnd: true } },
    },
  });
  return rentals
    .filter((r) => r.finance !== null)
    .map((r) => ({
      deviceId: r.deviceId,
      deviceName: r.device.name,
      pulseCounterStart: r.finance!.pulseCounterStart,
      pulseCounterEnd: r.finance!.pulseCounterEnd,
    }));
}

// Wynajmy z czasem kierowcy w okresie — wejście do kosztu pracy (sekcja 3.2).
// UWAGA BEZPIECZEŃSTWA: wołać WYŁĄCZNIE z kontekstu chronionego
// requireAdminSession()/requireAdmin() — hourlyRate nigdy nie trafia do
// żadnej odpowiedzi dostępnej roli KIEROWCA (schema.prisma, User.hourlyRate;
// docs/prompt-claude-code-dashboard-kosztow.md sekcja 1.4).
export async function loadDriverLaborInputs(period: Period): Promise<DriverLaborInput[]> {
  const rentals = await prisma.rental.findMany({
    where: {
      deletedInGoogle: false,
      startsAt: { gte: period.start, lte: period.end },
      driverId: { not: null },
      finance: { isNot: null },
    },
    select: {
      driverId: true,
      driver: { select: { name: true, hourlyRate: true } },
      finance: { select: { deliveryDurationMinutes: true, pickupDurationMinutes: true } },
    },
  });
  return rentals
    .filter((r): r is typeof r & { driverId: string; driver: NonNullable<typeof r.driver>; finance: NonNullable<typeof r.finance> } =>
      r.driverId !== null && r.driver !== null && r.finance !== null,
    )
    .map((r) => ({
      driverId: r.driverId,
      driverName: r.driver.name,
      hourlyRate: r.driver.hourlyRate !== null ? Number(r.driver.hourlyRate) : null,
      deliveryMinutes: r.finance.deliveryDurationMinutes,
      pickupMinutes: r.finance.pickupDurationMinutes,
    }));
}

// Dane jednego pełnego miesiąca kalendarzowego dla trendu (sekcja 4.2) —
// wpisy Cost + wynajmy z pojazdem (do kosztu paliwa). Zwraca surowe wiersze
// (nie same sumy), żeby dashboard-aggregate mógł też wykryć dominujący
// pojedynczy wpis dla insightu.
export async function loadMonthlyCostData(year: number, month1to12: number): Promise<{ costs: CostEntry[]; fuelInputs: RentalFuelInput[] }> {
  const period = monthPeriod(year, month1to12);
  const [costs, fuelInputs] = await Promise.all([loadCostsInPeriod(period), loadRentalFuelInputs(period)]);
  return { costs, fuelInputs };
}
