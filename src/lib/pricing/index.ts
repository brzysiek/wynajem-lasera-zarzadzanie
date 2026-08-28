import {
  FLEX_VARIANT,
  type ComputedFinance,
  type FinanceState,
  type PricingContext,
} from "./types";
import { variantNeedsPulseCounters } from "./base-price";
import { FLEX_PLACEHOLDER_NET, computeAlmaPulseSurcharge, computeFlexBasePrice, pulsesUsed } from "./pulse";
import { computeTotals } from "./total";

export * from "./types";
export { PricingError } from "./errors";
export { rentalDurationDays } from "./duration";
export { resolveBasePrice, variantNeedsPulseCounters } from "./base-price";
export type { BasePriceContext, ResolvedBasePrice } from "./base-price";
export { computeAlmaPulseSurcharge, computeFlexBasePrice, pulsesUsed, FLEX_PLACEHOLDER_NET } from "./pulse";
export { computeTotals, round2 } from "./total";
export type { TotalsInput } from "./total";
export { formatPln } from "./format";

// Finalizer wołany przy KAŻDYM zapisie RentalFinance (tworzenie/edycja przez
// biuro, edycja liczników/nakładki/gotówki przez kierowcę). Liczy pola
// pochodne (cena z impulsów, dopłata Alma, status, suma) z bieżącego stanu.
// NIE dobiera ceny bazowej z cennika — to robi resolveBasePrice() po stronie
// biura przy zmianie urządzenia/wariantu/terminu; tu cena bazowa jest brana
// z `state`, z JEDNYM wyjątkiem: LightSheer taryfa elastyczna, gdzie impulsy
// zawsze wygrywają (spec 3.2).
//
// Rzuca PricingError przy niepoprawnych licznikach — caller zwraca 400.
export function recalculateFinance(ctx: PricingContext, state: FinanceState): ComputedFinance {
  const { pulseCounterStart: start, pulseCounterEnd: end } = state;
  const used = start != null && end != null ? pulsesUsed(start, end) : null;

  let base = state.baseRentalPriceNet;
  let source = state.baseRentalPriceSource;
  let surcharge: ComputedFinance["pulseSurchargeNet"] = null;
  let status: ComputedFinance["pulseCalculationStatus"] = null;

  if (ctx.eventType !== "SZKOLENIE") {
    const isFlex = ctx.pricingCategory === "LIGHTSHEER_VARIANT" && ctx.deviceVariant === FLEX_VARIANT;

    if (isFlex) {
      if (used != null) {
        base = computeFlexBasePrice(ctx.pulseTiers, ctx.durationDays, used);
        source = "PULSE_CALCULATED";
        status = "CALCULATED";
      } else {
        base = FLEX_PLACEHOLDER_NET;
        source = "MANUAL";
        status = "PENDING";
      }
    } else if (ctx.pricingCategory === "ALMA_HARMONY") {
      // Cena bazowa Almy zostaje (z cennika albo ręczna) — impulsy to dopłata.
      if (used != null) {
        surcharge = computeAlmaPulseSurcharge(ctx.settings.almaPulseRateNet, used);
        status = "CALCULATED";
      } else {
        status = "PENDING";
      }
    } else if (variantNeedsPulseCounters(ctx.pricingCategory, ctx.deviceVariant)) {
      // Zabezpieczenie na wypadek dodania w przyszłości kolejnej kategorii
      // wymagającej liczników bez obsługi tutaj.
      status = used != null ? "CALCULATED" : "PENDING";
    }
  }

  const totals = computeTotals({
    eventType: ctx.eventType,
    baseRentalPriceNet: base,
    pulseSurchargeNet: surcharge,
    transportPrice: state.transportPrice,
    capUsedHS: state.capUsedHS,
    capFeeNet: state.capFeeNet,
    vatApplicable: state.vatApplicable,
    vatRate: state.vatRate,
  });

  return {
    baseRentalPriceNet: base,
    baseRentalPriceSource: source,
    pulseSurchargeNet: surcharge,
    pulseCalculationStatus: status,
    totalNet: totals.totalNet,
    totalGross: totals.totalGross,
  };
}
