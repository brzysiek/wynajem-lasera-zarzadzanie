import { describe, expect, it } from "vitest";
import { daysSince, suggestInvoices, type FvInvoiceCandidate } from "./fv-check";

const rental = {
  startsAt: new Date("2026-09-10T00:00:00Z"),
  endsAt: new Date("2026-09-12T00:00:00Z"),
  clientId: "c1",
  nip: "6790001122",
  deviceName: "LightSheer Desire",
};

function inv(p: Partial<FvInvoiceCandidate>): FvInvoiceCandidate {
  return {
    id: "i1",
    number: "FV 1/09/2026",
    sellDate: new Date("2026-09-12T00:00:00Z"),
    buyerName: "Gabinet",
    buyerTaxNo: null,
    clientId: "c1",
    totalGross: "2460",
    positionsSummary: "Wynajem LightSheer Desire 3 dni",
    ...p,
  };
}

describe("suggestInvoices", () => {
  it("ten sam klient, data w trakcie, urządzenie w pozycjach", () => {
    const [s] = suggestInvoices(rental, [inv({})]);
    expect(s.reasons).toEqual(["ten sam klient", "urządzenie w pozycjach", "data w trakcie wynajmu"]);
  });
  it("po NIP, gdy faktura nie ma klienta", () => {
    const [s] = suggestInvoices(rental, [inv({ clientId: null, buyerTaxNo: "6790001122", positionsSummary: null, sellDate: new Date("2026-09-15T00:00:00Z") })]);
    expect(s.reasons).toEqual(["ten sam NIP", "data ±3 dni"]);
  });
  it("inny klient albo poza oknem ±7 dni — brak", () => {
    expect(suggestInvoices(rental, [inv({ clientId: "c2" })])).toEqual([]);
    expect(suggestInvoices(rental, [inv({ sellDate: new Date("2026-09-20T00:00:00Z") })])).toEqual([]);
    expect(suggestInvoices(rental, [inv({ sellDate: new Date("2026-09-02T00:00:00Z") })])).toEqual([]);
  });
  it("najlepsza pierwsza, maksymalnie 3", () => {
    const list = suggestInvoices(rental, [
      inv({ id: "a", positionsSummary: "Transport", sellDate: new Date("2026-09-18T00:00:00Z") }),
      inv({ id: "b" }),
      inv({ id: "c", positionsSummary: null }),
      inv({ id: "d", positionsSummary: null, sellDate: new Date("2026-09-17T00:00:00Z") }),
    ]);
    expect(list.map((s) => s.id)).toEqual(["b", "c", "d"]);
  });
});

describe("daysSince", () => {
  it("pełne dni, nigdy ujemne", () => {
    expect(daysSince(new Date("2026-09-12T00:00:00Z"), new Date("2026-09-15T12:00:00Z"))).toBe(3);
    expect(daysSince(new Date("2026-09-20T00:00:00Z"), new Date("2026-09-15T00:00:00Z"))).toBe(0);
  });
});
