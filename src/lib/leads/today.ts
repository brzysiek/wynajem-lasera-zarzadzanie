// Widok „Na dziś” i podsumowanie 30 dni nad Sygnałami (prompt 2, 3.2 i 3.6).
// Czyste funkcje bez zależności (vitest bez aliasu "@/").
import { workHoursBetween } from "./work-time";
import type { LeadStageKey } from "./parse-deal";

export type TodayLead = {
  id: string;
  stage: LeadStageKey;
  createdAt: Date;
  firstContactAt: Date | null;
  nextActionAt: Date | null;
  rentalStartsAt: Date | null;
};

// Sygnał bez kontaktu starszy niż tyle dni nie jest już „nowy” — to
// zaległość z HubSpota (dziesiątki pobrań cennika sprzed miesięcy), którą
// trzeba przejrzeć i zamknąć, a nie alarm na czerwono.
export const FRESH_DAYS = 14;
export const RESERVATION_CONFIRM_DAYS = 3;

const DAY_MS = 86_400_000;
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const OPEN: LeadStageKey[] = ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA"];

export function buildToday<T extends TodayLead>(leads: T[], now: Date) {
  const freshFrom = new Date(now.getTime() - FRESH_DAYS * DAY_MS);
  const waiting = leads.filter((l) => l.stage === "SYGNAL" && !l.firstContactAt);
  const fresh = waiting.filter((l) => l.createdAt >= freshFrom).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const stale = waiting.filter((l) => l.createdAt < freshFrom).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const freshIds = new Set(waiting.map((l) => l.id));
  const followUps = leads
    .filter((l) => OPEN.includes(l.stage) && !freshIds.has(l.id) && l.nextActionAt && l.nextActionAt <= endOfDay(now))
    .sort((a, b) => a.nextActionAt!.getTime() - b.nextActionAt!.getTime());
  const confirmUntil = endOfDay(new Date(now.getTime() + RESERVATION_CONFIRM_DAYS * DAY_MS));
  const reservations = leads
    .filter((l) => l.stage === "REZERWACJA" && l.rentalStartsAt && l.rentalStartsAt >= startOfDay(now) && l.rentalStartsAt <= confirmUntil)
    .sort((a, b) => a.rentalStartsAt!.getTime() - b.rentalStartsAt!.getTime());
  return { fresh, followUps, reservations, stale };
}

export type StatsLead = {
  createdAt: Date;
  firstContactAt: Date | null;
  stage: LeadStageKey;
  stageChangedAt: Date;
  lostReason: string | null;
  hasRental: boolean;
};

export type LeadStats = {
  newCount: number;
  medianFirstContactHours: number | null; // godziny robocze
  reservationRate: number | null; // 0–1
  topLostReason: string | null;
  topLostCount: number;
};

// Ostatnie 30 dni: nowe sygnały, mediana czasu do pierwszego kontaktu,
// odsetek, który doszedł do rezerwacji, najczęstszy powód przegranej.
export function leadStats(leads: StatsLead[], now: Date, days = 30): LeadStats {
  const from = new Date(now.getTime() - days * DAY_MS);
  const recent = leads.filter((l) => l.createdAt >= from);

  const times = recent
    .filter((l) => l.firstContactAt)
    .map((l) => workHoursBetween(l.createdAt, l.firstContactAt!))
    .sort((a, b) => a - b);
  const median = times.length
    ? times.length % 2
      ? times[(times.length - 1) / 2]
      : (times[times.length / 2 - 1] + times[times.length / 2]) / 2
    : null;

  const reached = recent.filter((l) => l.hasRental || l.stage === "REZERWACJA" || l.stage === "WYGRANA").length;

  const reasons = new Map<string, number>();
  for (const l of leads) {
    if (l.stage === "PRZEGRANA" && l.lostReason && l.stageChangedAt >= from) reasons.set(l.lostReason, (reasons.get(l.lostReason) ?? 0) + 1);
  }
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    newCount: recent.length,
    medianFirstContactHours: median == null ? null : Math.round(median * 10) / 10,
    reservationRate: recent.length ? reached / recent.length : null,
    topLostReason: top?.[0] ?? null,
    topLostCount: top?.[1] ?? 0,
  };
}
