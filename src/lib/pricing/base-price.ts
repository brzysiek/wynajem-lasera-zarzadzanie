import { FLEX_VARIANT } from "./types";
import type {
  Prisma,
  DevicePricingCategory,
  PriceRuleRow,
  PriceSource,
  PulseCalculationStatus,
  RentalEventType,
} from "./types";
import { FLEX_PLACEHOLDER_NET } from "./pulse";

export type BasePriceContext = {
  eventType: RentalEventType;
  pricingCategory: DevicePricingCategory | null;
  deviceVariant: string | null;
  durationDays: number;
  priceRules: PriceRuleRow[];
};

export type ResolvedBasePrice = {
  // null = brak reguły w cenniku (nietypowy okres) albo urządzenie
  // nieskonfigurowane / szkolenie — biuro MUSI wpisać cenę ręcznie.
  priceNet: Prisma.Decimal | null;
  source: PriceSource;
  // ustawiane tylko dla LightSheer taryfa elastyczna (placeholder do przeliczenia)
  pulseCalculationStatus: PulseCalculationStatus | null;
};

// Dobiera cenę bazową z cennika (albo sygnalizuje "wpisz ręcznie"). Wołane
// przy tworzeniu wynajmu i przy zmianie urządzenia/wariantu/terminu przez
// biuro — NIE przy edycji kierowcy (tam urządzenie/termin się nie zmieniają).
export function resolveBasePrice(ctx: BasePriceContext): ResolvedBasePrice {
  // Szkolenie — zawsze ręcznie, bez logiki cennika (spec 3.6).
  if (ctx.eventType === "SZKOLENIE") {
    return { priceNet: null, source: "MANUAL", pulseCalculationStatus: null };
  }

  // LightSheer taryfa elastyczna — cena wyliczy się z liczników po zwrocie
  // sprzętu; teraz placeholder (spec 3.2).
  if (ctx.pricingCategory === "LIGHTSHEER_VARIANT" && ctx.deviceVariant === FLEX_VARIANT) {
    return { priceNet: FLEX_PLACEHOLDER_NET, source: "MANUAL", pulseCalculationStatus: "PENDING" };
  }

  if (!ctx.pricingCategory) {
    return { priceNet: null, source: "MANUAL", pulseCalculationStatus: null };
  }

  const rule = ctx.priceRules.find(
    (r) =>
      r.pricingCategory === ctx.pricingCategory &&
      (r.variant ?? null) === (ctx.deviceVariant ?? null) &&
      r.durationDays === ctx.durationDays,
  );

  if (rule) {
    return { priceNet: rule.priceNet, source: "PRICE_LIST", pulseCalculationStatus: null };
  }

  // Brak reguły (np. 4-dniowy wynajem lasera) — biuro wpisuje ręcznie.
  return { priceNet: null, source: "MANUAL", pulseCalculationStatus: null };
}

// Czy dany wariant wymaga odczytu liczników impulsów przy zwrocie sprzętu.
// LightSheer flex — impulsy wyznaczają cenę bazową; Alma — zawsze dopłata.
export function variantNeedsPulseCounters(
  category: DevicePricingCategory | null,
  variant: string | null,
): boolean {
  if (category === "ALMA_HARMONY") return true;
  if (category === "LIGHTSHEER_VARIANT" && variant === FLEX_VARIANT) return true;
  return false;
}
