// Etykiety PL modułu Sygnały — jedno źródło dla tablicy, listy, karty i CSV.
// Bez zależności (serwer i komponenty klienta).
import type { LeadStageKey, LeadTypeKey } from "./parse-deal";

// Lejek v2 (wzór lejek-v2-wzor.html): Nowe → W kontakcie → Oferta wysłana →
// Rezerwacja → Wygrana / Przegrana. Klucze w bazie bez zmian.
export const STAGE_LABEL: Record<LeadStageKey, string> = {
  SYGNAL: "Nowe",
  WYWIAD: "W kontakcie",
  OFERTA: "Oferta wysłana",
  REZERWACJA: "Rezerwacja",
  WYGRANA: "Wygrana",
  PRZEGRANA: "Przegrana",
  ODLOZONE: "Odłożone",
};
export const STAGE_KEYS = Object.keys(STAGE_LABEL) as LeadStageKey[];
// Nazwy w historii (wpisy STAGE_CHANGE) — obecne i sprzed v2 („Sygnał → Wywiad”).
export const STAGE_HISTORY_LABELS: Record<LeadStageKey, string[]> = {
  SYGNAL: ["Nowe", "Sygnał"],
  WYWIAD: ["W kontakcie", "Wywiad"],
  OFERTA: ["Oferta wysłana"],
  REZERWACJA: ["Rezerwacja"],
  WYGRANA: ["Wygrana"],
  PRZEGRANA: ["Przegrana"],
  ODLOZONE: ["Odłożone"],
};

// Odłożone („zła pora”, lejek v2): powód obowiązkowy, data powrotu obowiązkowa.
export const POSTPONE_REASON_LABEL = {
  SEZON: "przed sezonem",
  ZBIERA_OFERTY: "zbiera oferty",
  URLOP: "urlop",
  REMONT: "remont / otwarcie",
  INNE: "inny powód",
} as const;
export type PostponeReasonKey = keyof typeof POSTPONE_REASON_LABEL;
export const POSTPONE_REASON_KEYS = Object.keys(POSTPONE_REASON_LABEL) as PostponeReasonKey[];
export const BOARD_STAGES: LeadStageKey[] = ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA"];
export const OPEN_STAGES: LeadStageKey[] = BOARD_STAGES;

export const TYPE_LABEL: Record<LeadTypeKey, string> = {
  POBRANIE_CENNIKA: "Pobranie cennika",
  KONTAKT: "Formularz kontaktowy",
  REZERWACJA_WWW: "Rezerwacja WWW",
  SZKOLENIE_WWW: "Szkolenie WWW",
  TELEFON: "Telefon",
  EMAIL: "E-mail",
  OLX: "OLX",
  POLECENIE: "Polecenie",
  INNE: "Inne",
};
export const TYPE_KEYS = Object.keys(TYPE_LABEL) as LeadTypeKey[];

export const LOST_REASON_LABEL = {
  ODLEGLOSC: "Za daleko",
  CENA: "Cena",
  KUPILA_URZADZENIE: "Ma / kupiła urządzenie",
  INNE_URZADZENIE: "Wybrała inne urządzenie",
  TERMIN_ZAJETY: "Termin zajęty",
  BRAK_KONTAKTU: "Brak kontaktu",
  TYLKO_CENNIK: "Tylko cennik",
  POZA_BRANZA: "Poza branżą",
  ARCHIWUM_IMPORTU: "Archiwum (sprzed 2026)",
  INNE: "Inne – opis",
} as const;
// Powody do wyboru przy przegranej (wzór: siatka w karcie sygnału) — bez
// „Archiwum importu” (tylko z importu HubSpota).
export const LOST_REASON_PICK: LostReasonKey[] = ["ODLEGLOSC", "CENA", "KUPILA_URZADZENIE", "TERMIN_ZAJETY", "BRAK_KONTAKTU", "TYLKO_CENNIK", "POZA_BRANZA", "INNE_URZADZENIE", "INNE"];
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
