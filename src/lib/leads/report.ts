// Sygnały → Raport (lejek, wzór lejek-wzor.html s5): lejek „kiedykolwiek
// osiągnął etap”, czas do 1. kontaktu w koszykach, powody przegranych,
// źródła i wskaźniki. Czyste funkcje (vitest bez "@/").
import { FIRST_CONTACT_SLA_HOURS, FUNNEL_FROM, REACH_ORDER, medianFirstContactHours } from "./funnel";
import { workHoursBetween } from "./work-time";
import type { LeadStageKey, LeadTypeKey } from "./parse-deal";

export type ReportRange = "30" | "90" | "2026";
export type ReportSource = "all" | "www" | "phone" | "email";

export const SOURCE_TYPES: Record<Exclude<ReportSource, "all">, LeadTypeKey[]> = {
  www: ["POBRANIE_CENNIKA", "KONTAKT", "REZERWACJA_WWW", "SZKOLENIE_WWW"],
  phone: ["TELEFON"],
  email: ["EMAIL"],
};

export type ReportLead = {
  type: LeadTypeKey;
  stage: LeadStageKey;
  maxStage: LeadStageKey;
  createdAt: Date;
  firstContactAt: Date | null;
  lastContactAt: Date | null;
  stageChangedAt: Date;
  lostReason: string | null;
  rentalId: string | null;
};

export function inRange<T extends ReportLead>(leads: T[], range: ReportRange, source: ReportSource, now: Date): T[] {
  const from = range === "2026" ? FUNNEL_FROM : new Date(now.getTime() - Number(range) * 86_400_000);
  return leads.filter((l) => l.createdAt >= from && (source === "all" || SOURCE_TYPES[source].includes(l.type)));
}

export type FunnelStep = { key: string; label: string; count: number; pctOfPrev: number | null };

// Sygnał → Kontakt → Wywiad → Oferta → Rezerwacja → Wygrana; „Kontakt” = był
// pierwszy kontakt (albo sygnał doszedł dalej niż Sygnał).
export function funnelSteps(leads: ReportLead[]): FunnelStep[] {
  const reach = (s: LeadStageKey) => leads.filter((l) => REACH_ORDER.indexOf(l.maxStage) >= REACH_ORDER.indexOf(s)).length;
  const contact = leads.filter((l) => l.firstContactAt || REACH_ORDER.indexOf(l.maxStage) >= 1).length;
  const won = leads.filter((l) => l.stage === "WYGRANA" && l.rentalId).length;
  const raw = [
    { key: "SYGNAL", label: "Sygnał", count: leads.length },
    { key: "KONTAKT", label: "Kontakt", count: contact },
    { key: "WYWIAD", label: "Wywiad", count: reach("WYWIAD") },
    { key: "OFERTA", label: "Oferta", count: reach("OFERTA") },
    { key: "REZERWACJA", label: "Rezerwacja", count: reach("REZERWACJA") },
    { key: "WYGRANA", label: "Wygrana", count: won },
  ];
  return raw.map((s, i) => ({ ...s, pctOfPrev: i === 0 ? null : raw[i - 1].count ? Math.round((s.count / raw[i - 1].count) * 100) : null }));
}

export type Bucket = { key: string; label: string; count: number; tone: "ok" | "warn" | "base" };

// Czas do 1. kontaktu: ≤ 4 h rob. (cel), tego samego dnia, 1–3 dni, > 3 dni,
// wciąż bez kontaktu (tylko otwarte — przegrane bez kontaktu nie czekają).
export function firstContactBuckets(leads: ReportLead[]): Bucket[] {
  const b = { sla: 0, sameDay: 0, upTo3: 0, over3: 0, waiting: 0 };
  for (const l of leads) {
    if (!l.firstContactAt) {
      if (["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA"].includes(l.stage)) b.waiting++;
      continue;
    }
    const h = workHoursBetween(l.createdAt, l.firstContactAt);
    const days = (l.firstContactAt.getTime() - l.createdAt.getTime()) / 86_400_000;
    if (h <= FIRST_CONTACT_SLA_HOURS) b.sla++;
    else if (l.firstContactAt.toDateString() === l.createdAt.toDateString()) b.sameDay++;
    else if (days <= 3) b.upTo3++;
    else b.over3++;
  }
  return [
    { key: "sla", label: `≤ ${FIRST_CONTACT_SLA_HOURS} h rob. (cel)`, count: b.sla, tone: "ok" },
    { key: "sameDay", label: "tego samego dnia", count: b.sameDay, tone: "base" },
    { key: "upTo3", label: "1–3 dni", count: b.upTo3, tone: "base" },
    { key: "over3", label: "> 3 dni", count: b.over3, tone: "warn" },
    { key: "waiting", label: "wciąż bez kontaktu", count: b.waiting, tone: "warn" },
  ];
}

export function countBy<T>(items: T[], key: (x: T) => string): { key: string; count: number }[] {
  const m = new Map<string, number>();
  for (const x of items) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
}

export function reportKpis(leads: ReportLead[], now: Date) {
  const open = (l: ReportLead) => ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA"].includes(l.stage);
  const noContact = leads.filter((l) => open(l) && !l.firstContactAt).length;
  const won = leads.filter((l) => l.stage === "WYGRANA" && l.rentalId).length;
  const offers = leads.filter((l) => l.stage === "OFERTA");
  const stale = offers.filter((l) => {
    const lastTouch = Math.max(l.stageChangedAt.getTime(), l.lastContactAt?.getTime() ?? 0);
    return now.getTime() - lastTouch > 7 * 86_400_000;
  }).length;
  return {
    total: leads.length,
    noContact,
    noContactPct: leads.length ? Math.round((noContact / leads.length) * 100) : null,
    medianFirstContact: medianFirstContactHours(leads, now),
    won,
    wonPct: leads.length ? Math.round((won / leads.length) * 100) : null,
    staleOffers: stale,
    offers: offers.length,
  };
}
