// Przypisanie klienta do rezerwacji z kalendarza (wniosek nr 13). Czysty
// moduł bez zależności (vitest bez aliasu "@/").
//
// Automatycznie — tylko przy wysokiej pewności, w tej kolejności:
// 1. kontakt HubSpot rezerwacji = osoba klienta w panelu,
// 2. alias potwierdzony przez biuro na /klienci/dopasowania (ten sam klucz
//    tytułu co w historii kalendarzy),
// 3. telefon / e-mail / NIP z tytułu albo opisu wydarzenia,
// 4. seria: ten sam klucz tytułu ma już przypisaną rezerwację (albo wpis
//    historii) — i to u jednego klienta.
// Reszta (samo podobieństwo nazwy) czeka na potwierdzenie w dopasowaniach.

export type RentalMatchMethod = "HUBSPOT" | "ALIAS" | "SIGNAL" | "SERIES";

export const RENTAL_MATCH_LABEL: Record<RentalMatchMethod, string> = {
  HUBSPOT: "kontakt HubSpot",
  ALIAS: "alias z dopasowań",
  SIGNAL: "telefon / e-mail / NIP z opisu",
  SERIES: "tytuł poprzedniej rezerwacji z tej serii",
};

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
  | { type: "pending"; candidates: { clientId: string; score: number }[] }
  | { type: "skip" }; // serwis, blokada, tytuł pominięty przez biuro

// Klucz tytułu → klient, tylko gdy wszystkie przypisane wystąpienia wskazują
// tego samego klienta (ten sam tytuł u dwóch klientów = nie seria).
export function seriesIndex(rows: { key: string; clientId: string }[]): Map<string, string> {
  const seen = new Map<string, string | null>();
  for (const r of rows) {
    if (!r.key) continue;
    const prev = seen.get(r.key);
    if (prev === undefined) seen.set(r.key, r.clientId);
    else if (prev !== r.clientId) seen.set(r.key, null);
  }
  const out = new Map<string, string>();
  for (const [k, v] of seen) if (v) out.set(k, v);
  return out;
}

export function decideRentalClient(input: {
  classification: RentalClassification;
  hubspotContact: { clientId: string; contactId: string } | null;
  series: Map<string, string>;
}): RentalMatchDecision {
  const c = input.classification;
  if (input.hubspotContact) return { type: "assign", clientId: input.hubspotContact.clientId, contactId: input.hubspotContact.contactId, method: "HUBSPOT" };
  if (c.kind === "INNE" || c.matchState === "IGNORED") return { type: "skip" };
  if (c.clientId && c.matchState === "CONFIRMED") return { type: "assign", clientId: c.clientId, contactId: null, method: "ALIAS" };
  if (c.clientId && c.matchState === "AUTO" && (c.matchMethod === "PHONE" || c.matchMethod === "EMAIL" || c.matchMethod === "NIP")) {
    return { type: "assign", clientId: c.clientId, contactId: null, method: "SIGNAL" };
  }
  const fromSeries = c.titleKey ? input.series.get(c.titleKey) : undefined;
  if (fromSeries) return { type: "assign", clientId: fromSeries, contactId: null, method: "SERIES" };
  // Dopasowanie po samej nazwie (także „AUTO” z historii) — tylko propozycja.
  const candidates = c.clientId && !c.candidates.some((x) => x.clientId === c.clientId) ? [{ clientId: c.clientId, score: 1 }, ...c.candidates] : c.candidates;
  return { type: "pending", candidates };
}
