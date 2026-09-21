import { describe, expect, it } from "vitest";
import { computeHeatmap } from "./heatmap";
import type { RevenueRow } from "./aggregate";

function row(over: Partial<RevenueRow>): RevenueRow {
  return {
    id: Math.random().toString(36),
    eventType: "WYNAJEM",
    deviceId: "a",
    deviceName: "A",
    startsAt: "2026-09-01T12:00:00.000Z",
    startDate: "2026-09-01",
    endDate: "2026-09-01",
    durationDays: 1,
    totalNet: 1000,
    paymentMethod: "TRANSFER",
    pulsePending: false,
    hubspotContactId: null,
    contactLabel: null,
    confirmed: false,
    ...over,
  };
}

const MONTH = { mode: "month" as const, start: "2026-09-01", end: "2026-09-30" };

describe("computeHeatmap — tryb siatki", () => {
  it("Miesiąc → siatka miesięczna; Sezon/Zakres → ciągła", () => {
    expect(computeHeatmap([], new Set(["a"]), MONTH, "revenue").gridMode).toBe("month");
    expect(
      computeHeatmap([], new Set(["a"]), { mode: "season", start: "2026-09-01", end: "2027-08-31" }, "revenue").gridMode,
    ).toBe("continuous");
  });

  it("wrzesień 2026 zaczyna się we wtorek → pierwsza komórka to poniedziałek 31 sie (pad)", () => {
    const h = computeHeatmap([], new Set(["a"]), MONTH, "revenue");
    const first = h.weeks[0][0];
    expect(first.inPeriod).toBe(false);
    expect(first.weekday).toBe(0); // poniedziałek
  });
});

describe("computeHeatmap — Przychód", () => {
  it("sumuje totalNet wg dnia startu, tylko wybrane urządzenia, skala względem maksimum", () => {
    const rows = [
      row({ deviceId: "a", startDate: "2026-09-01", endDate: "2026-09-01", totalNet: 500 }),
      row({ deviceId: "a", startDate: "2026-09-01", endDate: "2026-09-01", totalNet: 500 }),
      row({ deviceId: "b", startDate: "2026-09-02", endDate: "2026-09-02", totalNet: 9999 }),
    ];
    const h = computeHeatmap(rows, new Set(["a"]), MONTH, "revenue");
    const day1 = h.weeks.flat().find((d) => d.key === "2026-09-01")!;
    const day2 = h.weeks.flat().find((d) => d.key === "2026-09-02")!;
    expect(day1.value).toBe(1000);
    expect(day2.value).toBe(0); // urządzenie b odfiltrowane
    expect(h.maxValue).toBe(1000);
    expect(day1.level).toBe(5); // 1000/1000
  });

  it("dzień z wartością 0 → poziom 1 (nie brak koloru)", () => {
    const h = computeHeatmap([row({})], new Set(["a"]), MONTH, "revenue");
    const empty = h.weeks.flat().find((d) => d.inPeriod && d.key === "2026-09-15")!;
    expect(empty.value).toBe(0);
    expect(empty.level).toBe(1);
  });
});

describe("computeHeatmap — Obłożenie", () => {
  it("liczy cały zakres dat wynajmu, kolor wg proporcji X/Y", () => {
    // 1 wynajem urządzenia a, 1–3 września. Y = 2 wybrane urządzenia.
    const rows = [row({ deviceId: "a", startDate: "2026-09-01", endDate: "2026-09-03" })];
    const h = computeHeatmap(rows, new Set(["a", "b"]), MONTH, "occupancy");
    const grid = h.weeks.flat();
    for (const key of ["2026-09-01", "2026-09-02", "2026-09-03"]) {
      const d = grid.find((x) => x.key === key)!;
      expect(d.occX).toBe(1);
      expect(d.occY).toBe(2);
      expect(d.value).toBeCloseTo(0.5);
      expect(d.level).toBe(3); // ceil(0.5*5)=3
    }
    const d4 = grid.find((x) => x.key === "2026-09-04")!;
    expect(d4.occX).toBe(0);
    expect(d4.level).toBe(1);
  });

  it("SZKOLENIE nie wchodzi do obłożenia", () => {
    const rows = [row({ eventType: "SZKOLENIE", deviceId: "a", startDate: "2026-09-05", endDate: "2026-09-05" })];
    const h = computeHeatmap(rows, new Set(["a"]), MONTH, "occupancy");
    const d = h.weeks.flat().find((x) => x.key === "2026-09-05")!;
    expect(d.occX).toBe(0);
  });

  it("nic nie zaznaczone → empty, brak dzielenia przez zero", () => {
    const h = computeHeatmap([row({})], new Set(), MONTH, "occupancy");
    expect(h.empty).toBe(true);
    expect(h.weeks.flat().every((d) => d.level === 0)).toBe(true);
  });
});

describe("computeHeatmap — pasek dni tygodnia", () => {
  it("Przychód: suma per dzień tygodnia, najlepszy oznaczony", () => {
    // 2026-09-04 to piątek, 2026-09-07 to poniedziałek
    const rows = [
      row({ startDate: "2026-09-04", endDate: "2026-09-04", totalNet: 3000 }),
      row({ startDate: "2026-09-07", endDate: "2026-09-07", totalNet: 1000 }),
    ];
    const h = computeHeatmap(rows, new Set(["a"]), MONTH, "revenue");
    const fri = h.weekdayAgg[4];
    expect(fri.value).toBe(3000);
    expect(fri.isBest).toBe(true);
    expect(h.bestWeekdayText).toContain("piątek");
  });
});
