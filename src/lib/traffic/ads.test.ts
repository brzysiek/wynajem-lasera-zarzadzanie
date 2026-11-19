import { describe, expect, it } from "vitest";
import { TCH } from "./ingest";
import { MIN_VISITS, adsMetricsByKey, adsTree, campKey, chKey, grpKey, kwKey, kwcKey, reclassify } from "./ads";
import type { TrafficRow } from "./report";

const at = new Date("2026-11-19T10:00:00Z");
const entry = (pv: string, path: string, dev: string, data: Record<string, unknown>): TrafficRow => ({ at, pv, path, dev, type: "wejscie", channel: "?", data: { prev: "", ...data } });
const ev = (pv: string, type: string, data: Record<string, unknown> = {}, path = "/alma/", dev = "telefon"): TrafficRow => ({ at, pv, path, dev, type, channel: "?", data });

const G = { src: "google.com", g: true, utm: { utm_source: "google", utm_medium: "cpc", utm_campaign: "alma", utm_term: "[wynajem lasera alma]", utm_content: "111" } };
const META = { src: "instagram.com", m: true, utm: { utm_source: "meta", utm_medium: "paid_social", utm_campaign: "WL | LEADS | WYNAJEM | 10.2026", utm_term: "Rolki - Cold – send_form - LightSheer", utm_content: "LightSheer B" } };

const rows: TrafficRow[] = reclassify([
  // Google, fraza „wynajem lasera alma”: pv1 wyszedł od razu, pv2 przewinął 100 / 2 min + telefon + formularz wysłany, pv3 bez podsumowania, pv4 porzucił formularz
  entry("g1", "/alma/", "telefon", G),
  ev("g1", "koniec", { przew: 0, czas: "<10s", wyjscie: true }),
  entry("g2", "/alma/", "telefon", G),
  ev("g2", "klik", { rodzaj: "telefon", etyk: "Zadzwoń", x: 10, y: 20 }),
  ev("g2", "form_start", { form: "5894" }),
  ev("g2", "form_wyslany", { form: "5894" }),
  ev("g2", "koniec", { przew: 100, czas: ">2min", wyjscie: false }),
  entry("g3", "/alma/", "komputer", G),
  entry("g4", "/alma/", "telefon", G),
  ev("g4", "form_start", { form: "5894" }),
  ev("g4", "form_porzucony", { form: "5894", pole: "telefon", bledy: 1 }),
  ev("g4", "koniec", { przew: 50, czas: "30s-2min", wyjscie: true }),
  // Meta: prawdziwe znaczniki, 1 wizyta; stary format zapisu (group = utm_content) nie szkodzi — klasyfikacja z surowych pól
  { ...entry("m1", "/lightsheer/", "telefon", META), data: { ...META, prev: "", campaignKey: "stare", group: "LightSheer B", term: "stare" } },
  ev("m1", "koniec", { przew: 0, czas: "10-30s", wyjscie: true }, "/lightsheer/"),
  // Google organiczne i wizyta wewnętrzna — nie reklamy
  entry("o1", "/", "komputer", { src: "google.pl" }),
  { ...entry("i1", "/cennik/", "komputer", { src: "", prev: "/" }) },
]);

