import { prisma } from "@/lib/prisma";
import { logWarn } from "@/lib/logger";
import { geoAttempts, geoKey, mapAddress } from "@/lib/clients/geo-rules";

// Współrzędne klientek z Nominatim (OpenStreetMap) — mapa na /klienci.
// Zasady Nominatim: max 1 zapytanie na sekundę, przedstawiający się
// User-Agent, bez masowego pobierania. Dlatego partiami z przycisku (limit
// czasu na partię), a wynik zapamiętany z kluczem adresu — ponownie liczymy
// dopiero po zmianie adresu. Pinezki przesunięte ręcznie (MANUAL) zostają.

const UA = "WynajemLasera-Panel/1.0 (kontakt@wynajemlasera.pl)";
const GAP_MS = 1100;
const BATCH_MS = 25_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function nominatim(params: Record<string, string>): Promise<{ lat: number; lng: number } | null> {
  const qs = new URLSearchParams({ format: "jsonv2", limit: "1", countrycodes: "pl", ...params });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${qs.toString()}`, {
    headers: { "User-Agent": UA, "Accept-Language": "pl" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const body = (await res.json().catch(() => [])) as { lat?: string; lon?: string }[];
  const hit = body[0];
  return hit?.lat && hit?.lon ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
}

// Klientki z historią (wynajem, wpis z kalendarza albo faktura) — te są na
// zakładce Klienci; kontaktów z zapytań nie liczymy. Pinezki MANUAL zostają.
async function pending() {
  const rows = await prisma.client.findMany({
    where: {
      archivedAt: null,
      AND: [
        {
          OR: [
            { rentals: { some: {} } },
            { history: { some: { matchState: { in: ["AUTO", "CONFIRMED"] } } } },
            { invoices: { some: { matchState: { in: ["AUTO", "CONFIRMED"] } } } },
          ],
        },
        { OR: [{ geoSource: null }, { geoSource: { not: "MANUAL" } }] },
      ],
    },
    select: { id: true, street: true, zip: true, city: true, deliveryAddress: true, geoQuery: true },
  });
  return rows.flatMap((r) => {
    const a = mapAddress(r);
    if (!a) return [];
    const key = geoKey(a);
    return key === r.geoQuery ? [] : [{ id: r.id, address: a, key }];
  });
}

export async function countPendingGeocode(): Promise<number> {
  return (await pending()).length;
}

export async function geocodeBatch(): Promise<{ done: number; found: number; notFound: number; remaining: number }> {
  const todo = await pending();
  const started = Date.now();
  let done = 0;
  let found = 0;
  for (const c of todo) {
    if (Date.now() - started > BATCH_MS) break;
    let hit: { lat: number; lng: number } | null = null;
    let precision: string | null = null;
    for (const a of geoAttempts(c.address)) {
      try {
        hit = await nominatim(a.params);
      } catch (err) {
        logWarn("geocode_request_failed", { clientId: c.id, message: err instanceof Error ? err.message : String(err) });
        // Błąd sieci / limit — przerywamy partię, nic nie zapisujemy dla tego klienta.
        return { done, found, notFound: done - found, remaining: todo.length - done };
      }
      await sleep(GAP_MS);
      if (hit) {
        precision = a.precision;
        break;
      }
    }
    await prisma.client.update({
      where: { id: c.id },
      data: { lat: hit?.lat ?? null, lng: hit?.lng ?? null, geoPrecision: precision, geoSource: hit ? "NOMINATIM" : null, geoQuery: c.key, geocodedAt: new Date() },
    });
    done++;
    if (hit) found++;
  }
  return { done, found, notFound: done - found, remaining: todo.length - done };
}

// Ręczna poprawka pinezki na mapie (albo powrót do liczenia z adresu).
export async function setManualGeo(id: string, geo: { lat: number; lng: number } | null): Promise<boolean> {
  const res = await prisma.client.updateMany({
    where: { id },
    data: geo ? { lat: geo.lat, lng: geo.lng, geoSource: "MANUAL", geoPrecision: "ADRES", geocodedAt: new Date() } : { lat: null, lng: null, geoSource: null, geoPrecision: null, geoQuery: null },
  });
  return res.count > 0;
}
