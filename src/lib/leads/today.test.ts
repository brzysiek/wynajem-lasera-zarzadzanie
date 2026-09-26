import { describe, expect, it } from "vitest";
import { addWorkdays, nextWorkday, waitingLabel, workHoursBetween } from "./work-time";
import { buildToday, leadStats, type StatsLead, type TodayLead } from "./today";

// 2026-09-25 = piątek.
const at = (d: number, h = 0, m = 0) => new Date(2026, 8, d, h, m);

describe("workHoursBetween", () => {
  it("w obrębie dnia roboczego", () => {
    expect(workHoursBetween(at(24, 9), at(24, 12, 30))).toBe(3.5);
  });
  it("wieczór → następny ranek liczy tylko godziny pracy", () => {
    expect(workHoursBetween(at(24, 20), at(25, 10))).toBe(2);
  });
  it("przez weekend", () => {
    expect(workHoursBetween(at(25, 17), at(28, 9))).toBe(2); // pt 17–18 + pon 8–9
  });
  it("odwrotna kolejność = 0", () => {
    expect(workHoursBetween(at(25, 10), at(25, 9))).toBe(0);
  });
});

describe("dni robocze", () => {
  it("następny dzień roboczy po piątku to poniedziałek", () => {
    expect(nextWorkday(at(25, 15))).toEqual(at(28));
    expect(addWorkdays(at(24, 10), 3)).toEqual(at(29));
  });
  it("etykieta czekania", () => {
    expect(waitingLabel(0.4)).toBe("czeka < 1 h");
    expect(waitingLabel(26.7)).toBe("czeka 26 h");
  });
});

describe("buildToday", () => {
  const now = at(25, 11);
  const lead = (p: Partial<TodayLead> & { id: string }): TodayLead => ({
    stage: "SYGNAL",
    createdAt: at(24, 10),
    firstContactAt: null,
    nextActionAt: null,
    rentalStartsAt: null,
    ...p,
  });

  it("dzieli na nowe, follow-upy, rezerwacje i zaległe", () => {
    const t = buildToday(
      [
        lead({ id: "new2", createdAt: at(25, 9) }),
        lead({ id: "new1", createdAt: at(23, 9) }),
        lead({ id: "old", createdAt: at(1, 9) }),
        lead({ id: "fu", stage: "OFERTA", firstContactAt: at(20), nextActionAt: at(25) }),
        lead({ id: "future", stage: "OFERTA", firstContactAt: at(20), nextActionAt: at(28) }),
        lead({ id: "res", stage: "REZERWACJA", firstContactAt: at(20), rentalStartsAt: at(27, 12) }),
        lead({ id: "resFar", stage: "REZERWACJA", firstContactAt: at(20), rentalStartsAt: new Date(2026, 9, 10) }),
        lead({ id: "won", stage: "WYGRANA", firstContactAt: at(20), nextActionAt: at(24) }),
      ],
      now,
    );
    expect(t.fresh.map((l) => l.id)).toEqual(["new1", "new2"]);
    expect(t.stale.map((l) => l.id)).toEqual(["old"]);
    expect(t.followUps.map((l) => l.id)).toEqual(["fu"]);
    expect(t.reservations.map((l) => l.id)).toEqual(["res"]);
  });
});

describe("leadStats", () => {
  const now = at(25, 12);
  const l = (p: Partial<StatsLead>): StatsLead => ({
    createdAt: at(21, 9), // poniedziałek
    firstContactAt: null,
    stage: "SYGNAL",
    stageChangedAt: at(21, 9),
    lostReason: null,
    hasRental: false,
    ...p,
  });

  it("liczy 4 wskaźniki z ostatnich 30 dni", () => {
    const s = leadStats(
      [
        l({ firstContactAt: at(22, 9) }), // pn 9 → wt 9 = 10 h
        l({ firstContactAt: at(23, 9), stage: "REZERWACJA" }), // 20 h
        l({ stage: "PRZEGRANA", lostReason: "CENA", stageChangedAt: at(24) }),
        l({ stage: "PRZEGRANA", lostReason: "CENA", stageChangedAt: at(24) }),
        l({ stage: "PRZEGRANA", lostReason: "ODLEGLOSC", stageChangedAt: at(24) }),
        l({ createdAt: new Date(2026, 6, 1) }), // poza oknem
      ],
      now,
    );
    expect(s.newCount).toBe(5);
    expect(s.medianFirstContactHours).toBe(15);
    expect(s.reservationRate).toBeCloseTo(1 / 5);
    expect(s.topLostReason).toBe("CENA");
    expect(s.topLostCount).toBe(2);
  });

  it("brak danych", () => {
    expect(leadStats([], now)).toEqual({ newCount: 0, medianFirstContactHours: null, reservationRate: null, topLostReason: null, topLostCount: 0 });
  });
});
