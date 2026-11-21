import { describe, expect, it } from "vitest";
import { MIN_VISITS, TCH, parseBands, parseBeacon } from "./ingest";
import { adsMetricsByKey, chKey, reclassify } from "./ads";
import { buildTrafficReport, timeStats, type TrafficRow } from "./report";

// Wniosek 60: czas aktywny (sek) i mapa uwagi (pasy) ze skryptu licznika v2.

const body = (koniec: Record<string, unknown>) => JSON.stringify({ pv: "abc123def", path: "/alma/", dev: "telefon", ev: [{ e: "koniec", t: 31, przew: 50, czas: "10-30s", wyjscie: true, ...koniec }] });
const koniec = (koniecData: Record<string, unknown>) => {
  const r = parseBeacon(body(koniecData));
  if (!r.ok) throw new Error(r.reason);
  return r.beacon.events[0].data;
};
const BANDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe("przyjmowanie sek i pasy", () => {
  it("zapisuje poprawne sek i pasy obok starego pola czas", () => {
    expect(koniec({ sek: 42, pasy: BANDS })).toMatchObject({ czas: "10-30s", przew: 50, sek: 42, pasy: BANDS });
  });
  it("brak pól (stary skrypt) → zdarzenie bez sek i pasy", () => {
    const d = koniec({});
    expect("sek" in d).toBe(false);
    expect("pasy" in d).toBe(false);
  });
  it("sek: granice 0 i 1800 ok; poza zakresem, ułamek, tekst i ujemne odrzucone (pole pominięte)", () => {
    expect(koniec({ sek: 0 }).sek).toBe(0);
    expect(koniec({ sek: 1800 }).sek).toBe(1800);
    for (const bad of [1801, -1, 12.5, "30", null, Number.NaN]) expect("sek" in koniec({ sek: bad })).toBe(false);
  });
  it("pasy: dokładnie 10 liczb całkowitych 0–1800, inaczej pominięte", () => {
    expect(parseBands(BANDS)).toEqual(BANDS);
    expect(parseBands(Array(10).fill(1800))).toHaveLength(10);
    expect(parseBands(BANDS.slice(0, 9))).toBeNull();
    expect(parseBands([...BANDS, 1])).toBeNull();
    expect(parseBands([...BANDS.slice(0, 9), 1801])).toBeNull();
    expect(parseBands([...BANDS.slice(0, 9), -1])).toBeNull();
    expect(parseBands([...BANDS.slice(0, 9), 1.5])).toBeNull();
    expect(parseBands([...BANDS.slice(0, 9), "3"])).toBeNull();
    expect(parseBands("1,2,3")).toBeNull();
    expect("pasy" in koniec({ pasy: [1, 2, 3] })).toBe(false);
  });
  it("zła wartość jednego pola nie psuje drugiego ani reszty zdarzenia", () => {
    expect(koniec({ sek: 99999, pasy: BANDS })).toMatchObject({ przew: 50, pasy: BANDS });
    expect(koniec({ sek: 20, pasy: [1] })).toMatchObject({ przew: 50, sek: 20 });
  });
});

const at = new Date("2026-11-22T10:00:00Z");
const entry = (pv: string, path: string, dev: string): TrafficRow => ({ at, pv, path, dev, type: "wejscie", channel: TCH.DIRECT, data: { prev: "", src: "" } });
const end = (pv: string, path: string, dev: string, data: Record<string, unknown>): TrafficRow => ({ at, pv, path, dev, type: "koniec", channel: TCH.DIRECT, data: { przew: 50, czas: "10-30s", wyjscie: true, ...data } });

