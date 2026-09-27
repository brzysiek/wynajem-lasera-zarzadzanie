import { describe, expect, it } from "vitest";
import { invoicePaymentStatus, paymentCoverage, paymentLabel, rentalWithoutInvoiceStatus } from "./payment-status";
import { buildTransactions, rentalRhythmDays, rhythmLabel, transactionTotals, typicalPayment, type TxInvoice, type TxRental } from "./transactions";

const today = new Date(2026, 8, 26, 12);
const d = (m: number, day: number, y = 2026) => new Date(y, m - 1, day, 10);

describe("invoicePaymentStatus", () => {
  it("wpłaty z wyciągów: po terminie tylko w sprawdzonym okresie, inaczej „nie sprawdzono”", () => {
    const cov = { from: d(9, 1), to: d(9, 24) };
    const base = { paidAt: null, paymentType: "transfer", cashConfirmed: false };
    // FV 03/04/2026 — sprzed początku śledzenia wpłat.
    expect(invoicePaymentStatus({ ...base, issueDate: d(4, 21), paymentTo: d(4, 28) }, today, cov)).toEqual({ kind: "NIE_SPRAWDZONO", days: 151 });
    // Termin po ostatnim dniu wyciągu.
    expect(invoicePaymentStatus({ ...base, issueDate: d(9, 18), paymentTo: d(9, 25) }, today, cov)).toEqual({ kind: "NIE_SPRAWDZONO", days: 1 });
    // Termin 3 dni przed końcem wyciągu — przelew mógł się jeszcze nie zaksięgować.
    expect(invoicePaymentStatus({ ...base, issueDate: d(9, 14), paymentTo: d(9, 21) }, today, cov)).toEqual({ kind: "NIE_SPRAWDZONO", days: 5 });
    // Sprawdzona, bez przelewu: „po terminie” tylko u klienta płacącego przelewem.
    expect(invoicePaymentStatus({ ...base, issueDate: d(9, 2), paymentTo: d(9, 9), clientPaymentForm: "PRZELEW" }, today, cov)).toEqual({ kind: "PO_TERMINIE", days: 17 });
    expect(invoicePaymentStatus({ ...base, issueDate: d(9, 2), paymentTo: d(9, 9) }, today, cov)).toEqual({ kind: "BRAK_PRZELEWU", days: 17 });
    expect(invoicePaymentStatus({ ...base, issueDate: d(9, 2), paymentTo: d(9, 9), clientPaymentForm: "OBA" }, today, cov)).toEqual({ kind: "BRAK_PRZELEWU", days: 17 });
    // Gotówka oznaczona ręcznie.
    const cash = invoicePaymentStatus({ ...base, paidAt: d(9, 12), paidMethod: "CASH", paidReceivedBy: "Marek", issueDate: d(9, 2), paymentTo: d(9, 9) }, today, cov);
    expect(cash).toMatchObject({ kind: "ZAPLACONA", method: "CASH", receivedBy: "Marek" });
    expect(paymentLabel(cash)).toBe("Gotówka 12.09 · Marek");
    expect(paymentLabel({ kind: "BRAK_PRZELEWU", days: 3 })).toBe("Brak przelewu");
    // Bez żadnego wyciągu.
    expect(invoicePaymentStatus({ ...base, issueDate: d(9, 2), paymentTo: d(9, 9) }, today, null).kind).toBe("NIE_SPRAWDZONO");
    // Częściowa wpłata przelewem.
    expect(invoicePaymentStatus({ ...base, paidAt: d(9, 10), paidAmount: 500, totalGross: 1451.4, issueDate: d(9, 2), paymentTo: d(9, 9) }, today, cov)).toMatchObject({ kind: "ZAPLACONA", paidAt: d(9, 10), partial: true });
    expect(paymentLabel({ kind: "NIE_SPRAWDZONO", days: 152 })).toBe("Nie sprawdzono");
    expect(paymentLabel({ kind: "ZAPLACONA", paidAt: d(9, 10), partial: true })).toBe("Częściowo zapłacona 10.09");
  });
  it("okres sprawdzony przez wyciągi", () => {
    expect(paymentCoverage([])).toBeNull();
    const since = new Date("2026-09-01T12:00:00.000Z");
    const c = paymentCoverage([
      { periodFrom: new Date("2026-08-01T12:00:00Z"), periodTo: new Date("2026-09-15T12:00:00Z"), uploadedAt: new Date("2026-09-16T08:00:00Z") },
      { periodFrom: null, periodTo: null, uploadedAt: new Date("2026-09-10T08:00:00Z") },
    ]);
    expect(c).toEqual({ from: since, to: new Date("2026-09-15T12:00:00Z") });
  });
  it("zapłacona / gotówka / po terminie / oczekuje (sprawdzone wyciągiem)", () => {
    const track = { from: d(1, 1), to: d(9, 30) };
    expect(invoicePaymentStatus({ paidAt: d(9, 20), paymentType: "transfer", paymentTo: d(9, 21), cashConfirmed: false }, today)).toEqual({
      kind: "ZAPLACONA",
      paidAt: d(9, 20),
      partial: false,
      method: null,
      receivedBy: null,
    });
    expect(invoicePaymentStatus({ paidAt: null, paymentType: "cash", paymentTo: d(9, 1), cashConfirmed: false }, today).kind).toBe("GOTOWKA");
    expect(invoicePaymentStatus({ paidAt: null, paymentType: "transfer", paymentTo: d(9, 21), cashConfirmed: false, clientPaymentForm: "PRZELEW" }, today, track)).toEqual({
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
    expect(paymentLabel({ kind: "ZAPLACONA", paidAt: d(8, 28), partial: false })).toBe("Zapłacona 28.08");
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
    { from: d(1, 1), to: d(9, 30) },
    "PRZELEW",
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
    expect(typicalPayment(rows)).toBe("gotówka i przelew, bywa po terminie");
  });

  it("MiWiNi bez wyciągu obejmującego FV: nigdzie „po terminie”, należność „nie sprawdzono”", () => {
    const cov = { from: d(9, 1), to: d(9, 24) };
    const rows2 = buildTransactions([rental({ id: "r1", startsAt: d(4, 24), fakturowniaInvoiceId: 9 })], [invoice({ id: "a", fakturowniaInvoiceId: 9, sellDate: d(4, 24) })], today, cov);
    expect(rows2[0].status).toEqual({ kind: "NIE_SPRAWDZONO", days: 148 });
    const t = transactionTotals(rows2, today, cov);
    expect(t).toMatchObject({ overdueCount: 0, oldestOverdue: null, dueCount: 0, uncheckedCount: 1, uncheckedNet: 1190, paymentsAsOf: d(9, 24).toISOString(), paymentsFrom: d(9, 1).toISOString() });
    expect(typicalPayment(rows2)).toBe("przelew");
  });
  it("typicalPayment: jedna faktura kilka dni po terminie to nie „zaległości”", () => {
    const cov = { from: d(9, 1), to: d(9, 25) };
    const one = buildTransactions([], [invoice({ id: "a", fakturowniaInvoiceId: 9, sellDate: d(9, 2) })], today, cov, "PRZELEW");
    expect(one[0].status).toEqual({ kind: "PO_TERMINIE", days: 17 });
    expect(typicalPayment(one)).toBe("przelew");
    const two = buildTransactions([], [invoice({ id: "a", fakturowniaInvoiceId: 9, sellDate: d(9, 2) }), invoice({ id: "b", fakturowniaInvoiceId: 8, sellDate: d(9, 3) })], today, cov, "PRZELEW");
    expect(typicalPayment(two)).toBe("przelew, zaległości");
  });
  it("MiWiNi: raz gotówka, raz przelew — bez przelewu to nie „po terminie”", () => {
    const cov = { from: d(9, 1), to: d(9, 25) };
    const rows3 = buildTransactions(
      [],
      [
        invoice({ id: "a", fakturowniaInvoiceId: 9, sellDate: d(9, 2), paidAt: d(9, 5), paidMethod: "CASH", paidReceivedBy: "Marek" }),
        invoice({ id: "b", fakturowniaInvoiceId: 8, sellDate: d(9, 3), paidAt: d(9, 8), paidMethod: "TRANSFER" }),
        invoice({ id: "c", fakturowniaInvoiceId: 7, sellDate: d(9, 4) }),
      ],
      today,
      cov,
      "OBA",
    );
    expect(rows3.map((r) => r.status.kind)).toEqual(["BRAK_PRZELEWU", "ZAPLACONA", "ZAPLACONA"]);
    expect(transactionTotals(rows3, today, cov)).toMatchObject({ overdueCount: 0, noTransferCount: 1, paidCount: 2 });
    expect(typicalPayment(rows3, "OBA")).toBe("gotówka i przelew");
    expect(typicalPayment(rows3)).toBe("gotówka i przelew");
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

describe("godzina dostawy", () => {
  it("deliveryTime, prefiks tytułu, całodniowe bez godziny", async () => {
    const { rentalTimeOf } = await import("../rental-title");
    const allDay = new Date("2026-10-02T12:00:00.000Z");
    expect(rentalTimeOf({ deliveryTime: "9:30", title: "MIWINI", startsAt: allDay })).toBe("09:30");
    expect(rentalTimeOf({ title: "10:00 MIWINI", startsAt: allDay })).toBe("10:00");
    expect(rentalTimeOf({ title: "MIWINI", startsAt: allDay })).toBeNull();
    expect(rentalTimeOf({ title: "MIWINI", startsAt: new Date("2026-10-02T08:00:00.000Z") })).toBe("10:00");
  });
});
