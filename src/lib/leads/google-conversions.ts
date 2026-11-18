// Wniosek 54, etap 1: konwersje offline z panelu do Google Ads. Panel wysyła
// prawdziwe etapy sprzedaży (rozmowa, oferta, rezerwacja, wynajem), Google
// przypisuje je do kliknięcia po identyfikatorze (gclid / gbraid / wbraid).
// Czysty moduł (vitest bez „@/”): wybór identyfikatora, zgody, czas wejścia w
// etap, kwalifikacja sygnału i plik CSV do ręcznego wgrania.
import { REACH_ORDER, maxStageReached } from "./funnel";
import { STAGE_HISTORY_LABELS } from "./labels";
import type { LeadStageKey } from "./parse-deal";

export type Attr = Record<string, string | string[]>;

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();

// ------------------------------------------------------------- identyfikatory

export type ClickKind = "gclid" | "gbraid" | "wbraid";
export type ClickId = { kind: ClickKind; value: string };

// Kolejność: najpierw ostatnie wejście (bliższe kliknięcie), potem pierwsze;
// w obrębie wejścia gclid → gbraid → wbraid. Wiersz importu ma jeden identyfikator.
export function pickClickId(attr: Attr | null): ClickId | null {
  if (!attr) return null;
  for (const prefix of ["last_", ""]) {
    for (const kind of ["gclid", "gbraid", "wbraid"] as const) {
      const value = one(attr[`${prefix}${kind}`]);
      if (value) return { kind, value };
    }
  }
  return null;
}

// Identyfikatory z adresu strony wejścia (landing_url). Odporne na brak
// schematu i na krzywe adresy — zwraca tylko to, co jest w query stringu.
export function clickIdsFromUrl(url: string | null | undefined): Partial<Record<ClickKind, string>> {
  const out: Partial<Record<ClickKind, string>> = {};
  const raw = (url ?? "").trim();
  if (!raw) return out;
  const q = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1).split("#")[0] : "";
  if (!q) return out;
  for (const [k, v] of new URLSearchParams(q)) {
    if ((k === "gclid" || k === "gbraid" || k === "wbraid") && v.trim() && !out[k]) out[k] = v.trim().slice(0, 500);
  }
  return out;
}

// Jednorazowe uzupełnienie starych sygnałów: gbraid / wbraid z landing_url, gdy
// nie ma ich w attribution (nie nadpisuje, nie rusza gclid). null = nic do dopisania.
export function backfillFromLandingUrl(attr: Attr | null): Attr | null {
  if (!attr) return null;
  const found = clickIdsFromUrl(one(attr.landing_url));
  const add: Attr = {};
  for (const kind of ["gbraid", "wbraid"] as const) {
    if (found[kind] && !one(attr[kind])) add[kind] = found[kind]!;
  }
  return Object.keys(add).length ? { ...attr, ...add } : null;
}

// Ile sygnałów ma jaki identyfikator (zapisany albo tylko w adresie wejścia).
export type ClickIdStats = { total: number; withGclid: number; noGclidWithBraid: number; none: number; braidOnlyInUrl: number };

export function clickIdStats(rows: { attribution: Attr | null }[]): ClickIdStats {
  const st: ClickIdStats = { total: rows.length, withGclid: 0, noGclidWithBraid: 0, none: 0, braidOnlyInUrl: 0 };
  for (const r of rows) {
    const a = r.attribution ?? {};
    const url = clickIdsFromUrl(one(a.landing_url));
    const hasG = Boolean(one(a.gclid) || one(a.last_gclid));
    const braidSaved = Boolean(one(a.gbraid) || one(a.wbraid) || one(a.last_gbraid) || one(a.last_wbraid));
    const braidUrl = Boolean(url.gbraid || url.wbraid);
    if (hasG) st.withGclid++;
    else if (braidSaved || braidUrl) st.noGclidWithBraid++;
    else st.none++;
    if (backfillFromLandingUrl(r.attribution)) st.braidOnlyInUrl++;
  }
  return st;
}

// ---------------------------------------------------------------------- zgody

export type ConsentState = "tak" | "nie" | "brak danych";

export function consentState(attr: Attr | null, key: "wl_consent_marketing" | "wl_consent_statistics"): ConsentState {
  const v = one(attr?.[key]);
  return v === "1" ? "tak" : v === "0" ? "nie" : "brak danych";
}

