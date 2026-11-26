// Wniosek 54, etap 2: raporty z licznika ruchu. Czysty moduł (vitest bez „@/”).
// Wejście: surowe zdarzenia okresu. Wyniki: kafelki, kanały (z podziałem na urządzenia),
// zgody, strony, przejścia, lejek formularzy, kliknięcia (+ punkty mapy) i dane do porównania
// z leadami. „Wejście” = początek wizyty (wejscie bez prev, nie z własnej witryny); każde
// wyświetlenie strony = wejscie (odsłona). Wizyt nie łączymy między stronami (brak
// identyfikatora wizyty — to etap 3, tylko za zgodą), więc kanał formularza = kanał tej odsłony.
import { BAND_COUNT, MIN_VISITS, TCH } from "./ingest";

export type TrafficRow = { at: Date; pv: string; path: string; dev: string; type: string; channel: string; data: Record<string, unknown> | null };

const d = (r: TrafficRow) => r.data ?? {};
const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" ? v : 0);

export const isVisit = (r: TrafficRow): boolean => r.type === "wejscie" && r.channel !== TCH.INTERNAL && !s(d(r).prev);

export type DevCounts = { telefon: number; tablet: number; komputer: number; nieznane: number };
const emptyDev = (): DevCounts => ({ telefon: 0, tablet: 0, komputer: 0, nieznane: 0 });
const bumpDev = (c: DevCounts, dev: string) => {
  if (dev === "telefon" || dev === "tablet" || dev === "komputer") c[dev]++;
  else c.nieznane++;
};

const AD_CHANNELS: string[] = [TCH.GOOGLE_ADS, TCH.META];
const pct = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 100) : null);

// Rodzaj kliknięcia Google Ads (pole `gt` skryptu v3, od 24.11.2026): gclid / gbraid / wbraid, „inne” = połączenia
// (np. gclid+gbraid), „brak” = wejście bez pola gt (sprzed 24.11 albo skrypt nie rozpoznał rodzaju).
export const GT_KINDS = ["gclid", "gbraid", "wbraid", "inne", "brak"] as const;
export type GtKind = (typeof GT_KINDS)[number];
export function gtKindOf(gt: unknown): GtKind {
  if (typeof gt !== "string" || !gt) return "brak";
  return gt === "gclid" || gt === "gbraid" || gt === "wbraid" ? gt : "inne";
}
// Czy kliknięcie miało gbraid lub wbraid (także w połączeniu, np. gclid+gbraid).
export const gtHasBraid = (gt: unknown): boolean => typeof gt === "string" && /(^|\+)(gbraid|wbraid)(\+|$)/.test(gt);
export type GtCell = { visits: number; byDev: DevCounts; formStarts: number };
export type GtBreakdown = Record<GtKind, GtCell>;
export const emptyGt = (): GtBreakdown => Object.fromEntries(GT_KINDS.map((k) => [k, { visits: 0, byDev: emptyDev(), formStarts: 0 }])) as GtBreakdown;

// Porzucenie wielokrokowego formularza: przycisk kroku 1 (nazwa „[klasa] napis” od skryptu v3) albo pole kroku 2 (pole z name).
export const STEP1_BUTTON_CLASSES = ["lsr-tile", "button", "lsr-next"] as const;
export const MULTISTEP_FORMS = ["5878", "5795"];
export type AbandonStep = "krok1_przycisk" | "krok2_pola" | "inne_przyciski" | "nieznane";
export function abandonStep(field: string): AbandonStep {
  if (!field || field === "(nieznane pole)") return "nieznane";
  const m = /^\[([^\]]*)\]/.exec(field);
  if (!m) return "krok2_pola";
  return (STEP1_BUTTON_CLASSES as readonly string[]).includes(m[1].trim().toLowerCase()) ? "krok1_przycisk" : "inne_przyciski";
}
export type AbandonSteps = Record<AbandonStep, number>;

