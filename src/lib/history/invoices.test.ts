import { describe, expect, it } from "vitest";
import { interestsFromText, invoiceOnlyRentalDates, vetoNameMatchOnNipConflict } from "./invoices";

const d = (m: number, day: number) => new Date(2026, m - 1, day, 12);

describe("interestsFromText", () => {
  it("rozpoznaje urządzenia z pozycji", () => {
    expect(interestsFromText("Wynajem lasera LightSheer Desire 2 dni; Transport")).toEqual(["LIGHTSHEER"]);
    expect(interestsFromText("Najem urządzenia Alma Harmony XL Pro (DYE-VL)")).toEqual(["ALMA_HARMONY"]);
    expect(interestsFromText("LightSheer ET400")).toEqual(["LIGHTSHEER_ET400", "LIGHTSHEER"]);
    expect(interestsFromText("Transport")).toEqual([]);
    expect(interestsFromText(null)).toEqual([]);
  });
});

describe("invoiceOnlyRentalDates", () => {
  const rentals = [{ startsAt: d(3, 10), endsAt: d(3, 11) }];

  it("faktura przy znanym wynajmie się nie liczy", () => {
    expect(invoiceOnlyRentalDates([{ sellDate: d(3, 17), hasRental: false }], rentals)).toEqual([]);
    expect(invoiceOnlyRentalDates([{ sellDate: d(3, 3), hasRental: false }], rentals)).toEqual([]);
  });

  it("faktura z wynajmu w panelu się nie liczy", () => {
    expect(invoiceOnlyRentalDates([{ sellDate: d(6, 1), hasRental: true }], rentals)).toEqual([]);
  });

  it("faktura bez wynajmu w pobliżu = wynajem; dwie bliskie = jeden", () => {
    const r = invoiceOnlyRentalDates(
      [
        { sellDate: d(5, 1), hasRental: false },
        { sellDate: d(5, 5), hasRental: false },
        { sellDate: d(3, 19), hasRental: false },
      ],
      rentals,
    );
    expect(r).toEqual([d(3, 19), d(5, 1)]);
  });
});

describe("NIP przed nazwą", () => {
  const auto = { clientId: "joanna", method: "NAME_AUTO", state: "AUTO", score: 0.95 };
  const nips: Record<string, string | null> = { joanna: "6621249644", miwini: "9441828201", bez: null };
  it("inny NIP klienta — faktura czeka na decyzję", () => {
    expect(vetoNameMatchOnNipConflict(auto, "9441828201", (id) => nips[id])).toEqual({ clientId: null, method: null, state: "SUGGESTED", score: 0.95 });
  });
  it("ten sam NIP, klient bez NIP albo faktura bez NIP — bez zmian", () => {
    expect(vetoNameMatchOnNipConflict(auto, "6621249644", (id) => nips[id])).toBe(auto);
    expect(vetoNameMatchOnNipConflict({ ...auto, clientId: "bez" }, "9441828201", (id) => nips[id]).clientId).toBe("bez");
    expect(vetoNameMatchOnNipConflict(auto, null, (id) => nips[id])).toBe(auto);
  });
  it("dopasowanie po NIP albo ręczne (alias) nie jest wetowane", () => {
    const manual = { ...auto, method: "MANUAL", state: "CONFIRMED" };
    expect(vetoNameMatchOnNipConflict(manual, "9441828201", (id) => nips[id])).toBe(manual);
  });
});
