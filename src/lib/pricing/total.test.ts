import { describe, expect, it } from "vitest";
import { Prisma } from "./types";
import { computeTotals, round2 } from "./total";

const D = (v: number | string) => new Prisma.Decimal(v);
const n = (x: Prisma.Decimal) => x.toNumber();

describe("computeTotals", () => {
  it("wynajem: baza + transport + nakładka, bez VAT (przykład z mockupu: 1500 + 150 + 70 = 1720)", () => {
    const r = computeTotals({
      eventType: "WYNAJEM",
      baseRentalPriceNet: D(1500),
      pulseSurchargeNet: null,
      transportPrice: D(150),
      capUsedHS: true,
      capFeeNet: D(70),
      vatApplicable: false,
      vatRate: D(23),
    });
    expect(n(r.totalNet)).toBe(1720);
    expect(n(r.totalGross)).toBe(1720);
  });

  it("nakładka niezaznaczona → capFeeNet pomijane", () => {
    const r = computeTotals({
      eventType: "WYNAJEM",
      baseRentalPriceNet: D(1500),
      pulseSurchargeNet: null,
      transportPrice: D(150),
      capUsedHS: false,
      capFeeNet: D(70),
      vatApplicable: false,
      vatRate: D(23),
    });
    expect(n(r.totalNet)).toBe(1650);
  });

  it("dopłata za impulsy Alma dodaje się do bazy", () => {
    const r = computeTotals({
      eventType: "WYNAJEM",
      baseRentalPriceNet: D(2000),
      pulseSurchargeNet: D(336),
      transportPrice: D(0),
      capUsedHS: null,
      capFeeNet: null,
      vatApplicable: false,
      vatRate: D(23),
    });
    expect(n(r.totalNet)).toBe(2336);
  });

  it("VAT 23% zaokrąglany do 2 miejsc half-up", () => {
    const r = computeTotals({
      eventType: "WYNAJEM",
      baseRentalPriceNet: D(1000),
      pulseSurchargeNet: null,
      transportPrice: D(3.33),
      capUsedHS: null,
      capFeeNet: null,
      vatApplicable: true,
      vatRate: D(23),
    });
    // netto 1003.33 → brutto 1003.33 * 1.23 = 1234.0959 → 1234.10
    expect(n(r.totalNet)).toBe(1003.33);
    expect(n(r.totalGross)).toBe(1234.1);
  });

  it("SZKOLENIE: transport pomijany w sumie", () => {
    const r = computeTotals({
      eventType: "SZKOLENIE",
      baseRentalPriceNet: D(800),
      pulseSurchargeNet: null,
      transportPrice: D(150),
      capUsedHS: null,
      capFeeNet: null,
      vatApplicable: false,
      vatRate: D(23),
    });
    expect(n(r.totalNet)).toBe(800);
  });
});

describe("round2", () => {
  it("0.005 → 0.01 (half-up)", () => {
    expect(n(round2(D("0.005")))).toBe(0.01);
  });
});
