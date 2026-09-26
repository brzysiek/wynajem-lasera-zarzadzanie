import { describe, expect, it } from "vitest";
import { invoicePaymentStatus, paymentLabel, rentalWithoutInvoiceStatus } from "./payment-status";
import { buildTransactions, rentalRhythmDays, rhythmLabel, transactionTotals, typicalPayment, type TxInvoice, type TxRental } from "./transactions";

const today = new Date(2026, 8, 26, 12);
const d = (m: number, day: number, y = 2026) => new Date(y, m - 1, day, 10);

describe("invoicePaymentStatus", () => {
  it("zapłacona / gotówka / po terminie / oczekuje", () => {
    expect(invoicePaymentStatus({ paidAt: d(9, 20), paymentType: "transfer", paymentTo: d(9, 21), cashConfirmed: false }, today)).toEqual({
      kind: "ZAPLACONA",
      paidAt: d(9, 20),
    });
    expect(invoicePaymentStatus({ paidAt: null, paymentType: "cash", paymentTo: d(9, 1), cashConfirmed: false }, today).kind).toBe("GOTOWKA");
    expect(invoicePaymentStatus({ paidAt: null, paymentType: "transfer", paymentTo: d(9, 21), cashConfirmed: false }, today)).toEqual({
      kind: "PO_TERMINIE",
      days: 5,
    });
    expect(invoicePaymentStatus({ paidAt: null, paymentType: "transfer", paymentTo: d(9, 30), cashConfirmed: false }, today)).toEqual({
      kind: "OCZEKUJE",
      dueInDays: 4,
    });
  });
  it("wiersz bez faktury i etykiety", () => {
    expect(rentalWithoutInvoiceStatus({ startsAt: d(10, 10), cashConfirmed: false }, today).kind).toBe("ZAPLANOWANY");
    expect(rentalWithoutInvoiceStatus({ startsAt: d(7, 24), cashConfirmed: true }, today).kind).toBe("GOTOWKA");
    expect(rentalWithoutInvoiceStatus({ startsAt: d(12, 3, 2025), cashConfirmed: false }, today).kind).toBe("BEZ_FAKTURY");
    expect(paymentLabel({ kind: "PO_TERMINIE", days: 5 })).toBe("Po terminie 5 dni");
    expect(paymentLabel({ kind: "ZAPLACONA", paidAt: d(8, 28) })).toBe("Zapłacona 28.08");
  });
});

const rental = (p: Partial<TxRental> & { id: string; startsAt: Date }): TxRental => ({
  source: "panel",
  deviceName: "LightSheer Desire",
  details: null,
  totalNet: 1000,
  fakturowniaInvoiceId: null,
  cashConfirmed: false,
  ...p,
});
const invoice = (p: Partial<TxInvoice> & { id: string; fakturowniaInvoiceId: number; sellDate: Date }): TxInvoice => ({
  number: `FV ${p.id}`,
  issueDate: p.sellDate,
  totalNet: 1190,
  paymentTo: new Date(p.sellDate.getTime() + 7 * 86_400_000),
  paymentType: "transfer",
  paidAt: null,
  rentalId: null,
  positions: null,
  ...p,
});

describe("buildTransactions", () => {
  const rows = buildTransactions(
    [
      rental({ id: "future", startsAt: d(10, 10), totalNet: 2050 }),
      rental({ id: "r1", startsAt: d(9, 18), fakturowniaInvoiceId: 9 }),
      rental({ id: "r2", startsAt: d(8, 21) }),
      rental({ id: "cash", startsAt: d(7, 24), cashConfirmed: true }),
      rental({ id: "h1", source: "kalendarz", startsAt: d(12, 3, 2025), totalNet: null }),
    ],
    [
      invoice({ id: "a", fakturowniaInvoiceId: 9, sellDate: d(9, 18), number: "09/09/2026" }),
      invoice({ id: "b", fakturowniaInvoiceId: 7, sellDate: d(8, 22), paidAt: d(8, 28), totalNet: 1970 }),
      invoice({ id: "c", fakturowniaInvoiceId: 5, sellDate: d(3, 1), paidAt: d(3, 5) }),
    ],
    today,
  );

  it("faktura z panelu raz, faktura w ±7 dniach dołączona, reszta osobno", () => {
    expect(rows.map((r) => r.key)).toEqual(["r-future", "r-r1", "r-r2", "r-cash", "i-c", "r-h1"]);
    expect(rows.find((r) => r.key === "r-r1")).toMatchObject({ invoice: { number: "09/09/2026" }, status: { kind: "PO_TERMINIE", days: 1 } });
    expect(rows.find((r) => r.key === "r-r2")).toMatchObject({ net: 1970, status: { kind: "ZAPLACONA" } });
    expect(rows.find((r) => r.key === "r-future")?.status.kind).toBe("ZAPLANOWANY");
    expect(rows.find((r) => r.key === "r-cash")?.status.kind).toBe("GOTOWKA");
    expect(rows.find((r) => r.key === "r-h1")).toMatchObject({ source: "kalendarz", status: { kind: "BEZ_FAKTURY" } });
    expect(rows.find((r) => r.key === "i-c")?.source).toBe("faktura");
  });

  it("sumy do kafelków", () => {
    const t = transactionTotals(rows, today);
    expect(t).toMatchObject({
      invoicedNet: 1190 + 1970 + 1190,
      invoicedCount: 3,
      overdueNet: 1190,
      overdueCount: 1,
      oldestOverdue: { number: "09/09/2026", days: 1 },
      dueNet: 1190,
      withoutInvoice: 1,
      withoutInvoiceAllCalendar: true,
    });
    expect(typicalPayment(rows)).toBe("przelew, bywa po terminie");
  });
});

describe("rytm wynajmów", () => {
  it("mediana odstępów przy ≥ 3 wynajmach", () => {
    expect(rentalRhythmDays([d(1, 1), d(1, 29), d(2, 26), d(4, 1)])).toBe(28);
    expect(rentalRhythmDays([d(1, 1), d(2, 1)])).toBeNull();
    expect(rhythmLabel(28)).toBe("co ok. 4 tygodnie");
    expect(rhythmLabel(95)).toBe("co ok. 3 miesiące");
  });
});
