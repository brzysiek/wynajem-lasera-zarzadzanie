// Wniosek 54, etap 1b: raport kampanii — sygnały + koszty z Google Ads w jedno
// drzewo kanał → kampania → grupa → słowo kluczowe. Czysty moduł (vitest bez „@/”).
// Każda liczba ma za sobą listę id sygnałów (klik w panelu, JSON dla MCP).
import { REACH_ORDER } from "../leads/funnel";
import type { CostRow } from "./costs-csv";
import { CH, type SourceInfo } from "./source";

export type ReportLead = {
  id: string;
  title: string;
  type: string; // LeadType
  stage: string; // bieżący etap
  createdAt: Date;
  maxStage: string; // najdalszy osiągnięty etap (jak w tablicy sygnałów)
  talked: boolean; // jak w tablicy sygnałów: był wpis rozmowy albo maila
  returning: boolean; // stała klientka — poza kosztem pozyskania
  lostReason: string | null;
  revenue: number | null; // RentalFinance.totalNet powiązanego wynajmu
  contactEmail: string | null;
  archivedAt: Date | null;
  archiveReason: string | null;
  source: SourceInfo;
};

// Sygnały testowe (+test) i zarchiwizowane duplikaty / spam nie wchodzą do raportu.
const EXCLUDED_ARCHIVE = ["DUPLIKAT", "TEST", "SPAM"];
export function countsInReport(l: Pick<ReportLead, "contactEmail" | "archivedAt" | "archiveReason">): boolean {
  if (/(^|[^a-z])test\+|\+test/i.test(l.contactEmail ?? "")) return false;
  if (l.archivedAt && EXCLUDED_ARCHIVE.includes(l.archiveReason ?? "")) return false;
  return true;
}

export type Level = "kanal" | "kampania" | "grupa" | "slowo";
export const LEVELS: Level[] = ["kanal", "kampania", "grupa", "slowo"];

const TYPE_METRIC: Record<string, string> = {
  POBRANIE_CENNIKA: "leads_cennik",
  KONTAKT: "leads_kontakt",
  REZERWACJA_WWW: "leads_rezerwacja",
  SZKOLENIE_WWW: "leads_szkolenie",
};

export type Counts = {
  leads: { razem: number; cennik: number; kontakt: number; rezerwacja: number; szkolenie: number; inne: number };
  returning: number;
  talked: number;
  offers: number;
  bookings: number;
  wins: number;
  lost: number;
  lostByReason: Record<string, number>;
};

export type Metrics = Counts & {
  impressions: number;
  clicks: number;
  cost: number;
  revenue: number;
  costPerLead: number | null;
  costPerTalk: number | null;
  costPerBooking: number | null;
  revenueToCost: number | null;
};

export type Node = {
  key: string;
  label: string;
  depth: number; // 0 kanał, 1 kampania, 2 grupa, 3 słowo
  path: { kanal: string; kampania?: string; grupa?: string; slowo?: string };
  metrics: Metrics;
  ids: Record<string, string[]>; // metryka → id sygnałów
  children: Node[];
};

type Acc = { impressions: number; clicks: number; cost: number; revenue: number; ids: Record<string, string[]>; children: Map<string, AccNode>; key: string; label: string; depth: number; path: Node["path"] };
type AccNode = Acc;

const ZERO_COUNTS = (): Counts => ({ leads: { razem: 0, cennik: 0, kontakt: 0, rezerwacja: 0, szkolenie: 0, inne: 0 }, returning: 0, talked: 0, offers: 0, bookings: 0, wins: 0, lost: 0, lostByReason: {} });

const round2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (num: number, den: number): number | null => (den > 0 && num > 0 ? round2(num / den) : null);

function newAcc(key: string, label: string, depth: number, path: Node["path"]): Acc {
  return { key, label, depth, path, impressions: 0, clicks: 0, cost: 0, revenue: 0, ids: {}, children: new Map() };
}

const push = (a: Acc, metric: string, id: string) => {
  (a.ids[metric] ??= []).push(id);
};

// Które metryki ma sygnał (stała klientka tylko w „returning”).
export function metricsOfLead(l: ReportLead): string[] {
  if (l.returning) return ["returning"];
  const m = ["leads", TYPE_METRIC[l.type] ?? "leads_inne"];
  const reach = REACH_ORDER.indexOf(l.maxStage as (typeof REACH_ORDER)[number]);
  if (l.talked) m.push("talked");
  if (reach >= REACH_ORDER.indexOf("OFERTA")) m.push("offers");
  if (reach >= REACH_ORDER.indexOf("REZERWACJA")) m.push("bookings");
  if (l.stage === "WYGRANA" || l.maxStage === "WYGRANA") m.push("wins");
  if (l.stage === "PRZEGRANA") {
    m.push("lost");
    m.push(`lost_${l.lostReason ?? "BRAK"}`);
  }
  return m;
}

