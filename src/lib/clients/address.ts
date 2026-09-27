// Format adresu klienta (wniosek nr 11): HubSpot dawał „51 Urzędnicza”,
// kod i miasto w polu „ulica”, „Poland”, „Krakow”. Normalizacja przy
// imporcie i zapisie + walidacja (kod NN-NNN, miasto bez cyfr). Czysty
// moduł (vitest bez aliasu "@/").

export type Address = { street: string | null; zip: string | null; city: string | null; country: string | null };

const COUNTRY: Record<string, string> = { poland: "Polska", pl: "Polska", polska: "Polska", "rzeczpospolita polska": "Polska" };
const CITY: Record<string, string> = {
  krakow: "Kraków",
  cracow: "Kraków",
  warsaw: "Warszawa",
  warszawa: "Warszawa",
  wroclaw: "Wrocław",
  gdansk: "Gdańsk",
  lodz: "Łódź",
  rzeszow: "Rzeszów",
  tarnow: "Tarnów",
  "nowy sacz": "Nowy Sącz",
  "bielsko-biala": "Bielsko-Biała",
  czestochowa: "Częstochowa",
  myslenice: "Myślenice",
  "busko-zdroj": "Busko-Zdrój",
  oswiecim: "Oświęcim",
  bochnia: "Bochnia",
};
// Ulice zaczynające się liczbą — nie przestawiamy („3 Maja”, „11 Listopada”).
const MONTHS = /^(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|wrzesnia|września|pazdziernika|października|listopada|grudnia)\b/i;

const clean = (s: string | null | undefined) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim().replace(/^,|,$/g, "").trim();
  return t || null;
};
const key = (s: string) => s.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export function normalizeZip(zip: string | null): string | null {
  const z = clean(zip);
  if (!z) return null;
  const d = z.replace(/\s/g, "");
  if (/^\d{5}$/.test(d)) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return z;
}

function normalizeCity(city: string | null): string | null {
  const c = clean(city);
  if (!c) return null;
  return CITY[key(c)] ?? c;
}

// „…, 30-048 Kraków” w polu ulica albo „30-048 Kraków” w polu miasto.
const ZIP_CITY = /(?:^|,?\s+)(\d{2}-?\d{3})\s+([^\d,][^,]*?)\s*(?:,\s*(?:polska|poland|pl))?\s*$/i;

export function normalizeAddress(a: Address): Address {
  let street = clean(a.street);
  let zip = normalizeZip(a.zip);
  let city = clean(a.city);
  let country = clean(a.country);

  if (street) {
    const m = street.match(ZIP_CITY);
    if (m) {
      street = clean(street.slice(0, m.index));
      zip ??= normalizeZip(m[1]);
      city ??= m[2];
    }
  }
  if (city) {
    const m = city.match(/^(\d{2}-?\d{3})\s+(.+)$/);
    if (m) {
      zip ??= normalizeZip(m[1]);
      city = m[2];
    }
  }
  // HubSpot: numer przed ulicą — „51 Urzędnicza” → „Urzędnicza 51”.
  if (street) {
    const m = street.match(/^(\d+[a-zA-Z]?(?:\/\d+[a-zA-Z]?)?)\s+([^\d].*)$/);
    if (m && !/\d/.test(m[2]) && !MONTHS.test(m[2].replace(/^(ul\.|al\.)\s*/i, ""))) street = `${m[2]} ${m[1]}`;
  }
  city = normalizeCity(city);
  if (country) country = COUNTRY[key(country)] ?? country;
  return { street, zip, city, country };
}

// null = w porządku; inaczej komunikat. Kod sprawdzany tylko dla Polski.
export function addressError(a: Address): string | null {
  const polish = !a.country || a.country === "Polska";
  if (a.zip && polish && !/^\d{2}-\d{3}$/.test(a.zip)) return "Kod pocztowy w formacie NN-NNN (np. 30-048).";
  if (a.city && /\d/.test(a.city)) return "Miasto nie może zawierać cyfr — kod pocztowy wpisz w polu „kod”.";
  return null;
}

const ADDRESS_KEYS = ["street", "zip", "city", "country"] as const;

// Zapis klienta: gdy zmiana dotyka adresu, normalizuje adres po złożeniu z
// bieżącymi wartościami (kod przeniesiony z ulicy trafia do pola „kod”) i
// zwraca tylko pola, które się zmieniły. Bez pól adresu — patch bez zmian.
export function normalizeAddressPatch<T extends Partial<Address>>(patch: T, current: Address): { ok: true; patch: T } | { ok: false; message: string } {
  if (!ADDRESS_KEYS.some((k) => k in patch)) return { ok: true, patch };
  const merged: Address = { ...current };
  for (const k of ADDRESS_KEYS) if (k in patch) merged[k] = (patch[k] as string | null | undefined) ?? null;
  const norm = normalizeAddress(merged);
  const err = addressError(norm);
  if (err) return { ok: false, message: err };
  const out = { ...patch };
  for (const k of ADDRESS_KEYS) {
    if (k in patch || norm[k] !== current[k]) (out as Record<string, unknown>)[k] = norm[k];
  }
  return { ok: true, patch: out };
}