// ---------------------------------------------------------------- konwersje

export type ConversionKey = "rozmowa" | "oferta" | "rezerwacja" | "wynajem";
export type ConversionDef = { key: ConversionKey; stage: LeadStageKey; name: string; fixedValue: number | null };

// Nazwy muszą być identyczne z działaniami konwersji w Google Ads.
export const CONVERSIONS: ConversionDef[] = [
  { key: "rozmowa", stage: "WYWIAD", name: "Panel – rozmowa kwalifikowana", fixedValue: 100 },
  { key: "oferta", stage: "OFERTA", name: "Panel – oferta wysłana", fixedValue: 150 },
  { key: "rezerwacja", stage: "REZERWACJA", name: "Panel – rezerwacja", fixedValue: null },
  { key: "wynajem", stage: "WYGRANA", name: "Panel – wynajem zrealizowany", fixedValue: null },
];

export const orderIdFor = (leadId: string, key: ConversionKey): string => `${leadId}-${key}`;

export type StageActivity = { type: string; body: string | null; createdAt: Date };

// Który etap odnotowuje wpis historii (null = żaden). „A → B” = B; wpisy
// synchronizacji z kalendarzem (Rezerwacja w kalendarzu / Powiązano z rezerwacją)
// = Rezerwacja; „Wygrana powiązana z wynajmem” = Wygrana.
export function stageOfActivity(body: string | null): LeadStageKey | null {
  const b = (body ?? "").trim();
  if (!b) return null;
  if (b.startsWith("Rezerwacja w kalendarzu") || b.startsWith("Powiązano z rezerwacją")) return "REZERWACJA";
  if (b.startsWith("Wygrana powiązana")) return "WYGRANA";
  const to = b.match(/→\s*([^·—]+)/)?.[1]?.trim();
  if (!to) return null;
  for (const key of Object.keys(STAGE_HISTORY_LABELS) as LeadStageKey[]) {
    if (STAGE_HISTORY_LABELS[key].some((l) => to.startsWith(l))) return key;
  }
  return null;
}

export type LeadForConversions = {
  id: string;
  createdAt: Date;
  stage: LeadStageKey;
  stageChangedAt: Date;
  archivedAt: Date | null;
  contactEmail: string | null;
  firstContactAt: Date | null;
  attribution: Attr | null;
  rentalId: string | null;
  rentalCreatedAt: Date | null;
  rentalNet: number | null; // RentalFinance.totalNet
  activities: StageActivity[];
};

// Moment wejścia w etap = pierwszy wpis historii o tym etapie. Etap pominięty
// w historii (skok Nowe → Oferta) dostaje czas najbliższego wyższego etapu;
// brak wpisów: bieżący etap = stageChangedAt, Rezerwacja z wynajmem = utworzenie wynajmu.
export function stageTimes(lead: LeadForConversions): Partial<Record<LeadStageKey, Date>> {
  const first: Partial<Record<LeadStageKey, Date>> = {};
  const acts = lead.activities.filter((a) => a.type === "STAGE_CHANGE").sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const a of acts) {
    const st = stageOfActivity(a.body);
    if (st && !first[st]) first[st] = a.createdAt;
  }
  if (lead.rentalId && !first.REZERWACJA && lead.rentalCreatedAt) first.REZERWACJA = lead.rentalCreatedAt;
  if (REACH_ORDER.includes(lead.stage) && !first[lead.stage]) first[lead.stage] = lead.stageChangedAt;
  // Etap pominięty → czas następnego osiągniętego.
  for (let i = REACH_ORDER.length - 2; i >= 0; i--) {
    const st = REACH_ORDER[i];
    const next = first[REACH_ORDER[i + 1]];
    if (!first[st] && next) first[st] = next;
  }
  return first;
}

export type Candidate = {
  leadId: string;
  def: ConversionDef;
  orderId: string;
  at: Date;
  value: number | null;
  click: ClickId;
};

export type SkipReason = "archiwum" | "test" | "brak_identyfikatora" | "brak_zgody" | "stary_identyfikator";

