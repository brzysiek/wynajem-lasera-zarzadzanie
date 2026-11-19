// Wniosek 54, etap 1c: model widoku „Przegląd” z raportu okresu i poprzedniego okresu.
// Czysty moduł (vitest bez „@/”). Kafelki, lejek i tabele sumują się do tych samych
// wartości: suma kanałów = „Razem”.
import { CH } from "./source";
import { delta, type Node, type Report } from "./report";

export type Tile = { value: number; prev: number; diff: number; pct: number | null; sub?: string };

export type SourceBar = { label: string; bookings: number; revenue: number; leads: number; unknown: boolean };

export type TodoItem = { who: "Ania" | "Tomek" | "Info"; text: string; href: string; linkLabel: string | null };

export type Overview = {
  leads: Tile;
  offers: Tile & { rateOfLeads: number | null };
  bookings: Tile & { rateOfLeads: number | null };
  revenue: Tile & { avgPerBooking: number | null };
  spend: { value: number; hasCost: boolean; prev: number };
  funnel: { leads: number; offers: number; bookings: number; revenue: number; offersRate: number | null; bookingsRate: number | null };
  sources: SourceBar[];
};

const pct = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 100) : null);
const tile = (cur: number, prev: number): Tile => ({ value: cur, prev, ...delta(cur, prev) });

export function overview(cur: Report, prev: Report): Overview {
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
    spend: { value: c.cost, hasCost: c.cost > 0 || c.clicks > 0, prev: p.cost },
    funnel: { leads: c.leads.razem, offers: c.offers, bookings: c.bookings, revenue: c.revenue, offersRate: pct(c.offers, c.leads.razem), bookingsRate: pct(c.bookings, c.offers) },
    sources,
  };
}

const DAY = 86_400_000;

// „Do zrobienia”: lista generowana automatycznie, pozycje z zerem są ukryte.
export function todoItems(input: { unsourced: number; waitingProposals: number; lastCostImportAt: string | null; now: Date; pendingConversions: number; query: string }): TodoItem[] {
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
  if (input.pendingConversions > 0) {
    out.push({ who: "Info", text: `Konwersje do Google: ${input.pendingConversions} gotowych do eksportu.`, href: "/marketing/ustawienia", linkLabel: null });
  }
  return out;
}
