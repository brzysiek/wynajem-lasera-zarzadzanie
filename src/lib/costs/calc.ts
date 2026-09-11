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

// --- 3.1 koszt paliwa per wynajem ---
// null gdy brakuje contactDistanceKm LUB vehicleId LUB vehicle.fuelCostPerKm.
export function fuelCostForRental(distanceKm: number | null, fuelCostPerKm: number | null): number | null {
  if (distanceKm == null || fuelCostPerKm == null) return null;
  return round2(distanceKm * fuelCostPerKm);
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
