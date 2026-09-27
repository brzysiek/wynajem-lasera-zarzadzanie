// Mapa klientek, etap 2 — dzień dostaw: dostawy i odbiory wybranego dnia,
// kolejność wg godziny, trasa z bazy w linii prostej i klientki „blisko
// trasy”, którym wg rytmu warto zaproponować termin. Czysty moduł (vitest
// bez "@/"). Wynajem całodniowy: początek i koniec zapisane jako 12:00 UTC
// pierwszego i ostatniego dnia (google-calendar.ts) — dostawa = dzień
// początku, odbiór = dzień końca.
import { BASE, distanceKm } from "./geo-rules";

export type DayRental = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  deliveryTime: string | null; // „HH:MM” (dostawa) — rentalTimeOf
  pickupTime: string | null;
  deviceName: string;
  driverName: string | null;
  clientId: string | null;
  clientName: string | null;
  geo: { lat: number; lng: number } | null;
  address: string | null;
};

export type DayStop = {
  key: string;
  rentalId: string;
  kind: "DOSTAWA" | "ODBIOR";
  time: string | null;
  title: string;
  deviceName: string;
  driverName: string | null;
  clientId: string | null;
  clientName: string | null;
  geo: { lat: number; lng: number } | null;
  address: string | null;
};

const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" });
export const warsawYmd = (d: Date) => ymd.format(d);

const timeKey = (t: string | null) => (t && /^\d{1,2}:\d{2}$/.test(t) ? t.padStart(5, "0") : "99:99");

// Przystanki dnia (RRRR-MM-DD, czas warszawski): dostawy i odbiory, od
// najwcześniejszej godziny; bez godziny — na końcu, dostawy przed odbiorami.
export function stopsForDay(rentals: DayRental[], day: string): DayStop[] {
  const out: DayStop[] = [];
  for (const r of rentals) {
    const base = { rentalId: r.id, title: r.title, deviceName: r.deviceName, driverName: r.driverName, clientId: r.clientId, clientName: r.clientName, geo: r.geo, address: r.address };
    if (warsawYmd(r.startsAt) === day) out.push({ ...base, key: `${r.id}-D`, kind: "DOSTAWA", time: r.deliveryTime });
    if (warsawYmd(r.endsAt) === day) out.push({ ...base, key: `${r.id}-O`, kind: "ODBIOR", time: r.pickupTime });
  }
  return out.sort((a, b) => timeKey(a.time).localeCompare(timeKey(b.time)) || (a.kind === b.kind ? 0 : a.kind === "DOSTAWA" ? -1 : 1));
}

// Trasa w linii prostej: baza → przystanki (w kolejności) → baza.
export function routeKm(stops: DayStop[]): number {
  const pts = [BASE, ...stops.flatMap((s) => (s.geo ? [s.geo] : [])), BASE];
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += distanceKm(pts[i - 1], pts[i]);
  return Math.round(km);
}

export type NearCandidate = { id: string; geo: { lat: number; lng: number } };

// Klientki blisko trasy: najmniejsza odległość do któregoś przystanku (albo
// do bazy — trasa i tak z niej rusza) ≤ promień. Bez klientek, które już są
// na trasie tego dnia. Od najbliższej.
export function nearRoute<T extends NearCandidate>(stops: DayStop[], candidates: T[], radiusKm: number): (T & { km: number; nearStop: string })[] {
  const onRoute = new Set(stops.map((s) => s.clientId).filter(Boolean));
  const points = stops.filter((s) => s.geo).map((s) => ({ geo: s.geo!, label: s.clientName ?? s.title }));
  if (!points.length) return [];
  const out: (T & { km: number; nearStop: string })[] = [];
  for (const c of candidates) {
    if (onRoute.has(c.id)) continue;
    let best = { km: Infinity, label: "" };
    for (const p of points) {
      const km = distanceKm(p.geo, c.geo);
      if (km < best.km) best = { km, label: p.label };
    }
    if (best.km <= radiusKm) out.push({ ...c, km: best.km, nearStop: best.label });
  }
  return out.sort((a, b) => a.km - b.km);
}
