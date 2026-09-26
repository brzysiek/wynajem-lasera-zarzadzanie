// Etykiety PL modułu Sygnały — jedno źródło dla tablicy, listy, karty i CSV.
// Bez zależności (serwer i komponenty klienta).
import type { LeadStageKey, LeadTypeKey } from "./parse-deal";

export const STAGE_LABEL: Record<LeadStageKey, string> = {
  SYGNAL: "Sygnał",
  WYWIAD: "Wywiad",
  OFERTA: "Oferta wysłana",
  REZERWACJA: "Rezerwacja",
  WYGRANA: "Wygrana",
  PRZEGRANA: "Przegrana",
};
export const STAGE_KEYS = Object.keys(STAGE_LABEL) as LeadStageKey[];
export const BOARD_STAGES: LeadStageKey[] = ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA"];
export const OPEN_STAGES: LeadStageKey[] = BOARD_STAGES;

export const TYPE_LABEL: Record<LeadTypeKey, string> = {
  POBRANIE_CENNIKA: "Pobranie cennika",
  KONTAKT: "Formularz kontaktowy",
  REZERWACJA_WWW: "Rezerwacja WWW",
  SZKOLENIE_WWW: "Szkolenie WWW",
  TELEFON: "Telefon",
  EMAIL: "E-mail",
  INNE: "Inne",
};
export const TYPE_KEYS = Object.keys(TYPE_LABEL) as LeadTypeKey[];

export const LOST_REASON_LABEL = {
  CENA: "Cena",
  TERMIN_ZAJETY: "Termin zajęty",
  ODLEGLOSC: "Odległość",
  KUPILA_URZADZENIE: "Kupiła urządzenie",
  INNE_URZADZENIE: "Wybrała inne urządzenie",
  BRAK_KONTAKTU: "Brak kontaktu",
  TYLKO_CENNIK: "Chciała tylko cennik",
  ARCHIWUM_IMPORTU: "Archiwum (sprzed 2026)",
  INNE: "Inne",
} as const;
export type LostReasonKey = keyof typeof LOST_REASON_LABEL;
export const LOST_REASON_KEYS = Object.keys(LOST_REASON_LABEL) as LostReasonKey[];

export const ACTIVITY_LABEL = {
  CALL: "Rozmowa",
  CALL_NO_ANSWER: "Nie odebrała",
  SMS: "SMS",
  EMAIL: "E-mail",
  NOTE: "Notatka",
  STAGE_CHANGE: "Zmiana etapu",
  SYSTEM: "System",
} as const;
export type ActivityTypeKey = keyof typeof ACTIVITY_LABEL;
