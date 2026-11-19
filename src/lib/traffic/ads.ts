// Wniosek 54: jakość ruchu z reklam wg kampanii, grupy i frazy (Google Ads) oraz kampanii, zestawu i reklamy
// (Meta) — z anonimowego licznika. Czysty moduł (vitest bez „@/”).
//
// UWAGA (do opisu pól): licznik NIE łączy wizyt między stronami — metryki dotyczą wyświetlenia strony,
// od którego zaczęła się wizyta (strona wejścia z danym utm). Nie wolno z nich wyciągać wniosków o całej
// ścieżce osoby (np. że formularz na innej podstronie nie został wysłany).
import { TCH, classifyChannel } from "./ingest";
import { isVisit, type TrafficRow } from "./report";

export const MIN_VISITS = 20; // poniżej: „mało danych”

export type AdMetrics = {
  wejscia: number;
  bez_podsumowania: number; // wejścia bez zdarzenia „koniec” — nie wchodzą do mianowników procentów
  z_podsumowaniem: number;
  wyszli_od_razu_proc: number | null;
  przewiniecie_50_proc: number | null;
  czas_30s_proc: number | null;
  klik_telefon: number;
  form_start: number;
  form_wyslany: number;
  form_porzucony: number;
  pole_porzucenia: string | null;
  malo_danych: boolean;
};

type Acc = { visits: number; ended: number; bounced: number; scroll50: number; time30: number; phone: number; start: number; sent: number; aband: number; fields: Map<string, number> };
const newAcc = (): Acc => ({ visits: 0, ended: 0, bounced: 0, scroll50: 0, time30: 0, phone: 0, start: 0, sent: 0, aband: 0, fields: new Map() });
const pct = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 100) : null);

export function metricsOf(a: Acc): AdMetrics {
  const top = [...a.fields.entries()].sort((x, y) => y[1] - x[1])[0];
  return {
    wejscia: a.visits,
    bez_podsumowania: a.visits - a.ended,
    z_podsumowaniem: a.ended,
    wyszli_od_razu_proc: pct(a.bounced, a.ended),
    przewiniecie_50_proc: pct(a.scroll50, a.ended),
    czas_30s_proc: pct(a.time30, a.ended),
    klik_telefon: a.phone,
    form_start: a.start,
    form_wyslany: a.sent,
    form_porzucony: a.aband,
    pole_porzucenia: top ? top[0] : null,
    malo_danych: a.visits < MIN_VISITS,
  };
}
export const emptyMetrics = (): AdMetrics => metricsOf(newAcc());

// Klucze: kanał, kampania, grupa / zestaw, fraza / reklama; „kwc” = fraza ponad grupami (zakładka Słowa kluczowe).
export const SEP = "\u0001";
export const chKey = (channel: string) => ["ch", channel].join(SEP);
export const campKey = (channel: string, camp: string) => ["camp", channel, camp].join(SEP);
export const grpKey = (channel: string, camp: string, group: string) => ["grp", channel, camp, group].join(SEP);
export const kwKey = (channel: string, camp: string, group: string, term: string) => ["kw", channel, camp, group, term].join(SEP);
export const kwcKey = (camp: string, term: string) => ["kwc", camp, term].join(SEP);

type PvFacts = { ended: boolean; bounced: boolean; scroll50: boolean; time30: boolean; phone: number; start: boolean; sent: boolean; aband: string[] };

function factsOf(events: TrafficRow[]): PvFacts {
  const f: PvFacts = { ended: false, bounced: false, scroll50: false, time30: false, phone: 0, start: false, sent: false, aband: [] };
  let last: TrafficRow | null = null;
  for (const e of events) {
    const d = e.data ?? {};
    if (e.type === "koniec") last = e;
    else if (e.type === "klik" && d.rodzaj === "telefon") f.phone++;
    else if (e.type === "form_start") f.start = true;
    else if (e.type === "form_wyslany") f.sent = true;
    else if (e.type === "form_porzucony") f.aband.push(typeof d.pole === "string" && d.pole ? d.pole : "(nieznane pole)");
  }
  if (last) {
    const d = last.data ?? {};
    f.ended = true;
    f.bounced = d.wyjscie === true && d.czas === "<10s";
    f.scroll50 = typeof d.przew === "number" && d.przew >= 50;
    f.time30 = d.czas === "30s-2min" || d.czas === ">2min";
  }
  return f;
}

