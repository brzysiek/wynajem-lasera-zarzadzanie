// Wniosek 54, etap 1b: import kosztów z Google Ads — CSV raportu słów kluczowych
// z segmentem Dzień. Czysty moduł (vitest bez „@/”). Akceptuje nagłówki PL i EN,
// wiersze tytułowe nad nagłówkiem, separator tabulator / średnik / przecinek,
// liczby „1 234,56” i „1,234.56”, daty RRRR-MM-DD, DD.MM.RRRR i „Nov 18, 2026”.
import { campaignFromCostName, normalizeKeyword } from "./source";

export type CostRowRaw = {
  day: string; // RRRR-MM-DD
  campaignName: string;
  campaignId: string;
  adGroupName: string;
  adGroupId: string;
  keywordText: string;
  impressions: number;
  clicks: number;
  cost: number;
};

export type CostRow = {
  channel?: "GOOGLE_ADS" | "META"; // domyślnie Google Ads; Meta: adGroup* = zestaw reklam, keyword* = reklama
  day: string;
  campaignKey: string;
  campaignName: string;
  adGroupId: string; // "" gdy raport nie ma identyfikatora grupy
  adGroupName: string;
  keyword: string; // znormalizowane; "" gdy brak
  keywordText: string;
  impressions: number;
  clicks: number;
  cost: number;
};

export type CostParse = {
  rows: CostRow[]; // zsumowane po (dzień, kampania, grupa, słowo)
  skipped: number; // wiersze bez poprawnej daty (np. „Razem: …”)
  warnings: string[];
  headerFound: boolean;
};

const ALIASES: Record<string, RegExp> = {
  day: /^(dzień|dzien|day|date|data)$/,
  campaign: /^(kampania|campaign|nazwa kampanii|campaign name)$/,
  campaignId: /^(identyfikator kampanii|campaign id|id kampanii)$/,
  adGroup: /^(grupa reklam|grupa reklamowa|ad group|nazwa grupy reklam|ad group name)$/,
  adGroupId: /^(identyfikator grupy reklam|ad group id|id grupy reklam)$/,
  keyword: /^(słowo kluczowe|slowo kluczowe|keyword|search keyword|słowo kluczowe w sieci wyszukiwania|slowo kluczowe w sieci wyszukiwania|słowo kluczowe w wyszukiwarce|keyword text|tekst słowa kluczowego)$/,
  currency: /^(kod waluty|currency code|currency|waluta)$/,
  impressions: /^(wyświetlenia|wyswietlenia|impressions|impr\.?)$/,
  clicks: /^(kliknięcia|klikniecia|clicks)$/,
  cost: /^(koszt|cost)(\s*\(.*\))?$/,
};

const norm = (h: string) => h.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, " ");

// Dzieli wiersz z uwzględnieniem cudzysłowów.
export function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

