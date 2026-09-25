import { describe, expect, it } from "vitest";
import { summarizeClient, type ClientRentalFact } from "./summary";

const today = new Date(2026, 9, 1, 12);
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 10);

function rental(p: Partial<ClientRentalFact> & { startsAt: Date }): ClientRentalFact {
  return {
    endsAt: new Date(p.startsAt.getTime() + 86_400_000),
    eventType: "WYNAJEM",
    deletedInGoogle: false,
    confirmedAt: null,
    totalNet: 1000,
    interest: "LIGHTSHEER",
    ...p,
  };
}

describe("summarizeClient", () => {
  it("klient bez wynajmów", () => {
    const s = summarizeClient({ statusOverride: null, rentals: [], today });
    expect(s).toMatchObject({ status: "POTENCJALNY", rentalsTotal: 0, rentals12m: 0, lastRentalAt: null, revenueNet: 0, avgRentalNet: null, favoriteDevice: null });
  });

  it("liczy wynajmy 12 mies. / łącznie, ostatni wynajem i przychód", () => {
    const s = summarizeClient({
      statusOverride: null,
      rentals: [
        rental({ startsAt: day(2026, 9, 10), totalNet: 1500 }), // przed 22.09 → zrealizowany
        rental({ startsAt: day(2026, 3, 1), totalNet: 1000, interest: "ALMA_HARMONY" }),
        rental({ startsAt: day(2024, 5, 1), totalNet: 800 }), // > 12 mies.
      ],
      today,
    });
    expect(s.rentalsTotal).toBe(3);
    expect(s.rentals12m).toBe(2);
    expect(s.lastRentalAt).toEqual(day(2026, 9, 10));
    expect(s.revenueNet).toBe(3300);
    expect(s.avgRentalNet).toBe(1100);
    expect(s.status).toBe("STALY");
    expect(s.favoriteDevice).toBe("LIGHTSHEER");
    expect(s.rentedDevices).toEqual(["LIGHTSHEER", "ALMA_HARMONY"]);
  });

  it("przyszła rezerwacja nie jest ani wynajmem zrealizowanym, ani przychodem", () => {
    const s = summarizeClient({ statusOverride: null, rentals: [rental({ startsAt: day(2026, 10, 20), totalNet: 2000 })], today });
    expect(s).toMatchObject({ rentalsTotal: 0, revenueNet: 0, status: "POTENCJALNY" });
  });

  it("niepotwierdzony wynajem po 22.09 nie liczy się jeszcze do wynajmów, ale przychód już tak", () => {
    const s = summarizeClient({ statusOverride: null, rentals: [rental({ startsAt: day(2026, 9, 25), totalNet: 900 })], today });
    expect(s.rentalsTotal).toBe(0);
    expect(s.revenueNet).toBe(900);
  });

  it("szkolenie wchodzi do przychodu, ale nie do liczby wynajmów", () => {
    const s = summarizeClient({
      statusOverride: null,
      rentals: [rental({ startsAt: day(2026, 8, 1), eventType: "SZKOLENIE", totalNet: 600, interest: null })],
      today,
    });
    expect(s.rentalsTotal).toBe(0);
    expect(s.revenueNet).toBe(600);
  });

  it("usunięty w Google nie liczy się nigdzie", () => {
    const s = summarizeClient({ statusOverride: null, rentals: [rental({ startsAt: day(2026, 8, 1), deletedInGoogle: true })], today });
    expect(s).toMatchObject({ rentalsTotal: 0, revenueNet: 0 });
  });

  it("wynajem bez rozliczenia nie psuje średniej", () => {
    const s = summarizeClient({
      statusOverride: null,
      rentals: [rental({ startsAt: day(2026, 8, 1), totalNet: 1000 }), rental({ startsAt: day(2026, 7, 1), totalNet: null })],
      today,
    });
    expect(s.rentalsTotal).toBe(2);
    expect(s.avgRentalNet).toBe(1000);
  });

  it("historia z kalendarzy liczy się do statusu i „klient od”, ale nie do przychodu", () => {
    const s = summarizeClient({
      statusOverride: null,
      rentals: [
        rental({ startsAt: day(2026, 9, 10), totalNet: 1500 }),
        rental({ startsAt: day(2026, 6, 1), totalNet: null, historical: true }),
        rental({ startsAt: day(2024, 3, 5), totalNet: null, historical: true }),
        rental({ startsAt: day(2025, 1, 1), totalNet: null, historical: true, eventType: "SZKOLENIE", interest: null }),
      ],
      today,
    });
    expect(s.status).toBe("STALY");
    expect(s.rentalsTotal).toBe(3); // szkolenie się nie liczy
    expect(s.firstSeenAt).toEqual(day(2024, 3, 5));
    expect(s.revenueNet).toBe(1500);
    expect(s.avgRentalNet).toBe(1500);
  });

  it("historyczny wynajem po 22.09 bez potwierdzenia też jest zrealizowany", () => {
    const s = summarizeClient({
      statusOverride: null,
      rentals: [rental({ startsAt: day(2026, 9, 25), totalNet: null, historical: true })],
      today,
    });
    expect(s.status).toBe("NOWY");
  });

  it("faktury: dowód wynajmu tylko bez wynajmu w pobliżu, suma osobno od przychodu", () => {
    const s = summarizeClient({
      statusOverride: null,
      rentals: [rental({ startsAt: day(2026, 6, 10), totalNet: 1500 })],
      invoices: [
        { sellDate: day(2026, 6, 12), totalNet: 1500, hasRental: false, interest: "LIGHTSHEER" }, // przy wynajmie
        { sellDate: day(2026, 2, 1), totalNet: 900, hasRental: false, interest: "ALMA_HARMONY" }, // osobny wynajem
      ],
      today,
    });
    expect(s.rentalsTotal).toBe(2);
    expect(s.status).toBe("STALY");
    expect(s.revenueNet).toBe(1500);
    expect(s.invoicedNet).toBe(2400);
    expect(s.invoicesCount).toBe(2);
    expect(s.firstSeenAt).toEqual(day(2026, 2, 1));
    expect(s.rentedDevices).toContain("ALMA_HARMONY");
  });
});
