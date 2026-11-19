import { describe, expect, it } from "vitest";
import { previewCosts } from "./costs-csv";
import { META_NEEDS_DAY, parseMetaCostsCsv } from "./meta-costs-csv";

const PL = [
  "Dzień,Nazwa kampanii,Nazwa zestawu reklam,Nazwa reklamy,Wyświetlenia,Kliknięcia linku,Wydana kwota (PLN)",
  '2026-11-17,WL | LEADS | WYNAJEM | 10.2026,Rolki - Cold – send_form - LightSheer,LightSheer B,"1 200",18,"42,50"',
  '2026-11-17,WL | LEADS | WYNAJEM | 10.2026,Rolki - Cold – send_form - LightSheer,LightSheer A,800,9,"20,10"',
  '2026-11-18,WL | LEADS | WYNAJEM | 10.2026,Rolki - Cold – send_form - LightSheer,LightSheer B,900,11,"30,00"',
].join("\n");

describe("import kosztów Mety", () => {
  it("nagłówki PL (poziom reklamy, podział na dni): kampania, zestaw, reklama, kliknięcia linku, kwota", () => {
    const p = parseMetaCostsCsv(PL);
    expect(p.headerFound).toBe(true);
    expect(p.warnings).toEqual([]);
    expect(p.rows).toHaveLength(3);
    expect(p.rows[0]).toMatchObject({ channel: "META", day: "2026-11-17", campaignKey: "wl | leads | wynajem | 10.2026", campaignName: "WL | LEADS | WYNAJEM | 10.2026", adGroupName: "Rolki - Cold – send_form - LightSheer", keyword: "lightsheer b", keywordText: "LightSheer B", impressions: 1200, clicks: 18, cost: 42.5 });
    const pv = previewCosts(p);
    expect(pv).toMatchObject({ rows: 3, days: 2, dayFrom: "2026-11-17", dayTo: "2026-11-18", totalCost: 92.6, clicks: 38 });
    expect(pv.campaigns).toHaveLength(1);
  });
  it("nagłówki EN, średnik, linie tytułu, „Reporting starts” i kwota w nagłówku", () => {
    const csv = ["Ads report", "Nov 1, 2026 - Nov 18, 2026", "Day;Campaign name;Ad set name;Ad name;Impressions;Link clicks;Amount spent (PLN)", "2026-11-17;Camp A;Set 1;Ad 1;100;5;12,5"].join("\n");
    const p = parseMetaCostsCsv(csv);
    expect(p.rows[0]).toMatchObject({ campaignName: "Camp A", adGroupName: "Set 1", keywordText: "Ad 1", clicks: 5, cost: 12.5 });
    expect(p.warnings).toEqual([]);
  });
  it("brak „Kliknięcia linku” → użyte „Kliknięcia (wszystkie)” z ostrzeżeniem", () => {
    const csv = ["Dzień,Nazwa kampanii,Nazwa zestawu reklam,Nazwa reklamy,Wyświetlenia,Kliknięcia (wszystkie),Wydana kwota (PLN)", "2026-11-17,K,Z,R,100,7,10"].join("\n");
    const p = parseMetaCostsCsv(csv);
    expect(p.rows[0].clicks).toBe(7);
    expect(p.warnings.some((w) => w.includes("Kliknięcia (wszystkie)"))).toBe(true);
  });
  it("waluta inna niż PLN → ostrzeżenie (z nagłówka)", () => {
    const p = parseMetaCostsCsv(PL.replace("(PLN)", "(USD)"));
    expect(previewCosts(p).warnings.some((w) => w.includes("USD") && w.includes("nie PLN"))).toBe(true);
  });
  it("brak kolumny dnia → odrzucenie z czytelnym komunikatem „ustaw podział: Czas → Dzień”", () => {
    const csv = ["Początek raportowania,Koniec raportowania,Nazwa kampanii,Nazwa reklamy,Wydana kwota (PLN)", "2026-11-01,2026-11-18,K,R,100"].join("\n");
    const p = parseMetaCostsCsv(csv);
    expect(p.rows).toEqual([]);
    expect(p.warnings).toEqual([META_NEEDS_DAY]);
    expect(p.warnings[0]).toContain("Czas → Dzień");
    const none = parseMetaCostsCsv("a,b,c\n1,2,3");
    expect(none.headerFound).toBe(false);
    expect(none.warnings[0]).toContain("Czas → Dzień");
  });
  it("„Początek raportowania” = dzień, gdy koniec jest taki sam w każdym wierszu (podział na dni); EN: Reporting starts / ends", () => {
    const pl = ["Początek raportowania,Koniec raportowania,Nazwa kampanii,Nazwa zestawu reklam,Nazwa reklamy,Wyświetlenia,Kliknięcia linku,Wydana kwota (PLN)", "2026-11-17,2026-11-17,K,Z,R,100,4,10,5"].join("\n").replace("10,5", '"10,5"');
    expect(parseMetaCostsCsv(pl).rows[0]).toMatchObject({ day: "2026-11-17", cost: 10.5, clicks: 4 });
    const en = ["Reporting starts,Reporting ends,Campaign name,Ad set name,Ad name,Impressions,Link clicks,Amount spent (PLN)", "2026-11-17,2026-11-17,K,Z,R,100,4,10"].join("\n");
    expect(parseMetaCostsCsv(en).rows).toHaveLength(1);
  });
  it("te same dni i reklama w kilku wierszach sumują się; wiersz „Razem” pominięty", () => {
    const csv = [PL, "Razem,,,,2900,38,92.6"].join("\n");
    const p = parseMetaCostsCsv(csv.replace("LightSheer A,800", "LightSheer B,800"));
    expect(p.skipped).toBe(1);
    expect(p.rows.find((r) => r.day === "2026-11-17")).toMatchObject({ impressions: 2000, clicks: 27, cost: 62.6 });
  });
});
