import { describe, expect, it } from "vitest";
import { churnRisk, completeness, computeRhythm, deviceConfig, forecastDates, headsFromText, isHoliday, monthsLabel, rhythmDays, seasonalBreak, type RhythmRental } from "./rhythm";

// Wynajem o 8:00 czasu polskiego (6:00 UTC).
const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 6));
const noon = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12));

// MiWiNi w skrócie: 2024 I–XI, 2025 I (×2)–VI i IX–XII, 2026 I–VI i IX;
// przerwa VII–VIII w 2025 i 2026. 24 z 29 w piątek, LightSheer 2 głowice.
const REALIZED: [number, number, number][] = [
  [2024, 1, 5], [2024, 2, 2], [2024, 3, 1], [2024, 3, 29], [2024, 4, 26], [2024, 5, 24], [2024, 6, 21], [2024, 7, 19], [2024, 8, 16], [2024, 9, 13], [2024, 10, 11],
  [2025, 1, 3], [2025, 1, 31], [2025, 2, 28], [2025, 3, 28], [2025, 4, 25], [2025, 5, 23], [2025, 6, 20], [2025, 9, 12], [2025, 10, 10], [2025, 11, 7], [2025, 12, 5],
  [2026, 1, 2], [2026, 1, 30], [2026, 2, 27], [2026, 3, 27], [2026, 4, 24], [2026, 5, 22], [2026, 9, 18],
];
// 5 wynajmów w czwartek (przesunięte o dzień) — 24 z 29 w piątek.
const THURSDAY = new Set(["2024-3-1", "2024-6-21", "2025-2-28", "2025-11-7", "2026-4-24"]);
const realized: RhythmRental[] = REALIZED.map(([y, m, d], i) => ({
  at: THURSDAY.has(`${y}-${m}-${d}`) ? at(y, m, d - 1) : at(y, m, d),
  device: i % 2 ? "LightSheer Desire" : "LightSheer Quattro",
  heads: i < 20 ? 2 : null,
}));
const planned: RhythmRental[] = [
  { at: at(2026, 10, 2), device: "LightSheer Quattro", heads: 2 },
  { at: at(2026, 10, 30), device: "LightSheer Quattro", heads: 2 },
];
const today = new Date(Date.UTC(2026, 8, 27, 10));

describe("rytm klienta (MiWiNi)", () => {
  const r = computeRhythm({ realized, planned, today });

  it("rytm 28 dni, piątek 24 z 29, przerwa VII–VIII", () => {
    expect(realized).toHaveLength(29);
    expect(r.rhythmDays).toBe(28);
    expect(r.preferredWeekday).toMatchObject({ day: 5, count: 24, total: 29 });
    expect(r.seasonalBreak).toEqual([7, 8]);
    expect(monthsLabel(r.seasonalBreak)).toBe("VII–VIII");
  });

  it("prognoza 27.11 i 18.12 (zamiast 25.12)", () => {
    expect(r.forecast).toEqual([noon(2026, 11, 27), noon(2026, 12, 18)]);
  });

  it("LightSheer, zawsze 2 głowice, modele", () => {
    expect(r.deviceConfig).toMatchObject({ family: "LightSheer", heads: 2, always: true });
    expect(r.deviceConfig?.models.map((m) => m.name).sort()).toEqual(["Desire", "Quattro"]);
  });

  it("ryzyko odejścia niskie (terminy zajęte do 30.10)", () => {
    expect(r.churnRisk).toMatchObject({ level: "niskie", ratio: 0 });
  });

  it("siatka lata × miesiące", () => {
    expect(r.grid.map((g) => g.year)).toEqual([2024, 2025, 2026]);
    const y26 = r.grid[2].months;
    expect(y26[8]).toEqual({ realized: 1, planned: 0, proposed: 0 });
    expect(y26[9]).toEqual({ realized: 0, planned: 2, proposed: 0 });
    expect(y26[10].proposed).toBe(1);
    expect(y26[11].proposed).toBe(1);
    expect(r.grid[1].months[0].realized).toBe(2);
    expect(r.grid[1].months[6].realized).toBe(0);
  });
});

describe("pola liczone — przypadki brzegowe", () => {
  it("rytm pomija długie przerwy, wymaga 3 wynajmów", () => {
    expect(rhythmDays([at(2026, 1, 2), at(2026, 1, 30)])).toBeNull();
    expect(rhythmDays([at(2026, 1, 2), at(2026, 1, 30), at(2026, 2, 27), at(2026, 6, 26), at(2026, 7, 24)])).toBe(28);
  });
  it("brak przerwy sezonowej przy jednym roku luki", () => {
    expect(seasonalBreak(REALIZED.slice(0, 11).map(([y, m, d]) => at(y, m, d)))).toEqual([]);
  });
  it("głowice z opisu wydarzenia", () => {
    expect(headsFromText("MiWiNi — 2 głowice")).toBe(2);
    expect(headsFromText("podwójna głowica")).toBe(2);
    expect(headsFromText("jedna głowica")).toBe(1);
    expect(headsFromText("MiWiNi")).toBeNull();
    expect(deviceConfig([])).toBeNull();
    // Jedno urządzenie — cała nazwa, nie pierwsze słowo („Alma”).
    const alma = deviceConfig(Array.from({ length: 8 }, () => ({ at: at(2026, 5, 1), device: "Alma Harmony XL", heads: null })));
    expect(alma).toMatchObject({ family: "Alma Harmony XL", models: [{ name: "Alma Harmony XL", count: 8 }] });
  });
  it("święta", () => {
    expect(isHoliday(noon(2026, 12, 25))).toBe(true);
    expect(isHoliday(noon(2026, 11, 11))).toBe(true);
    expect(isHoliday(noon(2026, 4, 6))).toBe(true); // poniedziałek wielkanocny 2026
    expect(isHoliday(noon(2026, 11, 27))).toBe(false);
  });
  it("prognoza bez rytmu albo przy rzadkich wynajmach — pusta", () => {
    expect(forecastDates({ lastPlanned: null, lastRealized: at(2026, 9, 18), rhythm: null, weekday: 5, breakMonths: [], today })).toEqual([]);
    expect(forecastDates({ lastPlanned: null, lastRealized: at(2026, 9, 18), rhythm: 200, weekday: 5, breakMonths: [], today })).toEqual([]);
  });
  it("prognoza przeskakuje przerwę sezonową", () => {
    const f = forecastDates({ lastPlanned: at(2027, 6, 18), lastRealized: null, rhythm: 28, weekday: 5, breakMonths: [7, 8], today });
    expect(f[0]).toEqual(noon(2027, 9, 10));
  });
  it("ryzyko odejścia: < 1,2 niskie, 1,2–2 średnie, > 2 wysokie", () => {
    expect(churnRisk(at(2026, 8, 28), 28, today)?.level).toBe("niskie");
    expect(churnRisk(at(2026, 8, 7), 28, today)?.level).toBe("średnie");
    expect(churnRisk(at(2026, 6, 1), 28, today)?.level).toBe("wysokie");
    expect(churnRisk(null, 28, today)).toBeNull();
  });
  it("kompletność", () => {
    expect(completeness({ nip: true, city: true, phone: false, email: true }, ["nip", "city", "phone", "email"])).toEqual({ percent: 75, missing: ["phone"] });
  });
});