const UNKNOWN_CAMPAIGN = "(kampania nieznana)";
const NO_GROUP = "(bez grupy)";
const NO_KEYWORD = "(bez słowa)";

function child(parent: Acc, key: string, label: string, path: Node["path"]): Acc {
  let c = parent.children.get(key);
  if (!c) {
    c = newAcc(key, label, parent.depth + 1, path);
    parent.children.set(key, c);
  }
  return c;
}

function finalize(a: Acc): Node {
  const ids = a.ids;
  const n = (k: string) => ids[k]?.length ?? 0;
  const counts = ZERO_COUNTS();
  counts.leads = { razem: n("leads"), cennik: n("leads_cennik"), kontakt: n("leads_kontakt"), rezerwacja: n("leads_rezerwacja"), szkolenie: n("leads_szkolenie"), inne: n("leads_inne") };
  counts.returning = n("returning");
  counts.talked = n("talked");
  counts.offers = n("offers");
  counts.bookings = n("bookings");
  counts.wins = n("wins");
  counts.lost = n("lost");
  for (const k of Object.keys(ids)) if (k.startsWith("lost_")) counts.lostByReason[k.slice(5)] = ids[k].length;
  const cost = round2(a.cost);
  const revenue = round2(a.revenue);
  return {
    key: a.key,
    label: a.label,
    depth: a.depth,
    path: a.path,
    ids,
    metrics: {
      ...counts,
      impressions: a.impressions,
      clicks: a.clicks,
      cost,
      revenue,
      costPerLead: ratio(cost, counts.leads.razem),
      costPerTalk: ratio(cost, counts.talked),
      costPerBooking: ratio(cost, counts.bookings),
      revenueToCost: cost > 0 && revenue > 0 ? round2(revenue / cost) : null,
    },
    children: [...a.children.values()]
      .map(finalize)
      .sort((x, y) => y.metrics.cost - x.metrics.cost || y.metrics.leads.razem - x.metrics.leads.razem || x.label.localeCompare(y.label, "pl")),
  };
}

export type ReportInput = {
  leads: ReportLead[]; // już w okresie
  costs: CostRow[]; // już w okresie
  from: string; // RRRR-MM-DD
  to: string;
  localDay: (d: Date) => string; // data w Europe/Warsaw
};

export type Report = {
  from: string;
  to: string;
  total: Node;
  channels: Node[];
  keywordsWithoutLeads: { campaign: string; group: string; keyword: string; cost: number; clicks: number; impressions: number }[];
  trend: { week: string; channel: string; leads: number; talked: number; bookings: number; cost: number; ids: { leads: string[]; talked: string[]; bookings: string[] } }[];
  unsourced: { id: string; channel: string }[];
  leads: Record<string, { id: string; title: string; type: string; stage: string; createdAt: string; channel: string }>;
  notes: string[];
};

