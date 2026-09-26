// „Do obdzwonienia” i reguły importu zaległych zapytań (prompt 2 v2, 1.0a i
// 2.3). Czyste funkcje bez zależności (vitest bez aliasu "@/").
import { HUBSPOT_FREEZER_STAGE, HUBSPOT_SIGNAL_STAGE, type LeadStageKey, type LeadTypeKey } from "./parse-deal";

// 01.01.2026 00:00 czasu warszawskiego.
export const CALL_LIST_FROM = new Date("2025-12-31T23:00:00.000Z");

export const ARCHIVE_NOTE = "Nieobsłużone zapytanie sprzed 2026 (import z HubSpota)";

// Transakcja „nieobsłużona”: etap Sygnał albo Zamrażalnik i brak śladu
// kontaktu — notatki / rozmowy w HubSpocie ani e-maila wychodzącego w Gmailu.
// Z 2026 (sprzed wdrożenia listy, `callListUntil`) → „Do obdzwonienia”;
// sprzed 2026 → przegrana „Archiwum (sprzed 2026)”. Nowe sygnały po
// wdrożeniu nigdy nie trafiają na listę — idą normalnie do „Na dziś”.
export function applyImportRules<T extends { stage: LeadStageKey; lostReason: string | null; lostNote: string | null }>(
  plan: T,
  input: { hsStage: string | null; createdAt: Date; handled: boolean; callListUntil: Date },
): T & { callList: boolean } {
  const untouchedStage = input.hsStage === HUBSPOT_SIGNAL_STAGE || input.hsStage === HUBSPOT_FREEZER_STAGE || !input.hsStage;
  if (!untouchedStage || input.handled) return { ...plan, callList: false };
  if (input.createdAt >= input.callListUntil) return { ...plan, callList: false };
  if (input.createdAt >= CALL_LIST_FROM) return { ...plan, stage: "SYGNAL", lostReason: null, lostNote: null, callList: true };
  return { ...plan, stage: "PRZEGRANA", lostReason: "ARCHIWUM_IMPORTU", lostNote: ARCHIVE_NOTE, callList: false };
}

// Kolejność obdzwaniania: najpierw zapytania o termin/rezerwację, potem
// kontakt, na końcu pobranie cennika; w grupie od najnowszych.
const TYPE_RANK: Record<LeadTypeKey, number> = {
  REZERWACJA_WWW: 0,
  SZKOLENIE_WWW: 0,
  KONTAKT: 1,
  TELEFON: 1,
  EMAIL: 1,
  INNE: 2,
  POBRANIE_CENNIKA: 3,
};

export function sortCallList<T extends { type: LeadTypeKey; createdAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type] || b.createdAt.localeCompare(a.createdAt));
}

// Na liście zostaje, dopóki nikt nie porozmawiał ani nie odpisał mailem i
// sygnał jest dalej w „Sygnale” (nieodebrane połączenia nie zdejmują z listy).
export function isCallListPending(l: { callList: boolean; stage: LeadStageKey; talked: boolean }): boolean {
  return l.callList && l.stage === "SYGNAL" && !l.talked;
}

export function callListProgress(rows: { callList: boolean; stage: LeadStageKey; talked: boolean; clientQualified: boolean }[]) {
  const cohort = rows.filter((r) => r.callList);
  const pending = cohort.filter(isCallListPending).length;
  return { total: cohort.length, done: cohort.length - pending, pending, qualified: cohort.filter((r) => r.clientQualified).length };
}

// Po tylu nieodebranych próbach karta proponuje „Przegrana — brak kontaktu”.
export const NO_ANSWER_LIMIT = 3;
