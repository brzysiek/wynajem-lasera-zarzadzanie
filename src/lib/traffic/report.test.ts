import { describe, expect, it } from "vitest";
import { classifyChannel, TCH } from "./ingest";
import { buildTrafficReport, compareAdsWithLeads, trafficJoin, type TrafficRow } from "./report";

const at = new Date("2026-11-18T10:00:00Z");
function entry(pv: string, path: string, dev: string, d: Parameters<typeof classifyChannel>[0] & { zgoda?: string }): TrafficRow {
  const info = classifyChannel(d);
  return { at, pv, path, dev, type: "wejscie", channel: info.channel, data: { ...d, zgoda: d.zgoda ?? "brak", channel: info.channel, campaignKey: info.campaignKey, campaign: info.campaign, term: info.term, group: info.group } };
}
function ev(pv: string, path: string, dev: string, channel: string, type: string, data: Record<string, unknown> = {}): TrafficRow {
  return { at, pv, path, dev, type, channel, data };
}

const ads = { g: true, src: "google.com", utm: { utm_campaign: "alma", utm_term: "wynajem lasera alma", utm_content: "111" } };
const GA = TCH.GOOGLE_ADS;

const rows: TrafficRow[] = [
  // wizyta 1: reklama Alma, telefon, wchodzi na /alma/, startuje formularz, wysyła
  entry("pv1", "/alma/", "telefon", { ...ads, zgoda: "s1m1" }),
  ev("pv1", "/alma/", "telefon", GA, "baner_pokazany"),
  ev("pv1", "/alma/", "telefon", GA, "baner_wybor", { wybor: "wszystkie", zgoda: "s1m1" }),
  ev("pv1", "/alma/", "telefon", GA, "klik", { rodzaj: "telefon", etyk: "Zadzwoń", x: 40, y: 220 }),
  ev("pv1", "/alma/", "telefon", GA, "form_start", { form: "5894" }),
  ev("pv1", "/alma/", "telefon", GA, "form_proba", { form: "5894" }),
  ev("pv1", "/alma/", "telefon", GA, "form_wyslany", { form: "5894" }),
  ev("pv1", "/alma/", "telefon", GA, "koniec", { przew: 100, czas: "30s-2min", wyjscie: false }),
  // wizyta 2: reklama Alma, komputer, porzuca formularz
  entry("pv2", "/alma/", "komputer", { ...ads, zgoda: "s0m0" }),
  ev("pv2", "/alma/", "komputer", GA, "baner_wybor", { wybor: "odrzucam", zgoda: "s0m0" }),
  ev("pv2", "/alma/", "komputer", GA, "form_start", { form: "5894" }),
  ev("pv2", "/alma/", "komputer", GA, "form_blad", { form: "5894", pola: ["telefon"] }),
  ev("pv2", "/alma/", "komputer", GA, "form_porzucony", { form: "5894", pole: "telefon", bledy: 2 }),
  ev("pv2", "/alma/", "komputer", GA, "koniec", { przew: 0, czas: "<10s", wyjscie: true }),
  // wizyta 3: Google organiczne → strona główna, potem przejście na /cennik/ (nowa odsłona, prev)
  entry("pv3", "/", "telefon", { src: "google.pl" }),
  ev("pv3", "/", "telefon", TCH.GOOGLE_ORG, "koniec", { przew: 25, czas: "10-30s", wyjscie: false }),
  entry("pv4", "/cennik/", "telefon", { src: "wynajemlasera.pl", prev: "/" }),
  ev("pv4", "/cennik/", "telefon", TCH.INTERNAL, "koniec", { przew: 50, czas: "10-30s", wyjscie: true }),
  // wizyta 5: bezpośrednio
  entry("pv5", "/", "komputer", { src: "" }),
];

