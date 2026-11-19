import { describe, expect, it } from "vitest";
import { parseCostsCsv, parseDay, parseNumber, previewCosts } from "./costs-csv";

describe("liczby i daty", () => {
  it("liczby: przecinek dziesiętny, spacja tysięcy, kropka, myślnik", () => {
    expect(parseNumber("1 234,56")).toBe(1234.56);
    expect(parseNumber("1 234,5")).toBe(1234.5);
    expect(parseNumber("1,234.56")).toBe(1234.56);
    expect(parseNumber("12,5")).toBe(12.5);
    expect(parseNumber("12.5")).toBe(12.5);
    expect(parseNumber("12,50 zł")).toBe(12.5);
    expect(parseNumber("--")).toBe(0);
    expect(parseNumber("")).toBe(0);
    expect(parseNumber("1 234", true)).toBe(1234);
    expect(parseNumber("1,234", true)).toBe(1234);
  });
  it("daty: ISO, polska, angielska, nazwy miesięcy", () => {
    expect(parseDay("2026-11-18")).toBe("2026-11-18");
    expect(parseDay("18.11.2026")).toBe("2026-11-18");
    expect(parseDay("Nov 18, 2026")).toBe("2026-11-18");
    expect(parseDay("18 lis 2026")).toBe("2026-11-18");
    expect(parseDay("Razem: konto")).toBeNull();
    expect(parseDay("31.02.2026")).toBeNull();
  });
});

const PL = [
  "Raport słów kluczowych",
  "1 listopada 2026 - 18 listopada 2026",
  "Dzień,Kampania,Identyfikator grupy reklam,Grupa reklam,Słowo kluczowe,Wyświetlenia,Kliknięcia,Koszt",
  '2026-11-17,Alma – wyszukiwanie,111,Alma ogólne,"[wynajem lasera alma]",120,"6","41,20"',
  '2026-11-17,Alma – wyszukiwanie,111,Alma ogólne,"wynajem lasera alma",30,1,"8,05"',
  '2026-11-18,LightSheer – wyszukiwanie,222,LS,"lightsheer wynajem","1 234",10,"100,00"',
  "Razem: konto,,,,,1384,17,149.25",
].join("\n");

// Eksport z edytora raportów Google Ads (PL): dwie linie tytułu, potem nagłówek z „Słowo kluczowe w sieci wyszukiwania” i „Kod waluty”.
const EDITOR = [
  "Raport bez tytułu",
  "6 października 2026 - 18 listopada 2026",
  "Grupa reklam,Dzień,Kampania,Identyfikator grupy reklam,Słowo kluczowe w sieci wyszukiwania,Wyświetlenia,Kliknięcia,Kod waluty,Koszt",
  'Alma ogólne,2026-11-17,Alma – wyszukiwanie,111,"[wynajem lasera alma]",120,6,PLN,"41,20"',
  'Alma ogólne,2026-11-17,Alma – wyszukiwanie,111,"wynajem lasera alma",30,1,PLN,"8,05"',
  'LS,2026-11-18,LightSheer – wyszukiwanie,222,"lightsheer wynajem","1 234",10,PLN,"100,00"',
].join("\n");

describe("import kosztów — format z edytora raportów Google Ads (A2)", () => {
  it("rozpoznaje „Słowo kluczowe w sieci wyszukiwania” i dwie linie tytułu; kod waluty ignorowany", () => {
    const p = parseCostsCsv(EDITOR);
    expect(p.headerFound).toBe(true);
    expect(p.warnings.some((w) => w.includes("Brak kolumny „Słowo kluczowe”"))).toBe(false);
    expect(p.warnings.some((w) => w.includes("Waluta"))).toBe(false);
    expect(p.rows).toHaveLength(2);
    expect(p.rows.find((r) => r.campaignKey === "alma")).toMatchObject({ keyword: "wynajem lasera alma", adGroupId: "111", adGroupName: "Alma ogólne", impressions: 150, clicks: 7, cost: 49.25 });
    expect(p.rows.find((r) => r.campaignKey === "lightsheer")).toMatchObject({ keyword: "lightsheer wynajem", impressions: 1234, cost: 100 });
  });
  it("waluta inna niż PLN daje ostrzeżenie w podglądzie", () => {
    const eur = EDITOR.replace(/,PLN,/g, ",EUR,");
    const pv = previewCosts(parseCostsCsv(eur));
    expect(pv.warnings.some((w) => w.includes("EUR") && w.includes("nie PLN"))).toBe(true);
  });
  it("pozostałe synonimy frazy: Search keyword, Keyword, Słowo kluczowe", () => {
    for (const h of ["Search keyword", "Keyword", "Słowo kluczowe"]) {
      const csv = [`Day,Campaign,${h},Impr.,Clicks,Cost`, "2026-11-18,Alma,laser,5,1,3.5"].join("\n");
      expect(parseCostsCsv(csv).rows[0], h).toMatchObject({ keyword: "laser", cost: 3.5 });
    }
  });
});

describe("import kosztów", () => {
  it("nagłówki PL, wiersze tytułowe, razem pominięte, typy dopasowania zsumowane", () => {
    const p = parseCostsCsv(PL);
    expect(p.headerFound).toBe(true);
    expect(p.skipped).toBe(1);
    expect(p.rows).toHaveLength(2);
    const alma = p.rows.find((r) => r.campaignKey === "alma")!;
    expect(alma).toMatchObject({ day: "2026-11-17", adGroupId: "111", keyword: "wynajem lasera alma", impressions: 150, clicks: 7, cost: 49.25 });
    const ls = p.rows.find((r) => r.campaignKey === "lightsheer")!;
    expect(ls.impressions).toBe(1234);
    expect(ls.cost).toBe(100);
  });
  it("nagłówki EN, średnik i dziesiętny przecinek", () => {
    const csv = ["Day;Campaign;Ad group;Keyword;Impr.;Clicks;Cost", "18.11.2026;Alma;G1;alma laser;10;2;12,34"].join("\n");
    const p = parseCostsCsv(csv);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ campaignKey: "alma", adGroupName: "G1", impressions: 10, clicks: 2, cost: 12.34 });
    expect(p.warnings.some((w) => w.includes("Identyfikator grupy"))).toBe(true);
  });
  it("tabulator (eksport Excela)", () => {
    const tsv = ["Day\tCampaign\tKeyword\tImpr.\tClicks\tCost", "2026-11-18\tAlma\tlaser\t5\t1\t3.5"].join("\n");
    expect(parseCostsCsv(tsv).rows[0]).toMatchObject({ clicks: 1, cost: 3.5 });
  });
  it("bez nagłówka — komunikat, nic nie zapisuje", () => {
    const p = parseCostsCsv("a,b,c\n1,2,3");
    expect(p.headerFound).toBe(false);
    expect(p.rows).toEqual([]);
  });
  it("podgląd: dni, kampanie, łączny koszt, kampania bez dopasowania", () => {
    const csv = [PL, "2026-11-18,Dziwna kampania,9,G,słowo,1,1,\"5,00\""].join("\n");
    const pv = previewCosts(parseCostsCsv(csv));
    expect(pv).toMatchObject({ days: 2, dayFrom: "2026-11-17", dayTo: "2026-11-18", totalCost: 154.25, rows: 3 });
    expect(pv.campaigns.map((c) => c.name)).toContain("Dziwna kampania");
    expect(pv.warnings.some((w) => w.includes("Dziwna kampania"))).toBe(true);
  });
});