export function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export function buildReport(input: ReportInput): Report {
  const root = newAcc("razem", "Razem", -1, { kanal: "razem" });
  const channelOf = (name: string) => child(root, name, name, { kanal: name });
  const groupLabels = new Map<string, string>(); // ID grupy → nazwa z raportu kosztów
  const keywordLabels = new Map<string, string>();
  for (const c of input.costs) {
    if (c.adGroupId && c.adGroupName) groupLabels.set(c.adGroupId, c.adGroupName);
    if (c.keyword && c.keywordText) keywordLabels.set(c.keyword, c.keywordText);
  }
  const groupLabel = (key: string) => groupLabels.get(key) ?? (/^\d+$/.test(key) ? `grupa ${key}` : key);

  // ---- koszty (tylko Google Ads)
  for (const c of input.costs) {
    const ch = channelOf(CH.GOOGLE_ADS);
    const camp = child(ch, c.campaignKey, c.campaignName, { kanal: CH.GOOGLE_ADS, kampania: c.campaignName });
    const gKey = c.adGroupId || c.adGroupName || NO_GROUP;
    const grp = child(camp, gKey, c.adGroupName || groupLabel(gKey), { kanal: CH.GOOGLE_ADS, kampania: c.campaignName, grupa: c.adGroupName || groupLabel(gKey) });
    const kKey = c.keyword || NO_KEYWORD;
    const kw = child(grp, kKey, c.keywordText || kKey, { kanal: CH.GOOGLE_ADS, kampania: c.campaignName, grupa: grp.label, slowo: c.keywordText || kKey });
    for (const a of [root, ch, camp, grp, kw]) {
      a.impressions += c.impressions;
      a.clicks += c.clicks;
      a.cost += c.cost;
    }
  }

  // ---- sygnały
  const leadInfo: Report["leads"] = {};
  const unsourced: Report["unsourced"] = [];
  for (const l of input.leads) {
    const src = l.source;
    leadInfo[l.id] = { id: l.id, title: l.title, type: l.type, stage: l.stage, createdAt: l.createdAt.toISOString(), channel: src.channel };
    if (src.channel === CH.NONE || src.channel === CH.PHONE_EMAIL) unsourced.push({ id: l.id, channel: src.channel });
    const metrics = metricsOfLead(l);
    const chain: Acc[] = [root];
    const ch = channelOf(src.channel);
    chain.push(ch);
    if (src.channel === CH.GOOGLE_ADS || src.channel === CH.META) {
      const campKey = src.campaign?.key ?? UNKNOWN_CAMPAIGN;
      const campLabel = src.campaign?.label ?? UNKNOWN_CAMPAIGN;
      const camp = child(ch, campKey, campLabel, { kanal: src.channel, kampania: campLabel });
      chain.push(camp);
      const gKey = src.adGroup ?? NO_GROUP;
      const gLabel = src.adGroup ? (src.channel === CH.GOOGLE_ADS ? groupLabel(src.adGroup) : `reklama ${src.adGroup}`) : NO_GROUP;
      const grp = child(camp, gKey, gLabel, { kanal: src.channel, kampania: campLabel, grupa: gLabel });
      chain.push(grp);
      if (src.channel === CH.GOOGLE_ADS) {
        const kKey = src.keyword ?? NO_KEYWORD;
        const kLabel = src.keyword ? (keywordLabels.get(src.keyword) ?? src.keyword) : NO_KEYWORD;
        chain.push(child(grp, kKey, kLabel, { kanal: src.channel, kampania: campLabel, grupa: gLabel, slowo: kLabel }));
      }
    }
    for (const a of chain) {
      for (const m of metrics) push(a, m, l.id);
      if (!l.returning && l.revenue != null && Number.isFinite(l.revenue)) a.revenue += l.revenue;
    }
  }

  const total = finalize(root);

  // ---- słowa z kosztem i bez leadów
  const keywordsWithoutLeads: Report["keywordsWithoutLeads"] = [];
  const walk = (n: Node) => {
    if (n.depth === 3 && n.metrics.cost > 0 && n.metrics.leads.razem === 0 && n.metrics.returning === 0) {
      keywordsWithoutLeads.push({ campaign: n.path.kampania ?? "", group: n.path.grupa ?? "", keyword: n.path.slowo ?? n.label, cost: n.metrics.cost, clicks: n.metrics.clicks, impressions: n.metrics.impressions });
    }
    n.children.forEach(walk);
  };
  total.children.forEach(walk);
  keywordsWithoutLeads.sort((a, b) => b.cost - a.cost);

  // ---- trend tygodniowy (poniedziałek–niedziela)
  const weeks = new Map<string, Map<string, { leads: string[]; talked: string[]; bookings: string[]; cost: number }>>();
  const cell = (week: string, channel: string) => {
    const w = weeks.get(week) ?? new Map();
    weeks.set(week, w);
    let c = w.get(channel);
    if (!c) {
      c = { leads: [], talked: [], bookings: [], cost: 0 };
      w.set(channel, c);
    }
    return c;
  };
  for (const l of input.leads) {
    const ms = metricsOfLead(l);
    if (!ms.includes("leads")) continue;
    const c = cell(mondayOf(input.localDay(l.createdAt)), l.source.channel);
    c.leads.push(l.id);
    if (ms.includes("talked")) c.talked.push(l.id);
    if (ms.includes("bookings")) c.bookings.push(l.id);
  }
  for (const k of input.costs) cell(mondayOf(k.day), CH.GOOGLE_ADS).cost += k.cost;
  const trend: Report["trend"] = [];
  for (const week of [...weeks.keys()].sort()) {
    for (const [channel, c] of weeks.get(week)!) {
      trend.push({ week, channel, leads: c.leads.length, talked: c.talked.length, bookings: c.bookings.length, cost: round2(c.cost), ids: { leads: c.leads, talked: c.talked, bookings: c.bookings } });
    }
  }

  const notes: string[] = [];
  if (!input.costs.length) notes.push("Brak zaimportowanych kosztów Google Ads w tym okresie — kolumny kosztowe będą puste.");
  notes.push("Koszty pochodzą tylko z Google Ads (import CSV). Koszty Mety nie są importowane.");
  notes.push("Stałe klientki (returningClient) są w osobnej kolumnie i nie liczą się do kosztu pozyskania. Etap = najdalszy osiągnięty (maxStage); rozmowa jak w tablicy sygnałów.");
  return { from: input.from, to: input.to, total, channels: total.children, keywordsWithoutLeads, trend, unsourced, leads: leadInfo, notes };
}

