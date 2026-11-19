import { describe, expect, it } from "vitest";
import { addDays, daysBetween, periodFromParams, periodQuery, seasonStart } from "./period";

const TODAY = "2026-11-18";

describe("okres w Marketingu", () => {
  it("domyślnie 28 dni; 7 / 90 / sezon z parametru okres", () => {
    expect(periodFromParams({}, "28", TODAY)).toMatchObject({ preset: "28", from: "2026-10-22", to: TODAY });
    expect(periodFromParams({ okres: "7" }, "28", TODAY)).toMatchObject({ preset: "7", from: "2026-11-12" });
    expect(periodFromParams({ okres: "90" }, "28", TODAY)).toMatchObject({ from: "2026-08-21" });
    expect(periodFromParams({ okres: "sezon" }, "28", TODAY)).toMatchObject({ preset: "sezon", from: "2026-09-01" });
  });
  it("domyślny okres zależy od podzakładki (Słowa kluczowe: sezon)", () => {
    expect(periodFromParams({}, "sezon", TODAY)).toMatchObject({ preset: "sezon", from: "2026-09-01" });
    expect(periodFromParams({ okres: "28" }, "sezon", TODAY).preset).toBe("28");
  });
  it("własny zakres, odwrócone daty, śmieci w parametrach", () => {
    expect(periodFromParams({ od: "2026-10-01", do: "2026-10-31" }, "28", TODAY)).toMatchObject({ preset: "wlasny", from: "2026-10-01", to: "2026-10-31" });
    expect(periodFromParams({ od: "2026-10-31", do: "2026-10-01" }, "28", TODAY)).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodFromParams({ okres: "xx", od: "to-nie-data" }, "28", TODAY).preset).toBe("28");
  });
  it("poprzedni okres ma tę samą długość i kończy się dzień przed początkiem", () => {
    const p = periodFromParams({}, "28", TODAY);
    expect(daysBetween(p.prevFrom, p.prevTo)).toBe(28);
    expect(p.prevTo).toBe(addDays(p.from, -1));
  });
  it("sezon: przed 1.09 poprzedni rok; zapytanie zachowuje okres", () => {
    expect(seasonStart("2027-03-01")).toBe("2026-09-01");
    expect(seasonStart("2026-09-01")).toBe("2026-09-01");
    expect(periodQuery(periodFromParams({ okres: "90" }, "28", TODAY))).toBe("okres=90");
    expect(periodQuery(periodFromParams({ od: "2026-10-01", do: "2026-10-31" }, "28", TODAY))).toBe("od=2026-10-01&do=2026-10-31");
  });
});
