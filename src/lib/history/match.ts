// Dopasowanie historycznego wpisu (wydarzenie z kalendarza, później faktura)
// do klienta — prompt 3, sekcja 2.3. Czysta funkcja bez zależności (vitest
// bez aliasu "@/"). Kolejność: telefon/e-mail z opisu → NIP → alias
// (potwierdzony wcześniej przez biuro) → podobieństwo nazwy.
//
// Podobieństwo nazwy: tokeny ważone rzadkością (IDF) — „anna” pasuje do
// wielu klientek, więc waży mało, „kolber” do jednej, więc waży dużo.
//   pokrycie tytułu   = jaka część tytułu występuje u klienta (nazwa firmy,
//                       osoby kontaktowe, miasto — razem),
//   pokrycie wariantu = jaka część najlepiej pasującej nazwy (firma albo
//                       „imię nazwisko” osoby) występuje w tytule.
//   wynik = 0,6·tytuł + 0,4·wariant (+ premia za miasto), maks. 1.
// Kolejność słów nie ma znaczenia, więc „imię nazwisko” i „nazwisko imię”
// liczą się tak samo.

import { normalizeTitle } from "./normalize-title";

export const MATCH_CONFIG = {
  autoThreshold: 0.9, // ≥ → AUTO
  suggestThreshold: 0.6, // ≥ → SUGGESTED (1–3 kandydatów), niżej UNMATCHED
  // Dwóch kandydatów bliżej niż o tyle — nawet wysoki wynik tylko jako propozycja.
  ambiguityMargin: 0.05,
  cityBonus: 0.1,
  // AUTO tylko, gdy tytuł zawiera większość którejś nazwy klienta — samo imię
  // plus miasto („Mariola Spytkowice”) zostaje propozycją.
  autoMinVariant: 0.75,
  maxCandidates: 3,
};

export type MatchMethod = "NIP" | "EMAIL" | "PHONE" | "NAME_AUTO" | "MANUAL" | "RENTAL";
export type MatchState = "AUTO" | "SUGGESTED" | "CONFIRMED" | "IGNORED" | "UNMATCHED";

export type MatchClient = {
  id: string;
  name: string;
  city: string | null;
  nip: string | null;
  contacts: { firstName: string | null; lastName: string | null; phone: string | null; email: string | null }[];
};

export type MatchCandidate = { clientId: string; score: number };

export type MatchResult = {
  clientId: string | null;
  method: MatchMethod | null;
  state: MatchState;
  score: number | null;
  candidates: MatchCandidate[];
};

export type MatchSignals = { phones: string[]; emails: string[]; nips: string[] };

const NONE: MatchResult = { clientId: null, method: null, state: "UNMATCHED", score: null, candidates: [] };

function levenshteinAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// Odmiana i literówki: „lucyny” ~ „lucyna”, „krakow” ~ „krakowa”, „bottega” ~ „botega”.
export function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  return a.length >= 5 && b.length >= 5 && levenshteinAtMostOne(a, b);
}

type Indexed = {
  id: string;
  variants: string[][]; // nazwa firmy + każda osoba kontaktowa
  cityTokens: string[];
  pool: string[]; // wszystkie tokeny klienta (bez miasta)
};

function tokensOf(s: string | null | undefined): string[] {
  return s ? normalizeTitle(s).tokens : [];
}