function add(a: Acc, f: PvFacts) {
  a.visits++;
  if (f.ended) {
    a.ended++;
    if (f.bounced) a.bounced++;
    if (f.scroll50) a.scroll50++;
    if (f.time30) a.time30++;
  }
  a.phone += f.phone;
  if (f.start) a.start++;
  if (f.sent) a.sent++;
  if (f.aband.length) {
    a.aband++;
    for (const field of f.aband) a.fields.set(field, (a.fields.get(field) ?? 0) + 1);
  }
}

const s = (v: unknown) => (typeof v === "string" ? v : "");

// Wszystkie wizyty (wejscie bez prev) z fakty wyświetlenia i kluczami.
function visitsWithFacts(rows: TrafficRow[]) {
  const byPv = new Map<string, TrafficRow[]>();
  for (const r of rows) {
    const l = byPv.get(r.pv);
    if (l) l.push(r);
    else byPv.set(r.pv, [r]);
  }
  const out: { row: TrafficRow; f: PvFacts }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!isVisit(r) || seen.has(r.pv)) continue;
    seen.add(r.pv);
    out.push({ row: r, f: factsOf(byPv.get(r.pv) ?? []) });
  }
  return out;
}

export function adsMetricsByKey(rows: TrafficRow[]): Map<string, AdMetrics> {
  const accs = new Map<string, Acc>();
  const bump = (key: string, f: PvFacts) => {
    let a = accs.get(key);
    if (!a) {
      a = newAcc();
      accs.set(key, a);
    }
    add(a, f);
  };
  for (const { row, f } of visitsWithFacts(rows)) {
    const d = row.data ?? {};
    bump(chKey(row.channel), f);
    if (row.channel !== TCH.GOOGLE_ADS && row.channel !== TCH.META) continue;
    const camp = s(d.campaignKey);
    if (!camp) continue;
    const group = s(d.group);
    const term = s(d.term);
    bump(campKey(row.channel, camp), f);
    bump(grpKey(row.channel, camp, group), f);
    bump(kwKey(row.channel, camp, group, term), f);
    if (row.channel === TCH.GOOGLE_ADS && term) bump(kwcKey(camp, term), f);
  }
  return new Map([...accs].map(([k, a]) => [k, metricsOf(a)]));
}

export type AdsTreeOptions = { groupNames?: Map<string, { name: string; campaignKey: string }>; campaign?: string | null };

export type AdsTree = {
  google_ads: { kampania: string; klucz: string; metryki: AdMetrics; grupy: { grupa_id: string; grupa: string; metryki: AdMetrics; frazy: { fraza: string; metryki: AdMetrics }[] }[] }[];
  meta: { kampania: string; klucz: string; metryki: AdMetrics; zestawy: { zestaw: string; metryki: AdMetrics; reklamy: { reklama: string; metryki: AdMetrics }[] }[] }[];
};

