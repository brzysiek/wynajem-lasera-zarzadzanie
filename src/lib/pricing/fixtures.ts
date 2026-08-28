// Dane cennika 1:1 z migracją prisma/migrations/20260829090000_rental_finance
// (sekcja 2 spec). Używane w testach jednostkowych.
import { Prisma, type PriceRuleRow, type PricingSettings, type PulseTierRow } from "./types";

const D = (v: number) => new Prisma.Decimal(v);

export const PRICE_RULES: PriceRuleRow[] = [
  { pricingCategory: "LIGHTSHEER_VARIANT", variant: "single_standard", durationDays: 1, priceNet: D(850) },
  { pricingCategory: "LIGHTSHEER_VARIANT", variant: "single_standard", durationDays: 2, priceNet: D(1500) },
  { pricingCategory: "LIGHTSHEER_VARIANT", variant: "single_standard", durationDays: 3, priceNet: D(2000) },
  { pricingCategory: "LIGHTSHEER_VARIANT", variant: "double", durationDays: 1, priceNet: D(1100) },
  { pricingCategory: "LIGHTSHEER_VARIANT", variant: "double", durationDays: 2, priceNet: D(1900) },
  { pricingCategory: "LIGHTSHEER_VARIANT", variant: "double", durationDays: 3, priceNet: D(2500) },
  { pricingCategory: "LIGHTSHEER_ET400_FLAT", variant: null, durationDays: 1, priceNet: D(650) },
  { pricingCategory: "LIGHTSHEER_ET400_FLAT", variant: null, durationDays: 2, priceNet: D(1100) },
  { pricingCategory: "LIGHTSHEER_ET400_FLAT", variant: null, durationDays: 3, priceNet: D(1450) },
  { pricingCategory: "ALMA_HARMONY", variant: "dye_vl", durationDays: 1, priceNet: D(1200) },
  { pricingCategory: "ALMA_HARMONY", variant: "dye_vl", durationDays: 2, priceNet: D(2000) },
  { pricingCategory: "ALMA_HARMONY", variant: "dye_vl", durationDays: 3, priceNet: D(2500) },
  { pricingCategory: "ALMA_HARMONY", variant: "dye_vl_ipixel", durationDays: 1, priceNet: D(1900) },
  { pricingCategory: "ALMA_HARMONY", variant: "dye_vl_ipixel", durationDays: 2, priceNet: D(3100) },
  { pricingCategory: "ALMA_HARMONY", variant: "dye_vl_ipixel", durationDays: 3, priceNet: D(3900) },
  { pricingCategory: "COOLTECH_FLAT", variant: null, durationDays: 1, priceNet: D(950) },
  { pricingCategory: "COOLTECH_FLAT", variant: null, durationDays: 2, priceNet: D(1500) },
  { pricingCategory: "COOLTECH_FLAT", variant: null, durationDays: 3, priceNet: D(2000) },
  { pricingCategory: "RESURFX_FLAT", variant: null, durationDays: 1, priceNet: D(900) },
  { pricingCategory: "RESURFX_FLAT", variant: null, durationDays: 2, priceNet: D(1600) },
  { pricingCategory: "RESURFX_FLAT", variant: null, durationDays: 3, priceNet: D(2100) },
  { pricingCategory: "OBSERV_FLAT", variant: null, durationDays: 1, priceNet: D(800) },
  { pricingCategory: "OBSERV_FLAT", variant: null, durationDays: 7, priceNet: D(1200) },
  { pricingCategory: "OBSERV_FLAT", variant: null, durationDays: 14, priceNet: D(2000) },
];

const flat = (
  durationDays: number,
  order: number,
  maxPulses: number | null,
  priceNet: number,
): PulseTierRow => ({
  pricingCategory: "LIGHTSHEER_VARIANT",
  durationDays,
  order,
  maxPulses,
  priceNet: D(priceNet),
  isOverflowTier: false,
  overflowStepPulses: null,
  overflowStepPriceNet: null,
});

const overflow = (durationDays: number, order: number, priceNet: number): PulseTierRow => ({
  pricingCategory: "LIGHTSHEER_VARIANT",
  durationDays,
  order,
  maxPulses: null,
  priceNet: D(priceNet),
  isOverflowTier: true,
  overflowStepPulses: 1500,
  overflowStepPriceNet: D(100),
});

export const PULSE_TIERS: PulseTierRow[] = [
  flat(1, 1, 10000, 750),
  flat(1, 2, 12000, 850),
  flat(1, 3, null, 950),
  flat(2, 1, 20000, 1300),
  flat(2, 2, 21500, 1400),
  flat(2, 3, 23000, 1500),
  flat(2, 4, 24500, 1600),
  flat(2, 5, 26000, 1700),
  overflow(2, 6, 1700),
  flat(3, 1, 20000, 1600),
  flat(3, 2, 21500, 1700),
  flat(3, 3, 23000, 1800),
  flat(3, 4, 24500, 1900),
  flat(3, 5, 26000, 2000),
  overflow(3, 6, 2000),
];

export const SETTINGS: PricingSettings = {
  capFeeHsNet: D(70),
  vatRateDefault: D(23),
  almaPulseRateNet: new Prisma.Decimal("0.06"),
};
