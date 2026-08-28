// Ładowanie kontekstu cennika z bazy i drobne konwersje na potrzeby
// src/lib/pricing/. Współdzielone przez endpoint kierowcy (Faza 2) i sekcję
// „Finanse" w formularzu wynajmu (Faza 3).
import { Prisma, type DevicePricingCategory, type RentalEventType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { rentalDurationDays, type PricingContext, type PricingSettings } from "@/lib/pricing";

const SETTING_FALLBACKS: Record<keyof PricingSettings, { key: string; value: number }> = {
  capFeeHsNet: { key: "cap_fee_hs_net", value: 70 },
  vatRateDefault: { key: "vat_rate_default", value: 23 },
  almaPulseRateNet: { key: "alma_pulse_rate_net", value: 0.06 },
};

// Pojedyncze wartości cennika. Fallbacki na wypadek braku wiersza (seed
// migracji je wgrywa, ale nie zakładamy tego twardo).
export async function loadPricingSettings(): Promise<PricingSettings> {
  const rows = await prisma.pricingSetting.findMany();
  const read = (name: keyof PricingSettings): Prisma.Decimal => {
    const cfg = SETTING_FALLBACKS[name];
    const row = rows.find((r) => r.key === cfg.key);
    return row ? row.value : new Prisma.Decimal(cfg.value);
  };
  return {
    capFeeHsNet: read("capFeeHsNet"),
    vatRateDefault: read("vatRateDefault"),
    almaPulseRateNet: read("almaPulseRateNet"),
  };
}

type RentalForPricingContext = {
  eventType: RentalEventType;
  startsAt: Date;
  endsAt: Date;
  device: { pricingCategory: DevicePricingCategory | null };
  finance: { deviceVariant: string | null } | null;
};

// Składa PricingContext dla jednego wydarzenia: kategoria z urządzenia,
// wybrany wariant z RentalFinance (jeśli już jest), reguły/progi ograniczone
// do tej kategorii + pojedyncze wartości.
export async function loadPricingContext(rental: RentalForPricingContext): Promise<PricingContext> {
  const pricingCategory = rental.device.pricingCategory;

  const [priceRules, pulseTiers, settings] = await Promise.all([
    pricingCategory ? prisma.priceRule.findMany({ where: { pricingCategory } }) : Promise.resolve([]),
    pricingCategory ? prisma.pulseTier.findMany({ where: { pricingCategory } }) : Promise.resolve([]),
    loadPricingSettings(),
  ]);

  return {
    eventType: rental.eventType,
    pricingCategory,
    deviceVariant: rental.finance?.deviceVariant ?? null,
    durationDays: rentalDurationDays(rental.startsAt, rental.endsAt),
    priceRules,
    pulseTiers,
    settings,
  };
}

// rental.transportPrice to wolny tekst ("500 zł", "150 netto/km", "do
// uzgodnienia"). Do sumy netto bierzemy pierwszą liczbę z tekstu; wartości
// bez liczby ("do uzgodnienia") nie dokładają nic (null → 0 w computeTotals).
export function parseTransportPrice(raw: string | null | undefined): Prisma.Decimal | null {
  if (!raw) return null;
  const match = raw.replace(/\s/g, "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  try {
    return new Prisma.Decimal(match[0]);
  } catch {
    return null;
  }
}
