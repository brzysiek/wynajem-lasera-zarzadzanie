// Wniosek 54, etap 1c: zakładka Analiza — raport tygodniowy Claude’a i propozycje
// zmian. Czysty moduł (vitest bez „@/”): walidacja wejścia MCP i przejścia statusów.

export const AREAS = ["google_ads", "meta", "strona", "panel"] as const;
export type Area = (typeof AREAS)[number];
export const AREA_LABEL: Record<Area, string> = { google_ads: "Google Ads", meta: "Meta", strona: "Strona", panel: "Panel" };

export const STATUSES = ["czeka", "zaakceptowana", "odrzucona", "wdrozona"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = { czeka: "Czeka na decyzję", zaakceptowana: "Zaakceptowana — do wdrożenia", odrzucona: "Odrzucona", wdrozona: "Wdrożona" };

export const RATINGS = ["dziala", "obserwuj", "do_wykluczenia"] as const;
export type Rating = (typeof RATINGS)[number];
export const RATING_LABEL: Record<Rating, string> = { dziala: "Działa", obserwuj: "Obserwuj", do_wykluczenia: "Do wykluczenia" };

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; message: string };

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());

export type ReportInput = {
  periodFrom: string;
  periodTo: string;
  title: string;
  conclusions: { tytul: string; opis: string }[];
  contentMd: string;
  proposals: { area: Area; title: string; reasoning: string }[];
};

export function parseReportInput(a: Record<string, unknown>): Ok<ReportInput> | Err {
  if (!isDay(a.okres_od) || !isDay(a.okres_do)) return { ok: false, message: "okres_od i okres_do: data RRRR-MM-DD." };
  if (a.okres_od > a.okres_do) return { ok: false, message: "okres_od nie może być późniejszy niż okres_do." };
  const title = text(a.tytul, 191);
  if (!title) return { ok: false, message: "Brak tytułu." };
  const contentMd = typeof a.tresc_md === "string" ? a.tresc_md.trim() : "";
  if (!contentMd) return { ok: false, message: "Brak treści raportu (tresc_md)." };
  if (!Array.isArray(a.wnioski) || a.wnioski.length < 1 || a.wnioski.length > 3) return { ok: false, message: "wnioski: od 1 do 3 pozycji { tytul, opis }." };
  const conclusions: ReportInput["conclusions"] = [];
  for (const w of a.wnioski as unknown[]) {
    const o = w && typeof w === "object" ? (w as Record<string, unknown>) : {};
    const t = text(o.tytul, 191);
    const d = text(o.opis, 1000);
    if (!t || !d) return { ok: false, message: "Każdy wniosek wymaga tytulu i opisu." };
    conclusions.push({ tytul: t, opis: d });
  }
  const props = Array.isArray(a.propozycje) ? (a.propozycje as unknown[]) : [];
  if (props.length > 20) return { ok: false, message: "Za dużo propozycji (maks. 20)." };
  const proposals: ReportInput["proposals"] = [];
  for (const p of props) {
    const o = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
    const area = typeof o.obszar === "string" && (AREAS as readonly string[]).includes(o.obszar) ? (o.obszar as Area) : null;
    const t = text(o.tytul, 191);
    const r = text(o.uzasadnienie, 2000);
    if (!area) return { ok: false, message: `Propozycja: obszar to ${AREAS.join(" | ")}.` };
    if (!t || !r) return { ok: false, message: "Propozycja wymaga tytulu i uzasadnienia." };
    proposals.push({ area, title: t, reasoning: r });
  }
  return { ok: true, value: { periodFrom: a.okres_od, periodTo: a.okres_do, title, conclusions, contentMd, proposals } };
}

export type Action = "accept" | "reject" | "undo" | "implement";

// Przejścia: czeka → zaakceptowana / odrzucona; decyzję można cofnąć do wdrożenia;
// wdrożyć można tylko zaakceptowaną.
export function nextStatus(current: Status, action: Action): Ok<Status> | Err {
  if (action === "accept" || action === "reject") {
    if (current !== "czeka") return { ok: false, message: "Decyzja już zapadła — najpierw ją cofnij." };
    return { ok: true, value: action === "accept" ? "zaakceptowana" : "odrzucona" };
  }
  if (action === "undo") {
    if (current === "wdrozona") return { ok: false, message: "Propozycja jest już wdrożona — decyzji nie można cofnąć." };
    if (current === "czeka") return { ok: false, message: "Propozycja nie ma decyzji do cofnięcia." };
    return { ok: true, value: "czeka" };
  }
  if (current !== "zaakceptowana") return { ok: false, message: current === "wdrozona" ? "Propozycja jest już oznaczona jako wdrożona." : "Wdrożyć można tylko zaakceptowaną propozycję." };
  return { ok: true, value: "wdrozona" };
}

export function parseRating(a: Record<string, unknown>): Ok<{ campaign: string; phrase: string; rating: Rating | "brak"; reason: string | null }> | Err {
  const campaign = text(a.kampania, 191);
  const phrase = text(a.fraza, 191);
  if (!campaign) return { ok: false, message: "Brak parametru kampania." };
  if (!phrase) return { ok: false, message: "Brak parametru fraza." };
  const rating = a.ocena;
  if (rating !== "brak" && !(RATINGS as readonly string[]).includes(String(rating))) return { ok: false, message: `ocena: ${RATINGS.join(" | ")} albo brak (zdejmuje ocenę).` };
  const reason = text(a.uzasadnienie, 1000);
  if (rating !== "brak" && !reason) return { ok: false, message: "Podaj uzasadnienie oceny." };
  return { ok: true, value: { campaign, phrase, rating: rating as Rating | "brak", reason } };
}