export function parseNumber(v: string | undefined, integer = false): number {
  let s = (v ?? "").replace(/[\s  ]/g, "").replace(/[^\d.,-]/g, "");
  if (!s || s === "-" || /^-+$/.test(s)) return 0;
  const neg = s.startsWith("-");
  s = s.replace(/-/g, "");
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  let n: number;
  if (integer) n = Number(s.replace(/[.,]/g, ""));
  else if (comma >= 0 && dot >= 0) n = comma > dot ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s.replace(/,/g, ""));
  else if (comma >= 0) n = Number(s.replace(",", "."));
  else n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, sty: 1, stycznia: 1, styczeń: 1,
  feb: 2, february: 2, lut: 2, lutego: 2, luty: 2,
  mar: 3, march: 3, marca: 3, marzec: 3,
  apr: 4, april: 4, kwi: 4, kwietnia: 4, kwiecień: 4,
  may: 5, maj: 5, maja: 5,
  jun: 6, june: 6, cze: 6, czerwca: 6, czerwiec: 6,
  jul: 7, july: 7, lip: 7, lipca: 7, lipiec: 7,
  aug: 8, august: 8, sie: 8, sierpnia: 8, sierpień: 8,
  sep: 9, sept: 9, september: 9, wrz: 9, września: 9, wrzesień: 9,
  oct: 10, october: 10, paź: 10, paz: 10, października: 10, październik: 10,
  nov: 11, november: 11, lis: 11, listopada: 11, listopad: 11,
  dec: 12, december: 12, gru: 12, grudnia: 12, grudzień: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseDay(v: string | undefined): string | null {
  const s = (v ?? "").trim().replace(/\.$/, "");
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = s.match(/^([A-Za-ząćęłńóśźż]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = s.match(/^(\d{1,2})\s+([A-Za-ząćęłńóśźż]+)\.?,?\s+(\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}

type ColMap = Partial<Record<keyof typeof ALIASES, number>>;

function findHeader(lines: string[], delim: string): { at: number; cols: ColMap } | null {
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const cells = splitLine(lines[i], delim).map(norm);
    const cols: ColMap = {};
    cells.forEach((c, idx) => {
      for (const [k, re] of Object.entries(ALIASES)) if (cols[k as keyof ColMap] === undefined && re.test(c)) cols[k as keyof ColMap] = idx;
    });
    if (cols.day !== undefined && cols.cost !== undefined && (cols.campaign !== undefined || cols.keyword !== undefined)) return { at: i, cols };
  }
  return null;
}

export function parseCostsCsv(text: string): CostParse {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const warnings: string[] = [];
  let found: { at: number; cols: ColMap; delim: string } | null = null;
  for (const delim of ["\t", ";", ","]) {
    const h = findHeader(lines, delim);
    if (h) {
      found = { ...h, delim };
      break;
    }
  }
  if (!found) {
    return { rows: [], skipped: 0, warnings: ["Nie znalazłem nagłówka raportu. Potrzebne kolumny: Dzień, Kampania (lub Słowo kluczowe) i Koszt."], headerFound: false };
  }
  const { at, cols, delim } = found;
  if (cols.keyword === undefined) warnings.push("Brak kolumny „Słowo kluczowe” — koszty będą tylko na poziomie kampanii / grupy.");
  if (cols.adGroupId === undefined && cols.adGroup !== undefined) warnings.push("Brak kolumny „Identyfikator grupy reklam” — leady (utm_content = ID grupy) nie połączą się z kosztami grup. Dodaj tę kolumnę w raporcie.");
  if (cols.adGroup === undefined && cols.adGroupId === undefined) warnings.push("Brak kolumn grupy reklam — koszty będą bez podziału na grupy.");
  if (cols.impressions === undefined) warnings.push("Brak kolumny „Wyświetlenia”.");
  if (cols.clicks === undefined) warnings.push("Brak kolumny „Kliknięcia”.");

  const cell = (cells: string[], k: keyof typeof ALIASES) => (cols[k] === undefined ? "" : (cells[cols[k]!] ?? ""));
  const raw: CostRowRaw[] = [];
  const currencies = new Set<string>();
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
    raw.push({
      day,
      campaignName: cell(cells, "campaign"),
      campaignId: cell(cells, "campaignId").replace(/\D/g, ""),
      adGroupName: cell(cells, "adGroup"),
      adGroupId: cell(cells, "adGroupId").replace(/\D/g, ""),
      keywordText: cell(cells, "keyword"),
      impressions: parseNumber(cell(cells, "impressions"), true),
      clicks: parseNumber(cell(cells, "clicks"), true),
      cost: parseNumber(cell(cells, "cost")),
    });
  }
  // Suma po (dzień, kampania, grupa, słowo) — typy dopasowania jednego słowa łączą się.
  const map = new Map<string, CostRow>();
  for (const r of raw) {
    const camp = campaignFromCostName(r.campaignName, r.campaignId);
    const keyword = normalizeKeyword(r.keywordText);
    const key = [r.day, camp.key, r.adGroupId || r.adGroupName, keyword].join("\u0001");
    const cur = map.get(key);
    if (cur) {
      cur.impressions += r.impressions;
      cur.clicks += r.clicks;
      cur.cost = Math.round((cur.cost + r.cost) * 100) / 100;
    } else {
      map.set(key, {
        day: r.day,
        campaignKey: camp.key,
        campaignName: camp.label === r.campaignName || !r.campaignName ? camp.label : r.campaignName,
        adGroupId: r.adGroupId,
        adGroupName: r.adGroupName,
        keyword,
        keywordText: r.keywordText,
        impressions: r.impressions,
        clicks: r.clicks,
        cost: Math.round(r.cost * 100) / 100,
      });
    }
  }
  const rows = [...map.values()].sort((a, b) => a.day.localeCompare(b.day) || a.campaignKey.localeCompare(b.campaignKey));
  if (!rows.length) warnings.push("Nagłówek jest, ale nie ma wierszy z poprawną datą.");
  // Kolumna „Kod waluty” jest ignorowana, ale waluta inna niż PLN psułaby sumy — ostrzegamy.
  const foreign = [...currencies].filter((c) => c !== "PLN");
  if (foreign.length) warnings.push(`Waluta w pliku: ${foreign.join(", ")} (nie PLN) — kwoty zapiszą się bez przeliczenia. Sprawdź konto Google Ads albo przelicz plik.`);
  return { rows, skipped, warnings, headerFound: true };
}

export type CostPreview = {
  rows: number;
  days: number;
  dayFrom: string | null;
  dayTo: string | null;
  totalCost: number;
  impressions: number;
  clicks: number;
  campaigns: { key: string; name: string; cost: number; known: boolean }[];
  warnings: string[];
};

export function previewCosts(p: CostParse): CostPreview {
  const days = [...new Set(p.rows.map((r) => r.day))].sort();
  const byCamp = new Map<string, { key: string; name: string; cost: number; known: boolean }>();
  for (const r of p.rows) {
    const c = byCamp.get(r.campaignKey) ?? { key: r.campaignKey, name: r.campaignName, cost: 0, known: !r.campaignKey.startsWith("nazwa:") && !r.campaignKey.startsWith("id:") };
    c.cost = Math.round((c.cost + r.cost) * 100) / 100;
    byCamp.set(r.campaignKey, c);
  }
  const campaigns = [...byCamp.values()].sort((a, b) => b.cost - a.cost);
  const warnings = [...p.warnings];
  if (p.skipped) warnings.push(`Pominięto ${p.skipped} ${p.skipped === 1 ? "wiersz" : "wierszy"} bez daty (np. podsumowania „Razem”).`);
  const unknown = campaigns.filter((c) => !c.known);
  if (unknown.length) warnings.push(`Kampanie bez dopasowania do znaczników z sygnałów (utm_campaign): ${unknown.map((c) => c.name).join(", ")} — ich koszt pokaże się osobno, bez leadów.`);
  return {
    rows: p.rows.length,
    days: days.length,
    dayFrom: days[0] ?? null,
    dayTo: days[days.length - 1] ?? null,
    totalCost: Math.round(p.rows.reduce((s, r) => s + r.cost, 0) * 100) / 100,
    impressions: p.rows.reduce((s, r) => s + r.impressions, 0),
    clicks: p.rows.reduce((s, r) => s + r.clicks, 0),
    campaigns,
    warnings,
  };
}