// Wniosek 63: formularz zapytania 6252 jest jednoekranowy — „etap” = ostatni element, którego dotknięto przed wyjściem
// (nazwy pól z `form_porzucony.pole` / `form_blad.pola`, od skryptu v3: pole z name albo „[klasa] napis”).
export const INQUIRY_FORM_ID = "6252";
export const INQUIRY_STAGES = ["urzadzenie", "kontakt", "miejscowosc", "kiedy", "data", "imie", "zgoda", "wyslij_bez_skutku", "inne", "nieznane", "otwarte_bez_dotkniecia"] as const;
export type InquiryStage = (typeof INQUIRY_STAGES)[number];
export type InquiryStages = Record<InquiryStage, number | null>;
export function inquiryStage(field: string): InquiryStage {
  if (!field || field === "(nieznane pole)") return "nieznane";
  const m = /^\[([^\]]*)\]\s*(.*)$/.exec(field);
  const cls = (m ? m[1] : "").trim().toLowerCase();
  const text = (m ? m[2] : field).trim().toLowerCase();
  if (cls === "zf-chg" || /^zq-dev/.test(text)) return "urzadzenie";
  if (cls === "zf-go") return "wyslij_bez_skutku";
  if (cls === "zf-datebtn" || cls === "zf-days" || /^contact-(date|days)/.test(text)) return "data";
  if (cls === "zf-kiedy" || /^(w tym miesiącu|w przyszłym|jeszcze nie wiem)/.test(text)) return "kiedy";
  if (/^wl-kontakt|^contact-(email|phone|tel)/.test(text)) return "kontakt";
  if (/^miejscowosc|^contact-(city|miejsc)/.test(text)) return "miejscowosc";
  if (/^contact-name/.test(text)) return "imie";
  if (/^acceptance/.test(text)) return "zgoda";
  return "inne";
}
export const emptyStages = (): InquiryStages => Object.fromEntries(INQUIRY_STAGES.map((k) => [k, k === "otwarte_bez_dotkniecia" ? null : 0])) as InquiryStages;

// Okno zapytania na stronie: stare 5878 + 5795 (do 25/26.11.2026) i nowe 6252 — liczone razem, bez podwójnego liczenia odsłon.
export const INQUIRY_WINDOW_OLD = ["5878", "5795"];
export const INQUIRY_WINDOW_NEW = [INQUIRY_FORM_ID];
export type FormFunnel = { views: number; opened: number | null; started: number; tried: number; sent: number };
export type InquiryWindow = {
  forms: { form: string; group: "stare" | "nowe"; from: string; to: string; started: number; tried: number; sent: number }[];
  stare: FormFunnel;
  nowe: FormFunnel;
  byPath: { path: string; stare: FormFunnel; nowe: FormFunnel }[];
};

export type TrafficReport = {
  from: string;
  to: string;
  hasData: boolean;
  tiles: { visits: number; fromAds: number; pageViews: number; bannerAcceptPct: number | null; bannerChoices: number; formStarted: number; formSent: number };
  channels: { channel: string; visits: number; byDev: DevCounts; formStarts: number }[];
  campaigns: { channel: string; key: string; label: string; visits: number; formStarts: number }[];
  // Google Ads wg rodzaju kliknięcia (gt): ogółem i wg kampanii.
  gt: { total: GtBreakdown; campaigns: { key: string; label: string; gt: GtBreakdown }[] };
  consents: {
    banner: { wszystkie: number; wlasny: number; odrzucam: number; shown: number };
    entries: { s1m1: number; s1m0: number; s0m0: number; brak: number };
  };
  pages: {
    path: string;
    views: number;
    landings: number;
    exits: number;
    avgScroll: number | null;
    time: Record<string, number>;
    bouncedPct: number | null;
    timeS: TimeStats; // czas aktywny w sekundach (skrypt v2)
    attention: { telefon: AttentionStats; komputer: AttentionStats }; // mapa uwagi: 10 pasów wysokości strony
  }[];
  transitions: { from: string; to: string; count: number }[];
  forms: {
    form: string;
    paths: string[];
    views: number;
    started: number;
    tried: number;
    sent: number;
    errors: { field: string; count: number }[];
    abandoned: { field: string; count: number; errorsAvg: number }[];
    abandonSteps: AbandonSteps | null; // tylko formularze wielokrokowe
    opened: number | null; // otwarcia okna (zdarzenie form_otwarty, wniosek 63); null = skrypt jeszcze ich nie wysyła
    abandonStages: InquiryStages | null; // tylko formularz zapytania 6252 (jednoekranowy)
    errorStages: InquiryStages | null;
    byPath: ({ path: string } & FormFunnel)[];
    byDev: ({ dev: string } & FormFunnel)[];
  }[];
  inquiryWindow: InquiryWindow | null;
  clicks: {
    top: { rodzaj: string; etyk: string; path: string; dev: string; count: number }[];
    phoneByPath: { path: string; count: number }[];
    points: { path: string; dev: string; x: number; y: number }[];
  };
};

