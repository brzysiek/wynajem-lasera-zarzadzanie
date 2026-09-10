import { describe, expect, it } from "vitest";
import { Prisma } from "./types";
import { computeTotals, round2 } from "./total";

const D = (v: number | string) => new Prisma.Decimal(v);
const n = (x: Prisma.Decimal) => x.toNumber();

// Wspólna baza wejścia — testy nadpisują tylko istotne pola.
const BASE = {
  eventType: "WYNAJEM" as const,
  baseRentalPriceNet: D(1500),
  pulseSurchargeNet: null,
  transportPriceNet: D(0),
  transportPaidSeparately: false,
  transportVatApplicable: false,
  capUsedHS: null as boolean | null,
  capFeeNet: null as Prisma.Decimal | null,
  vatApplicable: false,
  vatRate: D(23),
};

describe("computeTotals", () => {
  it("wynajem: baza + transport + nakładka, bez VAT (przykład z mockupu: 1500 + 150 + 70 = 1720)", () => {
    const r = computeTotals({ ...BASE, transportPriceNet: D(150), capUsedHS: true, capFeeNet: D(70) });
    expect(n(r.totalNet)).toBe(1720);
    expect(n(r.totalGross)).toBe(1720);
    expect(r.transportTotalNet).toBeNull();
  });

  it("2 nakładki HS: capFeeNet * count (1500 + 70*2 = 1640)", () => {
    const r = computeTotals({ ...BASE, capUsedHS: true, capCountHS: 2, capFeeNet: D(70) });
    expect(n(r.totalNet)).toBe(1640);
  });

  it("nakładka niezaznaczona → capFeeNet pomijane", () => {
    const r = computeTotals({ ...BASE, transportPriceNet: D(150), capUsedHS: false, capFeeNet: D(70) });
    expect(n(r.totalNet)).toBe(1650);
  });

  it("dopłata za impulsy Alma dodaje się do bazy", () => {
    const r = computeTotals({ ...BASE, baseRentalPriceNet: D(2000), pulseSurchargeNet: D(336) });
    expect(n(r.totalNet)).toBe(2336);
  });

  it("VAT 23% zaokrąglany do 2 miejsc half-up", () => {
    const r = computeTotals({ ...BASE, baseRentalPriceNet: D(1000), transportPriceNet: D(3.33), vatApplicable: true });
    // netto 1003.33 → brutto 1003.33 * 1.23 = 1234.0959 → 1234.10
    expect(n(r.totalNet)).toBe(1003.33);
    expect(n(r.totalGross)).toBe(1234.1);
  });

  it("SZKOLENIE: transport pomijany w sumie", () => {
    const r = computeTotals({ ...BASE, eventType: "SZKOLENIE", baseRentalPriceNet: D(800), transportPriceNet: D(150) });
    expect(n(r.totalNet)).toBe(800);
    expect(r.transportTotalNet).toBeNull();
  });

  it("SZKOLENIE ignoruje transportPaidSeparately (nie ma transportu w szkoleniu)", () => {
    const r = computeTotals({
      ...BASE,
      eventType: "SZKOLENIE",
      baseRentalPriceNet: D(800),
      transportPriceNet: D(150),
      transportPaidSeparately: true,
      transportVatApplicable: true,
    });
    expect(n(r.totalNet)).toBe(800);
    expect(r.transportTotalNet).toBeNull();
    expect(r.transportTotalGross).toBeNull();
  });

  it("transport osobno: wynajem z VAT-em, transport bez VAT — dwie oddzielne sumy (1000+23% / 100)", () => {
    const r = computeTotals({
      ...BASE,
      baseRentalPriceNet: D(1000),
      transportPriceNet: D(100),
      transportPaidSeparately: true,
      transportVatApplicable: false,
      vatApplicable: true,
    });
    // wynajem: transport NIE wchodzi do sumy
    expect(n(r.totalNet)).toBe(1000);
    expect(n(r.totalGross)).toBe(1230);
    // transport: osobno, bez VAT
    expect(n(r.transportTotalNet!)).toBe(100);
    expect(n(r.transportTotalGross!)).toBe(100);
  });

  it("transport osobno z własnym VAT 23% (100 → 123), niezależnie od VAT wynajmu", () => {
    const r = computeTotals({
      ...BASE,
      baseRentalPriceNet: D(1000),
      transportPriceNet: D(100),
      transportPaidSeparately: true,
      transportVatApplicable: true,
      vatApplicable: false,
    });
    expect(n(r.totalNet)).toBe(1000);
    expect(n(r.totalGross)).toBe(1000);
    expect(n(r.transportTotalNet!)).toBe(100);
    expect(n(r.transportTotalGross!)).toBe(123);
  });

  it("transportPaidSeparately=false → transport wraca do sumy wynajmu (jak dawniej)", () => {
    const r = computeTotals({
      ...BASE,
      baseRentalPriceNet: D(1000),
      transportPriceNet: D(100),
      transportPaidSeparately: false,
      vatApplicable: true,
    });
    expect(n(r.totalNet)).toBe(1100);
    expect(n(r.totalGross)).toBe(1353); // 1100 * 1.23
    expect(r.transportTotalNet).toBeNull();
  });
});

describe("round2", () => {
  it("0.005 → 0.01 (half-up)", () => {
    expect(n(round2(D("0.005")))).toBe(0.01);
  });
});
