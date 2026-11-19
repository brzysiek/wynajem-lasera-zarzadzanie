// Wniosek 54: import kosztów Mety — CSV z Menedżera reklam (poziom reklamy, podział Dzień).
// Czysty moduł (vitest bez „@/”). Nagłówki PL i EN, przecinek / średnik / tabulator, linie tytułu
// przed nagłówkiem pomijane (jak w imporcie Google). Format opracowany z opisu eksportu Menedżera
// reklam (nazwy kolumn z polecenia) — nie z prawdziwego pliku; po pierwszym imporcie sprawdź podgląd.
import { splitLine, parseNumber, parseDay, type CostParse, type CostRow } from "./costs-csv";
import { normName } from "./source";

const ALIASES: Record<string, RegExp> = {
  day: /^(dzień|dzien|day)$/,
  start: /^(początek raportowania|poczatek raportowania|reporting starts)$/,
  end: /^(koniec raportowania|reporting ends)$/,
  campaign: /^(nazwa kampanii|campaign name)$/,
  adset: /^(nazwa zestawu reklam|ad set name)$/,
  ad: /^(nazwa reklamy|ad name)$/,
  impressions: /^(wyświetlenia|wyswietlenia|impressions)$/,
  linkClicks: /^(kliknięcia linku|klikniecia linku|link clicks)$/,
  allClicks: /^(kliknięcia \(wszystkie\)|klikniecia \(wszystkie\)|clicks \(all\))$/,
  currency: /^(waluta|currency)$/,
};
const COST = /^(wydana kwota|amount spent)\s*(?:\(([a-z]{3})\))?$/;

const norm = (h: string) => h.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, " ");

type Cols = { idx: Partial<Record<keyof typeof ALIASES, number>>; cost: number; currency: string | null };

function findHeader(lines: string[], delim: string): { at: number; cols: Cols } | null {
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const cells = splitLine(lines[i], delim).map(norm);
    const idx: Cols["idx"] = {};
    let cost = -1;
    let currency: string | null = null;
    cells.forEach((c, n) => {
      for (const [k, re] of Object.entries(ALIASES)) if (idx[k as keyof Cols["idx"]] === undefined && re.test(c)) idx[k as keyof Cols["idx"]] = n;
      const m = c.match(COST);
      if (m && cost < 0) {
        cost = n;
        currency = m[2] ? m[2].toUpperCase() : null;
      }
    });
    const hasDay = idx.day !== undefined || idx.start !== undefined;
    if (hasDay && cost >= 0 && (idx.campaign !== undefined || idx.adset !== undefined || idx.ad !== undefined)) return { at: i, cols: { idx, cost, currency } };
  }
  return null;
}

export const META_NEEDS_DAY = "Brak podziału na dni — w Menedżerze reklam ustaw podział: Czas → Dzień (i poziom: Reklamy), potem wyeksportuj CSV ponownie.";

export function parseMetaCostsCsv(text: string): CostParse {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  let found: { at: number; cols: Cols; delim: string } | null = null;
  for (const delim of ["\t", ";", ","]) {
    const h = findHeader(lines, delim);
    if (h) {
      found = { ...h, delim };
      break;
    }
  }
  if (!found) {
    return { rows: [], skipped: 0, warnings: [`Nie znalazłem nagłówka raportu Mety. Potrzebne kolumny: Dzień (albo Początek raportowania), Nazwa kampanii, Wydana kwota. ${META_NEEDS_DAY}`], headerFound: false };
  }
  const { at, cols, delim } = found;
  const { idx } = cols;
  const warnings: string[] = [];
  // Brak kolumny „Dzień”: „Początek raportowania” traktujemy jak dzień, o ile każdy wiersz ma koniec = początek
  // (podział Czas → Dzień). Gdy koniec jest późniejszy, to okres całego raportu — odrzucamy.
  if (idx.day === undefined) {
    if (idx.start === undefined) return { rows: [], skipped: 0, warnings: [META_NEEDS_DAY], headerFound: true };
    if (idx.end !== undefined) {
      const wide = lines.slice(at + 1).some((l) => {
        const c = splitLine(l, delim);
        const a = parseDay(c[idx.start!] ?? "");
        const b = parseDay(c[idx.end!] ?? "");
        return !!a && !!b && a !== b;
      });
      if (wide) return { rows: [], skipped: 0, warnings: [META_NEEDS_DAY], headerFound: true };
    }
    idx.day = idx.start;
  }
  if (idx.adset === undefined) warnings.push("Brak kolumny „Nazwa zestawu reklam” — koszty będą bez podziału na zestawy.");
  if (idx.ad === undefined) warnings.push("Brak kolumny „Nazwa reklamy” — koszty będą na poziomie kampanii / zestawu. Ustaw poziom: Reklamy.");
  if (idx.linkClicks === undefined && idx.allClicks === undefined) warnings.push("Brak kolumny „Kliknięcia linku” — kliknięcia będą zerowe.");
  else if (idx.linkClicks === undefined) warnings.push("Brak kolumny „Kliknięcia linku” — użyto „Kliknięcia (wszystkie)”.");
  if (idx.impressions === undefined) warnings.push("Brak kolumny „Wyświetlenia”.");

  const cell = (cells: string[], k: keyof Cols["idx"]) => (idx[k] === undefined ? "" : (cells[idx[k]!] ?? ""));
  const currencies = new Set<string>();
  if (cols.currency) currencies.add(cols.currency);
  const map = new Map<string, CostRow>();
  let skipped = 0;
  for (const line of lines.slice(at + 1)) {
    const cells = splitLine(line, delim);
    const day = parseDay(cell(cells, "day"));
    if (!day) {
      skipped++;
      continue;
    }
    const cur = cell(cells, "currency").trim().toUpperCase();
    if (cur) currencies.add(cur);
    const campaign = cell(cells, "campaign").trim();
    const adset = cell(cells, "adset").trim();
    const ad = cell(cells, "ad").trim();
    const clicks = parseNumber(idx.linkClicks !== undefined ? cell(cells, "linkClicks") : cell(cells, "allClicks"), true);
    const row: CostRow = {
      channel: "META",
      day,
      campaignKey: normName(campaign) || "(bez nazwy)",
      campaignName: campaign || "(bez nazwy)",
      adGroupId: "",
      adGroupName: adset.slice(0, 150),
      keyword: normName(ad).slice(0, 150),
      keywordText: ad.slice(0, 191),
      impressions: parseNumber(cell(cells, "impressions"), true),
      clicks,
      cost: Math.round(parseNumber(cells[cols.cost] ?? "") * 100) / 100,
    };
    const key = [row.day, row.campaignKey, normName(adset), row.keyword].join("\u0001");
    const cur0 = map.get(key);
    if (cur0) {
      cur0.impressions += row.impressions;
      cur0.clicks += row.clicks;
      cur0.cost = Math.round((cur0.cost + row.cost) * 100) / 100;
    } else map.set(key, row);
  }
  const rows = [...map.values()].sort((a, b) => a.day.localeCompare(b.day) || a.campaignKey.localeCompare(b.campaignKey));
  if (!rows.length) warnings.push("Nagłówek jest, ale nie ma wierszy z poprawną datą.");
  const foreign = [...currencies].filter((c) => c !== "PLN");
  if (foreign.length) warnings.push(`Waluta w pliku: ${foreign.join(", ")} (nie PLN) — kwoty zapiszą się bez przeliczenia. Ustaw w Menedżerze reklam walutę PLN albo przelicz plik.`);
  return { rows, skipped, warnings, headerFound: true };
}
