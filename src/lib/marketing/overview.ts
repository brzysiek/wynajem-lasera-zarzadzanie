// Wniosek 54, etap 1c: model widoku „Przegląd” z raportu okresu i poprzedniego okresu.
// Czysty moduł (vitest bez „@/”). Kafelki, lejek i tabele sumują się do tych samych
// wartości: suma kanałów = „Razem”.
import { CH } from "./source";
import { addDays } from "./period";
import { delta, type Node, type Report } from "./report";

export type Tile = { value: number; prev: number; diff: number; pct: number | null; sub?: string };

export type SourceBar = { label: string; bookings: number; revenue: number; leads: number; unknown: boolean };

export type TodoItem = { who: "Ania" | "Tomek" | "Info"; text: string; href: string; linkLabel: string | null };

export type Overview = {
  leads: Tile;
  offers: Tile & { rateOfLeads: number | null };
  bookings: Tile & { rateOfLeads: number | null };
  revenue: Tile & { avgPerBooking: number | null };
  spend: { value: number; hasCost: boolean; prev: number; google: number; meta: number; ranges: SpendRange[] };
  funnel: { leads: number; offers: number; bookings: number; revenue: number; offersRate: number | null; bookingsRate: number | null };
  sources: SourceBar[];
};

// Zakres dni z zaimportowanymi kosztami w okresie raportu (osobno Google Ads i Meta).
export type CostCoverage = { channel: "GOOGLE_ADS" | "META"; days: number; from: string | null; to: string | null };
export type SpendRange = { label: "Google" | "Meta"; text: string; incomplete: boolean };

const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

// Podpis kafelka „Wydatki na reklamy”: zakres zaimportowanych dni każdego kanału; „niepełny”, gdy brakuje
// więcej niż dnia na początku albo końcu okresu (koszty z dnia bieżącego zwykle jeszcze nie są wgrane).
export function spendRanges(period: { from: string; to: string }, coverage: CostCoverage[]): SpendRange[] {
  return (["GOOGLE_ADS", "META"] as const).map((channel) => {
    const label = channel === "META" ? ("Meta" as const) : ("Google" as const);
    const c = coverage.find((x) => x.channel === channel);
    if (!c || c.days === 0 || !c.from || !c.to) return { label, text: "brak zaimportowanych kosztów w tym okresie", incomplete: true };
    const incomplete = c.from > addDays(period.from, 1) || c.to < addDays(period.to, -1);
    return { label, text: c.from === c.to ? dm(c.from) : `${dm(c.from)}–${dm(c.to)}`, incomplete };
  });
}

const pct = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 100) : null);
const tile = (cur: number, prev: number): Tile => ({ value: cur, prev, ...delta(cur, prev) });

export function overview(cur: Report, prev: Report, period?: { from: string; to: string }, coverage: CostCoverage[] = []): Overview {
  const c = cur.total.metrics;
  const p = prev.total.metrics;
  const sources: SourceBar[] = cur.channels
    .filter((n) => n.metrics.leads.razem > 0 || n.metrics.bookings > 0)
    .map((n: Node) => ({ label: n.label, bookings: n.metrics.bookings, revenue: n.metrics.revenue, leads: n.metrics.leads.razem, unknown: n.label === CH.NONE }))
    .sort((a, b) => b.bookings - a.bookings || b.revenue - a.revenue || b.leads - a.leads || a.label.localeCompare(b.label, "pl"));
  return {
    leads: tile(c.leads.razem, p.leads.razem),
    offers: { ...tile(c.offers, p.offers), rateOfLeads: pct(c.offers, c.leads.razem) },
    bookings: { ...tile(c.bookings, p.bookings), rateOfLeads: pct(c.bookings, c.leads.razem) },
    revenue: { ...tile(c.revenue, p.revenue), avgPerBooking: c.bookings > 0 ? Math.round(c.revenue / c.bookings) : null },
    spend: {
      value: c.cost,
      hasCost: c.cost > 0 || c.clicks > 0,
      prev: p.cost,
      google: cur.channels.find((n) => n.label === CH.GOOGLE_ADS)?.metrics.cost ?? 0,
      meta: cur.channels.find((n) => n.label === CH.META)?.metrics.cost ?? 0,
      ranges: period ? spendRanges(period, coverage) : [],
    },
    funnel: { leads: c.leads.razem, offers: c.offers, bookings: c.bookings, revenue: c.revenue, offersRate: pct(c.offers, c.leads.razem), bookingsRate: pct(c.bookings, c.offers) },
    sources,
  };
}

const DAY = 86_400_000;

// „Do zrobienia”: lista generowana automatycznie, pozycje z zerem są ukryte.
export function todoItems(input: { unsourced: number; waitingProposals: number; lastCostImportAt: string | null; lastMetaImportAt?: string | null; now: Date; pendingConversions: number; query: string }): TodoItem[] {
  const out: TodoItem[] = [];
  const q = input.query ? `?${input.query}` : "";
  if (input.unsourced > 0) {
    out.push({
      who: "Ania",
      text: `${input.unsourced} ${input.unsourced === 1 ? "nowa klientka bez źródła" : input.unsourced < 5 ? "nowe klientki bez źródła" : "nowych klientek bez źródła"} — zapytać przy kontakcie i wpisać w karcie.`,
      href: `/marketing/kampanie${q}#bez-zrodla`,
      linkLabel: "Pokaż listę",
    });
  }
  if (input.waitingProposals > 0) {
    out.push({ who: "Tomek", text: `${input.waitingProposals} ${input.waitingProposals === 1 ? "propozycja zmian" : "propozycji zmian"} w reklamach czeka na decyzję.`, href: "/marketing/analiza", linkLabel: "Otwórz analizę" });
  }
  const last = input.lastCostImportAt ? new Date(input.lastCostImportAt) : null;
  if (!last || input.now.getTime() - last.getTime() > 7 * DAY) {
    const when = last ? last.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" }) : "jeszcze nie importowano";
    out.push({ who: "Tomek", text: `Wgraj koszty Google Ads za ostatni tydzień (ostatni import: ${when}).`, href: "/marketing/ustawienia", linkLabel: null });
  }
  // Meta: przypomnienie tylko, gdy koszty Mety już kiedyś importowano (bez tego nie ponaglamy).
  const lastMeta = input.lastMetaImportAt ? new Date(input.lastMetaImportAt) : null;
  if (lastMeta && input.now.getTime() - lastMeta.getTime() > 7 * DAY) {
    out.push({ who: "Tomek", text: `Wgraj koszty Meta za ostatni tydzień (ostatni import: ${lastMeta.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" })}).`, href: "/marketing/ustawienia", linkLabel: null });
  }
  if (input.pendingConversions > 0) {
    out.push({ who: "Info", text: `Konwersje do Google: ${input.pendingConversions} gotowych do eksportu.`, href: "/marketing/ustawienia", linkLabel: null });
  }
  return out;
}
