// Koszty wyliczane automatycznie — NIE tabela `Cost`, tylko obliczenia w
// locie z danych już zbieranych gdzie indziej w aplikacji (prompt-claude-code-dashboard-kosztow.md,
// sekcja 3). Czyste funkcje na plain number — bez Prismy, bezpieczne w
// bundlu klienta (podobnie jak src/lib/revenue/aggregate.ts).
//
// Zasada nadrzędna: nigdy nie zgadujemy — brak danych do wyliczenia daje
// `null` ("brak danych"), NIE `0` ("koszt zerowy") i nie `Infinity`/`NaN`.

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Koszt/km wyliczony z DWÓCH wejść zamiast wpisywany wprost: stałego
// spalania pojazdu (Vehicle.fuelConsumptionL100km, zmienia się rzadko) i
// jednej, współdzielonej ceny paliwa (PricingSetting["fuel_price_per_liter"],
// ADMIN aktualizuje raz dla całej floty, nie osobno w każdym aucie).
export function vehicleFuelCostPerKm(consumptionL100km: number | null, pricePerLiter: number | null): number | null {
  if (consumptionL100km == null || pricePerLiter == null) return null;
  return round2((consumptionL100km / 100) * pricePerLiter);
}

// --- 3.1 koszt paliwa PER ETAP (dostawa LUB odbiór) ---
// Rental.contactDistanceKm to odległość W JEDNĄ STRONĘ do klienta — każdy
// etap to osobna, pełna trasa tam-i-z-powrotem, stąd ×2. Dostawa i odbiór są
// od siebie niezależne (mogą jechać różnymi pojazdami — RentalFinance.pickupVehicleId),
// więc liczone osobno, nie jedną wspólną trasą jak dawniej.
// null gdy brakuje odległości LUB kosztu/km pojazdu tego etapu.
export function legFuelCost(distanceKm: number | null, fuelCostPerKm: number | null): number | null {
  if (distanceKm == null || fuelCostPerKm == null) return null;
  return round2(distanceKm * fuelCostPerKm * 2);
}

// --- 3.1 koszt paliwa CAŁEGO wynajmu = dostawa + odbiór ---
// Gdy ten sam pojazd robi oba etapy, to po prostu 2× legFuelCost. Gdy różne —
// każdy etap liczony kosztem/km SWOJEGO pojazdu, nic się między nimi nie
// dzieli (patrz legFuelCost). null tylko gdy OBA etapy dają null (zupełny
// brak danych) — jeden brakujący etap nie zeruje drugiego.
export function fuelCostForRental(
  distanceKm: number | null,
  deliveryFuelCostPerKm: number | null,
  pickupFuelCostPerKm: number | null,
): number | null {
  const delivery = legFuelCost(distanceKm, deliveryFuelCostPerKm);
  const pickup = legFuelCost(distanceKm, pickupFuelCostPerKm);
  if (delivery == null && pickup == null) return null;
  return round2((delivery ?? 0) + (pickup ?? 0));
}

// --- 3.2 koszt pracy kierowcy per wynajem ---
// UWAGA BEZPIECZEŃSTWA: wynik tej funkcji nigdy nie może trafić do żadnej
// odpowiedzi API/widoku dostępnego roli KIEROWCA (patrz User.hourlyRate
// w schema.prisma). Wołać wyłącznie w kontekstach ADMIN.
export function driverCostForRental(
  deliveryMinutes: number | null,
  pickupMinutes: number | null,
  hourlyRate: number | null,
): number | null {
  if (hourlyRate == null) return null;
  const minutes = (deliveryMinutes ?? 0) + (pickupMinutes ?? 0);
  if (minutes <= 0) return null;
  return round2((minutes / 60) * hourlyRate);
}

// --- 3.3 koszt na impuls (tylko urządzenia z licznikami) ---
// null gdy suma impulsów w okresie = 0 (brak wyniku, nie dzielenie przez zero).
export function costPerPulse(lampReplacementSumNet: number, totalPulsesUsed: number): number | null {
  if (totalPulsesUsed <= 0) return null;
  return round2(lampReplacementSumNet / totalPulsesUsed);
}

// --- sekcja 4.3, zakładka Pojazdy: całkowity koszt eksploatacji na km ---
// null gdy suma km w okresie = 0 (pojazd nieużywany).
export function costPerKm(fuelNet: number, otherCostsNet: number, totalKm: number): number | null {
  if (totalKm <= 0) return null;
  return round2((fuelNet + otherCostsNet) / totalKm);
}