// Płaska lista wierszy na wybranym poziomie (CSV, MCP). Kanały bez głębszych
// poziomów (np. Bing) zostają jako własny wiersz, żeby sumy się zgadzały.
export function flatten(report: Report, level: Level, channel?: string | null): Node[] {
  const target = LEVELS.indexOf(level);
  const want = channel ? channel.trim().toLowerCase() : "";
  const out: Node[] = [];
  const walk = (n: Node) => {
    if (n.depth === target || (n.depth < target && n.children.length === 0)) {
      out.push(n);
      return;
    }
    n.children.forEach(walk);
  };
  for (const ch of report.channels) {
    if (want && !ch.label.toLowerCase().includes(want) && ch.label.toLowerCase().replace(/[^a-z]/g, "") !== want.replace(/[^a-z]/g, "")) continue;
    walk(ch);
  }
  return out;
}

export const METRIC_KEYS = ["leads", "leads_cennik", "leads_kontakt", "leads_rezerwacja", "leads_szkolenie", "leads_inne", "returning", "talked", "offers", "bookings", "wins", "lost"] as const;

// CSV raportu (średnik, przecinek dziesiętny, BOM — otwiera się w Excelu po polsku).
export function reportCsv(rows: Node[]): string {
  const num = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));
  const head = [
    "Kanał", "Kampania", "Grupa", "Słowo kluczowe", "Wyświetlenia", "Kliknięcia", "Koszt", "Leady", "Cennik", "Kontakt", "Rezerwacja WWW", "Szkolenie", "Inne",
    "Stałe klientki", "Rozmowy", "Oferty", "Rezerwacje", "Wygrane", "Przychód netto", "Koszt/lead", "Koszt/rozmowę", "Koszt/rezerwację", "Przychód/koszt", "Przegrane wg powodu",
  ];
  const esc = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [head.join(";")];
  for (const n of rows) {
    const m = n.metrics;
    const lost = Object.entries(m.lostByReason).map(([r, c]) => `${r}: ${c}`).join(", ");
    lines.push(
      [
        n.path.kanal, n.path.kampania ?? "", n.path.grupa ?? "", n.path.slowo ?? "", m.impressions, m.clicks, num(m.cost), m.leads.razem, m.leads.cennik, m.leads.kontakt, m.leads.rezerwacja, m.leads.szkolenie, m.leads.inne,
        m.returning, m.talked, m.offers, m.bookings, m.wins, num(m.revenue), num(m.costPerLead), num(m.costPerTalk), num(m.costPerBooking), num(m.revenueToCost), lost,
      ]
        .map((v) => esc(String(v)))
        .join(";"),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------- JSON dla MCP

const IDS_PL: Record<string, string> = {
  leads: "leady",
  leads_cennik: "leady_cennik",
  leads_kontakt: "leady_kontakt",
  leads_rezerwacja: "leady_rezerwacja_www",
  leads_szkolenie: "leady_szkolenie",
  leads_inne: "leady_inne",
  returning: "stale_klientki",
  talked: "rozmowy",
  offers: "oferty",
  bookings: "rezerwacje",
  wins: "wygrane",
  lost: "przegrane",
};

// Wiersz raportu po polsku: liczby + id sygnałów za każdą liczbą.
export function nodeJson(n: Node) {
  const m = n.metrics;
  const sygnaly: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(n.ids)) sygnaly[IDS_PL[k] ?? k.replace(/^lost_/, "przegrane_")] = v;
  return {
    kanal: n.path.kanal,
    kampania: n.path.kampania ?? null,
    grupa: n.path.grupa ?? null,
    slowo_kluczowe: n.path.slowo ?? null,
    wyswietlenia: m.impressions,
    klikniecia: m.clicks,
    koszt: m.cost,
    leady: { razem: m.leads.razem, cennik: m.leads.cennik, kontakt: m.leads.kontakt, rezerwacja_www: m.leads.rezerwacja, szkolenie: m.leads.szkolenie, inne: m.leads.inne },
    stale_klientki: m.returning,
    rozmowy: m.talked,
    oferty: m.offers,
    rezerwacje: m.bookings,
    wygrane: m.wins,
    przychod_netto: m.revenue,
    koszt_na_lead: m.costPerLead,
    koszt_na_rozmowe: m.costPerTalk,
    koszt_na_rezerwacje: m.costPerBooking,
    przychod_do_kosztu: m.revenueToCost,
    przegrane: m.lost,
    przegrane_wg_powodu: m.lostByReason,
    sygnaly,
  };
}
