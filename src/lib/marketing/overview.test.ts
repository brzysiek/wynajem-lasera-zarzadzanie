import { describe, expect, it } from "vitest";
import { buildReport, type ReportLead } from "./report";
import { overview, todoItems } from "./overview";
import { attributeSource } from "./source";

const localDay = (d: Date) => d.toISOString().slice(0, 10);
const L = (id: string, attr: Record<string, string> | null, o: Partial<ReportLead> = {}): ReportLead => ({
  id, title: id, type: "REZERWACJA_WWW", stage: "SYGNAL", createdAt: new Date("2026-11-10T10:00:00Z"), maxStage: "SYGNAL", talked: false, returning: false, lostReason: null, revenue: null,
  contactEmail: "a@b.pl", archivedAt: null, archiveReason: null, source: attributeSource({ attribution: attr, type: o.type ?? "REZERWACJA_WWW" }), ...o,
});
const rep = (leads: ReportLead[]) => buildReport({ leads, costs: [], from: "2026-10-22", to: "2026-11-18", localDay });

describe("przegląd Marketingu", () => {
  const cur = rep([
    L("g1", { utm_source: "google", utm_campaign: "alma" }, { maxStage: "REZERWACJA", stage: "REZERWACJA", revenue: 3900 }),
    L("g2", { utm_source: "google", utm_campaign: "alma" }, { maxStage: "OFERTA", stage: "OFERTA" }),
    L("n1", { form: "kontakt" }, { maxStage: "REZERWACJA", stage: "REZERWACJA", revenue: 1400 }),
    L("n2", { form: "kontakt" }, { maxStage: "OFERTA", stage: "OFERTA" }),
    L("o1", { referrer: "https://www.google.com/" }, { type: "POBRANIE_CENNIKA" }),
  ]);
  const prev = rep([L("p1", { form: "kontakt" }), L("p2", { form: "kontakt" })]);
  const o = overview(cur, prev);

  it("kafelki, odsetki i porównanie z poprzednim okresem", () => {
    expect(o.leads).toMatchObject({ value: 5, prev: 2, diff: 3, pct: 150 });
    expect(o.offers).toMatchObject({ value: 4, rateOfLeads: 80 });
    expect(o.bookings).toMatchObject({ value: 2, rateOfLeads: 40 });
    expect(o.revenue).toMatchObject({ value: 5300, avgPerBooking: 2650 });
    expect(o.spend.hasCost).toBe(false);
  });
  it("lejek: zapytania → oferty → rezerwacje → przychód, z odsetkiem przejścia", () => {
    expect(o.funnel).toMatchObject({ leads: 5, offers: 4, bookings: 2, revenue: 5300, offersRate: 80, bookingsRate: 50 });
  });
  it("suma kanałów = Razem (zapytania, oferty, rezerwacje, przychód)", () => {
    const sum = (f: (n: (typeof cur.channels)[number]) => number) => cur.channels.reduce((s, n) => s + f(n), 0);
    expect(sum((n) => n.metrics.leads.razem)).toBe(cur.total.metrics.leads.razem);
    expect(sum((n) => n.metrics.offers)).toBe(cur.total.metrics.offers);
    expect(sum((n) => n.metrics.bookings)).toBe(cur.total.metrics.bookings);
    expect(sum((n) => n.metrics.revenue)).toBe(cur.total.metrics.revenue);
  });
  it("skąd rezerwacje: malejąco wg liczby rezerwacji, potem przychodu; „Bez źródła” oznaczone", () => {
    expect(o.sources.map((s) => [s.label, s.bookings, s.revenue, s.unknown])).toEqual([
      ["Google Ads", 1, 3900, false],
      ["Bez źródła", 1, 1400, true],
      ["Google organiczne", 0, 0, false],
    ]);
  });
});

describe("do zrobienia", () => {
  const now = new Date("2026-11-19T10:00:00Z");
  it("ukrywa pozycje z zerem; pokazuje cztery rodzaje, gdy jest co robić", () => {
    expect(todoItems({ unsourced: 0, waitingProposals: 0, lastCostImportAt: "2026-11-18T10:00:00Z", now, pendingConversions: 0, query: "okres=28" })).toEqual([]);
    const all = todoItems({ unsourced: 4, waitingProposals: 3, lastCostImportAt: null, now, pendingConversions: 2, query: "okres=28" });
    expect(all.map((t) => t.who)).toEqual(["Ania", "Tomek", "Tomek", "Info"]);
    expect(all[0].text).toContain("4 nowe klientki bez źródła");
    expect(all[0].href).toBe("/marketing/kampanie?okres=28#bez-zrodla");
    expect(all[2].text).toContain("jeszcze nie importowano");
  });
  it("import kosztów starszy niż 7 dni wraca na listę, świeży nie", () => {
    const stale = todoItems({ unsourced: 0, waitingProposals: 0, lastCostImportAt: "2026-11-01T10:00:00Z", now, pendingConversions: 0, query: "" });
    expect(stale).toHaveLength(1);
    expect(stale[0].text).toContain("01.11.2026");
  });
});
