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
      invoicePending: false,
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

  it("„część” bez kwoty: VAT, FV do ustalenia (Kolber, Garcia)", () => {
    const p = planBackfill(ls, { ...relaks, invoiceMode: "PARTIAL", invoicePartDefault: null }, list, false);
    expect(p).toMatchObject({ vatApplicable: true, invoicePart: null, invoicePending: true });
  });

  it("MiWiNi: po akceptacji ceny LS_2G wariant z tabeli klienta", () => {
    const miwini: PlanTerms = { ...relaks, prices: [{ device: "LS_2G", days: 1, priceNet: 1000 }] };
    expect(resolveVariant({ ...ls, title: "MIWINI" }, [])).toHaveProperty("reason");
    expect(planBackfill({ ...ls, title: "MIWINI" }, miwini, list, false)).toMatchObject({ ready: true, variant: "double", baseNet: 1000, baseSource: "CLIENT_TERMS" });
  });

  it("Estetic: „2 głowice” z cennika, klient ma tylko 1 głowicę — rozbieżność", () => {
    const estetic: PlanTerms = { ...relaks, transportNet: 0, prices: [{ device: "LS_1G", days: 2, priceNet: 1300 }] };
    const c = compareWithTerms({ baseNet: 1900, transportNet: 0, category: "LIGHTSHEER_VARIANT", variant: "double", days: 2 }, estetic, false);
    expect(c).toMatchObject({ base: { expected: 1300, otherVariant: "LS_1G" }, transport: null, big: true });
  });

  it("porównanie wpisanej kwoty z warunkami", () => {
    expect(compareWithTerms({ baseNet: 850, transportNet: 70, category: "LIGHTSHEER_VARIANT", variant: "single_standard", days: 1 }, relaks, false)).toBeNull();
    expect(compareWithTerms({ baseNet: 850, transportNet: 0, category: "LIGHTSHEER_VARIANT", variant: "single_standard", days: 1 }, relaks, true)).toBeNull();
    const c = compareWithTerms({ baseNet: 1000, transportNet: 100, category: "LIGHTSHEER_VARIANT", variant: "single_standard", days: 1 }, relaks, false);
    expect(c).toMatchObject({ base: { expected: 850 }, transport: { expected: 70 }, big: true });
    expect(compareWithTerms({ baseNet: 900, transportNet: 70, category: "LIGHTSHEER_VARIANT", variant: "single_standard", days: 1 }, relaks, false)).toMatchObject({ big: false });
  });
});
