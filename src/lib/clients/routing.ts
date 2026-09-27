// Trasa od bazy do adresu dostawy — publiczny serwer OSRM (OpenStreetMap,
// bez klucza, bez korków). Zasady serwera demo: pojedyncze zapytania, bez
// masowego pobierania — dlatego liczymy przy zapisie adresu i partiami z mapy.

const UA = "WynajemLasera-Panel/1.0 (kontakt@wynajemlasera.pl)";

export type Route = { km: number; min: number };

// null = OSRM nie znalazł trasy; rzuca przy błędzie sieci.
export async function osrmRoute(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<Route | null> {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as { code?: string; routes?: { distance?: number; duration?: number }[] } | null;
  const r = body?.code === "Ok" ? body.routes?.[0] : undefined;
  if (!r || typeof r.distance !== "number" || typeof r.duration !== "number") return null;
  return { km: Math.round(r.distance / 100) / 10, min: Math.round(r.duration / 60) };
}
