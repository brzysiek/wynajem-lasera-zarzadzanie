// Moduł „Porządki” — słowniki wniosków i uwag (obszar, typ, przyczyna,
// status, priorytet) z polskimi etykietami. Czysty moduł (vitest, bez @/).

export const AREA_LABEL = {
  KLIENCI: "Klienci",
  SYGNALY: "Sygnały",
  HISTORIA: "Historia i dopasowania",
  FINANSE: "Finanse",
  KALENDARZ: "Kalendarz i rezerwacje",
  KOMUNIKACJA: "Komunikacja (SMS, maile)",
  INTEGRACJE: "Integracje (HubSpot, n8n, formularze, Gmail)",
  PROCES: "Zadania i proces pracy",
} as const;
export type AreaKey = keyof typeof AREA_LABEL;
export const AREA_KEYS = Object.keys(AREA_LABEL) as AreaKey[];

export const TYPE_LABEL = {
  BLAD: "Błąd",
  REGULA: "Reguła",
  BRAK_DANYCH: "Brakujące pole/dane",
  UX: "Usprawnienie UX",
  AUTOMATYZACJA: "Automatyzacja",
  JAKOSC_DANYCH: "Jakość danych (walidacja)",
  POMYSL: "Pomysł biznesowy",
  PYTANIE: "Pytanie/decyzja",
} as const;
export type ProposalTypeKey = keyof typeof TYPE_LABEL;
export const TYPE_KEYS = Object.keys(TYPE_LABEL) as ProposalTypeKey[];

export const CAUSE_LABEL = {
  PANEL: "panel",
  HUBSPOT: "HubSpot",
  N8N: "n8n",
  FORMULARZ: "formularz WWW",
  PROCES: "proces",
  INNE: "inne",
} as const;
export type CauseKey = keyof typeof CAUSE_LABEL;
export const CAUSE_KEYS = Object.keys(CAUSE_LABEL) as CauseKey[];

export const STATUS_LABEL = {
  NOWY: "nowy",
  DO_DECYZJI: "do decyzji",
  PRZYJETY: "przyjęty",
  W_REALIZACJI: "w realizacji",
  ZROBIONY: "zrobiony",
  ODRZUCONY: "odrzucony",
  DUPLIKAT: "duplikat",
} as const;
export type ProposalStatusKey = keyof typeof STATUS_LABEL;
export const STATUS_KEYS = Object.keys(STATUS_LABEL) as ProposalStatusKey[];
// Otwarte = jeszcze nie zamknięte decyzją ani realizacją.
export const OPEN_STATUSES: ProposalStatusKey[] = ["NOWY", "DO_DECYZJI", "PRZYJETY", "W_REALIZACJI"];

export const PRIORITY_LABEL = { HIGH: "wysoki", MEDIUM: "średni", LOW: "niski" } as const;
export type PriorityKey = keyof typeof PRIORITY_LABEL;
export const PRIORITY_KEYS = Object.keys(PRIORITY_LABEL) as PriorityKey[];
export const PRIORITY_RANK: Record<PriorityKey, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export const RELATION_LABEL = {
  DUPLICATE_OF: "duplikat wniosku",
  DEPENDS_ON: "zależy od",
  SUPERSEDES: "zastępuje",
} as const;
export type RelationKey = keyof typeof RELATION_LABEL;
export const RELATION_KEYS = Object.keys(RELATION_LABEL) as RelationKey[];

export const REMARK_STATUS_LABEL = { OPEN: "otwarta", CLOSED: "zamknięta" } as const;
export type RemarkStatusKey = keyof typeof REMARK_STATUS_LABEL;

export function proposalNumber(n: number): string {
  return `W-${String(n).padStart(4, "0")}`;
}

// Dziennik zmian — czytelne nazwy obiektów i operacji.
export const ENTITY_LABEL: Record<string, string> = {
  CLIENT: "klient",
  CONTACT: "osoba kontaktowa",
  LEAD: "sygnał",
  HISTORY: "dopasowanie historii",
  INVOICE: "faktura",
  TASK: "zadanie",
  NOTE: "notatka",
  TASK_COMMENT: "komentarz do zadania",
};

export const OPERATION_LABEL: Record<string, string> = {
  FIELD_CHANGE: "zmiana pola",
  CREATE: "dodanie",
  QUALIFY: "przeniesienie do klientów",
  UNQUALIFY: "cofnięcie kwalifikacji",
  MATCH_ASSIGN: "potwierdzenie dopasowania",
  MATCH_IGNORE: "odrzucenie dopasowania",
  MATCH_RESET: "cofnięcie dopasowania",
  STATUS_CHANGE: "zmiana statusu",
  UNDO: "cofnięcie zmiany",
};

export const FIELD_LABEL: Record<string, string> = {
  name: "nazwa",
  nip: "NIP",
  street: "ulica",
  zip: "kod",
  city: "miasto",
  country: "kraj",
  transportPriceNet: "transport netto",
  distanceKm: "odległość",
  clinicType: "rodzaj gabinetu",
  source: "źródło",
  deviceInterests: "zainteresowania",
  statusOverride: "blokada „Nie kontaktować”",
  notes: "stałe ustalenia",
  firstName: "imię",
  lastName: "nazwisko",
  phone: "telefon",
  phone2: "drugi telefon",
  phone2Label: "etykieta drugiego telefonu",
  email: "e-mail",
  role: "rola",
  isPrimary: "osoba główna",
  qualifiedAt: "kwalifikacja",
  qualifiedReason: "powód",
  matchState: "stan",
  clientId: "klient",
  rentalId: "wynajem",
  body: "treść",
  title: "tytuł",
  dueDate: "termin",
  assigneeId: "odpowiedzialny",
  status: "status",
};
