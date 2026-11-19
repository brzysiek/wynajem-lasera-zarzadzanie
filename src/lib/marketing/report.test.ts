import { describe, expect, it } from "vitest";
import { buildReport, countsInReport, flatten, mondayOf, reportCsv, type ReportLead } from "./report";
import { CH, attributeSource } from "./source";
import type { CostRow } from "./costs-csv";

const localDay = (d: Date) => d.toISOString().slice(0, 10);

function lead(id: string, attr: Record<string, string> | null, over: Partial<ReportLead> = {}): ReportLead {
  const type = over.type ?? "REZERWACJA_WWW";
  return {
    id,
    title: `Sygnał ${id}`,
    type,
    stage: "SYGNAL",
    createdAt: new Date("2026-11-10T10:00:00Z"),
    maxStage: "SYGNAL",
    talked: false,
    returning: false,
    lostReason: null,
    revenue: null,
    contactEmail: "a@b.pl",
    archivedAt: null,
    archiveReason: null,
    source: attributeSource({ attribution: attr, type }),
    ...over,
  };
}

const cost = (over: Partial<CostRow>): CostRow => ({
  day: "2026-11-10",
  campaignKey: "alma",
  campaignName: "Alma",
  adGroupId: "111",
  adGroupName: "Alma ogólne",
  keyword: "wynajem lasera alma",
  keywordText: "wynajem lasera alma",
  impressions: 100,
  clicks: 10,
  cost: 50,
  ...over,
});

const ALMA = { utm_source: "google", utm_campaign: "alma", utm_content: "111", utm_term: "wynajem lasera alma" };

describe("filtry sygnałów", () => {
  it("pomija testowe i zarchiwizowane duplikaty, ale nie inne archiwa", () => {
    expect(countsInReport({ contactEmail: "test+www-1@wynajemlasera.pl", archivedAt: null, archiveReason: null })).toBe(false);
    expect(countsInReport({ contactEmail: "a@b.pl", archivedAt: new Date(), archiveReason: "DUPLIKAT" })).toBe(false);
    expect(countsInReport({ contactEmail: "a@b.pl", archivedAt: new Date(), archiveReason: "SPAM" })).toBe(false);
    expect(countsInReport({ contactEmail: "a@b.pl", archivedAt: new Date(), archiveReason: "BEZ_KONTAKTU_2025" })).toBe(true);
    expect(countsInReport({ contactEmail: "a@b.pl", archivedAt: null, archiveReason: null })).toBe(true);
  });
});

