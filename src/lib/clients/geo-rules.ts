// Mapa klientek (etap 1): który adres pokazujemy, jak pytamy Nominatim
// (OpenStreetMap) i odległość od bazy. Czysty moduł (vitest bez "@/").
import { normalizeAddress } from "./address";

// Baza — EsteGH, ul. Podbory 29a, 32-050 Skawina (Nominatim, 27.09.2026).
export const BASE = { lat: 49.9812912, lng: 19.8012493, label: "Baza · Skawina, Podbory 29a" };

export type GeoAddress = { street: string | null; zip: string | null; city: string | null };

// Adres dostawy z „Paszportu dostawy” ma pierwszeństwo przed adresem firmy
// (tam jedzie kierowca). Wolny tekst dzielimy tak samo jak przy zapisie.
export function mapAddress(c: { street: string | null; zip: string | null; city: string | null; deliveryAddress: string | null }): GeoAddress | null {
  const delivery = c.deliveryAddress?.trim();
  if (delivery) {
    const n = normalizeAddress({ street: delivery, zip: null, city: null, country: null });
    if (n.city || n.zip) return { street: n.street, zip: n.zip, city: n.city };
    // Sam tekst bez kodu i miasta — dopinamy miasto firmy.
    return { street: delivery, zip: c.zip, city: c.city };
  }
  if (!c.city && !c.zip) return null;
  return { street: c.street, zip: c.zip, city: c.city };
}

// Klucz adresu — zmiana adresu = ponowne liczenie współrzędnych.
export function geoKey(a: GeoAddress): string {
  return [a.street, a.zip, a.city].map((x) => (x ?? "").trim().toLowerCase()).join("|").slice(0, 255);
}

// „ul. Rudawska 4” → { name: „Rudawska”, number: „4” }; „Witosa 68/4” → numer „68”
// (lokal po ukośniku Nominatim zwykle nie zna).
export function splitStreet(street: string | null): { name: string; number: string | null } | null {
  const s = (street ?? "").replace(/^(ul|al|os|pl)\.?\s+/i, "").trim();
  if (!s) return null;
  const m = s.match(/^(.*?)[\s,]+(\d+[a-zA-Z]?)(?:\s*\/\s*\S+)?$/);
  if (!m) return { name: s, number: null };
  return { name: m[1].trim(), number: m[2] };
}

export type GeoAttempt = { params: Record<string, string>; precision: "ADRES" | "MIEJSCOWOSC" };

// Kolejne zapytania do Nominatim — od najdokładniejszego. Zapytania
// strukturalne działają lepiej niż wolny tekst z „ul.” i kodem.
export function geoAttempts(a: GeoAddress): GeoAttempt[] {
  const out: GeoAttempt[] = [];
  const st = splitStreet(a.street);
  const city = a.city?.trim() || null;
  const zip = a.zip?.trim() || null;
  if (st && (city || zip)) {
    const street = st.number ? `${st.number} ${st.name}` : st.name;
    if (city && zip) out.push({ params: { street, city, postalcode: zip }, precision: "ADRES" });
    if (city) out.push({ params: { street, city }, precision: "ADRES" });
    out.push({ params: { q: [`${st.name}${st.number ? ` ${st.number}` : ""}`, city ?? zip].join(", ") }, precision: "ADRES" });
  }
  if (zip && city) out.push({ params: { postalcode: zip, city }, precision: "MIEJSCOWOSC" });
  if (city) out.push({ params: { city }, precision: "MIEJSCOWOSC" });
  else if (zip) out.push({ params: { postalcode: zip }, precision: "MIEJSCOWOSC" });
  return out;
}

// Odległość w linii prostej (km) — orientacyjnie, bez tras po drogach.
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}