// Czas aktywny z pola `sek`: tylko odsłony z pomiarem (zdarzenia sprzed skryptu v2 go nie mają → n = 0, nie zera).
export type TimeStats = { n: number; avg: number | null; median: number | null };
// Mapa uwagi: średnie sekundy na pas i odsetek odsłon, które w ogóle zobaczyły pas (> 0 s). n = odsłony z pomiarem.
export type AttentionStats = { n: number; avgSeconds: number[]; seenPct: (number | null)[]; fewData: boolean };

const round1 = (x: number) => Math.round(x * 10) / 10;
const median = (a: number[]): number => {
  const v = [...a].sort((x, y) => x - y);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
export const timeStats = (secs: number[]): TimeStats => ({ n: secs.length, avg: secs.length ? round1(secs.reduce((a, b) => a + b, 0) / secs.length) : null, median: secs.length ? round1(median(secs)) : null });
// Telefon i tablet razem (jak na mapie kliknięć), komputer osobno.
export const attentionGroup = (dev: string): "telefon" | "komputer" => (dev === "komputer" ? "komputer" : "telefon");
export function attentionStats(bands: number[][]): AttentionStats {
  const n = bands.length;
  return {
    n,
    avgSeconds: Array.from({ length: BAND_COUNT }, (_, i) => (n ? round1(bands.reduce((a, b) => a + b[i], 0) / n) : 0)),
    seenPct: Array.from({ length: BAND_COUNT }, (_, i) => pct(bands.filter((b) => b[i] > 0).length, n)),
    fewData: n < MIN_VISITS,
  };
}
const isBands = (v: unknown): v is number[] => Array.isArray(v) && v.length === BAND_COUNT && v.every((x) => typeof x === "number");

export type TrafficFilter = { path?: string | null };

export function buildTrafficReport(rows: TrafficRow[], range: { from: string; to: string }, f: TrafficFilter = {}): TrafficReport {
  const all = f.path ? rows.filter((r) => r.path === f.path) : rows;
  const visits = all.filter(isVisit);
  const views = all.filter((r) => r.type === "wejscie");

  // ---- kanały
  const ch = new Map<string, { visits: number; byDev: DevCounts; formStarts: number }>();
  const chOf = (name: string) => {
    let c = ch.get(name);
    if (!c) {
      c = { visits: 0, byDev: emptyDev(), formStarts: 0 };
      ch.set(name, c);
    }
    return c;
  };
  for (const v of visits) {
    const c = chOf(v.channel);
    c.visits++;
    bumpDev(c.byDev, v.dev);
  }
  const startPvs = new Set<string>();
  for (const r of all) if (r.type === "form_start" && !startPvs.has(r.pv)) {
    startPvs.add(r.pv);
    if (r.channel !== TCH.INTERNAL && r.channel !== TCH.UNKNOWN) chOf(r.channel).formStarts++;
  }

  // ---- kampanie (reklamy)
  const camp = new Map<string, { channel: string; key: string; label: string; visits: number; formStarts: number }>();
  const campOf = (channel: string, key: string, label: string) => {
    const k = `${channel}\u0001${key}`;
    let c = camp.get(k);
    if (!c) {
      c = { channel, key, label, visits: 0, formStarts: 0 };
      camp.set(k, c);
    }
    return c;
  };
  const entryByPv = new Map<string, TrafficRow>();
  for (const r of rows) if (r.type === "wejscie" && !entryByPv.has(r.pv)) entryByPv.set(r.pv, r);
  for (const v of visits) {
    if (!AD_CHANNELS.includes(v.channel)) continue;
    const key = s(d(v).campaignKey) || "(kampania nieznana)";
    campOf(v.channel, key, s(d(v).campaign) || key).visits++;
  }
  for (const pv of startPvs) {
    const e = entryByPv.get(pv);
    if (!e || !AD_CHANNELS.includes(e.channel) || !isVisit(e)) continue;
    const key = s(d(e).campaignKey) || "(kampania nieznana)";
    campOf(e.channel, key, s(d(e).campaign) || key).formStarts++;
  }

  // ---- Google Ads wg rodzaju kliknięcia (gt)
  const gtTotal = emptyGt();
  const gtCamp = new Map<string, { key: string; label: string; gt: GtBreakdown }>();
  const gtCampOf = (e: TrafficRow) => {
    const key = s(d(e).campaignKey) || "(kampania nieznana)";
    let c = gtCamp.get(key);
    if (!c) {
      c = { key, label: s(d(e).campaign) || key, gt: emptyGt() };
      gtCamp.set(key, c);
    }
    return c;
  };
  for (const v of visits) {
    if (v.channel !== TCH.GOOGLE_ADS) continue;
    const kind = gtKindOf(d(v).gt);
    for (const cell of [gtTotal[kind], gtCampOf(v).gt[kind]]) {
      cell.visits++;
      bumpDev(cell.byDev, v.dev);
    }
  }
  for (const pv of startPvs) {
    const e = entryByPv.get(pv);
    if (!e || e.channel !== TCH.GOOGLE_ADS || !isVisit(e)) continue;
    const kind = gtKindOf(d(e).gt);
    gtTotal[kind].formStarts++;
    gtCampOf(e).gt[kind].formStarts++;
  }

  // ---- zgody
  const banner = { wszystkie: 0, wlasny: 0, odrzucam: 0, shown: 0 };
  const entries = { s1m1: 0, s1m0: 0, s0m0: 0, brak: 0 };
  for (const r of all) {
    if (r.type === "baner_pokazany") banner.shown++;
    if (r.type === "baner_wybor") {
      const w = s(d(r).wybor);
      if (w === "wszystkie" || w === "wlasny" || w === "odrzucam") banner[w]++;
    }
  }
  for (const v of visits) {
    const z = s(d(v).zgoda);
    if (z === "s1m1" || z === "s1m0" || z === "s0m0") entries[z]++;
    else entries.brak++;
  }
  const choices = banner.wszystkie + banner.wlasny + banner.odrzucam;

  // ---- strony i przejścia
  const pg = new Map<string, { views: number; landings: number; exits: number; scroll: number[]; time: Record<string, number>; bounced: number; ends: number }>();
  const pgOf = (path: string) => {
    let p = pg.get(path);
    if (!p) {
      p = { views: 0, landings: 0, exits: 0, scroll: [], time: {}, bounced: 0, ends: 0 };
      pg.set(path, p);
    }
    return p;
  };
  const trans = new Map<string, number>();
  for (const v of views) {
    const p = pgOf(v.path);
    p.views++;
    if (isVisit(v)) p.landings++;
    const prev = s(d(v).prev);
    if (prev && prev !== v.path) trans.set(`${prev}\u0001${v.path}`, (trans.get(`${prev}\u0001${v.path}`) ?? 0) + 1);
  }
  for (const r of all) {
    if (r.type !== "koniec") continue;
    const p = pgOf(r.path);
    p.ends++;
    if (d(r).wyjscie === true) p.exits++;
    p.scroll.push(n(d(r).przew));
    const t = s(d(r).czas) || "<10s";
    p.time[t] = (p.time[t] ?? 0) + 1;
    if (t === "<10s" && n(d(r).przew) === 0) p.bounced++;
  }
  // Czas aktywny i pasy: z ostatniego „koniec” danej odsłony, które je ma (sumy rosną — nie zliczamy kilku).
  const secByPv = new Map<string, { path: string; sek: number }>();
  const bandsByPv = new Map<string, { path: string; dev: string; pasy: number[] }>();
  for (const r of all) {
    if (r.type !== "koniec") continue;
    if (typeof d(r).sek === "number") secByPv.set(r.pv, { path: r.path, sek: d(r).sek as number });
    if (isBands(d(r).pasy)) bandsByPv.set(r.pv, { path: r.path, dev: r.dev, pasy: d(r).pasy as number[] });
  }
  const secByPath = new Map<string, number[]>();
  for (const x of secByPv.values()) secByPath.set(x.path, [...(secByPath.get(x.path) ?? []), x.sek]);
  const bandsByPath = new Map<string, { telefon: number[][]; komputer: number[][] }>();
  for (const x of bandsByPv.values()) {
    const b = bandsByPath.get(x.path) ?? { telefon: [], komputer: [] };
    b[attentionGroup(x.dev)].push(x.pasy);
    bandsByPath.set(x.path, b);
  }
  const pages = [...pg.entries()]
    .map(([path, p]) => ({
      path,
      views: p.views,
      landings: p.landings,
      exits: p.exits,
      avgScroll: p.scroll.length ? Math.round(p.scroll.reduce((a, b) => a + b, 0) / p.scroll.length) : null,
      time: p.time,
      bouncedPct: pct(p.bounced, p.ends),
      timeS: timeStats(secByPath.get(path) ?? []),
      attention: { telefon: attentionStats(bandsByPath.get(path)?.telefon ?? []), komputer: attentionStats(bandsByPath.get(path)?.komputer ?? []) },
    }))
    .sort((a, b) => b.views - a.views);
  const transitions = [...trans.entries()]
    .map(([k, count]) => ({ from: k.split("\u0001")[0], to: k.split("\u0001")[1], count }))
    .sort((a, b) => b.count - a.count);

  // ---- formularze
  const fm = new Map<string, { paths: Set<string>; err: Map<string, number>; ab: Map<string, { count: number; errs: number }> }>();
  const fmOf = (id: string) => {
    let x = fm.get(id);
    if (!x) {
      x = { paths: new Set(), err: new Map(), ab: new Map() };
      fm.set(id, x);
    }
    return x;
  };
  const formRows: TrafficRow[] = [];
  for (const r of all) {
    const id = s(d(r).form);
    if (!id) continue;
    formRows.push(r);
    const x = fmOf(id);
    x.paths.add(r.path);
    if (r.type === "form_blad") for (const field of (Array.isArray(d(r).pola) ? (d(r).pola as unknown[]) : []).map(s).filter(Boolean)) x.err.set(field, (x.err.get(field) ?? 0) + 1);
    if (r.type === "form_porzucony") {
      const field = s(d(r).pole) || "(nieznane pole)";
      const a = x.ab.get(field) ?? { count: 0, errs: 0 };
      a.count++;
      a.errs += n(d(r).bledy);
      x.ab.set(field, a);
    }
  }
  const uniqPv = (rs: TrafficRow[], type: string) => new Set(rs.filter((r) => r.type === type).map((r) => r.pv));
  // Lejek z wierszy zdarzeń formularza (rs) i odsłon stron (viewRows); `openKnown` = skrypt wysyła form_otwarty.
  const funnel = (rs: TrafficRow[], viewRows: TrafficRow[], openKnown: boolean): FormFunnel => ({
    views: viewRows.length,
    opened: openKnown ? uniqPv(rs, "form_otwarty").size : null,
    started: uniqPv(rs, "form_start").size,
    tried: uniqPv(rs, "form_proba").size,
    sent: uniqPv(rs, "form_wyslany").size,
  });
  // Podział porzuceń na krok 1 (przyciski) i krok 2 (pola) — dla formularzy wielokrokowych (po id albo po nazwach „[klasa] napis”).
  const multistep = (form: string, ab: Map<string, { count: number; errs: number }>): AbandonSteps | null => {
    if (form.includes(INQUIRY_FORM_ID)) return null; // jednoekranowy — patrz abandonStages
    const isMulti = MULTISTEP_FORMS.some((id) => form.includes(id)) || [...ab.keys()].some((f) => f.startsWith("["));
    if (!isMulti) return null;
    const out: AbandonSteps = { krok1_przycisk: 0, krok2_pola: 0, inne_przyciski: 0, nieznane: 0 };
    for (const [field, a] of ab) out[abandonStep(field)] += a.count;
    return out;
  };
  const stagesOf = (m: Map<string, { count: number } | number>): InquiryStages => {
    const out = emptyStages();
    for (const [field, v] of m) out[inquiryStage(field)] = (out[inquiryStage(field)] ?? 0) + (typeof v === "number" ? v : v.count);
    return out;
  };
  const forms = [...fm.entries()]
    .map(([form, x]) => {
      const rs = formRows.filter((r) => s(d(r).form) === form);
      // Odsłony liczymy od pierwszego zdarzenia tego formularza — wcześniej okno mogło go jeszcze nie mieć (wniosek 63).
      const first = Math.min(...rs.map((r) => r.at.getTime()));
      const vr = views.filter((v) => x.paths.has(v.path) && v.at.getTime() >= first);
      const openKnown = rs.some((r) => r.type === "form_otwarty");
      const total = funnel(rs, vr, openKnown);
      const isInquiry = form.includes(INQUIRY_FORM_ID);
      let abandonStages: InquiryStages | null = null;
      let errorStages: InquiryStages | null = null;
      if (isInquiry) {
        abandonStages = stagesOf(x.ab);
        errorStages = stagesOf(x.err);
        errorStages.otwarte_bez_dotkniecia = null;
        // okno otwarte, ale bez żadnego dotyku (start liczony też po tapnięciu) i bez porzucenia
        const touched = new Set(rs.filter((r) => r.type === "form_start" || r.type === "form_porzucony").map((r) => r.pv));
        abandonStages.otwarte_bez_dotkniecia = openKnown ? [...uniqPv(rs, "form_otwarty")].filter((pv) => !touched.has(pv)).length : null;
      }
      return {
        form,
        paths: [...x.paths].sort(),
        views: total.views,
        started: total.started,
        tried: total.tried,
        sent: total.sent,
        errors: [...x.err.entries()].map(([field, count]) => ({ field, count })).sort((a, b) => b.count - a.count),
        abandoned: [...x.ab.entries()].map(([field, a]) => ({ field, count: a.count, errorsAvg: Math.round((a.errs / a.count) * 10) / 10 })).sort((a, b) => b.count - a.count),
        abandonSteps: multistep(form, x.ab),
        opened: total.opened,
        abandonStages,
        errorStages,
        byPath: [...x.paths].sort().map((path) => ({ path, ...funnel(rs.filter((r) => r.path === path), vr.filter((v) => v.path === path), openKnown) })).sort((a, b) => b.views - a.views),
        byDev: [...new Set(rs.map((r) => r.dev))].sort().map((dev) => ({ dev, ...funnel(rs.filter((r) => r.dev === dev), vr.filter((v) => v.dev === dev), openKnown) })),
      };
    })
    .sort((a, b) => b.started - a.started);

  // Okno zapytania (wniosek 63): stare 5878 + 5795 i nowe 6252 razem — odsłony liczone raz na stronę, bez podwójnego liczenia.
  const idIn = (form: string, ids: string[]) => ids.some((id) => form.includes(id));
  const day = (dt: Date) => dt.toLocaleDateString("sv-SE", { timeZone: "Europe/Warsaw" });
  const groupRows = (ids: string[]) => formRows.filter((r) => idIn(s(d(r).form), ids));
  const oldRows = groupRows(INQUIRY_WINDOW_OLD);
  const newRows = groupRows(INQUIRY_WINDOW_NEW);
  const inquiryWindow: InquiryWindow | null =
    oldRows.length + newRows.length === 0
      ? null
      : (() => {
          const openKnown = newRows.some((r) => r.type === "form_otwarty") || oldRows.some((r) => r.type === "form_otwarty");
          // Odsłony strony od pierwszego zdarzenia grupy; stare okno — tylko do pierwszego zdarzenia nowego (potem go nie było).
          const firstOf = (rs: TrafficRow[]) => (rs.length ? Math.min(...rs.map((r) => r.at.getTime())) : null);
          const oldFrom = firstOf(oldRows);
          const newFrom = firstOf(newRows);
          const of = (rs: TrafficRow[], from: number | null, to: number | null, path?: string) => {
            const sub = path ? rs.filter((r) => r.path === path) : rs;
            const paths = new Set(path ? (sub.length ? [path] : []) : rs.map((r) => r.path));
            const vr = views.filter((v) => paths.has(v.path) && from !== null && v.at.getTime() >= from && (to === null || v.at.getTime() < to));
            return funnel(sub, vr, openKnown);
          };
          const allPaths = [...new Set([...oldRows, ...newRows].map((r) => r.path))];
          return {
            forms: [...fm.keys()]
              .filter((f) => idIn(f, [...INQUIRY_WINDOW_OLD, ...INQUIRY_WINDOW_NEW]))
              .map((form) => {
                const rs = formRows.filter((r) => s(d(r).form) === form);
                const times = rs.map((r) => r.at.getTime());
                const f = funnel(rs, [], false);
                return { form, group: idIn(form, INQUIRY_WINDOW_NEW) ? ("nowe" as const) : ("stare" as const), from: day(new Date(Math.min(...times))), to: day(new Date(Math.max(...times))), started: f.started, tried: f.tried, sent: f.sent };
              })
              .sort((a, b) => a.from.localeCompare(b.from)),
            stare: of(oldRows, oldFrom, newFrom),
            nowe: of(newRows, newFrom, null),
            byPath: allPaths.map((path) => ({ path, stare: of(oldRows, oldFrom, newFrom, path), nowe: of(newRows, newFrom, null, path) })).sort((a, b) => b.stare.views + b.nowe.views - (a.stare.views + a.nowe.views)),
          };
        })();

  // ---- kliknięcia
  const top = new Map<string, { rodzaj: string; etyk: string; path: string; dev: string; count: number }>();
  const phone = new Map<string, number>();
  const points: { path: string; dev: string; x: number; y: number }[] = [];
  for (const r of all) {
    if (r.type !== "klik") continue;
    const rodzaj = s(d(r).rodzaj) || "inne";
    const etyk = s(d(r).etyk);
    const k = [rodzaj, etyk, r.path, r.dev].join("\u0001");
    const cur = top.get(k) ?? { rodzaj, etyk, path: r.path, dev: r.dev, count: 0 };
    cur.count++;
    top.set(k, cur);
    if (rodzaj === "telefon") phone.set(r.path, (phone.get(r.path) ?? 0) + 1);
    if (typeof d(r).x === "number" && typeof d(r).y === "number" && points.length < 3000) points.push({ path: r.path, dev: r.dev, x: n(d(r).x), y: n(d(r).y) });
  }

  const sent = new Set(all.filter((r) => r.type === "form_wyslany").map((r) => r.pv)).size;
  return {
    from: range.from,
    to: range.to,
    hasData: all.length > 0,
    tiles: {
      visits: visits.length,
      fromAds: visits.filter((v) => AD_CHANNELS.includes(v.channel)).length,
      pageViews: views.length,
      bannerAcceptPct: pct(banner.wszystkie, choices),
      bannerChoices: choices,
      formStarted: startPvs.size,
      formSent: sent,
    },
    channels: [...ch.entries()].map(([channel, c]) => ({ channel, ...c })).sort((a, b) => b.visits - a.visits),
    campaigns: [...camp.values()].sort((a, b) => b.visits - a.visits),
    gt: { total: gtTotal, campaigns: [...gtCamp.values()].sort((a, b) => GT_KINDS.reduce((n, k) => n + b.gt[k].visits, 0) - GT_KINDS.reduce((n, k) => n + a.gt[k].visits, 0)) },
    consents: { banner, entries },
    pages,
    transitions,
    forms,
    inquiryWindow,
    clicks: {
      top: [...top.values()].sort((a, b) => b.count - a.count).slice(0, 40),
      phoneByPath: [...phone.entries()].map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count),
      points,
    },
  };
}

