// Lista wykluczeń domen i adresów (wniosek 7) — czyste reguły (vitest, bez @/).
//
// EXCLUDE — domena / adres spoza branży (np. firmy inżynieryjne Tomka): maile
//   nie trafiają do historii klientów, kontakty i transakcje z HubSpota nie
//   tworzą klientów ani sygnałów.
// HIDE — domena, której wątki są domyślnie ukryte w historii klienta, chyba
//   że temat / skrót dotyczy wynajmu (np. kreatywnainzynieria.pl — ten sam
//   alias pisze też do gabinetów o laserach).

export type ExclusionKind = "EXCLUDE" | "HIDE";
export type ExclusionEntry = { kind: ExclusionKind; value: string };

export const DEFAULT_HIDE_KEYWORDS = ["urządzen", "wynaj", "laser", "wynajemlasera", "szkoleni", "oferta", "estegh", "lightsheer", "alma harmony", "cooltech"];

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l");

// „@Edina.pl”, „https://www.edina.pl/kontakt”, „jan@x.pl” → wartość na liście.
export function normalizeExclusion(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  let v = raw.trim().toLowerCase();
  if (!v) return { ok: false, message: "Pusta wartość." };
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(v)) return { ok: true, value: v };
  v = v.replace(/^[a-z]+:\/\//, "").replace(/^@/, "").replace(/^www\./, "").split(/[/?#\s]/)[0];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v)) return { ok: false, message: `„${raw.trim()}” to nie domena ani adres e-mail.` };
  return { ok: true, value: v };
}

// Wiele pozycji naraz (lista z pliku agenta): po liniach, przecinkach, średnikach.
export function parseExclusionList(text: string): { values: string[]; errors: string[] } {
  const values = new Set<string>();
  const errors: string[] = [];
  for (const part of text.split(/[\n,;]+/)) {
    if (!part.trim()) continue;
    const r = normalizeExclusion(part);
    if (r.ok) values.add(r.value);
    else errors.push(r.message);
  }
  return { values: [...values], errors };
}

export type ExclusionMatcher = (address: string | null | undefined) => ExclusionKind | null;

export function buildExclusionMatcher(entries: ExclusionEntry[]): ExclusionMatcher {
  const addresses = new Map<string, ExclusionKind>();
  const domains = new Map<string, ExclusionKind>();
  for (const e of entries) (e.value.includes("@") ? addresses : domains).set(e.value.toLowerCase(), e.kind);
  return (address) => {
    const a = address?.trim().toLowerCase();
    if (!a || !a.includes("@")) return null;
    const exact = addresses.get(a);
    if (exact) return exact;
    const parts = a.slice(a.lastIndexOf("@") + 1).split(".");
    for (let i = 0; i < parts.length - 1; i++) {
      const hit = domains.get(parts.slice(i).join("."));
      if (hit) return hit;
    }
    return null;
  };
}

export type EmailHideReason = "EXCLUDED" | "ENGINEERING";

// Czy wiadomość ukryć w historii klienta. EXCLUDED — każdy adres spoza
// naszych skrzynek jest na liście wykluczeń (nie zapisujemy jej wcale).
// ENGINEERING — ktoś z domeny „HIDE” bierze udział, a temat / skrót nie
// dotyczy wynajmu.
export function emailHideReason(
  m: { from: string[]; to: string[]; cc: string[]; subject: string | null; snippet: string | null },
  match: ExclusionMatcher,
  isOwn: (address: string) => boolean,
  keywords: string[] = DEFAULT_HIDE_KEYWORDS,
): EmailHideReason | null {
  const all = [...m.from, ...m.to, ...m.cc];
  const external = all.filter((a) => !isOwn(a));
  const kinds = all.map((a) => match(a));
  if (external.length > 0 && external.every((a) => match(a) === "EXCLUDE")) return "EXCLUDED";
  if (kinds.includes("HIDE")) {
    const text = fold(`${m.subject ?? ""} ${m.snippet ?? ""}`);
    if (!keywords.some((k) => k.trim() && text.includes(fold(k.trim())))) return "ENGINEERING";
  }
  return null;
}

// Plan importu klientów z HubSpota bez osób z wykluczonych adresów i domen;
// firma bez pozostałych osób odpada.
export function withoutExcluded<T extends { contacts: { email: string | null }[] }>(clients: T[], match: ExclusionMatcher): T[] {
  return clients
    .map((c) => ({ c: { ...c, contacts: c.contacts.filter((p) => match(p.email) !== "EXCLUDE") }, had: c.contacts.length > 0 }))
    .filter(({ c, had }) => c.contacts.length > 0 || !had)
    .map(({ c }) => c);
}

// Archiwizacja z powodem „spoza branży”: domeny osób (bez darmowych i już
// wykluczonych) do zaproponowania na listę.
export function suggestExclusionDomains(emails: (string | null)[], freeDomains: Set<string>, match: ExclusionMatcher): string[] {
  const out = new Set<string>();
  for (const e of emails) {
    const a = e?.trim().toLowerCase();
    if (!a?.includes("@")) continue;
    const d = a.slice(a.lastIndexOf("@") + 1);
    if (freeDomains.has(d) || match(a)) continue;
    out.add(d);
  }
  return [...out];
}
