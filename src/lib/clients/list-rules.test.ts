import { describe, expect, it } from "vitest";
import { isBeforeSeason, rhythmStrip, seasonWindow, statusCheck } from "./list-rules";

const today = new Date(2026, 8, 27, 12); // 27.09.2026
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 10);

describe("przed sezonem — pętla półroczy", () => {
  it("wrzesień: baza I–VIII, sezon IX–XII („jesień 2026”)", () => {
    const w = seasonWindow(today);
    expect(w.label).toBe("jesień 2026");
    expect(w.baseLabel).toBe("I–VIII 2026");
    expect(w.flip).toContain("Od 1 stycznia");
  });
  it("luty: baza IX–XII poprzedniego roku, sezon I–VIII", () => {
    const w = seasonWindow(new Date(2027, 1, 10));
    expect(w.label).toBe("wiosna 2027");
    expect(w.baseLabel).toBe("IX–XII 2026");
    expect(w.baseFrom).toEqual(new Date(2026, 8, 1));
  });
  const w = seasonWindow(today);
  const base = { status: "STALY" as const, seasonalBreak: [], window: w, today };
  it("wynajmowała wiosną, jesienią nic → na liście", () => {
    expect(isBeforeSeason({ ...base, rentalDates: [d(2026, 4, 10), d(2026, 6, 5)], bookedDates: [] })).toBe(true);
  });
  it("rezerwacja w X albo wynajem we IX → nie", () => {
    expect(isBeforeSeason({ ...base, rentalDates: [d(2026, 4, 10)], bookedDates: [d(2026, 10, 23)] })).toBe(false);
    expect(isBeforeSeason({ ...base, rentalDates: [d(2026, 4, 10), d(2026, 9, 4)], bookedDates: [] })).toBe(false);
  });
  it("trwająca przerwa sezonowa, Nie kontaktować, potencjalna → nie", () => {
    expect(isBeforeSeason({ ...base, rentalDates: [d(2026, 4, 10)], bookedDates: [], seasonalBreak: [9] })).toBe(false);
    expect(isBeforeSeason({ ...base, status: "NIE_KONTAKTOWAC", rentalDates: [d(2026, 4, 10)], bookedDates: [] })).toBe(false);
  });
});

describe("pasek rytmu 12 + 3", () => {
  it("MiWiNi: rezerwacje X i XII, w XI wg rytmu bez rezerwacji", () => {
    const s = rhythmStrip({
      realized: [d(2025, 10, 10), d(2025, 11, 7), d(2026, 5, 22), d(2026, 9, 4)],
      planned: [d(2026, 10, 2), d(2026, 10, 30), d(2026, 12, 4)],
      forecast: [],
      rhythmDays: 28,
      seasonalBreak: [7, 8],
      today,
    });
    expect(s.pastLabel).toBe("X.25–IX.26");
    expect(s.futureLabel).toBe("X–XII");
    expect(s.cells.slice(12)).toEqual(["P", "F", "P"]);
    expect(s.cells[0]).toBe("R"); // X.2025
    expect(s.cells[11]).toBe("R"); // IX.2026
    expect(s.suggestion?.month).toBe(11);
    expect(s.suggestion?.at.getDate()).toBe(27); // 30.10 + 28 dni
  });
  it("bez rytmu — przyszłe miesiące puste; przerwa sezonowa nie jest okazją", () => {
    expect(rhythmStrip({ realized: [d(2026, 9, 10)], planned: [], forecast: [], rhythmDays: null, seasonalBreak: [], today }).cells.slice(12)).toEqual(["E", "E", "E"]);
    const s = rhythmStrip({ realized: [d(2026, 9, 10)], planned: [], forecast: [], rhythmDays: 28, seasonalBreak: [10, 11, 12], today });
    expect(s.cells.slice(12)).toEqual(["E", "E", "E"]);
  });
  it("była klientka (ponad rok) — bez okazji", () => {
    expect(rhythmStrip({ realized: [d(2024, 11, 28)], planned: [], forecast: [], rhythmDays: 28, seasonalBreak: [], today }).cells.slice(12)).toEqual(["E", "E", "E"]);
  });
});

describe("do sprawdzenia", () => {
  it("Nie kontaktować z rezerwacją", () => {
    expect(statusCheck({ status: "NIE_KONTAKTOWAC", realizedDates: [], unconfirmedPast: [], nextReservation: d(2026, 10, 23), today })).toBe("„Nie kontaktować”, a ma rezerwację 23.10");
  });
  it("niepotwierdzony odbiór podniósłby status", () => {
    const msg = statusCheck({ status: "NOWY", realizedDates: [d(2026, 5, 1)], unconfirmedPast: [d(2026, 9, 25)], nextReservation: null, today });
    expect(msg).toContain("25.09");
    expect(msg).toContain("Stały");
    expect(statusCheck({ status: "STALY", realizedDates: [d(2026, 5, 1), d(2026, 6, 1)], unconfirmedPast: [d(2026, 9, 25)], nextReservation: null, today })).toBeNull();
  });
});
