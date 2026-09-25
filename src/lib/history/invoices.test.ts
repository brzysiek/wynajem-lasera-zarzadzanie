import { describe, expect, it } from "vitest";
import { interestsFromText, invoiceOnlyRentalDates } from "./invoices";

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