describe("jakość ruchu z reklam (licznik)", () => {
  const m = adsMetricsByKey(rows);
  const phrase = m.get(kwKey(TCH.GOOGLE_ADS, "alma", "111", "wynajem lasera alma"))!;
  it("metryki frazy: wejścia, % wyszli od razu, przewinięcie ≥ 50, czas ≥ 30 s, telefon, formularz", () => {
    expect(phrase.wejscia).toBe(4);
    expect(phrase.bez_podsumowania).toBe(1);
    expect(phrase.z_podsumowaniem).toBe(3);
    // mianownik = 3 (bez pv „bez podsumowania”)
    expect(phrase.wyszli_od_razu_proc).toBe(33); // g1
    expect(phrase.przewiniecie_50_proc).toBe(67); // g2 (100), g4 (50)
    expect(phrase.czas_30s_proc).toBe(67); // g2 (>2min), g4 (30s-2min)
    expect(phrase.klik_telefon).toBe(1);
    expect(phrase.form_start).toBe(2);
    expect(phrase.form_wyslany).toBe(1);
    expect(phrase.form_porzucony).toBe(1);
    expect(phrase.pole_porzucenia).toBe("telefon");
  });
  it("próg wiarygodności: poniżej 20 wejść = mało danych", () => {
    expect(MIN_VISITS).toBe(20);
    expect(phrase.malo_danych).toBe(true);
    const many = reclassify(Array.from({ length: 25 }, (_, i) => entry(`x${i}`, "/alma/", "telefon", G)));
    expect(adsMetricsByKey(many).get(kwKey(TCH.GOOGLE_ADS, "alma", "111", "wynajem lasera alma"))!.malo_danych).toBe(false);
  });
  it("poziomy: kanał, kampania, grupa, fraza i fraza ponad grupami; bez podsumowania nie wchodzi do procentów", () => {
    expect(m.get(chKey(TCH.GOOGLE_ADS))!.wejscia).toBe(4);
    expect(m.get(campKey(TCH.GOOGLE_ADS, "alma"))!.wejscia).toBe(4);
    expect(m.get(grpKey(TCH.GOOGLE_ADS, "alma", "111"))!.wejscia).toBe(4);
    expect(m.get(kwcKey("alma", "wynajem lasera alma"))!.wejscia).toBe(4);
    const none = m.get(kwKey(TCH.GOOGLE_ADS, "alma", "999", "x"));
    expect(none).toBeUndefined();
  });
  it("Meta: kampania → zestaw (utm_term) → reklama (utm_content) po nazwach bez wielkości liter; zapis w starym formacie przeliczony na nowo", () => {
    const k = kwKey(TCH.META, "wl | leads | wynajem | 10.2026", "rolki - cold – send_form - lightsheer", "lightsheer b");
    expect(m.get(k)).toMatchObject({ wejscia: 1, bez_podsumowania: 0, wyszli_od_razu_proc: 0, przewiniecie_50_proc: 0, malo_danych: true });
  });
  it("organiczne i wewnętrzne nie są w drzewie reklam; kanał ma metryki", () => {
    expect(m.get(chKey(TCH.GOOGLE_ORG))!.wejscia).toBe(1);
    expect(m.get(chKey(TCH.INTERNAL))).toBeUndefined(); // wejścia wewnętrzne to nie wizyty
  });
  it("drzewo: Google kampania → grupa (nazwa z importu kosztów) → fraza; Meta kampania → zestaw → reklama; filtr kampanii", () => {
    const t = adsTree(rows, { groupNames: new Map([["111", { name: "Alma ogólne", campaignKey: "alma" }]]) });
    expect(t.google_ads).toHaveLength(1);
    expect(t.google_ads[0]).toMatchObject({ kampania: "Alma", klucz: "alma" });
    expect(t.google_ads[0].grupy[0]).toMatchObject({ grupa_id: "111", grupa: "Alma ogólne" });
    expect(t.google_ads[0].grupy[0].frazy[0]).toMatchObject({ fraza: "wynajem lasera alma", metryki: { wejscia: 4 } });
    expect(t.meta[0]).toMatchObject({ kampania: "WL | LEADS | WYNAJEM | 10.2026" });
    expect(t.meta[0].zestawy[0]).toMatchObject({ zestaw: "Rolki - Cold – send_form - LightSheer" });
    expect(t.meta[0].zestawy[0].reklamy[0]).toMatchObject({ reklama: "LightSheer B", metryki: { wejscia: 1 } });
    expect(adsTree(rows, { campaign: "alma" }).meta).toHaveLength(0);
    expect(adsTree(rows, { campaign: "wl | leads" }).google_ads).toHaveLength(0);
  });
});

describe("nodeTrafficKey", () => {
  it("klucze węzła raportu kampanii = klucze metryk licznika; „(bez …)” to pusty klucz", async () => {
    const { nodeTrafficKey, chKey, campKey, grpKey, kwKey } = await import("./ads");
    expect(nodeTrafficKey(["Google Ads"])).toBe(chKey("Google Ads"));
    expect(nodeTrafficKey(["Google Ads", "alma"])).toBe(campKey("Google Ads", "alma"));
    expect(nodeTrafficKey(["Google Ads", "alma", "(bez grupy)"])).toBe(grpKey("Google Ads", "alma", ""));
    expect(nodeTrafficKey(["Google Ads", "alma", "204", "(bez słowa)"])).toBe(kwKey("Google Ads", "alma", "204", ""));
    expect(nodeTrafficKey([])).toBeNull();
  });
});
