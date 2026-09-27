// Paszport dostawy (karta klienta, etap B): adresy dostawy, baza, strefy
// transportu, region z geokodowania. Czysty moduł (vitest bez "@/").
import { addressError, normalizeAddress } from "./address";
import { BASE, geoKey } from "./geo-rules";
import { regionFromZip } from "./region";

export type AddressParts = { street: string | null; zip: string | null; city: string | null };

// „ul. Krakowska 137, 32-060 Liszki”
export function formatAddressLine(a: AddressParts): string {
  return [a.street?.trim(), [a.zip?.trim(), a.city?.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

const k = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/^(ul|al|os|pl)\.?\s+/, "")
    .replace(/[\s,.]+/g, " ")
    .trim();

export function sameAddress(a: AddressParts, b: AddressParts): boolean {
  return k(a.street) === k(b.street) && k(a.zip) === k(b.zip) && k(a.city) === k(b.city);
}

// ------------------------------------------------------------------ baza

export type DeliveryBase = { address: string; lat: number; lng: number };

export const DEFAULT_BASE: DeliveryBase = { address: "ul. Podbory 29a, 32-050 Skawina", lat: BASE.lat, lng: BASE.lng };

export function parseBase(raw: string | null | undefined): DeliveryBase {
  try {
    const o = JSON.parse(raw ?? "") as Partial<DeliveryBase>;
    if (typeof o.address === "string" && Number.isFinite(o.lat) && Number.isFinite(o.lng)) return { address: o.address, lat: Number(o.lat), lng: Number(o.lng) };
  } catch {
    // brak / uszkodzone ustawienie — baza domyślna
  }
  return DEFAULT_BASE;
}

// Adres czeka na mapę: zmienił się (inny klucz niż przy liczeniu), nie ma
// trasy od bazy albo — bez kodu pocztowego — województwa do regionu.
export type AddressGeoState = AddressParts & { geoQuery: string | null; lat: number | null; routeCalculatedAt: Date | string | null; geoState: string | null };

export function addressNeedsGeo(a: AddressGeoState): boolean {
  if (!a.city && !a.zip) return false;
  if (geoKey({ street: a.street, zip: a.zip, city: a.city }) !== a.geoQuery) return true;
  return a.lat != null && (a.routeCalculatedAt == null || (a.geoState == null && regionFromZip(a.zip) == null));
}

// ------------------------------------------------------------------ strefy transportu

// Strefa to tylko podpowiedź (nie nadpisuje transportu z warunków klienta).
export type TransportZone = { code: string; fromKm: number; toKm: number | null; priceNet: number | null };

export const DEFAULT_ZONES: TransportZone[] = [
  { code: "A", fromKm: 0, toKm: 10, priceNet: null },
  { code: "B", fromKm: 10, toKm: 30, priceNet: null },
  { code: "C", fromKm: 30, toKm: 60, priceNet: null },
  { code: "D", fromKm: 60, toKm: 100, priceNet: null },
  { code: "E", fromKm: 100, toKm: null, priceNet: null },
];

// Z ustawień bierzemy tylko stawki — granice stref są stałe.
export function parseZones(raw: string | null | undefined): TransportZone[] {
  let prices: Record<string, unknown> = {};
  try {
    const o = JSON.parse(raw ?? "");
    if (o && typeof o === "object" && !Array.isArray(o)) prices = o as Record<string, unknown>;
  } catch {
    // brak ustawienia — strefy bez stawek
  }
  return DEFAULT_ZONES.map((z) => {
    const p = Number(prices[z.code]);
    return { ...z, priceNet: prices[z.code] != null && prices[z.code] !== "" && Number.isFinite(p) && p >= 0 ? p : null };
  });
}

export function zoneFor(km: number | null | undefined, zones: TransportZone[] = DEFAULT_ZONES): TransportZone | null {
  if (km == null || !Number.isFinite(km) || km < 0) return null;
  return zones.find((z) => km >= z.fromKm && (z.toKm === null || km < z.toKm)) ?? null;
}

export function zoneRangeLabel(z: TransportZone): string {
  return z.toKm === null ? `${z.fromKm}+ km` : `${z.fromKm}–${z.toKm} km`;
}

// „8 km · 10 min”
export function routeLabel(km: number | null | undefined, min: number | null | undefined): string | null {
  if (km == null) return null;
  const kmText = `${Math.round(km).toLocaleString("pl-PL")} km`;
  if (min == null) return kmText;
  const m = Math.max(1, Math.round(min));
  return `${kmText} · ${m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`}`;
}

// ------------------------------------------------------------------ zapis adresu

export const ADDRESS_TEXT_FIELDS = ["entrance", "floor", "parking", "power", "receiver", "openingHours", "officeNotes"] as const;
export type AddressTextField = (typeof ADDRESS_TEXT_FIELDS)[number];

export type AddressInput = {
  label: string;
  street: string | null;
  zip: string | null;
  city: string | null;
  usualStartTime: string | null;
} & Record<AddressTextField, string | null>;

const text = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

// Walidacja body (POST = pełny adres, PATCH = część). Adres normalizowany
// jak adres firmy (kod NN-NNN, „Krakow” → „Kraków”, kod w polu ulicy).
export function parseAddressInput(
  body: Record<string, unknown>,
  current: AddressInput | null,
): { ok: true; value: AddressInput; changed: (keyof AddressInput)[] } | { ok: false; message: string } {
  const base: AddressInput = current ?? {
    label: "Gabinet",
    street: null,
    zip: null,
    city: null,
    usualStartTime: null,
    entrance: null,
    floor: null,
    parking: null,
    power: null,
    receiver: null,
    openingHours: null,
    officeNotes: null,
  };
  const next: AddressInput = { ...base };
  const label = text(body.label, 64);
  if (label !== undefined) {
    if (!label) return { ok: false, message: "Podaj nazwę adresu (np. Gabinet, Wieliczka)." };
    next.label = label;
  }
  for (const f of ["street", "zip", "city"] as const) {
    const v = text(body[f], 191);
    if (v !== undefined) next[f] = v;
  }
  for (const f of ADDRESS_TEXT_FIELDS) {
    const v = text(body[f], 2000);
    if (v !== undefined) next[f] = v;
  }
  const time = text(body.usualStartTime, 16);
  if (time !== undefined) {
    if (time && !/^([01]?\d|2[0-3])[:.][0-5]\d$/.test(time)) return { ok: false, message: "Typowa godzina dostawy w formacie GG:MM." };
    next.usualStartTime = time ? time.replace(".", ":").padStart(5, "0") : null;
  }
  // Adres sprawdzamy tylko, gdy zapis go dotyka (stare adresy z migracji
  // nie blokują zmiany samych uwag).
  if (!current || (["street", "zip", "city"] as const).some((f) => f in body)) {
    const norm = normalizeAddress({ street: next.street, zip: next.zip, city: next.city, country: null });
    const err = addressError(norm);
    if (err) return { ok: false, message: err };
    next.street = norm.street;
    next.zip = norm.zip;
    next.city = norm.city;
    if (!next.city && !next.zip) return { ok: false, message: "Podaj miejscowość albo kod pocztowy — bez tego nie policzymy trasy." };
  }
  const changed = (Object.keys(next) as (keyof AddressInput)[]).filter((key) => (current ? current[key] !== next[key] : next[key] !== null));
  return { ok: true, value: next, changed };
}

// ------------------------------------------------------------------ uwagi kierowcy

export function splitFeedback<T>(items: T[], visible = 3): { shown: T[]; more: T[] } {
  return { shown: items.slice(0, visible), more: items.slice(visible) };
}
