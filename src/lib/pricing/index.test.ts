import { describe, expect, it } from "vitest";
import { Prisma, type FinanceState, type PricingContext } from "./types";
import { PricingError } from "./errors";
import { recalculateFinance } from "./index";
import { PRICE_RULES, PULSE_TIERS, SETTINGS } from "./fixtures";

const D = (v: number) => new Prisma.Decimal(v);

function ctx(over: Partial<PricingContext>): PricingContext {
  return {
    eventType: "WYNAJEM",
    pricingCategory: "LIGHTSHEER_VARIANT",
    deviceVariant: "double",
    durationDays: 3,
    priceRules: PRICE_RULES,
    pulseTiers: PULSE_TIERS,
    settings: SETTINGS,
    ...over,
  };
}

function state(over: Partial<FinanceState>): FinanceState {
  return {
    baseRentalPriceNet: D(2500),
    baseRentalPriceSource: "PRICE_LIST",
    pulseCounterStart: null,
    pulseCounterEnd: null,
    capUsedHS: null,
    capFeeNet: null,
    vatApplicable: false,
    vatRate: D(23),
    transportPrice: null,
    ...over,
  };
}

describe("recalculateFinance — LightSheer double (standard)", () => {
  it("baza z cennika, brak impulsów, suma = baza", () => {
    const r = recalculateFinance(ctx({}), state({}));
    expect(r.baseRentalPriceNet.toNumber()).toBe(2500);
    expect(r.baseRentalPriceSource).toBe("PRICE_LIST");
    expect(r.pulseSurchargeNet).toBeNull();
    expect(r.pulseCalculationStatus).toBeNull();
    expect(r.totalNet.toNumber()).toBe(2500);
  });

  it("nakładka HS zaznaczona → +capFeeNet (snapshot podany w state)", () => {
    const r = recalculateFinance(ctx({}), state({ capUsedHS: true, capFeeNet: D(70), transportPrice: D(150) }));
    expect(r.totalNet.toNumber()).toBe(2720);
  });

  it("VAT 23% → brutto", () => {
    const r = recalculateFinance(ctx({}), state({ vatApplicable: true }));
    expect(r.totalNet.toNumber()).toBe(2500);
    expect(r.totalGross.toNumber()).toBe(3075);
  });

  it("ręczne nadpisanie ceny bazowej jest zachowane", () => {
    const r = recalculateFinance(ctx({}), state({ baseRentalPriceNet: D(2300), baseRentalPriceSource: "MANUAL" }));
    expect(r.baseRentalPriceNet.toNumber()).toBe(2300);
    expect(r.baseRentalPriceSource).toBe("MANUAL");
    expect(r.totalNet.toNumber()).toBe(2300);
  });
});

describe("recalculateFinance — LightSheer single_flex (impulsy zastępują bazę)", () => {
  const flexCtx = ctx({ deviceVariant: "single_flex", durationDays: 2 });

  it("bez liczników → placeholder = najniższy próg dla okresu (2 dni = 1300), PENDING, MANUAL", () => {
    const r = recalculateFinance(flexCtx, state({ baseRentalPriceNet: D(999), baseRentalPriceSource: "MANUAL" }));
    expect(r.baseRentalPriceNet.toNumber()).toBe(1300);
    expect(r.baseRentalPriceSource).toBe("MANUAL");
    expect(r.pulseCalculationStatus).toBe("PENDING");
  });

  it("placeholder dla 1 dnia = 750, dla 3 dni = 1600", () => {
    const c1 = ctx({ deviceVariant: "single_flex", durationDays: 1 });
    const c3 = ctx({ deviceVariant: "single_flex", durationDays: 3 });
    expect(recalculateFinance(c1, state({})).baseRentalPriceNet.toNumber()).toBe(750);
    expect(recalculateFinance(c3, state({})).baseRentalPriceNet.toNumber()).toBe(1600);
  });

  it("z licznikami → cena z progów, PULSE_CALCULATED, CALCULATED", () => {
    const r = recalculateFinance(
      flexCtx,
      state({ baseRentalPriceNet: D(750), baseRentalPriceSource: "MANUAL", pulseCounterStart: 1000, pulseCounterEnd: 28000 }),
    );
    // 27 000 impulsów, 2 dni → próg nadwyżki: 1700 + ceil(1000/1500)*100 = 1800
    expect(r.baseRentalPriceNet.toNumber()).toBe(1800);
    expect(r.baseRentalPriceSource).toBe("PULSE_CALCULATED");
    expect(r.pulseCalculationStatus).toBe("CALCULATED");
    expect(r.totalNet.toNumber()).toBe(1800);
  });

  it("liczniki impulsów zawsze wygrywają nad wartością ręczną w state", () => {
    const r = recalculateFinance(
      flexCtx,
      state({ baseRentalPriceNet: D(9999), baseRentalPriceSource: "MANUAL", pulseCounterStart: 0, pulseCounterEnd: 15000 }),
    );
    // 15 000 impulsów, 2 dni → pierwszy zwykły próg (<= 20000) = 1300
    expect(r.baseRentalPriceNet.toNumber()).toBe(1300);
  });

  it("end < start → PricingError", () => {
    expect(() =>
      recalculateFinance(flexCtx, state({ pulseCounterStart: 5000, pulseCounterEnd: 1000 })),
    ).toThrow(PricingError);
  });
});

describe("recalculateFinance — Alma Harmony (impulsy = dopłata)", () => {
  const almaCtx = ctx({ pricingCategory: "ALMA_HARMONY", deviceVariant: "dye_vl", durationDays: 2 });

  it("bez liczników → baza z cennika, dopłata null, PENDING", () => {
    const r = recalculateFinance(almaCtx, state({ baseRentalPriceNet: D(2000), baseRentalPriceSource: "PRICE_LIST" }));
    expect(r.baseRentalPriceNet.toNumber()).toBe(2000);
    expect(r.pulseSurchargeNet).toBeNull();
    expect(r.pulseCalculationStatus).toBe("PENDING");
    expect(r.totalNet.toNumber()).toBe(2000);
  });

  it("z licznikami → baza bez zmian + dopłata pulsesUsed*0,06", () => {
    const r = recalculateFinance(
      almaCtx,
      state({
        baseRentalPriceNet: D(2000),
        baseRentalPriceSource: "PRICE_LIST",
        pulseCounterStart: 4200,
        pulseCounterEnd: 9800,
      }),
    );
    expect(r.baseRentalPriceNet.toNumber()).toBe(2000);
    expect(r.pulseSurchargeNet?.toNumber()).toBe(336); // 5600 * 0.06
    expect(r.pulseCalculationStatus).toBe("CALCULATED");
    expect(r.totalNet.toNumber()).toBe(2336);
  });
});

describe("recalculateFinance — SZKOLENIE", () => {
  it("cena ręczna, brak impulsów/nakładki, transport pominięty", () => {
    const r = recalculateFinance(
      ctx({ eventType: "SZKOLENIE", pricingCategory: null, deviceVariant: null, durationDays: 1 }),
      state({ baseRentalPriceNet: D(800), baseRentalPriceSource: "MANUAL", transportPrice: D(150) }),
    );
    expect(r.baseRentalPriceNet.toNumber()).toBe(800);
    expect(r.pulseSurchargeNet).toBeNull();
    expect(r.pulseCalculationStatus).toBeNull();
    expect(r.totalNet.toNumber()).toBe(800); // transport NIE dolicza się
  });
});
