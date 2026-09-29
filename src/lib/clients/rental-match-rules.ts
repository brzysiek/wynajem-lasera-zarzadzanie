// Przypisanie klienta do rezerwacji z kalendarza (wniosek 13, zmienione
// wnioskiem 23: klient wybierany z panelu, a nie zgadywany). Czysty moduł bez
// zależności (vitest bez aliasu "@/").
//
// Automatycznie — tylko twardy klucz, w tej kolejności:
// 1. clientId zapisany przez panel w wydarzeniu Google (extendedProperties
//    albo znacznik [klient:<id>] w opisie — np. skopiowane wydarzenie),
// 2. alias zatwierdzony przez biuro (klucz tytułu → klient),
// 3. ta sama seria: wydarzenie cykliczne Google (recurringEventId) albo ten
//    sam tytuł, już przypisany jednemu klientowi (kopia),
// 4. telefon / e-mail / NIP z tytułu albo opisu wydarzenia.
// Reszta — podobna nazwa, kontakt z HubSpota, podobny tytuł wcześniejszej
// rezerwacji — to tylko kandydaci z uzasadnieniem, nigdy przypisanie.
import { tokensMatch, tokensMatchStrong } from "../history/match";

export type RentalMatchMethod = "EVENT" | "ALIAS" | "SERIES" | "SIGNAL";

export const RENTAL_MATCH_LABEL: Record<RentalMatchMethod, string> = {
  EVENT: "klient zapisany w wydarzeniu",
  ALIAS: "alias",
  SERIES: "ta sama seria",
  SIGNAL: "telefon / e-mail / NIP w opisie",
};

export type CandidateReason = { clientId: string; score: number; reason: string };

export type RentalClassification = {
  kind: "WYNAJEM" | "SZKOLENIE" | "INNE";
  titleKey: string;
  clientId: string | null;
  matchMethod: string | null;
  matchState: string;
  candidates: { clientId: string; score: number }[];
};

export type RentalMatchDecision =
  | { type: "assign"; clientId: string; contactId: string | null; method: RentalMatchMethod }
  | { type: "pending"; candidates: CandidateReason[] }
  | { type: "skip" }; // serwis, blokada, tytuł pominięty przez biuro

// Ogólne tytuły („NOWA PaNI”, „klientka”, „rezerwacja”, „?”) — nie są
// aliasem ani serią (wniosek 23). Klucz = normalizeTitle(title).key.
const GENERIC = new Set(["nowa", "nowy", "pani", "pan", "klientka", "klient", "klienci", "rezerwacja", "rezerwacje", "wynajem", "test", "nowa klientka", "nowa pani", "nowy klient", "brak", "tbc", "tbd", "do", "potwierdzenia", "potwierdzenie", "wstepnie", "wstepna", "moze", "rezerwacja wstepna", "zapytanie"]);

export function isGenericTitleKey(key: string): boolean {
  const k = key.trim();
  if (k.length < 3 || GENERIC.has(k)) return true;
  return k.split(" ").every((t) => GENERIC.has(t) || t.length < 3);
}

// Klucz tytułu → klient, tylko gdy wszystkie przypisane wystąpienia wskazują
// tego samego klienta (ten sam tytuł u dwóch klientów = nie seria).
export function seriesIndex(rows: { key: string; clientId: string }[]): Map<string, string> {
  const seen = new Map<string, string | null>();
  for (const r of rows) {
    if (!r.key || isGenericTitleKey(r.key)) continue;
    const prev = seen.get(r.key);
    if (prev === undefined) seen.set(r.key, r.clientId);
    else if (prev !== r.clientId) seen.set(r.key, null);
  }
  const out = new Map<string, string>();
  for (const [k, v] of seen) if (v) out.set(k, v);
  return out;
}

const pct = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

export function decideRentalClient(input: {
  classification: RentalClassification;
  eventClientId?: string | null;
  recurringClientId?: string | null;
  hubspotContact: { clientId: string; contactId: string } | null;
  series: Map<string, string>;
}): RentalMatchDecision {
  const c = input.classification;
  if (input.eventClientId) return { type: "assign", clientId: input.eventClientId, contactId: null, method: "EVENT" };
  if (c.kind === "INNE" || c.matchState === "IGNORED") return { type: "skip" };
  if (c.clientId && c.matchState === "CONFIRMED" && !isGenericTitleKey(c.titleKey)) return { type: "assign", clientId: c.clientId, contactId: null, method: "ALIAS" };
  if (input.recurringClientId) return { type: "assign", clientId: input.recurringClientId, contactId: null, method: "SERIES" };
  const fromSeries = c.titleKey ? input.series.get(c.titleKey) : undefined;
  if (fromSeries) return { type: "assign", clientId: fromSeries, contactId: null, method: "SERIES" };
  if (c.clientId && c.matchState === "AUTO" && (c.matchMethod === "PHONE" || c.matchMethod === "EMAIL" || c.matchMethod === "NIP")) {
    return { type: "assign", clientId: c.clientId, contactId: null, method: "SIGNAL" };
  }
  // Tylko kandydaci: HubSpot i podobna nazwa (także „AUTO” z historii).
  const out: CandidateReason[] = [];
  if (input.hubspotContact) out.push({ clientId: input.hubspotContact.clientId, score: 1, reason: "HubSpot" });
  const named = c.clientId && !c.candidates.some((x) => x.clientId === c.clientId) ? [{ clientId: c.clientId, score: 1 }, ...c.candidates] : c.candidates;
  for (const x of named) if (!out.some((o) => o.clientId === x.clientId)) out.push({ ...x, reason: `podobna nazwa ${pct(x.score)} – sprawdź` });
  return { type: "pending", candidates: out };
}

export type CandidateNames = {
  nameTokens: string[]; // nazwa firmy
  persons: { first: string[]; last: string[] }[];
  aliasTokens: string[][]; // tytuły potwierdzone przez biuro
  cityTokens: string[];
};

// Czy propozycja klienta ma sens dla tytułu rezerwacji (wniosek 13):
// „Aleksandra Kucewicz - W-wa” nie może podpowiadać „Katarzyny Von” — inne
// imię i nazwisko. Wymagane: wspólne słowo z aliasu albo nazwy firmy, albo
// nazwisko osoby; nazwisko z literówką („Gralewicz” ~ „Grylewicz”) tylko,
// gdy zgadza się też imię (także zdrobnienie: Małgosia = Małgorzata).
export function plausibleCandidate(titleTokens: string[], c: CandidateNames): boolean {
  const title = titleTokens.filter((t) => t.length >= 3 && !c.cityTokens.some((x) => tokensMatchStrong(t, x)));
  const strong = (list: string[]) => title.some((t) => t.length >= 4 && list.some((x) => tokensMatchStrong(t, x)));
  const weak = (list: string[]) => title.some((t) => list.some((x) => tokensMatch(t, x)));
  if (c.aliasTokens.some((a) => strong(a))) return true;
  // Imię w nazwie firmy („Anna Nowak Gabinet”) to jeszcze nie ta sama osoba.
  const firstNames = c.persons.flatMap((p) => p.first);
  if (strong(c.nameTokens.filter((t) => t.length >= 4 && !firstNames.some((f) => tokensMatchStrong(t, f))))) return true;
  return c.persons.some((p) => {
    if (p.last.length === 0) return false;
    if (strong(p.last)) return true;
    return weak(p.last) && title.some((t) => p.first.some((x) => tokensMatchStrong(t, x)));
  });
}
