// Wniosek 54, etap 1b: raport kampanii — sygnały + koszty z Google Ads w jedno
// drzewo kanał → kampania → grupa → słowo kluczowe. Czysty moduł (vitest bez „@/”).
// Każda liczba ma za sobą listę id sygnałów (klik w panelu, JSON dla MCP).
import { REACH_ORDER } from "../leads/funnel";
import type { CostRow } from "./costs-csv";
import { CH, normName, type SourceInfo } from "./source";

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
  clickKind?: "gclid" | "gbraid" | "wbraid" | null; // jakim identyfikatorem Google zapisało się zgłoszenie (atrybucja z formularza)
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
  returningBookings: number; // stałe klientki: co najmniej rezerwacja
  returningWins: number; // stałe klientki: wygrane
  unqualified: number; // przegrane z powodem „Poza branżą” — nie klient, poza liczbą leadów
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
  returningRevenue: number; // przychód netto stałych klientek (poza przychodem z pozyskania)
  costPerLead: number | null;
  costPerTalk: number | null;
  costPerBooking: number | null;
  revenueToCost: number | null;
};

export type Node = {
  ckeys: string[]; // klucze od kanału do tego węzła (kanał, kampania, grupa / zestaw, fraza / reklama) — łączenie z licznikiem ruchu
  key: string;
  label: string;
  depth: number; // 0 kanał, 1 kampania, 2 grupa, 3 słowo
  path: { kanal: string; kampania?: string; grupa?: string; slowo?: string };
  metrics: Metrics;
  ids: Record<string, string[]>; // metryka → id sygnałów
  children: Node[];
};

type Acc = { ckeys: string[]; impressions: number; clicks: number; cost: number; revenue: number; returningRevenue: number; ids: Record<string, string[]>; children: Map<string, AccNode>; key: string; label: string; depth: number; path: Node["path"] };
type AccNode = Acc;

const ZERO_COUNTS = (): Counts => ({ leads: { razem: 0, cennik: 0, kontakt: 0, rezerwacja: 0, szkolenie: 0, inne: 0 }, returning: 0, returningBookings: 0, returningWins: 0, unqualified: 0, talked: 0, offers: 0, bookings: 0, wins: 0, lost: 0, lostByReason: {} });

const round2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (num: number, den: number): number | null => (den > 0 && num > 0 ? round2(num / den) : null);

function newAcc(key: string, label: string, depth: number, path: Node["path"]): Acc {
  return { ckeys: [], key, label, depth, path, impressions: 0, clicks: 0, cost: 0, revenue: 0, returningRevenue: 0, ids: {}, children: new Map() };
}

const push = (a: Acc, metric: string, id: string) => {
  (a.ids[metric] ??= []).push(id);
};

// Stała klientka = klient, który PRZED datą tego zapytania miał już rezerwację lub
// wynajem (kalendarz — wpis utworzony albo termin przed zapytaniem; historia
// wynajmów), albo sygnał ma flagę „stała klientka”. Własna rezerwacja zapytania
// (powiązany wynajem) się nie liczy.
export type PriorRental = { id: string; startsAt: Date; createdAt: Date };
export function isReturningLead(flag: boolean, prior: { rentals: PriorRental[]; history: Date[] }, lead: { createdAt: Date; rentalId: string | null }): boolean {
  if (flag) return true;
  const t = lead.createdAt.getTime();
  if (prior.history.some((d) => d.getTime() < t)) return true;
  return prior.rentals.some((r) => r.id !== lead.rentalId && (r.startsAt.getTime() < t || r.createdAt.getTime() < t));
}

// Przegrana z powodem „Poza branżą” (np. firma oferująca regenerację głowic) to nie klient.
export function isUnqualified(l: Pick<ReportLead, "stage" | "lostReason">): boolean {
  return l.stage === "PRZEGRANA" && l.lostReason === "POZA_BRANZA";
}

