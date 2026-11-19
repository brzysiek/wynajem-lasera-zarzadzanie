import { describe, expect, it } from "vitest";
import { buildReport, countsInReport, delta, flatten, isReturningLead, isUnqualified, keywordTable, metricsOfLead, mondayOf, reportCsv, type ReportLead } from "./report";
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
    expect(rep.unsourced.map((u) => u.id)).toEqual(["l7"]); // telefon / e-mail to osobny kanał, nie „bez źródła”
    expect(rep.channels.find((c) => c.label === CH.PHONE_EMAIL)!.metrics.leads.razem).toBe(1);
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

describe("poprawki raportu (19.11)", () => {
  const ALMA2 = { utm_source: "google", utm_campaign: "alma", utm_content: "111", utm_term: "wynajem lasera alma" };
  it("każda oferta, rezerwacja i wygrana liczy się też jako rozmowa (oferty ≤ rozmowy)", () => {
    expect(metricsOfLead(lead("a", ALMA2, { maxStage: "OFERTA", stage: "OFERTA", talked: false }))).toEqual(expect.arrayContaining(["talked", "offers"]));
    expect(metricsOfLead(lead("b", ALMA2, { maxStage: "REZERWACJA", stage: "REZERWACJA", talked: false }))).toEqual(expect.arrayContaining(["talked", "offers", "bookings"]));
    expect(metricsOfLead(lead("c", ALMA2, { maxStage: "WYGRANA", stage: "WYGRANA", talked: false }))).toEqual(expect.arrayContaining(["talked", "offers", "bookings", "wins"]));
    expect(metricsOfLead(lead("d", ALMA2, { maxStage: "WYWIAD", stage: "WYWIAD", talked: false }))).not.toContain("talked");
    const rep = buildReport({ leads: [lead("a", ALMA2, { maxStage: "OFERTA", stage: "OFERTA" }), lead("b", ALMA2, { maxStage: "REZERWACJA", stage: "REZERWACJA" })], costs: [], from: "2026-11-01", to: "2026-11-18", localDay });
    expect(rep.total.metrics.offers).toBeLessThanOrEqual(rep.total.metrics.talked);
    expect(rep.total.metrics.talked).toBe(2);
  });
  it("stałe klientki: tylko w swojej kolumnie, razem z rezerwacjami, wygranymi i przychodem; nie trafiają na listę „bez źródła”", () => {
    const stala = lead("s1", null, { type: "EMAIL", returning: true, stage: "WYGRANA", maxStage: "WYGRANA", talked: true, revenue: 750 });
    const stala2 = lead("s2", null, { type: "EMAIL", returning: true, stage: "REZERWACJA", maxStage: "REZERWACJA", revenue: 1270 });
    const nowa = lead("n1", { form: "kontakt" }, { type: "KONTAKT" });
    const rep = buildReport({ leads: [stala, stala2, nowa], costs: [], from: "2026-11-01", to: "2026-11-18", localDay });
    const t = rep.total.metrics;
    expect(t).toMatchObject({ returning: 2, returningWins: 1, returningBookings: 2, returningRevenue: 2020, wins: 0, bookings: 0, revenue: 0 });
    expect(t.leads.razem).toBe(1);
    expect(rep.unsourced.map((u) => u.id)).toEqual(["n1"]);
    expect(rep.total.ids.returning_wins).toEqual(["s1"]);
  });
  it("stała klientka także po wcześniejszej rezerwacji lub wynajmie, mimo braku flagi", () => {
    const lead = { createdAt: new Date("2026-11-16T10:00:00Z"), rentalId: "R-own" };
    const none = { rentals: [], history: [] };
    expect(isReturningLead(false, { rentals: [], history: [new Date("2025-03-01T00:00:00Z")] }, lead)).toBe(true); // historia wynajmów
    expect(isReturningLead(false, { rentals: [{ id: "R-old", startsAt: new Date("2026-06-01T00:00:00Z"), createdAt: new Date("2026-05-01T00:00:00Z") }], history: [] }, lead)).toBe(true);
    // rezerwacja założona przed zapytaniem, termin w przyszłości — też „miała rezerwację”
    expect(isReturningLead(false, { rentals: [{ id: "R-fut", startsAt: new Date("2026-12-01T00:00:00Z"), createdAt: new Date("2026-11-10T00:00:00Z") }], history: [] }, lead)).toBe(true);
    // własna rezerwacja zapytania (powstała po nim) nie robi z nowej klientki stałej
    expect(isReturningLead(false, { rentals: [{ id: "R-own", startsAt: new Date("2026-11-01T00:00:00Z"), createdAt: new Date("2026-11-01T00:00:00Z") }], history: [] }, lead)).toBe(false);
    expect(isReturningLead(false, { rentals: [{ id: "R-after", startsAt: new Date("2027-01-11T00:00:00Z"), createdAt: new Date("2026-11-17T00:00:00Z") }], history: [] }, lead)).toBe(false);
    expect(isReturningLead(false, none, lead)).toBe(false);
    expect(isReturningLead(true, none, lead)).toBe(true);
  });
  it("przegrana „Poza branżą” = nie klient: poza leadami, kosztem na lead i listą do uzupełnienia; „Inne” zostaje leadem", () => {
    expect(isUnqualified({ stage: "PRZEGRANA", lostReason: "POZA_BRANZA" })).toBe(true);
    expect(isUnqualified({ stage: "PRZEGRANA", lostReason: "INNE" })).toBe(false);
    expect(isUnqualified({ stage: "SYGNAL", lostReason: "POZA_BRANZA" })).toBe(false);
    const vendor = lead("v1", null, { type: "EMAIL", stage: "PRZEGRANA", lostReason: "POZA_BRANZA", maxStage: "SYGNAL" });
    const real = lead("v2", ALMA2, { type: "POBRANIE_CENNIKA", stage: "PRZEGRANA", lostReason: "INNE", maxStage: "WYWIAD", talked: true });
    const rep = buildReport({ leads: [vendor, real], costs: [cost({})], from: "2026-11-01", to: "2026-11-18", localDay });
    expect(rep.total.metrics).toMatchObject({ unqualified: 1 });
    expect(rep.total.metrics.leads.razem).toBe(1);
    expect(rep.total.metrics.lostByReason).toEqual({ INNE: 1 });
    expect(rep.unsourced).toEqual([]);
    expect(rep.total.metrics.costPerLead).toBe(50);
  });
});

