import { Prisma } from "@prisma/client";
import type {
  DevicePricingCategory,
  PriceSource,
  PulseCalculationStatus,
  RentalEventType,
} from "@prisma/client";

// Kwoty w całym module trzymamy jako Prisma.Decimal (decimal.js) — nigdy
// float. Boundary konwersji jest w API route (string/Decimal z Prismy → tu,
// wynik → z powrotem do Prisma.update).
export { Prisma };
export type { DevicePricingCategory, PriceSource, PulseCalculationStatus, RentalEventType };

export type PriceRuleRow = {
  pricingCategory: DevicePricingCategory;
  variant: string | null;
  durationDays: number;
  priceNet: Prisma.Decimal;
};

export type PulseTierRow = {
  pricingCategory: DevicePricingCategory;
  durationDays: number;
  order: number;
  maxPulses: number | null;
  priceNet: Prisma.Decimal;
  isOverflowTier: boolean;
  overflowStepPulses: number | null;
  overflowStepPriceNet: Prisma.Decimal | null;
};

export type PricingSettings = {
  capFeeHsNet: Prisma.Decimal;
  vatRateDefault: Prisma.Decimal;
  almaPulseRateNet: Prisma.Decimal;
};

// Kontekst potrzebny do policzenia finansów jednego wydarzenia — biuro składa
// go z urządzenia + cennika, kierowca dostaje ten sam kontekst z serwera.
export type PricingContext = {
  eventType: RentalEventType;
  pricingCategory: DevicePricingCategory | null;
  deviceVariant: string | null;
  durationDays: number;
  priceRules: PriceRuleRow[];
  pulseTiers: PulseTierRow[];
  settings: PricingSettings;
};

// Bieżący stan pól finansowych (część wpisuje biuro, część kierowca) — wejście
// do recalculateFinance().
export type FinanceState = {
  baseRentalPriceNet: Prisma.Decimal;
  baseRentalPriceSource: PriceSource;
  pulseCounterStart: number | null;
  pulseCounterEnd: number | null;
  capUsedHS: boolean | null;
  capCountHS?: number | null; // domyślnie 1 gdy pominięte
  capFeeNet: Prisma.Decimal | null;
  vatApplicable: boolean;
  vatRate: Prisma.Decimal;
  // rental.transportPrice to string ("500 zł", "do uzgodnienia") — API parsuje
  // go do Decimal, a nieparsujące się wartości przekazuje jako null.
  transportPrice: Prisma.Decimal | null;
};

// Wynik recalculateFinance() — pola do zapisania na RentalFinance.
export type ComputedFinance = {
  baseRentalPriceNet: Prisma.Decimal;
  baseRentalPriceSource: PriceSource;
  pulseSurchargeNet: Prisma.Decimal | null;
  pulseCalculationStatus: PulseCalculationStatus | null;
  totalNet: Prisma.Decimal;
  totalGross: Prisma.Decimal;
};

export { FLEX_VARIANT, DOUBLE_VARIANT } from "./variants";
