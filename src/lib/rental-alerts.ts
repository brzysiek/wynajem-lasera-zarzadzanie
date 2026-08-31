// Ostrzeżenia w kalendarzu (widok admina): wynajmy z najbliższych dni bez
// kompletu danych operacyjnych. Moduł client-safe — bez importu Prismy;
// samo zapytanie robi kalendarz/page.tsx po stronie serwera.

// Ile dni w przód (od dziś, włącznie) obejmuje kontrola.
export const ALERT_WINDOW_DAYS = 10;

export type RentalAlertField = "driver" | "contact" | "phone";

export type RentalAlert = {
  id: string;
  title: string;
  startsAt: string; // ISO
  deviceName: string;
  deviceColor: string;
  missing: RentalAlertField[];
};

export const ALERT_FIELD_LABEL: Record<RentalAlertField, string> = {
  driver: "brak kierowcy",
  contact: "brak kontaktu",
  phone: "brak telefonu",
};

// Krótka forma do nagłówka zbiorczego („… bez: kierowca, telefon").
export const ALERT_FIELD_SHORT: Record<RentalAlertField, string> = {
  driver: "kierowca",
  contact: "kontakt",
  phone: "telefon",
};

export const ALERT_FIELD_ORDER: RentalAlertField[] = ["driver", "contact", "phone"];

// „1 wynajem", „2 wynajmy", „5 wynajmów" — polska liczba mnoga.
export function pluralWynajem(n: number): string {
  if (n === 1) return "wynajem";
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "wynajmy";
  return "wynajmów";
}