describe("tabela słów kluczowych i porównanie okresów", () => {
  const A = { utm_source: "google", utm_campaign: "alma", utm_content: "111", utm_term: "wynajem lasera alma" };
  it("scala frazę ponad grupami reklam; zapytania bez frazy liczone osobno", () => {
    const leads = [
      lead("k1", A, { maxStage: "REZERWACJA", stage: "REZERWACJA", talked: true }),
      lead("k2", { ...A, utm_content: "222" }, { maxStage: "OFERTA", stage: "OFERTA" }),
      lead("k3", { utm_source: "google", utm_campaign: "alma" }),
    ];
    const costs = [cost({ cost: 40, clicks: 4 }), cost({ adGroupId: "222", adGroupName: "Druga", cost: 10, clicks: 1 }), cost({ keyword: "bez efektu", keywordText: "bez efektu", cost: 5, clicks: 1 })];
    const t = keywordTable(buildReport({ leads, costs, from: "2026-11-01", to: "2026-11-18", localDay }));
    const alma = t.rows.find((r) => r.keyword === "wynajem lasera alma")!;
    expect(alma).toMatchObject({ campaign: "Alma", cost: 50, clicks: 5, leads: 2, bookings: 1 });
    expect(alma.leadIds.sort()).toEqual(["k1", "k2"]);
    expect(t.rows.find((r) => r.keyword === "bez efektu")).toMatchObject({ cost: 5, leads: 0 });
    expect(t.withoutKeyword).toEqual({ leads: 1, ids: ["k3"] });
    expect(t.rows[0].keyword).toBe("wynajem lasera alma"); // malejąco wg kosztu
  });
  it("delta: różnica i procent (brak podstawy = null)", () => {
    expect(delta(19, 10)).toEqual({ diff: 9, pct: 90 });
    expect(delta(3, 0)).toEqual({ diff: 3, pct: null });
    expect(delta(0, 4)).toEqual({ diff: -4, pct: -100 });
  });
});