// Wejścia i starty formularza wg kanału / kampanii / frazy — do kolumn w raporcie Kampanie i Słowa kluczowe.
export type TrafficJoin = {
  byChannel: Map<string, { visits: number; formStarts: number }>;
  byCampaign: Map<string, { visits: number; formStarts: number }>; // klucz: klucz kampanii
  byKeyword: Map<string, { visits: number; formStarts: number }>; // klucz: kampania \u0001 fraza
};

export function trafficJoin(rows: TrafficRow[]): TrafficJoin {
  const j: TrafficJoin = { byChannel: new Map(), byCampaign: new Map(), byKeyword: new Map() };
  const bump = (m: Map<string, { visits: number; formStarts: number }>, key: string, what: "visits" | "formStarts") => {
    const c = m.get(key) ?? { visits: 0, formStarts: 0 };
    c[what]++;
    m.set(key, c);
  };
  const entryByPv = new Map<string, TrafficRow>();
  for (const r of rows) if (r.type === "wejscie" && !entryByPv.has(r.pv)) entryByPv.set(r.pv, r);
  const apply = (e: TrafficRow, what: "visits" | "formStarts") => {
    bump(j.byChannel, e.channel, what);
    if (e.channel === TCH.GOOGLE_ADS) {
      const key = s(d(e).campaignKey);
      if (key) {
        bump(j.byCampaign, key, what);
        const term = s(d(e).term);
        if (term) bump(j.byKeyword, `${key}\u0001${term}`, what);
      }
    }
  };
  for (const r of rows) if (isVisit(r)) apply(r, "visits");
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.type !== "form_start" || seen.has(r.pv)) continue;
    seen.add(r.pv);
    const e = entryByPv.get(r.pv);
    if (e && isVisit(e)) apply(e, "formStarts"); // tylko gdy formularz jest na stronie wejścia (brak identyfikatora wizyty)
  }
  return j;
}

