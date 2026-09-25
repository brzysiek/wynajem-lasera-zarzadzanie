// Etykiety PL modułu Klienci — jedno źródło dla listy, karty i eksportu CSV.
// Bez zależności (używane i po stronie serwera, i w komponentach klienta).
import type { ClientStatus } from "./status";

export const STATUS_LABEL: Record<ClientStatus, string> = {
  POTENCJALNY: "Potencjalny",
  NOWY: "Nowy",
  STALY: "Stały",
  USPIONY: "Uśpiony",
  BYLY: "Były",
  NIE_KONTAKTOWAC: "Nie kontaktować",
};

// Opis segmentu pod liczbą na kafelku (makieta) — reguły z status.ts.
export const STATUS_HINT: Record<ClientStatus, string> = {
  POTENCJALNY: "bez wynajmu",
  NOWY: "1 wynajem w 12 mies.",
  STALY: "2+ wynajmy w 12 mies.",
  USPIONY: "6–12 mies. bez wynajmu",
  BYLY: "ponad 12 mies.",
  NIE_KONTAKTOWAC: "blokada",
};

export const DEVICE_INTEREST_LABEL = {
  LIGHTSHEER: "LightSheer",
  LIGHTSHEER_ET400: "ET400",
  ALMA_HARMONY: "Alma",
  COOLTECH: "Cooltech",
  RESURFX: "ResurFX",
  OBSERV: "Observ",
  SZKOLENIE: "Szkolenie",
} as const;
export type DeviceInterestKey = keyof typeof DEVICE_INTEREST_LABEL;
export const DEVICE_INTEREST_KEYS = Object.keys(DEVICE_INTEREST_LABEL) as DeviceInterestKey[];

// Kategoria cennikowa urządzenia (Device.pricingCategory) → zainteresowanie,
// żeby wynajęte urządzenia i deklarowane zainteresowania mówiły tym samym
// słownikiem (kolumna „Urządzenia”, ulubione urządzenie, podpowiedź sezonowa).
export const CATEGORY_TO_INTEREST: Record<string, DeviceInterestKey> = {
  LIGHTSHEER_VARIANT: "LIGHTSHEER",
  LIGHTSHEER_ET400_FLAT: "LIGHTSHEER_ET400",
  ALMA_HARMONY: "ALMA_HARMONY",
  COOLTECH_FLAT: "COOLTECH",
  RESURFX_FLAT: "RESURFX",
  OBSERV_FLAT: "OBSERV",
};

export const SOURCE_LABEL = {
  FORMULARZ_WWW: "Formularz WWW",
  TELEFON: "Telefon",
  POLECENIE: "Polecenie",
  GOOGLE_ADS: "Google Ads",
  META: "Meta",
  POWRACAJACY: "Powracający",
  INNE: "Inne",
} as const;
export type SourceKey = keyof typeof SOURCE_LABEL;

export const CLINIC_TYPE_LABEL = {
  GABINET_KOSMETOLOGICZNY: "Gabinet kosmetologiczny",
  KLINIKA_MEDYCYNY_ESTETYCZNEJ: "Klinika medycyny estetycznej",
  SALON_BEAUTY: "Salon beauty",
  KOSMETOLOG_MOBILNY: "Kosmetolog mobilny",
  INNE: "Inne",
} as const;
export type ClinicTypeKey = keyof typeof CLINIC_TYPE_LABEL;

// „679-000-11-22” — format NIP do wyświetlania (w bazie same cyfry).
export function formatNip(nip: string | null): string | null {
  if (!nip) return null;
  return /^\d{10}$/.test(nip) ? `${nip.slice(0, 3)}-${nip.slice(3, 6)}-${nip.slice(6, 8)}-${nip.slice(8)}` : nip;
}

// „+48 601 000 111” — czytelny zapis numeru E.164 (PL); inne zostają jak są.
export function formatPhone(phone: string | null): string | null {
  if (!phone) return null;
  const m = phone.match(/^\+48(\d{3})(\d{3})(\d{3})$/);
  return m ? `+48 ${m[1]} ${m[2]} ${m[3]}` : phone;
}

// Inicjały do awatara: „Gabinet Aurora” → „GA”, „Anna” → „AN”.
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
