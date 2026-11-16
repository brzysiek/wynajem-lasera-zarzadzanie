// Historia SMS (wniosek 53): czyste reguły wyszukiwania po treści (bez względu na
// wielkość liter i polskie znaki), podświetlania trafień i rozpoznawania, czy
// SMS pochodzi z szablonu, czy został napisany / zmieniony ręcznie. Bez bazy (vitest).

// Składanie znak po znaku, żeby długość tekstu się nie zmieniała — indeksy trafień
// w złożonym tekście są wtedy takie same w oryginale (podświetlanie).
export function fold(text: string): string {
  let out = "";
  for (const ch of text) {
    const base = ch === "ł" || ch === "Ł" ? "l" : (ch.normalize("NFD")[0] ?? ch);
    out += base.toLowerCase();
  }
  return out;
}

const digits = (s: string) => s.replace(/\D/g, "");

export type SearchableSms = { body: string; recipient: string; clientName: string | null; rentalLabel: string | null };

// Trafienie: fragment w treści, nazwie klienta, wynajmie albo numerze telefonu
// (numer porównywany po cyfrach, więc „531 574 115” znajdzie „+48531574115”).
export function matchesQuery(row: SearchableSms, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  if (fold(row.body).includes(q) || fold(row.clientName ?? "").includes(q) || fold(row.rentalLabel ?? "").includes(q) || fold(row.recipient).includes(q)) return true;
  const qd = digits(q);
  return qd.length >= 3 && digits(row.recipient).includes(qd);
}

export type Segment = { text: string; hit: boolean };

// Dzieli treść na odcinki z zaznaczonymi trafieniami (wszystkie wystąpienia).
export function highlightSegments(text: string, query: string): Segment[] {
  const q = fold(query.trim());
  if (!q) return [{ text, hit: false }];
  const f = fold(text);
  const out: Segment[] = [];
  let from = 0;
  for (let i = f.indexOf(q); i >= 0; i = f.indexOf(q, from)) {
    if (i > from) out.push({ text: text.slice(from, i), hit: false });
    out.push({ text: text.slice(i, i + q.length), hit: true });
    from = i + q.length;
  }
  if (from < text.length) out.push({ text: text.slice(from), hit: false });
  return out.length ? out : [{ text, hit: false }];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Szablon → wyrażenie: tokeny {coś} pasują tylko do „swojego” rodzaju tekstu (data,
// telefon, krótki tekst bez końca zdania), reszta dosłownie (spacje elastyczne).
// Dopisek wstawiony do szablonu albo zmieniona treść przestają pasować → „ręczny”.
const TOKEN_RE: Record<string, string> = {
  data: "\\d{1,2}\\.\\d{1,2}\\.\\d{4}",
  telefon: "[\\d +]{9,16}",
};
const FREE = "(?:(?!\\.\\s)[^\\n]){1,90}?";

export function templateRegex(body: string): RegExp {
  const tokens = [...body.trim().matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  const parts = body.trim().split(/\{[^}]+\}/g).map((p) => escapeRe(p).replace(/\s+/g, "\\s+"));
  let src = parts[0];
  tokens.forEach((t, i) => {
    const kind = Object.keys(TOKEN_RE).find((k) => t.includes(k));
    src += (kind ? TOKEN_RE[kind] : FREE) + parts[i + 1];
  });
  return new RegExp(`^\\s*${src}\\s*$`);
}

export type SmsTemplateRef = { label: string; body: string };

// „szablon” — treść pasuje do któregoś szablonu (zwraca jego nazwę); „reczny” —
// napisany od nowa albo zmieniony szablon.
export function classifySms(body: string, templates: SmsTemplateRef[]): { kind: "szablon" | "reczny"; template: string | null } {
  const hit = templates.find((t) => t.body.trim() && templateRegex(t.body).test(body));
  return hit ? { kind: "szablon", template: hit.label } : { kind: "reczny", template: null };
}
