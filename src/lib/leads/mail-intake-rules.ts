// Mail przychodzący od nowej osoby → sygnał (wniosek 43): reguły czyste (vitest
// bez "@/"). Filtr w panelu, bez API modelu i bez zmian w Gmailu: odrzucenie
// oczywistych śmieci, punktacja nowych osób, wyciąganie telefonu i NIP, decyzja
// zależna od trybu (ostrożny: nic nie zakłada się samo).
import { isAutomated, type MessageHeaders } from "../gmail/parse";

export type IntakeMode = "CAUTIOUS" | "AUTO";
export type WordPoints = { word: string; points: number };

export type IntakeConfig = {
  mode: IntakeMode;
  positive: WordPoints[]; // plusy (punkty > 0)
  negative: WordPoints[]; // minusy (punkty < 0)
  rentalWords: string[]; // prośba o wynajem od klientki z bazy → „Do sprawdzenia”
  blockedDomains: string[]; // nadawcy systemowi, od których nigdy nie będzie sygnału
  high: number; // od tej punktacji: sygnał (tryb AUTO) / do sprawdzenia
  medium: number; // od tej: do sprawdzenia; niżej: odrzucone (widoczne 14 dni)
};

export const DEFAULT_CONFIG: IntakeConfig = {
  mode: "CAUTIOUS",
  positive: [
    { word: "lightsheer", points: 3 },
    { word: "alma harmony", points: 3 },
    { word: "alma", points: 2 },
    { word: "observ", points: 3 },
    { word: "cooltech", points: 3 },
    { word: "resur", points: 3 },
    { word: "kriolipoliz", points: 3 },
    { word: "wynaj", points: 3 },
    { word: "wypozycz", points: 3 },
    { word: "szkolen", points: 2 },
    { word: "rezerwac", points: 2 },
    { word: "cennik", points: 2 },
    { word: "cena", points: 2 },
    { word: "ile kosztuje", points: 2 },
    { word: "termin", points: 1 },
    { word: "laser", points: 1 },
    { word: "oferta wynajmu", points: 2 },
  ],
  negative: [
    { word: "pozycjonowan", points: -5 },
    { word: "seo", points: -4 },
    { word: "wspolpraca reklamow", points: -4 },
    { word: "kampani", points: -2 },
    { word: "marketing", points: -2 },
    { word: "faktura", points: -3 },
    { word: "rachunek", points: -3 },
    { word: "przelew", points: -3 },
    { word: "newsletter", points: -4 },
    { word: "wypisz sie", points: -3 },
    { word: "zaproszenie na webinar", points: -4 },
  ],
  rentalWords: ["wynaj", "wypozycz", "lightsheer", "alma", "observ", "cooltech", "resur", "termin", "rezerwac", "oferta", "cennik", "ile kosztuje", "kiedy mozna"],
  blockedDomains: ["fakturownia.pl", "hubspot.com", "hubspotemail.net", "facebookmail.com", "linkedin.com", "github.com", "cyberfolks.pl", "cyber-folks.pl", "google.com", "mailchimp.com", "paypal.com"],
  high: 5,
  medium: 2,
};

// Małe litery, bez polskich znaków — słowa i teksty porównujemy w tej postaci.
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : d);
const words = (v: unknown, d: string[]) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => fold(x.trim())).filter(Boolean).slice(0, 200) : d);
const pts = (v: unknown, d: WordPoints[], sign: 1 | -1): WordPoints[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is { word: unknown; points: unknown } => !!x && typeof x === "object")
        .map((x) => ({ word: typeof x.word === "string" ? fold(x.word.trim()) : "", points: Math.abs(num(x.points, 0)) * sign }))
        .filter((x) => x.word && x.points !== 0)
        .slice(0, 200)
    : d;

// Konfiguracja z bazy (JSON) scalona z domyślną; błędne pola → domyślne.
export function mergeConfig(raw: unknown): IntakeConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const high = num(r.high, DEFAULT_CONFIG.high);
  const medium = Math.min(num(r.medium, DEFAULT_CONFIG.medium), high);
  return {
    mode: r.mode === "AUTO" ? "AUTO" : "CAUTIOUS",
    positive: pts(r.positive, DEFAULT_CONFIG.positive, 1),
    negative: pts(r.negative, DEFAULT_CONFIG.negative, -1),
    rentalWords: words(r.rentalWords, DEFAULT_CONFIG.rentalWords),
    blockedDomains: words(r.blockedDomains, DEFAULT_CONFIG.blockedDomains),
    high,
    medium,
  };
}

// Słowo krótsze niż 4 znaki tylko jako całe słowo (np. „seo”, „cena”), dłuższe
// jako początek wyrazu / fragment (np. „wynaj” → wynajem, wynająć).
function hits(text: string, word: string): boolean {
  if (word.length < 4) return new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(text);
  return text.includes(word);
}

