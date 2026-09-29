import { describe, expect, it } from "vitest";
import { idxToYmd, nearestFreeStarts, overlaps, seriesSpans, ymdToIdx } from "./availability-rules";

const d = (ymd: string) => ymdToIdx(ymd);

describe("overlaps", () => {
  it("dni kalendarza włącznie", () => {
    expect(overlaps({ start: d("2026-10-06"), end: d("2026-10-07") }, { start: d("2026-10-07"), end: d("2026-10-08") })).toBe(true);
    expect(overlaps({ start: d("2026-10-06"), end: d("2026-10-06") }, { start: d("2026-10-07"), end: d("2026-10-08") })).toBe(false);
  });
});

describe("nearestFreeStarts", () => {
  it("omija zajęte dni, nie przed dziś", () => {
    const busy = [{ start: d("2026-10-07"), end: d("2026-10-08") }];
    const wanted = { start: d("2026-10-06"), end: d("2026-10-07") };
    const out = nearestFreeStarts(busy, wanted, d("2026-10-01"), 3).map(idxToYmd);
    expect(out).toEqual(["2026-10-04", "2026-10-05", "2026-10-09"]);
    expect(nearestFreeStarts(busy, wanted, d("2026-10-06"), 2).map(idxToYmd)).toEqual(["2026-10-09", "2026-10-10"]);
  });
});

describe("seriesSpans", () => {
  it("co 5 tyg. do dnia", () => {
    const s = seriesSpans({ start: d("2026-10-06"), end: d("2026-10-07") }, 5, d("2027-06-30"));
    expect(s.length).toBe(8);
    expect(idxToYmd(s[1].start)).toBe("2026-11-10");
    expect(seriesSpans({ start: 1, end: 1 }, 0, 100)).toHaveLength(1);
  });
});
