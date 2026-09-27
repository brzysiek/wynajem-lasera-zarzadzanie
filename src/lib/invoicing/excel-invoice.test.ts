import { describe, expect, it } from "vitest";
import { excelDay, parseExcelInvoice, paymentTypeOf, syntheticInvoiceId, type Cell } from "./excel-invoice";
import sample from "./fixtures/fv-2026-01-03.json";

// Szablon „Faktura wzór” (FV 03/01/2026, dane nabywcy zanonimizowane).
const rows = sample as Cell[][];

describe("faktura z Excela (wniosek 9)", () => {
  it("czyta numer, daty, nabywcę, NIP, płatność i pozycje", () => {
    const r = parseExcelInvoice(rows, "FV 2026_01_03 P. B. Trzaska.xls");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.invoice).toMatchObject({
      number: "03/01/2026",
      syntheticId: -202601003,
      issueDate: "2026-01-12",
      sellDate: "2026-01-09",
      buyerName: "Gabinet Testowy Anna Przykładowa",
      buyerAddress: "ul. Testowa 1, 30-001 Kraków",
      buyerTaxNo: "1234563218",
      paymentMethod: "przelew 7 dni",
      paymentTo: "2026-01-19",
      totalNet: 1180,
      totalGross: 1451.4,
    });
    expect(r.invoice.positions).toEqual([
      { name: "Wynajem lasera Lightsheer", net: 1100, gross: 1353 },
      { name: "Usługa transportowa", net: 80, gross: 98.4 },
    ]);
  });

  it("faktury Inżynierii są pomijane", () => {
    expect(parseExcelInvoice(rows, "FV IN_2026_01_2_ Porolex.xls")).toMatchObject({ ok: false, skip: true });
  });

  it("inny arkusz — czytelny błąd", () => {
    expect(parseExcelInvoice([["Cennik"], ["LightSheer", 1100]], "cennik.xls")).toMatchObject({ ok: false });
  });

  it("identyfikator stały i unikalny dla numeru", () => {
    expect(syntheticInvoiceId("03/01/2026")).toBe(-202601003);
    expect(syntheticInvoiceId("13/03/2026")).toBe(-202603013);
    expect(syntheticInvoiceId("014/03/2026")).toBe(-202603014);
    expect(syntheticInvoiceId("abc")).toBeNull();
  });

  it("daty w różnych zapisach i forma płatności", () => {
    expect(excelDay("12-01-2026 r.")).toBe("2026-01-12");
    expect(excelDay("19.01.2026 r.")).toBe("2026-01-19");
    expect(excelDay(46034)).toBe("2026-01-12");
    expect(paymentTypeOf("przelew 7 dni")).toBe("transfer");
    expect(paymentTypeOf("gotówka")).toBe("cash");
  });
});
