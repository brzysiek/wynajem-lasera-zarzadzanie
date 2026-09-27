import { describe, expect, it } from "vitest";
import { nearRoute, routeKm, stopsForDay, warsawYmd, type DayRental } from "./day-route";

const noon = (d: string) => new Date(`${d}T12:00:00.000Z`);
const rudawa = { lat: 50.1218371, lng: 19.7118189 };
const busko = { lat: 50.4687849, lng: 20.7024985 };
const r = (id: string, from: string, to: string, extra: Partial<DayRental> = {}): DayRental => ({
  id,
  title: id,
  startsAt: noon(from),
  endsAt: noon(to),
  deliveryTime: null,
  pickupTime: null,
  deviceName: "LightSheer",
  driverName: null,
  clientId: id,
  clientName: id,
  geo: rudawa,
  address: null,
  ...extra,
});

describe("dzień dostaw", () => {
  it("dostawa = dzień początku, odbiór = dzień końca; kolejność wg godziny", () => {
    const stops = stopsForDay(
      [
        r("miwini", "2026-10-02", "2026-10-02", { deliveryTime: "10:00", pickupTime: "18:00" }),
        r("laskin", "2026-10-01", "2026-10-02", { pickupTime: "08:00", geo: busko }),
        r("inna", "2026-10-03", "2026-10-04"),
        r("bezgodz", "2026-10-02", "2026-10-05"),
      ],
      "2026-10-02",
    );
    expect(stops.map((s) => `${s.clientId}:${s.kind}:${s.time ?? "—"}`)).toEqual(["laskin:ODBIOR:08:00", "miwini:DOSTAWA:10:00", "miwini:ODBIOR:18:00", "bezgodz:DOSTAWA:—"]);
  });

  it("dzień w czasie warszawskim", () => {
    expect(warsawYmd(new Date("2026-10-01T22:30:00.000Z"))).toBe("2026-10-02");
  });

  it("trasa z bazy i z powrotem (linia prosta)", () => {
    const stops = stopsForDay([r("miwini", "2026-10-02", "2026-10-02")], "2026-10-02");
    expect(routeKm(stops)).toBe(34); // 2 × ok. 17 km (dostawa i odbiór w tym samym miejscu)
  });

  it("klientki blisko trasy — bez tych, które już są na trasie; od najbliższej", () => {
    const stops = stopsForDay([r("miwini", "2026-10-02", "2026-10-05")], "2026-10-02");
    const near = nearRoute(
      stops,
      [
        { id: "miwini", geo: rudawa },
        { id: "zabierzow", geo: { lat: 50.1146, lng: 19.7964 } },
        { id: "busko", geo: busko },
      ],
      10,
    );
    expect(near.map((n) => n.id)).toEqual(["zabierzow"]);
    expect(near[0].nearStop).toBe("miwini");
  });
});
