import { describe, expect, it } from "vitest";
import { computeSeasonGoal, springOutcome, type SeasonRental } from "./season-goal";

const season = { from: "2026-10-01", to: "2027-05-31" };
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 10);
const rental = (clientId: string, startsAt: Date, x: Partial<SeasonRental> = {}): SeasonRental => ({
  clientId,
  clientName: clientId,
  startsAt,
  createdAt: new Date(startsAt.getTime() - 10 * 86_400_000),
  eventType: "WYNAJEM",
  deletedInGoogle: false,
  deviceName: "LightSheer",
  ...x,
});

describe("cel sezonu (wniosek 21)", () => {
  it("gabinety, nie wynajmy: wracająca z listy wiosny liczy się raz, kolejne wynajmy nie", () => {
    const g = computeSeasonGoal({
      season,
      springIds: ["wood"],
      rentals: [rental("wood", d(2026, 4, 10)), rental("wood", d(2026, 10, 5)), rental("wood", d(2026, 11, 5)), rental("wood", d(2026, 12, 5))],
      priorArrivals: new Map([["wood", [d(2026, 4, 10)]]]),
    });
    expect(g).toMatchObject({ returning: 1, fresh: 0, total: 1 });
  });

  it("nowe = pierwszy przyjazd w historii; powracająca spoza listy, szkolenie i usunięty wynajem się nie liczą", () => {
    const g = computeSeasonGoal({
      season,
      springIds: [],
      rentals: [
        rental("nowa", d(2026, 10, 7)),
        rental("nowa", d(2026, 10, 8)), // drugie urządzenie — ten sam przyjazd
        rental("bigos", d(2026, 10, 7)), // przyjazdy 2023–2025 z historii
        rental("szkolenie", d(2026, 10, 9), { eventType: "SZKOLENIE" }),
        rental("anulowana", d(2026, 10, 9), { deletedInGoogle: true }),
        rental("wrzesien", d(2026, 9, 20)), // przyjazd przed sezonem
        rental("wrzesien", d(2026, 10, 20)),
      ],
      priorArrivals: new Map([["bigos", [d(2025, 2, 10)]]]),
    });
    expect(g.wins.map((w) => [w.clientId, w.kind])).toEqual([["nowa", "new"]]);
  });

  it("kolejność „6 z 20” wg chwili wpisania rezerwacji", () => {
    const g = computeSeasonGoal({
      season,
      springIds: ["a"],
      rentals: [rental("a", d(2026, 11, 20), { createdAt: d(2026, 10, 2) }), rental("b", d(2026, 10, 15), { createdAt: d(2026, 10, 5) })],
      priorArrivals: new Map([["a", [d(2026, 4, 1)]]]),
    });
    expect(g.wins.map((w) => [w.clientId, w.no])).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("wynik gabinetu z wiosny", () => {
    expect(springOutcome(true, null)).toBe("BOOKED");
    expect(springOutcome(false, null)).toBe("TODO");
    expect(springOutcome(false, { stage: "ODLOZONE", lastContactAt: null })).toBe("POSTPONED");
    expect(springOutcome(false, { stage: "PRZEGRANA", lastContactAt: d(2026, 10, 1) })).toBe("LOST");
    expect(springOutcome(false, { stage: "WYWIAD", lastContactAt: d(2026, 10, 1) })).toBe("TALKING");
  });
});
