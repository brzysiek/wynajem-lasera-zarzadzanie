import { describe, expect, it } from "vitest";
import { PricingError } from "./errors";
import { computeAlmaPulseSurcharge, computeFlexBasePrice, flexPlaceholderNet, pulsesUsed } from "./pulse";
import { PULSE_TIERS, SETTINGS } from "./fixtures";

const n = (x: { toNumber(): number }) => x.toNumber();

describe("pulsesUsed", () => {
  it("odejmuje liczniki", () => {
    expect(pulsesUsed(4200, 9800)).toBe(5600);
  });
  it("odrzuca end < start", () => {
    expect(() => pulsesUsed(9800, 4200)).toThrow(PricingError);
  });
  it("odrzuca wartości ujemne", () => {
    expect(() => pulsesUsed(-1, 10)).toThrow(PricingError);
  });
  it("odrzuca ułamki", () => {
    expect(() => pulsesUsed(1.5, 10)).toThrow(PricingError);
  });
});

describe("computeFlexBasePrice — durationDays = 1 (bez nadwyżki)", () => {
  it("do 10 000 impulsów → 750", () => {
    expect(n(computeFlexBasePrice(PULSE_TIERS, 1, 10000))).toBe(750);
  });
  it("10 001–12 000 → 850", () => {
    expect(n(computeFlexBasePrice(PULSE_TIERS, 1, 12000))).toBe(850);
  });
  it("powyżej 12 000 → 950 (zamknięte, bez nadwyżki)", () => {
    expect(n(computeFlexBasePrice(PULSE_TIERS, 1, 50000))).toBe(950);
  });
});

describe("computeFlexBasePrice — durationDays = 2 (z nadwyżką od 26 000)", () => {
  it("granice zwykłych progów", () => {
    expect(n(computeFlexBasePrice(PULSE_TIERS, 2, 20000))).toBe(1300);
    expect(n(computeFlexBasePrice(PULSE_TIERS, 2, 21500))).toBe(1400);
    expect(n(computeFlexBasePrice(PULSE_TIERS, 2, 23000))).toBe(1500);
    expect(n(computeFlexBasePrice(PULSE_TIERS, 2, 24500))).toBe(1600);
    expect(n(computeFlexBasePrice(PULSE_TIERS, 2, 26000))).toBe(1700);
  });
  it("pierwszy impuls ponad 26 000 → pełny krok nadwyżki (1700 + 100)", () => {
    expect(n(computeFlexBasePrice(PULSE_TIERS, 2, 26001))).toBe(1800);
  });
  it("27 000 → 1800 (1 krok), 28 500 → 1900 (2 kroki)", () => {
    expect(n(computeFlexBasePrice(PULSE_TIERS, 2, 27000))).toBe(1800);
    expect(n(computeFlexBasePrice(PULSE_TIERS, 2, 28500))).toBe(1900);
  });
});

describe("computeFlexBasePrice — durationDays = 3 (z nadwyżką od 26 000)", () => {
  it("zwykłe progi", () => {
    expect(n(computeFlexBasePrice(PULSE_TIERS, 3, 20000))).toBe(1600);
    expect(n(computeFlexBasePrice(PULSE_TIERS, 3, 26000))).toBe(2000);
  });
  it("nadwyżka: 29 000 → 2000 + 2*100 = 2200", () => {
    expect(n(computeFlexBasePrice(PULSE_TIERS, 3, 29000))).toBe(2200);
  });
});

describe("flexPlaceholderNet — najniższy próg dla okresu", () => {
  it("1 dzień → 750, 2 dni → 1300, 3 dni → 1600", () => {
    expect(flexPlaceholderNet(PULSE_TIERS, 1).toNumber()).toBe(750);
    expect(flexPlaceholderNet(PULSE_TIERS, 2).toNumber()).toBe(1300);
    expect(flexPlaceholderNet(PULSE_TIERS, 3).toNumber()).toBe(1600);
  });
  it("brak progów dla okresu → fallback 750", () => {
    expect(flexPlaceholderNet(PULSE_TIERS, 5).toNumber()).toBe(750);
  });
});

describe("computeAlmaPulseSurcharge", () => {
  it("5 600 impulsów * 0,06 zł = 336", () => {
    expect(n(computeAlmaPulseSurcharge(SETTINGS.almaPulseRateNet, 5600))).toBe(336);
  });
  it("0 impulsów = 0", () => {
    expect(n(computeAlmaPulseSurcharge(SETTINGS.almaPulseRateNet, 0))).toBe(0);
  });
});
