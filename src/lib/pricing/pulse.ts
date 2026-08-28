import { PricingError } from "./errors";
import { Prisma, type PulseTierRow } from "./types";

// Placeholder ceny bazowej dla LightSheer taryfa elastyczna (single_flex),
// pokazywany zanim kierowca odczyta liczniki. Świadomie stała 750 zł
// niezależnie od liczby dni — nie próba zgadnięcia z tabeli 2/3-dniowej
// (spec 3.2).
export const FLEX_PLACEHOLDER_NET = new Prisma.Decimal(750);

// Zużyte impulsy z pary liczników. Waliduje wejście — komunikaty pod
// wyświetlenie kierowcy.
export function pulsesUsed(start: number, end: number): number {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new PricingError("Liczniki impulsów muszą być liczbami całkowitymi.");
  }
  if (start < 0 || end < 0) {
    throw new PricingError("Liczniki impulsów nie mogą być ujemne.");
  }
  if (end < start) {
    throw new PricingError("Licznik końcowy nie może być mniejszy niż początkowy.");
  }
  return end - start;
}

// LightSheer "single_flex": impulsy WYZNACZAJĄ cenę bazową (zastępują ją, nie
// dodają się). Progi posortowane po `order` rosnąco; bierzemy pierwszy, do
// którego mieści się `used`. Jeśli żaden zwykły próg nie pasuje — ostatni
// (overflow) z regułą nadwyżki (dotyczy tylko durationDays 2 i 3; dla 1 dnia
// ostatni próg 950 zł jest zamknięty, bez nadwyżki — spec sekcja 2).
export function computeFlexBasePrice(
  tiers: PulseTierRow[],
  durationDays: number,
  used: number,
): Prisma.Decimal {
  const relevant = tiers
    .filter((t) => t.pricingCategory === "LIGHTSHEER_VARIANT" && t.durationDays === durationDays)
    .sort((a, b) => a.order - b.order);

  if (relevant.length === 0) {
    throw new PricingError(`Brak skonfigurowanych progów impulsów dla wynajmu ${durationDays}-dniowego.`);
  }

  for (const tier of relevant) {
    if (!tier.isOverflowTier && (tier.maxPulses === null || used <= tier.maxPulses)) {
      return tier.priceNet;
    }
  }

  const overflow = relevant[relevant.length - 1];
  if (!overflow.isOverflowTier || overflow.overflowStepPulses == null || overflow.overflowStepPriceNet == null) {
    // Zamknięty ostatni próg bez nadwyżki — jego cena wprost.
    return overflow.priceNet;
  }

  // Baza nadwyżki = maxPulses ostatniego zwykłego progu (np. 26000 dla 2 dni).
  const lastFlat = [...relevant].reverse().find((t) => !t.isOverflowTier && t.maxPulses !== null);
  const baseline = lastFlat?.maxPulses ?? 0;
  const extra = Math.max(0, used - baseline);
  const steps = Math.ceil(extra / overflow.overflowStepPulses);
  return overflow.priceNet.plus(overflow.overflowStepPriceNet.times(steps));
}

// Alma Harmony: impulsy Dye-VL to DOPŁATA do ceny bazowej z PriceRule
// (nie zmieniają jej). Stawka z PricingSetting `alma_pulse_rate_net`.
export function computeAlmaPulseSurcharge(rateNet: Prisma.Decimal, used: number): Prisma.Decimal {
  return rateNet.times(used);
}
