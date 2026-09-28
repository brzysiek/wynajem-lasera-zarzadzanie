import { describe, expect, it } from "vitest";
import { clientPriceFor, deviceCodeFor, expectedClientPrice, invoiceDefaults, invoiceNetOf, positionsSummary, termsDeviation, termsVariantFor } from "./terms-rules";

describe("warunki handlowe", () => {
  it("urządzenie i wariant → kod tabeli cen klienta", () => {
    expect(deviceCodeFor("WYNAJEM", "LIGHTSHEER_VARIANT", "single_standard")).toBe("LS_1G");
    expect(deviceCodeFor("WYNAJEM", "LIGHTSHEER_VARIANT", "double")).toBe("LS_2G");
    expect(deviceCodeFor("WYNAJEM", "LIGHTSHEER_VARIANT", "single_flex")).toBeNull();
    expect(deviceCodeFor("WYNAJEM", "ALMA_HARMONY", "dye_vl")).toBe("ALMA_DYEVL");
    expect(deviceCodeFor("WYNAJEM", "RESURFX_FLAT", null)).toBe("RESURFX");
    expect(deviceCodeFor("SZKOLENIE", "ALMA_HARMONY", null)).toBe("SZKOLENIE");
    expect(deviceCodeFor("WYNAJEM", null, null)).toBeNull();
  });

  it("cena klienta dla urządzenia i dni (Twój Relaks: LS 1 gł. 850)", () => {
    const prices = [
      { device: "LS_1G", days: 1, priceNet: 850 },
      { device: "RESURFX", days: 1, priceNet: 900 },
    ];
    expect(clientPriceFor(prices, "LS_1G", 1)).toBe(850);
    expect(clientPriceFor(prices, "LS_1G", 2)).toBeNull();
    expect(clientPriceFor(prices, null, 1)).toBeNull();
  });

  it("kwota na FV: bez VAT 0, część, całość", () => {
    expect(invoiceNetOf({ vatApplicable: false, invoiceNet: null, totalNet: 920 })).toBe(0);
    expect(invoiceNetOf({ vatApplicable: true, invoiceNet: null, totalNet: 920 })).toBe(920);
    expect(invoiceNetOf({ vatApplicable: true, invoiceNet: 500, totalNet: 1500 })).toBe(500);
    expect(invoiceNetOf({ vatApplicable: true, invoiceNet: 2000, totalNet: 1500 })).toBe(1500);
    expect(invoiceDefaults("PARTIAL", 500)).toEqual({ vatApplicable: true, invoiceNet: 500, pending: false });
    expect(invoiceDefaults("NONE", null)).toEqual({ vatApplicable: false, invoiceNet: null, pending: false });
    expect(invoiceDefaults(null, null)).toBeNull();
    // Kolber, Garcia: „część” bez kwoty — VAT, kwota na FV do ustalenia (nie całość).
    expect(invoiceDefaults("PARTIAL", null)).toEqual({ vatApplicable: true, invoiceNet: null, pending: true });
  });

  it("odchylenie od warunków powyżej 10%", () => {
    expect(termsDeviation(850, 850)).toBeNull();
    expect(termsDeviation(935, 850)).toBeNull(); // dokładnie 10%
    expect(termsDeviation(1000, 850)?.pct).toBeCloseTo(0.1765, 3);
    expect(termsDeviation(700, 850)?.expected).toBe(850);
    expect(termsDeviation(700, null)).toBeNull();
  });

  it("skrót pozycji", () => {
    expect(positionsSummary({ eventType: "WYNAJEM", baseNet: 1200, transportNet: 70, pulseSurchargeNet: null, pulsesPending: true, capNet: null, membraneNet: null })).toBe(
      "wynajem 1200 · transport 70 · impulsy po odbiorze",
    );
    expect(positionsSummary({ eventType: "WYNAJEM", baseNet: 750, transportNet: 0, pulseSurchargeNet: null, pulsesPending: false, capNet: 70, membraneNet: null })).toBe("wynajem 750 · nakładka 70");
  });

  it("cena do porównania: jedyny inny wariant z tabeli klienta (Estetic)", () => {
    const estetic = [
      { device: "LS_1G", days: 1, priceNet: 850 },
      { device: "LS_1G", days: 2, priceNet: 1300 },
    ];
    expect(expectedClientPrice(estetic, "WYNAJEM", "LIGHTSHEER_VARIANT", "double", 2)).toEqual({ priceNet: 1300, code: "LS_1G", otherVariant: true });
    expect(termsDeviation(1900, 1300)).toMatchObject({ expected: 1300 });
    expect(expectedClientPrice(estetic, "WYNAJEM", "LIGHTSHEER_VARIANT", "single_standard", 2)).toEqual({ priceNet: 1300, code: "LS_1G", otherVariant: false });
    expect(expectedClientPrice(estetic, "WYNAJEM", "LIGHTSHEER_VARIANT", "single_flex", 1)).toBeNull();
    expect(expectedClientPrice(estetic, "WYNAJEM", "LIGHTSHEER_VARIANT", "double", 3)).toBeNull();
    expect(expectedClientPrice([...estetic, { device: "LS_2G", days: 1, priceNet: 1100 }], "WYNAJEM", "LIGHTSHEER_VARIANT", "double", 2)).toBeNull();
  });

  it("wariant Almy z tabeli klienta (Pawlik); LightSheer bez zmian", () => {
    const pawlik = [{ device: "ALMA_DYEVL_IPIXEL", days: 1, priceNet: 1200 }];
    expect(termsVariantFor("ALMA_HARMONY", "er_yag_ipixel", [], pawlik, 1)).toBe("dye_vl_ipixel");
    expect(termsVariantFor("ALMA_HARMONY", null, ["dye_vl", "dye_vl_ipixel"], pawlik, 1)).toBe("dye_vl_ipixel");
    expect(termsVariantFor("ALMA_HARMONY", "er_yag_ipixel", ["dye_vl", "er_yag_ipixel"], pawlik, 1)).toBe("er_yag_ipixel");
    expect(termsVariantFor("ALMA_HARMONY", "er_yag_ipixel", [], pawlik, 2)).toBe("er_yag_ipixel");
    expect(termsVariantFor("LIGHTSHEER_VARIANT", "double", [], [{ device: "LS_1G", days: 1, priceNet: 850 }], 1)).toBe("double");
  });
});
