import { describe, expect, it } from "vitest";
import { isBeforeSeason, isBeforeSeasonAction, plannedContact, rhythmStrip, seasonWindow, statusCheck } from "./list-rules";

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
  it("wniosek 56: rezerwacja w następnym półroczu (styczeń) też zdejmuje z listy", () => {
    // wrzesień 2026: sezon IX–XII, rezerwacja 11.01.2027 wypada poza sezon, ale klientka już zarezerwowała
    expect(isBeforeSeason({ ...base, rentalDates: [d(2026, 4, 10)], bookedDates: [d(2027, 1, 11)] })).toBe(false);
    // rezerwacja w przeszłości (wynajem z bazy) nie zdejmuje — to nie jest przyszła rezerwacja
    expect(isBeforeSeason({ ...base, rentalDates: [d(2026, 4, 10)], bookedDates: [d(2026, 6, 5)] })).toBe(true);
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

describe("przed sezonem — do działania teraz (wniosek 58)", () => {
  const now = new Date(2026, 10, 19, 21, 0); // 19.11.2026
  const at = (m: number, day: number, y = 2026) => new Date(y, m - 1, day, 9);
  const base = { beforeSeason: true, steps: [], returns: [] };
  it("brak kroku → do działania", () => {
    expect(isBeforeSeasonAction(base, now)).toBe(true);
  });
  it("krok zaległy (18.11) albo na dziś → do działania", () => {
    expect(isBeforeSeasonAction({ ...base, steps: [{ at: at(11, 18), kind: "pole" }] }, now)).toBe(true);
    expect(isBeforeSeasonAction({ ...base, steps: [{ at: at(11, 19), kind: "zadanie" }] }, now)).toBe(true);
  });
  it("krok w przyszłości (23.11) → zaplanowane, z datą najbliższego kontaktu", () => {
    const c = { ...base, steps: [{ at: at(11, 30), kind: "zadanie" as const }, { at: at(11, 23), kind: "pole" as const }] };
    expect(isBeforeSeasonAction(c, now)).toBe(false);
    expect(plannedContact(c, now)).toMatchObject({ overdue: false, kind: "pole" });
    expect(plannedContact(c, now).plannedAt).toEqual(at(11, 23));
  });
  it("sygnał Odłożone z datą powrotu w przyszłości → zaplanowane (16.08.2027)", () => {
    const c = { ...base, returns: [{ at: at(8, 16, 2027), kind: "odlozone" as const }] };
    expect(isBeforeSeasonAction(c, now)).toBe(false);
    expect(plannedContact(c, now)).toMatchObject({ kind: "odlozone" });
  });
  it("ręczne uśpienie z datą powrotu w przyszłości → zaplanowane (31.01.2027); data minęła → do działania", () => {
    expect(isBeforeSeasonAction({ ...base, returns: [{ at: at(1, 31, 2027), kind: "uspiona" }] }, now)).toBe(false);
    expect(isBeforeSeasonAction({ ...base, returns: [{ at: at(11, 10), kind: "uspiona" }] }, now)).toBe(true);
  });
  it("zaległy krok przeważa nad przyszłym; przesunięcie kroku na wczoraj wraca na listę główną", () => {
    expect(isBeforeSeasonAction({ ...base, steps: [{ at: at(11, 18), kind: "pole" }, { at: at(11, 20), kind: "zadanie" }] }, now)).toBe(true);
    const planned = { ...base, steps: [{ at: at(11, 23), kind: "pole" as const }] };
    expect(isBeforeSeasonAction(planned, now)).toBe(false);
    expect(isBeforeSeasonAction({ ...planned, steps: [{ at: new Date(2026, 10, 18), kind: "pole" as const }] }, now)).toBe(true);
    // klientka wraca sama, gdy termin minie: ten sam krok 23.11, ale „dziś” to już 24.11
    expect(isBeforeSeasonAction(planned, new Date(2026, 10, 24, 8, 0))).toBe(true);
  });
  it("nie „przed sezonem” → nigdy do działania", () => {
    expect(isBeforeSeasonAction({ ...base, beforeSeason: false }, now)).toBe(false);
  });
});