describe("raport ruchu", () => {
  const r = buildTrafficReport(rows, { from: "2026-11-01", to: "2026-11-18" });
  it("kafelki: wejścia (początki wizyt), z reklam, odsłony, baner, formularz", () => {
    expect(r.hasData).toBe(true);
    expect(r.tiles).toMatchObject({ visits: 4, fromAds: 2, pageViews: 5, bannerChoices: 2, bannerAcceptPct: 50, formStarted: 2, formSent: 1 });
  });
  it("kanały z podziałem na urządzenia; wewnętrzne nie liczą się jako wejścia", () => {
    const g = r.channels.find((c) => c.channel === GA)!;
    expect(g).toMatchObject({ visits: 2, formStarts: 2, byDev: { telefon: 1, komputer: 1, tablet: 0, nieznane: 0 } });
    expect(r.channels.find((c) => c.channel === TCH.INTERNAL)).toBeUndefined();
    expect(r.channels.map((c) => c.channel).sort()).toEqual([TCH.DIRECT, TCH.GOOGLE_ADS, TCH.GOOGLE_ORG].sort());
  });
  it("kampanie reklamowe: wejścia i starty formularza", () => {
    expect(r.campaigns).toEqual([{ channel: GA, key: "alma", label: "Alma", visits: 2, formStarts: 2 }]);
  });
  it("zgody: wybór w banerze i stan zgody przy wejściach", () => {
    expect(r.consents.banner).toMatchObject({ wszystkie: 1, odrzucam: 1, wlasny: 0, shown: 1 });
    expect(r.consents.entries).toEqual({ s1m1: 1, s1m0: 0, s0m0: 1, brak: 2 });
  });
  it("strony: wejścia, strony wejścia, wyjścia, przewinięcie, czas, wyszli od razu", () => {
    const alma = r.pages.find((p) => p.path === "/alma/")!;
    expect(alma).toMatchObject({ views: 2, landings: 2, exits: 1, avgScroll: 50, bouncedPct: 50 });
    expect(alma.time).toEqual({ "30s-2min": 1, "<10s": 1 });
    expect(r.pages.find((p) => p.path === "/cennik/")).toMatchObject({ views: 1, landings: 0, exits: 1 });
  });
  it("przejścia prev → path", () => {
    expect(r.transitions).toEqual([{ from: "/", to: "/cennik/", count: 1 }]);
  });
  it("lejek formularza: wyświetlenia → start → próba → wysłany; porzucenia i błędy", () => {
    expect(r.forms).toHaveLength(1);
    expect(r.forms[0]).toMatchObject({ form: "5894", views: 2, started: 2, tried: 1, sent: 1 });
    expect(r.forms[0].abandoned).toEqual([{ field: "telefon", count: 1, errorsAvg: 2 }]);
    expect(r.forms[0].errors).toEqual([{ field: "telefon", count: 1 }]);
  });
  it("kliknięcia: najczęstsze elementy, telefony wg strony, punkty mapy", () => {
    expect(r.clicks.top[0]).toMatchObject({ rodzaj: "telefon", etyk: "Zadzwoń", path: "/alma/", dev: "telefon", count: 1 });
    expect(r.clicks.phoneByPath).toEqual([{ path: "/alma/", count: 1 }]);
    expect(r.clicks.points).toEqual([{ path: "/alma/", dev: "telefon", x: 40, y: 220 }]);
  });
  it("filtr strony zawęża wszystkie sekcje", () => {
    const f = buildTrafficReport(rows, { from: "2026-11-01", to: "2026-11-18" }, { path: "/cennik/" });
    expect(f.tiles.visits).toBe(0);
    expect(f.pages.map((p) => p.path)).toEqual(["/cennik/"]);
  });
  it("brak danych: hasData = false", () => {
    expect(buildTrafficReport([], { from: "2026-11-01", to: "2026-11-18" }).hasData).toBe(false);
  });
});

describe("łączenie z kampaniami i leadami", () => {
  it("wejścia i starty formularza wg kanału, kampanii i frazy (tylko Google Ads dla kampanii i frazy)", () => {
    const j = trafficJoin(rows);
    expect(j.byChannel.get(GA)).toEqual({ visits: 2, formStarts: 2 });
    expect(j.byCampaign.get("alma")).toEqual({ visits: 2, formStarts: 2 });
    expect(j.byKeyword.get("alma\u0001wynajem lasera alma")).toEqual({ visits: 2, formStarts: 2 });
    expect(j.byChannel.get(TCH.GOOGLE_ORG)).toEqual({ visits: 1, formStarts: 0 });
  });
  it("porównanie wejść z Google Ads wg kampanii z leadami tej kampanii", () => {
    const j = trafficJoin(rows);
    const c = compareAdsWithLeads(j.byCampaign, [{ key: "alma", label: "Alma", leads: 1 }, { key: "lightsheer", label: "LightSheer", leads: 3 }]);
    expect(c[0]).toMatchObject({ key: "alma", visits: 2, leads: 1, leadsPer100Visits: 50 });
    expect(c.find((x) => x.key === "lightsheer")).toMatchObject({ visits: 0, leads: 3, leadsPer100Visits: null });
    const withClicks = compareAdsWithLeads(j.byCampaign, [{ key: "alma", label: "Alma", leads: 1 }], new Map([["alma", 8], ["marka", 5]]));
    expect(withClicks.find((x) => x.key === "alma")).toMatchObject({ visits: 2, clicks: 8, visitsPer100Clicks: 25 });
    expect(withClicks.find((x) => x.key === "marka")).toMatchObject({ visits: 0, clicks: 5, visitsPer100Clicks: 0 });
  });
});
