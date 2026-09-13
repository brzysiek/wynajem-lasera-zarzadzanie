import { describe, expect, it } from "vitest";
import {
  comparisonPeriod,
  currentAndNextMonthPeriod,
  monthPeriod,
  periodFromParams,
  prevMonthPeriod,
  rangePeriod,
  seasonPeriod,
  seasonStartYearFor,
} from "./period";

describe("monthPeriod", () => {
  it("wrzesień 2026: 1–30, 30 dni", () => {
    const p = monthPeriod(2026, 9);
    expect(p.start.getFullYear()).toBe(2026);
    expect(p.start.getMonth()).toBe(8);
    expect(p.start.getDate()).toBe(1);
    expect(p.end.getMonth()).toBe(8);
    expect(p.end.getDate()).toBe(30);
    expect(p.dayCount).toBe(30);
    expect(p.label).toBe("Wrzesień 2026");
  });

  it("luty 2028 (przestępny): 29 dni", () => {
    expect(monthPeriod(2028, 2).dayCount).toBe(29);
  });

  it("prevMonthPeriod przez granicę roku: styczeń → grudzień poprzedniego roku", () => {
    const prev = prevMonthPeriod(monthPeriod(2026, 1));
    expect(prev.label).toBe("Grudzień 2025");
  });
});

describe("currentAndNextMonthPeriod", () => {
  it("wrzesień 2026: od 1 września do 31 października", () => {
    const p = currentAndNextMonthPeriod(new Date(2026, 8, 15));
    expect(p.start.getMonth()).toBe(8);
    expect(p.start.getDate()).toBe(1);
    expect(p.end.getMonth()).toBe(9);
    expect(p.end.getDate()).toBe(31);
    expect(p.dayCount).toBe(30 + 31);
  });

  it("przez granicę roku: grudzień → styczeń następnego roku", () => {
    const p = currentAndNextMonthPeriod(new Date(2026, 11, 10));
    expect(p.start.getFullYear()).toBe(2026);
    expect(p.start.getMonth()).toBe(11);
    expect(p.start.getDate()).toBe(1);
    expect(p.end.getFullYear()).toBe(2027);
    expect(p.end.getMonth()).toBe(0);
    expect(p.end.getDate()).toBe(31);
  });
});

describe("seasonPeriod", () => {
  it("2026/2027: 1 wrz 2026 – 31 sie 2027, 365 dni", () => {
    const p = seasonPeriod(2026);
    expect(p.start.getMonth()).toBe(8);
    expect(p.start.getDate()).toBe(1);
    expect(p.end.getFullYear()).toBe(2027);
    expect(p.end.getMonth()).toBe(7);
    expect(p.end.getDate()).toBe(31);
    expect(p.dayCount).toBe(365);
    expect(p.label).toBe("Sezon 2026/2027");
  });

  it("2027/2028 obejmuje luty 2028 (przestępny): 366 dni", () => {
    expect(seasonPeriod(2027).dayCount).toBe(366);
  });

  it("seasonStartYearFor: sierpień należy do sezonu z poprzedniego roku", () => {
    expect(seasonStartYearFor(new Date(2027, 1, 15))).toBe(2026); // luty 2027 → sezon 2026/2027
    expect(seasonStartYearFor(new Date(2026, 8, 1))).toBe(2026); // 1 wrz 2026 → sezon 2026/2027
    expect(seasonStartYearFor(new Date(2026, 7, 31))).toBe(2025); // 31 sie 2026 → sezon 2025/2026
  });
});

describe("rangePeriod", () => {
  it("liczy dni inclusive i odwraca odwrócony zakres", () => {
    expect(rangePeriod("2026-09-01", "2026-09-10").dayCount).toBe(10);
    expect(rangePeriod("2026-09-10", "2026-09-01").dayCount).toBe(10);
  });
});

describe("periodFromParams", () => {
  it("brak parametrów → tryb miesiąc", () => {
    expect(periodFromParams({}).mode).toBe("month");
  });
  it("mode=season z rokiem", () => {
    const p = periodFromParams({ mode: "season", s: "2025" });
    expect(p.label).toBe("Sezon 2025/2026");
  });
  it("mode=month z m=YYYY-MM", () => {
    expect(periodFromParams({ mode: "month", m: "2026-03" }).label).toBe("Marzec 2026");
  });
});

describe("comparisonPeriod", () => {
  it("Zakres → brak porównania", () => {
    expect(comparisonPeriod(rangePeriod("2026-09-01", "2026-09-30"))).toBeNull();
  });
  it("Miesiąc → poprzedni miesiąc", () => {
    expect(comparisonPeriod(monthPeriod(2026, 9))?.label).toBe("Sierpień 2026");
  });
  it("Sezon → poprzedni sezon", () => {
    expect(comparisonPeriod(seasonPeriod(2026))?.label).toBe("Sezon 2025/2026");
  });
});