export function buildMatcher(
  clients: MatchClient[],
  aliases: Map<string, string>, // znormalizowany klucz → clientId
  normalizePhone: (raw: string) => string | null,
  config = MATCH_CONFIG,
) {
  const byPhone = new Map<string, string>();
  const byEmail = new Map<string, string>();
  const byNip = new Map<string, string>();
  const indexed: Indexed[] = [];
  const df = new Map<string, number>();

  for (const c of clients) {
    if (c.nip) byNip.set(c.nip.replace(/\D/g, ""), c.id);
    const variants = [tokensOf(c.name)];
    for (const p of c.contacts) {
      if (p.email) byEmail.set(p.email.trim().toLowerCase(), c.id);
      const phone = p.phone ? normalizePhone(p.phone) : null;
      if (phone) byPhone.set(phone, c.id);
      const person = tokensOf([p.firstName, p.lastName].filter(Boolean).join(" "));
      if (person.length) variants.push(person);
    }
    const nonEmpty = variants.filter((v) => v.length > 0);
    const pool = [...new Set(nonEmpty.flat())];
    const cityTokens = tokensOf(c.city);
    indexed.push({ id: c.id, variants: nonEmpty, cityTokens, pool });
    for (const t of new Set([...pool, ...cityTokens])) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const n = Math.max(1, clients.length);
  const maxWeight = Math.log(1 + n);
  // Słowo nieznane żadnemu klientowi waży jak najrzadsze — tytuł „Maria
  // Orlova” nie może dopasować się do „Marii Kowalskiej” tylko przez imię.
  const weight = (t: string) => {
    const d = df.get(t);
    return d ? Math.log(1 + n / d) : maxWeight;
  };
  const found = (t: string, list: string[]) => list.some((x) => tokensMatch(t, x));

  function scoreClient(c: Indexed, title: string[]): { score: number; variant: number } {
    const nameTokens = title.filter((t) => found(t, c.pool));
    if (nameTokens.length === 0) return { score: 0, variant: 0 }; // samo miasto to jeszcze nie klient
    const cityHit = c.cityTokens.length > 0 && title.some((t) => !found(t, c.pool) && found(t, c.cityTokens));

    const titleTotal = title.reduce((s, t) => s + weight(t), 0);
    const titleCovered = title.reduce((s, t) => s + (found(t, c.pool) || found(t, c.cityTokens) ? weight(t) : 0), 0);
    const titleCoverage = titleTotal ? titleCovered / titleTotal : 0;

    let variantCoverage = 0;
    for (const v of c.variants) {
      const total = v.reduce((s, t) => s + weight(t), 0);
      const covered = v.reduce((s, t) => s + (found(t, title) ? weight(t) : 0), 0);
      if (total) variantCoverage = Math.max(variantCoverage, covered / total);
    }

    const score = 0.6 * titleCoverage + 0.4 * variantCoverage + (cityHit ? config.cityBonus : 0);
    return { score: Math.min(1, Math.round(score * 1000) / 1000), variant: variantCoverage };
  }

  return function match(key: string, signals: MatchSignals = { phones: [], emails: [], nips: [] }): MatchResult {
    for (const p of signals.phones) {
      const id = byPhone.get(p);
      if (id) return { clientId: id, method: "PHONE", state: "AUTO", score: 1, candidates: [] };
    }
    for (const e of signals.emails) {
      const id = byEmail.get(e.toLowerCase());
      if (id) return { clientId: id, method: "EMAIL", state: "AUTO", score: 1, candidates: [] };
    }
    for (const nip of signals.nips) {
      const id = byNip.get(nip);
      if (id) return { clientId: id, method: "NIP", state: "AUTO", score: 1, candidates: [] };
    }
    if (!key) return NONE;
    const aliased = aliases.get(key);
    if (aliased) return { clientId: aliased, method: "MANUAL", state: "CONFIRMED", score: 1, candidates: [] };

    const title = key.split(" ");
    const ranked = indexed
      .map((c) => ({ clientId: c.id, ...scoreClient(c, title) }))
      .filter((c) => c.score >= config.suggestThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, config.maxCandidates);
    if (ranked.length === 0) return NONE;
    const scored = ranked.map(({ clientId, score }) => ({ clientId, score }));

    const [top, second] = ranked;
    const clear = !second || top.score - second.score > config.ambiguityMargin;
    if (top.score >= config.autoThreshold && top.variant >= config.autoMinVariant && clear) {
      return { clientId: top.clientId, method: "NAME_AUTO", state: "AUTO", score: top.score, candidates: scored };
    }
    return { clientId: null, method: null, state: "SUGGESTED", score: top.score, candidates: scored };
  };
}