describe("raport: czas i mapa uwagi wg strony", () => {
  const rows: TrafficRow[] = [
    entry("p1", "/alma/", "telefon"), end("p1", "/alma/", "telefon", { sek: 10, pasy: [10, 0, 0, 0, 0, 0, 0, 0, 0, 0] }),
    entry("p2", "/alma/", "telefon"), end("p2", "/alma/", "telefon", { sek: 20, pasy: [10, 10, 0, 0, 0, 0, 0, 0, 0, 0] }),
    entry("p3", "/alma/", "tablet"), end("p3", "/alma/", "tablet", { sek: 60, pasy: [10, 10, 10, 10, 0, 0, 0, 0, 0, 0] }),
    entry("p4", "/alma/", "komputer"), end("p4", "/alma/", "komputer", { sek: 30, pasy: [5, 5, 5, 5, 5, 5, 0, 0, 0, 0] }),
    // wiele „koniec” w jednej odsłonie: liczy się ostatnie z pomiarem (sumy rosną), nie suma
    entry("p5", "/alma/", "komputer"), end("p5", "/alma/", "komputer", { sek: 5, pasy: [5, 0, 0, 0, 0, 0, 0, 0, 0, 0] }), end("p5", "/alma/", "komputer", { sek: 15, pasy: [5, 10, 0, 0, 0, 0, 0, 0, 0, 0] }),
    // stare zdarzenie (przed v2) — bez sek i pasy: nie wchodzi do średnich
    entry("p6", "/alma/", "telefon"), end("p6", "/alma/", "telefon", {}),
    // strona wyłącznie ze starymi zdarzeniami
    entry("p7", "/cennik/", "telefon"), end("p7", "/cennik/", "telefon", {}),
  ];
  const r = buildTrafficReport(rows, { from: "2026-11-22", to: "2026-11-22" });
  const alma = r.pages.find((p) => p.path === "/alma/")!;

  it("średni i mediana czasu z odsłon z pomiarem (bez starych zdarzeń i bez dublowania)", () => {
    expect(alma.timeS).toEqual({ n: 5, avg: 27, median: 20 }); // 10, 20, 60, 30, 15
    expect(alma.bouncedPct).not.toBeNull(); // dotychczasowe metryki bez zmian
  });
  it("mapa uwagi: telefon (z tabletem) i komputer osobno, średnie sekundy i odsetek zobaczyło", () => {
    expect(alma.attention.telefon.n).toBe(3);
    expect(alma.attention.telefon.avgSeconds).toEqual([10, 6.7, 3.3, 3.3, 0, 0, 0, 0, 0, 0]);
    expect(alma.attention.telefon.seenPct).toEqual([100, 67, 33, 33, 0, 0, 0, 0, 0, 0]);
    expect(alma.attention.komputer.n).toBe(2);
    expect(alma.attention.komputer.avgSeconds).toEqual([5, 7.5, 2.5, 2.5, 2.5, 2.5, 0, 0, 0, 0]);
    expect(alma.attention.komputer.seenPct).toEqual([100, 100, 50, 50, 50, 50, 0, 0, 0, 0]);
  });
  it("poniżej 20 odsłon z pomiarem = mało danych", () => {
    expect(alma.attention.telefon.fewData).toBe(true);
    const many = Array.from({ length: MIN_VISITS }, (_, i) => [entry(`m${i}`, "/x/", "komputer"), end(`m${i}`, "/x/", "komputer", { sek: 5, pasy: BANDS })]).flat();
    expect(buildTrafficReport(many, { from: "2026-11-22", to: "2026-11-22" }).pages[0].attention.komputer.fewData).toBe(false);
  });
  it("brak pomiarów = n 0 i null (nie zera)", () => {
    const cennik = r.pages.find((p) => p.path === "/cennik/")!;
    expect(cennik.timeS).toEqual({ n: 0, avg: null, median: null });
    expect(cennik.attention.telefon.n).toBe(0);
    expect(timeStats([])).toEqual({ n: 0, avg: null, median: null });
  });
  it("filtr strony zawęża też czas i uwagę", () => {
    const only = buildTrafficReport(rows, { from: "2026-11-22", to: "2026-11-22" }, { path: "/cennik/" });
    expect(only.pages).toHaveLength(1);
    expect(only.pages[0].timeS.n).toBe(0);
  });
});

describe("reklamy: średni czas wejść", () => {
  const G = { src: "google.com", g: true, utm: { utm_source: "google", utm_medium: "cpc", utm_campaign: "alma", utm_term: "[laser]", utm_content: "111" } };
  const e = (pv: string): TrafficRow => ({ at, pv, path: "/alma/", dev: "telefon", type: "wejscie", channel: "?", data: { prev: "", ...G } });
  const k = (pv: string, data: Record<string, unknown>): TrafficRow => ({ at, pv, path: "/alma/", dev: "telefon", type: "koniec", channel: "?", data: { przew: 25, czas: "10-30s", wyjscie: true, ...data } });
  it("średnia tylko z wejść z pomiarem; bez pomiarów null", () => {
    const m = adsMetricsByKey(reclassify([e("a"), k("a", { sek: 10 }), e("b"), k("b", { sek: 21 }), e("c"), k("c", {}), e("d")])).get(chKey(TCH.GOOGLE_ADS))!;
    expect(m.sredni_czas_s).toBe(15.5);
    expect(m.z_pomiarem_czasu).toBe(2);
    const old = adsMetricsByKey(reclassify([e("a"), k("a", {})])).get(chKey(TCH.GOOGLE_ADS))!;
    expect(old.sredni_czas_s).toBeNull();
    expect(old.z_pomiarem_czasu).toBe(0);
  });
});
