import { describe, expect, it } from "vitest";
import { resolveBasePrice, variantNeedsPulseCounters } from "./base-price";
import { PRICE_RULES } from "./fixtures";

const base = { eventType: "WYNAJEM" as const, priceRules: PRICE_RULES };

describe("resolveBasePrice", () => {
  it("LightSheer double, 3 dni → 2500 z cennika", () => {
    const r = resolveBasePrice({ ...base, pricingCategory: "LIGHTSHEER_VARIANT", deviceVariant: "double", durationDays: 3 });
    expect(r.priceNet?.toNumber()).toBe(2500);
    expect(r.source).toBe("PRICE_LIST");
    expect(r.pulseCalculationStatus).toBeNull();
  });

  it("kategoria FLAT (variant null): Observ, 7 dni → 1200", () => {
    const r = resolveBasePrice({ ...base, pricingCategory: "OBSERV_FLAT", deviceVariant: null, durationDays: 7 });
    expect(r.priceNet?.toNumber()).toBe(1200);
    expect(r.source).toBe("PRICE_LIST");
  });

  it("LightSheer single_flex → placeholder 750, MANUAL, PENDING", () => {
    const r = resolveBasePrice({ ...base, pricingCategory: "LIGHTSHEER_VARIANT", deviceVariant: "single_flex", durationDays: 2 });
    expect(r.priceNet?.toNumber()).toBe(750);
    expect(r.source).toBe("MANUAL");
    expect(r.pulseCalculationStatus).toBe("PENDING");
  });

  it("brak reguły (4-dniowy laser) → null / MANUAL", () => {
    const r = resolveBasePrice({ ...base, pricingCategory: "LIGHTSHEER_VARIANT", deviceVariant: "double", durationDays: 4 });
    expect(r.priceNet).toBeNull();
    expect(r.source).toBe("MANUAL");
  });

  it("urządzenie bez skonfigurowanego cennika → null / MANUAL", () => {
    const r = resolveBasePrice({ ...base, pricingCategory: null, deviceVariant: null, durationDays: 2 });
    expect(r.priceNet).toBeNull();
    expect(r.source).toBe("MANUAL");
  });

  it("SZKOLENIE → zawsze null / MANUAL, bez logiki cennika", () => {
    const r = resolveBasePrice({
      eventType: "SZKOLENIE",
      priceRules: PRICE_RULES,
      pricingCategory: "LIGHTSHEER_VARIANT",
      deviceVariant: "double",
      durationDays: 3,
    });
    expect(r.priceNet).toBeNull();
    expect(r.source).toBe("MANUAL");
  });
});

describe("variantNeedsPulseCounters", () => {
  it("Alma zawsze true", () => {
    expect(variantNeedsPulseCounters("ALMA_HARMONY", "dye_vl")).toBe(true);
    expect(variantNeedsPulseCounters("ALMA_HARMONY", "dye_vl_ipixel")).toBe(true);
  });
  it("LightSheer single_flex true, pozostałe warianty false", () => {
    expect(variantNeedsPulseCounters("LIGHTSHEER_VARIANT", "single_flex")).toBe(true);
    expect(variantNeedsPulseCounters("LIGHTSHEER_VARIANT", "double")).toBe(false);
    expect(variantNeedsPulseCounters("LIGHTSHEER_VARIANT", "single_standard")).toBe(false);
  });
  it("kategorie FLAT false", () => {
    expect(variantNeedsPulseCounters("COOLTECH_FLAT", null)).toBe(false);
    expect(variantNeedsPulseCounters(null, null)).toBe(false);
  });
});