export const SKIP_LABEL: Record<SkipReason, string> = {
  archiwum: "zarchiwizowany",
  test: "sygnał testowy",
  brak_identyfikatora: "brak identyfikatora kliknięcia",
  brak_zgody: "brak zgody marketingowej (nie / brak danych)",
  stary_identyfikator: "identyfikator starszy niż 90 dni",
};

export const CLICK_MAX_AGE_DAYS = 90;
const DAY = 86_400_000;

export function isTestLead(email: string | null): boolean {
  return /(^|[^a-z])test\+|\+test/i.test(email ?? "");
}

// Czy sygnał w ogóle może wysłać konwersje do Google (jeden powód odrzucenia).
export function eligibility(lead: LeadForConversions, now: Date): { click: ClickId } | { skip: SkipReason } {
  if (lead.archivedAt) return { skip: "archiwum" };
  if (isTestLead(lead.contactEmail)) return { skip: "test" };
  const click = pickClickId(lead.attribution);
  if (!click) return { skip: "brak_identyfikatora" };
  if (consentState(lead.attribution, "wl_consent_marketing") !== "tak") return { skip: "brak_zgody" };
  // Kliknięcie nie jest nowsze niż utworzenie sygnału — starszy sygnał = starszy identyfikator.
  if (now.getTime() - lead.createdAt.getTime() > CLICK_MAX_AGE_DAYS * DAY) return { skip: "stary_identyfikator" };
  return { click };
}

// Etapy, które sygnał osiągnął, jako konwersje (każdy najwyżej raz). Rozmowa
// kwalifikowana = osiągnięty etap W kontakcie z odbytą rozmową (talked: był wpis
// rozmowy albo maila — jak w tablicy sygnałów).
export function conversionsFor(lead: LeadForConversions, click: ClickId): Candidate[] {
  const talked = lead.firstContactAt != null || lead.activities.some((a) => a.type === "CALL" || a.type === "EMAIL");
  const bodies = lead.activities.filter((a) => a.type === "STAGE_CHANGE").map((a) => a.body);
  const max = maxStageReached(lead.stage, bodies, STAGE_HISTORY_LABELS, Boolean(lead.rentalId), talked);
  const reached = REACH_ORDER.indexOf(max);
  const times = stageTimes(lead);
  const out: Candidate[] = [];
  for (const def of CONVERSIONS) {
    if (REACH_ORDER.indexOf(def.stage) > reached) continue;
    if (def.key === "rozmowa" && !talked) continue;
    const raw = times[def.stage] ?? lead.stageChangedAt;
    // Konwersja nie może poprzedzać kliknięcia (przybliżenie: utworzenia sygnału).
    const at = raw.getTime() < lead.createdAt.getTime() ? lead.createdAt : raw;
    const value = def.fixedValue ?? (lead.rentalNet != null && Number.isFinite(lead.rentalNet) ? lead.rentalNet : null);
    out.push({ leadId: lead.id, def, orderId: orderIdFor(lead.id, def.key), at, value, click });
  }
  return out;
}

// ------------------------------------------------------------------------ CSV

export const CSV_TIME_ZONE = "Europe/Warsaw";

// „2026-11-18 14:05:00” w strefie Europe/Warsaw (strefę deklaruje wiersz Parameters).
export function csvTime(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CSV_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "00";
  return `${p("year")}-${p("month")}-${p("day")} ${p("hour")}:${p("minute")}:${p("second")}`;
}

const csvCell = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export const CSV_HEADER = ["Google Click ID", "GBRAID", "WBRAID", "Conversion Name", "Conversion Time", "Conversion Value", "Conversion Currency", "Order ID", "Ad User Data"];

// Plik do ręcznego importu w Google Ads (Cele → Konwersje → Wgrywanie). Tylko
// kandydaci ze zgodą marketingową, więc Ad User Data = GRANTED. Bez e-maila i telefonu.
export function buildCsv(rows: Candidate[]): string {
  const lines = [`Parameters:TimeZone=${CSV_TIME_ZONE}`, CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.click.kind === "gclid" ? r.click.value : "",
        r.click.kind === "gbraid" ? r.click.value : "",
        r.click.kind === "wbraid" ? r.click.value : "",
        r.def.name,
        csvTime(r.at),
        r.value == null ? "" : r.value.toFixed(2),
        "PLN",
        r.orderId,
        "GRANTED",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
