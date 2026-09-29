// Wyszukiwarka klienta przy rezerwacji i „+ Nowy klient” (wniosek 23) —
// czyste reguły (vitest bez aliasu "@/").

// Cyfry telefonu do porównania: ostatnie 9 (bez +48 / 48 / spacji / myślników).
export function phoneKey(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : null;
}

export function emailKey(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export function nipKey(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length === 10 ? d : null;
}

// Zapytanie → tekst (≥ 2 znaki) i ciąg cyfr (≥ 5 — telefon / NIP).
export function parseClientQuery(q: string): { text: string | null; digits: string | null } {
  const t = q.trim();
  const digits = t.replace(/\D/g, "");
  const onlyNumber = /^[\d\s+()-]+$/.test(t);
  return {
    text: !onlyNumber && t.length >= 2 ? t : null,
    digits: digits.length >= 5 ? (digits.length > 9 && digits.startsWith("48") ? digits.slice(2) : digits) : null,
  };
}

// „Anna Kowalska” → osoba; nazwa z wyrazami gabinetu → firma bez osoby.
export function splitPersonName(name: string): { firstName: string | null; lastName: string | null } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const business = /(gabinet|salon|studio|klinika|instytut|beauty|kosmetolog|centrum|sp\.|s\.c\.|spółka|\d)/i.test(name);
  if (business || words.length < 2 || words.length > 3) return { firstName: null, lastName: null };
  return { firstName: words[0], lastName: words.slice(1).join(" ") };
}