// Które metryki ma sygnał. Stała klientka tylko w „returning” (+ jej rezerwacje /
// wygrane osobno), nie-klient tylko w „unqualified”; reszta to leady z pozyskania.
// Każda oferta, rezerwacja i wygrana liczy się też jako rozmowa.
export function metricsOfLead(l: ReportLead): string[] {
  const reach = REACH_ORDER.indexOf(l.maxStage as (typeof REACH_ORDER)[number]);
  const won = l.stage === "WYGRANA" || l.maxStage === "WYGRANA";
  if (l.returning) {
    const m = ["returning"];
    if (reach >= REACH_ORDER.indexOf("REZERWACJA")) m.push("returning_bookings");
    if (won) m.push("returning_wins");
    return m;
  }
  if (isUnqualified(l)) return ["unqualified"];
  const m = ["leads", TYPE_METRIC[l.type] ?? "leads_inne"];
  if (l.talked || reach >= REACH_ORDER.indexOf("OFERTA")) m.push("talked");
  if (reach >= REACH_ORDER.indexOf("OFERTA")) m.push("offers");
  if (reach >= REACH_ORDER.indexOf("REZERWACJA")) m.push("bookings");
  if (won) m.push("wins");
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
    c.ckeys = [...parent.ckeys, key];
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
  counts.returningBookings = n("returning_bookings");
  counts.returningWins = n("returning_wins");
  counts.unqualified = n("unqualified");
  counts.talked = n("talked");
  counts.offers = n("offers");
  counts.bookings = n("bookings");
  counts.wins = n("wins");
  counts.lost = n("lost");
  for (const k of Object.keys(ids)) if (k.startsWith("lost_")) counts.lostByReason[k.slice(5)] = ids[k].length;
  const cost = round2(a.cost);
  const revenue = round2(a.revenue);
  const returningRevenue = round2(a.returningRevenue);
  return {
    ckeys: a.ckeys,
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
      returningRevenue,
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
  leads: Record<string, { id: string; title: string; type: string; stage: string; createdAt: string; channel: string; termFromFirst: boolean; clickKind: "gclid" | "gbraid" | "wbraid" | null }>;
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

  // ---- koszty (Google Ads i Meta z importu CSV)
  for (const c of input.costs) {
    const meta = c.channel === "META";
    const chName = meta ? CH.META : CH.GOOGLE_ADS;
    const ch = channelOf(chName);
    const camp = child(ch, c.campaignKey, c.campaignName, { kanal: chName, kampania: c.campaignName });
    // Google: grupa po ID (nazwa z raportu), słowo po znormalizowanej frazie. Meta: zestaw i reklama po nazwach bez wielkości liter.
    const gKey = meta ? normName(c.adGroupName) || NO_GROUP : c.adGroupId || c.adGroupName || NO_GROUP;
    const gLabel = c.adGroupName || groupLabel(gKey);
    const grp = child(camp, gKey, gLabel, { kanal: chName, kampania: c.campaignName, grupa: gLabel });
    const kKey = c.keyword || NO_KEYWORD;
    const kLabel = c.keywordText || kKey;
    const kw = child(grp, kKey, kLabel, { kanal: chName, kampania: c.campaignName, grupa: grp.label, slowo: kLabel });
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
    leadInfo[l.id] = { id: l.id, title: l.title, type: l.type, stage: l.stage, createdAt: l.createdAt.toISOString(), channel: src.channel, termFromFirst: src.fromFirst, clickKind: l.clickKind ?? null };
    const metrics = metricsOfLead(l);
    // Do uzupełnienia tylko nowe zapytania bez źródła — nie stałe klientki i nie nie-klienci.
    if (metrics.includes("leads") && src.channel === CH.NONE) unsourced.push({ id: l.id, channel: src.channel });
    if (src.fromFirst && !l.returning) metrics.push("term_from_first"); // tylko lista id, nie liczba
    const chain: Acc[] = [root];
    const ch = channelOf(src.channel);
    chain.push(ch);
    if (src.channel === CH.GOOGLE_ADS || src.channel === CH.META) {
      const meta = src.channel === CH.META;
      const campKey = src.campaign?.key ?? UNKNOWN_CAMPAIGN;
      const campLabel = src.campaign?.label ?? UNKNOWN_CAMPAIGN;
      const camp = child(ch, campKey, campLabel, { kanal: src.channel, kampania: campLabel });
      chain.push(camp);
      // Meta „bez przypisania do reklamy” (stare znaczniki) zostaje na poziomie kampanii.
      if (!(meta && src.adGroup == null && src.keyword == null && campKey.startsWith("("))) {
        const gKey = src.adGroup ?? NO_GROUP;
        const gLabel = src.adGroup ? (meta ? (src.adGroupLabel ?? src.adGroup) : groupLabel(src.adGroup)) : NO_GROUP;
        const grp = child(camp, gKey, gLabel, { kanal: src.channel, kampania: campLabel, grupa: gLabel });
        chain.push(grp);
        const kKey = src.keyword ?? NO_KEYWORD;
        const kLabel = src.keyword ? (meta ? (src.keywordLabel ?? src.keyword) : (keywordLabels.get(src.keyword) ?? src.keyword)) : NO_KEYWORD;
        chain.push(child(grp, kKey, kLabel, { kanal: src.channel, kampania: campLabel, grupa: gLabel, slowo: kLabel }));
      }
    }
    for (const a of chain) {
      for (const m of metrics) push(a, m, l.id);
      if (l.revenue != null && Number.isFinite(l.revenue)) {
        if (l.returning) a.returningRevenue += l.revenue;
        else if (metrics.includes("leads")) a.revenue += l.revenue;
      }
    }
  }

  const total = finalize(root);

  // ---- słowa z kosztem i bez leadów
  const keywordsWithoutLeads: Report["keywordsWithoutLeads"] = [];
  const walk = (n: Node) => {
    if (n.depth === 3 && n.path.kanal === CH.GOOGLE_ADS && n.metrics.cost > 0 && n.metrics.leads.razem === 0 && n.metrics.returning === 0) {
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
  for (const k of input.costs) cell(mondayOf(k.day), k.channel === "META" ? CH.META : CH.GOOGLE_ADS).cost += k.cost;
  const trend: Report["trend"] = [];
  for (const week of [...weeks.keys()].sort()) {
    for (const [channel, c] of weeks.get(week)!) {
      trend.push({ week, channel, leads: c.leads.length, talked: c.talked.length, bookings: c.bookings.length, cost: round2(c.cost), ids: { leads: c.leads, talked: c.talked, bookings: c.bookings } });
    }
  }

  const notes: string[] = [];
  const coverage = (ch: "GOOGLE_ADS" | "META", name: string) => {
    const days = input.costs.filter((c) => (c.channel ?? "GOOGLE_ADS") === ch).map((c) => c.day).sort();
    if (!days.length) return `Brak zaimportowanych kosztów ${name} w tym okresie — kolumny kosztowe tego kanału będą puste.`;
    return `Koszty ${name} z importu CSV (zakres: ${days[0]} – ${days[days.length - 1]}).`;
  };
  notes.push(coverage("GOOGLE_ADS", "Google Ads"));
  notes.push(coverage("META", "Mety"));
  notes.push("Stałe klientki (flaga sygnału albo wcześniejszy wynajem klienta) są w osobnej kolumnie, razem z ich rezerwacjami i wygranymi, i nie liczą się do kosztu pozyskania. Przegrane z powodem „Poza branżą” to nie klienci — osobna kolumna, poza liczbą leadów.");
  notes.push("Etap = najdalszy osiągnięty (maxStage). Rozmowa = wpis rozmowy lub maila w sygnale; każda oferta, rezerwacja i wygrana liczy się też jako rozmowa, więc oferty ≤ rozmowy.");
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
    "Stałe klientki", "Stałe – rezerwacje", "Stałe – wygrane", "Stałe – przychód netto", "Poza branżą", "Rozmowy", "Oferty", "Rezerwacje", "Wygrane", "Przychód netto", "Koszt/lead", "Koszt/rozmowę", "Koszt/rezerwację", "Przychód/koszt", "Przegrane wg powodu",
  ];
  const esc = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [head.join(";")];
  for (const n of rows) {
    const m = n.metrics;
    const lost = Object.entries(m.lostByReason).map(([r, c]) => `${r}: ${c}`).join(", ");
    lines.push(
      [
        n.path.kanal, n.path.kampania ?? "", n.path.grupa ?? "", n.path.slowo ?? "", m.impressions, m.clicks, num(m.cost), m.leads.razem, m.leads.cennik, m.leads.kontakt, m.leads.rezerwacja, m.leads.szkolenie, m.leads.inne,
        m.returning, m.returningBookings, m.returningWins, num(m.returningRevenue), m.unqualified, m.talked, m.offers, m.bookings, m.wins, num(m.revenue), num(m.costPerLead), num(m.costPerTalk), num(m.costPerBooking), num(m.revenueToCost), lost,
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
  returning_bookings: "stale_rezerwacje",
  returning_wins: "stale_wygrane",
  unqualified: "poza_branza",
  talked: "rozmowy",
  offers: "oferty",
  bookings: "rezerwacje",
  wins: "wygrane",
  lost: "przegrane",
  term_from_first: "haslo_z_pierwszego_wejscia",
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
    stale_klientki_szczegoly: { rezerwacje: m.returningBookings, wygrane: m.returningWins, przychod_netto: m.returningRevenue },
    poza_branza_nie_klienci: m.unqualified,
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

// ------------------------------------------------------------ słowa kluczowe

export type KeywordRow = {
  campaignKey: string;
  campaign: string;
  keyword: string; // znormalizowane — klucz oceny
  label: string;
  cost: number;
  clicks: number;
  impressions: number;
  leads: number;
  bookings: number;
  leadIds: string[];
  bookingIds: string[];
};

// Frazy z kosztem i / lub zapytaniami, scalone po (kampania, fraza) ponad grupami
// reklam. Zapytania bez frazy nie są frazami — liczymy je osobno.
export function keywordTable(report: Report): { rows: KeywordRow[]; withoutKeyword: { leads: number; ids: string[] } } {
  const map = new Map<string, KeywordRow>();
  const noKw: string[] = [];
  const google = report.channels.find((c) => c.label === CH.GOOGLE_ADS);
  for (const camp of google?.children ?? []) {
    for (const grp of camp.children) {
      for (const kw of grp.children) {
        if (kw.key === NO_KEYWORD) {
          noKw.push(...(kw.ids.leads ?? []));
          continue;
        }
        const key = `${camp.key}\u0001${kw.key}`;
        const m = kw.metrics;
        const cur = map.get(key) ?? { campaignKey: camp.key, campaign: camp.label, keyword: kw.key, label: kw.label, cost: 0, clicks: 0, impressions: 0, leads: 0, bookings: 0, leadIds: [], bookingIds: [] };
        cur.cost = round2(cur.cost + m.cost);
        cur.clicks += m.clicks;
        cur.impressions += m.impressions;
        cur.leads += m.leads.razem;
        cur.bookings += m.bookings;
        cur.leadIds.push(...(kw.ids.leads ?? []));
        cur.bookingIds.push(...(kw.ids.bookings ?? []));
        map.set(key, cur);
      }
    }
  }
  const rows = [...map.values()].sort((a, b) => b.cost - a.cost || b.leads - a.leads || a.label.localeCompare(b.label, "pl"));
  return { rows, withoutKeyword: { leads: noKw.length, ids: noKw } };
}

// Zmiana względem poprzedniego okresu: różnica bezwzględna i procentowa (null, gdy brak podstawy).
export function delta(cur: number, prev: number): { diff: number; pct: number | null } {
  return { diff: round2(cur - prev), pct: prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null };
}