// Porównanie: wejścia z Google Ads wg kampanii a leady z tej kampanii oraz kliknięcia z importu kosztów
// (ad_cost_days) za te same dni — czy licznik widzi tyle wejść, ile Google liczy kliknięć.
export function compareAdsWithLeads(visitsByCampaign: Map<string, { visits: number; formStarts: number }>, leadsByCampaign: { key: string; label: string; leads: number }[], clicksByCampaign: Map<string, number> = new Map()) {
  const keys = new Set([...visitsByCampaign.keys(), ...leadsByCampaign.map((l) => l.key), ...clicksByCampaign.keys()]);
  return [...keys]
    .map((key) => {
      const v = visitsByCampaign.get(key) ?? { visits: 0, formStarts: 0 };
      const l = leadsByCampaign.find((x) => x.key === key);
      const clicks = clicksByCampaign.get(key) ?? 0;
      return {
        key,
        label: l?.label ?? key,
        visits: v.visits,
        formStarts: v.formStarts,
        leads: l?.leads ?? 0,
        leadsPer100Visits: v.visits > 0 ? Math.round(((l?.leads ?? 0) / v.visits) * 1000) / 10 : null,
        clicks,
        visitsPer100Clicks: clicks > 0 ? Math.round((v.visits / clicks) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => b.visits - a.visits || b.clicks - a.clicks);
}
