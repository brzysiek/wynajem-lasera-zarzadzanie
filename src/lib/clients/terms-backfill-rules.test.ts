import { describe, expect, it } from "vitest";
import { compareWithTerms, planBackfill, resolveVariant, type PlanTerms } from "./terms-backfill-rules";

const relaks: PlanTerms = {
  prices: [
    { device: "LS_1G", days: 1, priceNet: 850 },
    { device: "RESURFX", days: 1, priceNet: 900 },
    { device: "ALMA_DYEVL", days: 1, priceNet: 1200 },
  ],
  transportNet: 70,
  paymentForm: "GOTOWKA",
  invoiceMode: "NONE",
  invoicePartDefault: null,
};
const list = [
  { category: "LIGHTSHEER_VARIANT" as const, variant: "single_standard", days: 2, priceNet: 1500 },
  { category: "LIGHTSHEER_VARIANT" as const, variant: "double", days: 1, priceNet: 1100 },
];
const ls = { title: "Twój Relaks", description: null, category: "LIGHTSHEER_VARIANT" as const, variantOptions: ["single_standard", "double"], days: 1 };

describe("uzupełnienie kwot wg warunków", () => {
  it("Twój Relaks 17.10: 850 + 70, bez FV, gotówka", () => {
    expect(planBackfill(ls, relaks, list, false)).toEqual({
      ready: true,
      variant: "single_standard",
      code: "LS_1G",
      baseNet: 850,
      baseSource: "CLIENT_TERMS",
      transportNet: 70,
      vatApplicable: false,
      invoicePart: null,
      paymentMethod: "CASH",
      totalNet: 920,
    });
  });

  it("drugie urządzenie tego dnia — transport 0; brak ceny klienta — cennik", () => {
    const p = planBackfill({ ...ls, days: 2 }, relaks, list, true);
    expect(p).toMatchObject({ ready: true, baseNet: 1500, baseSource: "PRICE_LIST", transportNet: 0, totalNet: 1500 });
  });

  it("wariant z tytułu, a bez niego — niepewny", () => {
    expect(resolveVariant({ ...ls, title: "Relaks 2 głowice" }, relaks.prices)).toEqual({ variant: "double" });
    expect(resolveVariant(ls, [{ device: "LS_1G", days: 1, priceNet: 850 }, { device: "LS_2G", days: 1, priceNet: 1100 }])).toHaveProperty("reason");
    expect(planBackfill({ ...ls, category: null }, relaks, list, false)).toMatchObject({ ready: false });
    expect(planBackfill({ ...ls, days: 3 }, relaks, list, false)).toMatchObject({ ready: false, reason: "brak ceny dla 3 dni (ani w warunkach, ani w cenniku)" });
  });

  it("część na FV z warunków (Kolber)", () => {
    const p = planBackfill(ls, { ...relaks, invoiceMode: "PARTIAL", invoicePartDefault: 500, paymentForm: "OBA" }, list, false);
    expect(p).toMatchObject({ vatApplicable: true, invoicePart: 500, paymentMethod: "CASH" });
  });

  it("porównanie wpisanej kwoty z warunkami", () => {
    expect(compareWithTerms({ baseNet: 850, transportNet: 70, code: "LS_1G", days: 1 }, relaks, false)).toBeNull();
    expect(compareWithTerms({ baseNet: 850, transportNet: 0, code: "LS_1G", days: 1 }, relaks, true)).toBeNull();
    const c = compareWithTerms({ baseNet: 1000, transportNet: 100, code: "LS_1G", days: 1 }, relaks, false);
    expect(c).toMatchObject({ base: { expected: 850 }, transport: { expected: 70 }, big: true });
    expect(compareWithTerms({ baseNet: 900, transportNet: 70, code: "LS_1G", days: 1 }, relaks, false)).toMatchObject({ big: false });
  });
});