// Drzewo reklam: Google Ads kampania → grupa → fraza; Meta kampania → zestaw → reklama (z nazwami oryginalnymi).
export function adsTree(rows: TrafficRow[], opts: AdsTreeOptions = {}): AdsTree {
  const m = adsMetricsByKey(rows);
  const want = opts.campaign ? opts.campaign.trim().toLowerCase() : "";
  const names = opts.groupNames ?? new Map();
  const campaigns = new Map<string, { channel: string; key: string; label: string; groups: Map<string, { key: string; label: string; terms: Map<string, string> }> }>();
  for (const { row } of visitsWithFacts(rows)) {
    if (row.channel !== TCH.GOOGLE_ADS && row.channel !== TCH.META) continue;
    const d = row.data ?? {};
    const camp = s(d.campaignKey);
    if (!camp) continue;
    const label = s(d.campaign) || camp;
    if (want && !camp.includes(want) && !label.toLowerCase().includes(want)) continue;
    const ck = `${row.channel}${SEP}${camp}`;
    const c = campaigns.get(ck) ?? { channel: row.channel, key: camp, label, groups: new Map() };
    campaigns.set(ck, c);
    const gk = s(d.group);
    const g = c.groups.get(gk) ?? { key: gk, label: row.channel === TCH.META ? s(d.groupLabel) || gk : (names.get(gk)?.name ?? (gk ? `grupa ${gk}` : "(bez grupy)")), terms: new Map() };
    c.groups.set(gk, g);
    const tk = s(d.term);
    if (!g.terms.has(tk)) g.terms.set(tk, row.channel === TCH.META ? s(d.termLabel) || tk || "(bez reklamy)" : tk || "(bez frazy)");
  }
  const out: AdsTree = { google_ads: [], meta: [] };
  for (const c of campaigns.values()) {
    const metrics = m.get(campKey(c.channel, c.key)) ?? emptyMetrics();
    if (c.channel === TCH.GOOGLE_ADS) {
      out.google_ads.push({
        kampania: c.label,
        klucz: c.key,
        metryki: metrics,
        grupy: [...c.groups.values()]
          .map((g) => ({
            grupa_id: g.key,
            grupa: g.label,
            metryki: m.get(grpKey(c.channel, c.key, g.key)) ?? emptyMetrics(),
            frazy: [...g.terms.entries()].map(([t, label]) => ({ fraza: label, metryki: m.get(kwKey(c.channel, c.key, g.key, t)) ?? emptyMetrics() })).sort((a, b) => b.metryki.wejscia - a.metryki.wejscia),
          }))
          .sort((a, b) => b.metryki.wejscia - a.metryki.wejscia),
      });
    } else {
      out.meta.push({
        kampania: c.label,
        klucz: c.key,
        metryki: metrics,
        zestawy: [...c.groups.values()]
          .map((g) => ({
            zestaw: g.label,
            metryki: m.get(grpKey(c.channel, c.key, g.key)) ?? emptyMetrics(),
            reklamy: [...g.terms.entries()].map(([t, label]) => ({ reklama: label, metryki: m.get(kwKey(c.channel, c.key, g.key, t)) ?? emptyMetrics() })).sort((a, b) => b.metryki.wejscia - a.metryki.wejscia),
          }))
          .sort((a, b) => b.metryki.wejscia - a.metryki.wejscia),
      });
    }
  }
  out.google_ads.sort((a, b) => b.metryki.wejscia - a.metryki.wejscia);
  out.meta.sort((a, b) => b.metryki.wejscia - a.metryki.wejscia);
  return out;
}

// Ponowna klasyfikacja zdarzeń z surowych pól „wejscie” (src, prev, utm, g, m): kanał wyświetlenia i klucze
// kampanii / grupy / frazy zawsze według aktualnych reguł (także dla zdarzeń zapisanych wcześniej).
export function reclassify(rows: TrafficRow[]): TrafficRow[] {
  const info = new Map<string, ReturnType<typeof classifyChannel>>();
  for (const r of rows) {
    if (r.type === "wejscie" && !info.has(r.pv)) info.set(r.pv, classifyChannel((r.data ?? {}) as Parameters<typeof classifyChannel>[0]));
  }
  return rows.map((r) => {
    const i = info.get(r.pv);
    if (!i) return r;
    const data = r.type === "wejscie" ? { ...(r.data ?? {}), channel: i.channel, campaignKey: i.campaignKey, campaign: i.campaign, group: i.group, term: i.term, groupLabel: i.groupLabel ?? null, termLabel: i.termLabel ?? null } : r.data;
    return { ...r, channel: i.channel, data };
  });
}

// Klucz metryk licznika dla węzła raportu kampanii (ckeys: kanał, kampania, grupa / zestaw, fraza / reklama).
// „(bez grupy)” / „(bez słowa)” to w liczniku pusty klucz.
export function nodeTrafficKey(ckeys: string[]): string | null {
  const blank = (k: string | undefined) => (!k || /^\(bez /.test(k) ? "" : k);
  if (ckeys.length === 1) return chKey(ckeys[0]);
  if (ckeys.length === 2) return campKey(ckeys[0], ckeys[1]);
  if (ckeys.length === 3) return grpKey(ckeys[0], ckeys[1], blank(ckeys[2]));
  if (ckeys.length === 4) return kwKey(ckeys[0], ckeys[1], blank(ckeys[2]), blank(ckeys[3]));
  return null;
}

export type TrafficMetricsDto = { hasData: boolean; byKey: Record<string, AdMetrics> };
export function metricsDto(rows: TrafficRow[]): TrafficMetricsDto {
  const m = adsMetricsByKey(rows);
  return { hasData: m.size > 0, byKey: Object.fromEntries(m) };
}