export function scoreText(text: string, cfg: IntakeConfig): { score: number; matched: string[] } {
  const t = fold(text);
  let score = 0;
  const matched: string[] = [];
  for (const w of [...cfg.positive, ...cfg.negative]) {
    if (hits(t, w.word)) {
      score += w.points;
      matched.push(`${w.word} (${w.points > 0 ? "+" : ""}${w.points})`);
    }
  }
  return { score, matched };
}

// Prośba o wynajem w mailu klientki z bazy: które słowa się znalazły.
export function rentalRequestWords(text: string, cfg: IntakeConfig): string[] {
  const t = fold(text);
  return cfg.rentalWords.filter((w) => hits(t, w));
}

export function band(score: number, cfg: IntakeConfig): "high" | "medium" | "low" {
  return score >= cfg.high ? "high" : score >= cfg.medium ? "medium" : "low";
}

// Nowa osoba: tryb ostrożny nie zakłada nic sam (wysoka i średnia → do sprawdzenia),
// tryb AUTO zakłada sygnał tylko przy wysokiej punktacji; niska → odrzucone.
export function decideNewPerson(score: number, cfg: IntakeConfig): "SYGNAL_AUTO" | "DO_SPRAWDZENIA" | "ODRZUCONY" {
  const b = band(score, cfg);
  if (b === "low") return "ODRZUCONY";
  if (b === "high" && cfg.mode === "AUTO") return "SYGNAL_AUTO";
  return "DO_SPRAWDZENIA";
}

const NO_REPLY = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|newsletter|mailer|noreply\d*)([.+_-]|@|$)/i;
const BLOCKED_LABELS: Record<string, string> = { CATEGORY_PROMOTIONS: "kategoria Gmaila: Promocje", CATEGORY_SOCIAL: "kategoria Gmaila: Social", CATEGORY_FORUMS: "kategoria Gmaila: Fora" };

// Oczywiste śmieci (pkt 2a) — powód albo null. `excluded` = domena/adres z listy
// wykluczeń (wniosek 7), `own` = nasz adres.
export function rejectReason(input: {
  from: string;
  headers: MessageHeaders;
  labelIds: string[];
  own: boolean;
  excluded: boolean;
  blockedDomains: string[];
}): string | null {
  if (input.own) return "nasz adres";
  if (NO_REPLY.test(input.from)) return "no-reply / adres systemowy";
  const domain = input.from.slice(input.from.lastIndexOf("@") + 1).toLowerCase();
  if (input.blockedDomains.some((d) => domain === d || domain.endsWith(`.${d}`))) return `nadawca systemowy: ${domain}`;
  if (input.excluded) return "domena z listy wykluczeń";
  for (const l of input.labelIds) if (BLOCKED_LABELS[l]) return BLOCKED_LABELS[l];
  if (input.headers["list-unsubscribe"] || input.headers["list-id"]) return "newsletter (List-Unsubscribe)";
  if (isAutomated(input.headers)) return "wiadomość automatyczna (nagłówki)";
  return null;
}

// Telefon: 9 cyfr (opcjonalnie +48) w formatach 600 100 200 / 600-100-200 / +48 600 100 200.
export function extractPhone(text: string): string | null {
  const m = text.match(/(?:\+?48[\s.-]?)?(?<![\d])([5-8]\d{2}[\s.-]?\d{3}[\s.-]?\d{3})(?![\d])/);
  if (!m) return null;
  const digits = m[1].replace(/\D/g, "");
  return digits.length === 9 ? `+48${digits}` : null;
}

export function isValidNip(nip: string): boolean {
  const d = nip.replace(/\D/g, "");
  if (d.length !== 10) return false;
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = w.reduce((a, x, i) => a + x * Number(d[i]), 0) % 11;
  return sum !== 10 && sum === Number(d[9]);
}

// NIP: 10 cyfr z poprawną sumą kontrolną (z kreskami albo bez), najlepiej po „NIP”.
export function extractNip(text: string): string | null {
  const re = /(?<![\d])(\d{3}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}|\d{10})(?![\d])/g;
  for (const m of text.matchAll(re)) {
    const digits = m[1].replace(/\D/g, "");
    if (isValidNip(digits)) return digits;
  }
  return null;
}

// „Anna Kowalska <a@b.pl>” → „Anna Kowalska” (bez adresu i cudzysłowów).
export function displayName(fromHeader: string | undefined): string | null {
  const m = (fromHeader ?? "").match(/^\s*"?([^"<]+?)"?\s*<[^>]+>/);
  const n = m?.[1]?.trim();
  return n && !n.includes("@") ? n.slice(0, 190) : null;
}