describe("raport kampanii", () => {
  const leads = [
    lead("l1", ALMA, { type: "REZERWACJA_WWW", talked: true, maxStage: "WYGRANA", stage: "WYGRANA", revenue: 1500 }),
    lead("l2", ALMA, { type: "POBRANIE_CENNIKA", talked: true, maxStage: "OFERTA", stage: "OFERTA" }),
    lead("l3", ALMA, { type: "KONTAKT", stage: "PRZEGRANA", maxStage: "WYWIAD", talked: true, lostReason: "ODLEGLOSC" }),
    lead("l4", { ...ALMA, utm_content: "999", utm_term: "inne" }, { type: "POBRANIE_CENNIKA" }),
    lead("l5", ALMA, { returning: true, type: "KONTAKT", maxStage: "REZERWACJA", stage: "REZERWACJA", talked: true, revenue: 700 }),
    lead("l6", { utm_source: "meta", utm_campaign: "jesien", utm_content: "r1" }, { type: "REZERWACJA_WWW", maxStage: "REZERWACJA", stage: "REZERWACJA", revenue: 900, talked: true }),
    lead("l7", { form: "kontakt" }, { type: "KONTAKT" }),
    lead("l8", null, { type: "TELEFON" }),
  ];
  const costs = [cost({}), cost({ day: "2026-11-11", cost: 25.5 }), cost({ keyword: "bez efektu", keywordText: "bez efektu", adGroupId: "222", adGroupName: "Inna", cost: 30, clicks: 4 })];
  const rep = buildReport({ leads, costs, from: "2026-11-01", to: "2026-11-18", localDay });

  it("sumy kanału Google Ads: koszt, leady z podziałem, etapy, przychód, stałe klientki osobno", () => {
    const g = rep.channels.find((c) => c.label === CH.GOOGLE_ADS)!;
    expect(g.metrics.cost).toBe(105.5);
    expect(g.metrics.clicks).toBe(24);
    expect(g.metrics.leads).toMatchObject({ razem: 4, rezerwacja: 1, cennik: 2, kontakt: 1 });
    expect(g.metrics.returning).toBe(1);
    expect(g.metrics.talked).toBe(3);
    expect(g.metrics.offers).toBe(2); // „co najmniej oferta” — wygrany też dotarł do oferty
    expect(g.metrics.bookings).toBe(1);
    expect(g.metrics.wins).toBe(1);
    expect(g.metrics.revenue).toBe(1500); // przychód stałej klientki nie wchodzi
    expect(g.metrics.lostByReason).toEqual({ ODLEGLOSC: 1 });
    expect(g.metrics.costPerLead).toBe(26.38);
    expect(g.metrics.revenueToCost).toBe(14.22);
    expect(g.ids.leads.sort()).toEqual(["l1", "l2", "l3", "l4"]);
    expect(g.ids.returning).toEqual(["l5"]);
  });
  it("poziomy: kampania → grupa → słowo łączą koszty i leady po kluczach", () => {
    const alma = rep.channels.find((c) => c.label === CH.GOOGLE_ADS)!.children.find((c) => c.key === "alma")!;
    const g111 = alma.children.find((g) => g.key === "111")!;
    expect(g111.label).toBe("Alma ogólne");
    expect(g111.metrics.cost).toBe(75.5);
    expect(g111.metrics.leads.razem).toBe(3);
    const kw = g111.children.find((k) => k.key === "wynajem lasera alma")!;
    expect(kw.metrics.cost).toBe(75.5);
    expect(kw.ids.leads.sort()).toEqual(["l1", "l2", "l3"]);
    // grupa 999 ma lead, ale nie ma kosztu
    expect(alma.children.find((g) => g.key === "999")!.metrics).toMatchObject({ cost: 0, leads: { razem: 1 } });
  });
  it("Meta, bez źródła i telefon/e-mail są osobnymi kanałami; lista do uzupełnienia", () => {
    expect(rep.channels.find((c) => c.label === CH.META)!.metrics.bookings).toBe(1);
    expect(rep.channels.find((c) => c.label === CH.NONE)!.metrics.leads.razem).toBe(1);
    expect(rep.unsourced.map((u) => u.id).sort()).toEqual(["l7", "l8"]);
    expect(rep.total.metrics.leads.razem).toBe(7);
  });
  it("słowa z kosztem i bez leadów", () => {
    expect(rep.keywordsWithoutLeads).toEqual([{ campaign: "Alma", group: "Inna", keyword: "bez efektu", cost: 30, clicks: 4, impressions: 100 }]);
  });
  it("trend tygodniowy: poniedziałek tygodnia, koszty z dni importu", () => {
    expect(mondayOf("2026-11-10")).toBe("2026-11-09");
    const g = rep.trend.filter((t) => t.channel === CH.GOOGLE_ADS);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ week: "2026-11-09", leads: 4, talked: 3, bookings: 1, cost: 105.5 });
  });
  it("flatten: poziom kanał / kampania / słowo, filtr kanału", () => {
    expect(flatten(rep, "kanal").map((n) => n.label)).toContain(CH.GOOGLE_ADS);
    expect(flatten(rep, "kampania", "google").map((n) => n.label)).toEqual(["Alma"]);
    expect(flatten(rep, "slowo", "google_ads").map((n) => n.path.slowo).sort()).toEqual(["bez efektu", "inne", "wynajem lasera alma"]);
    // kanał bez głębszych poziomów zostaje własnym wierszem
    expect(flatten(rep, "slowo").some((n) => n.label === CH.NONE)).toBe(true);
  });
  it("CSV: średnik, przecinek dziesiętny, BOM", () => {
    const csv = reportCsv(flatten(rep, "kampania", "google"));
    expect(csv.startsWith("﻿Kanał;Kampania;")).toBe(true);
    expect(csv).toContain("Google Ads;Alma;;;");
    expect(csv).toContain("105,5");
    expect(csv).toContain("ODLEGLOSC: 1");
  });
  it("lista id za każdą liczbą zgadza się z liczbą", () => {
    for (const ch of rep.channels) {
      expect(ch.ids.leads?.length ?? 0).toBe(ch.metrics.leads.razem);
      expect(ch.ids.talked?.length ?? 0).toBe(ch.metrics.talked);
    }
  });
});
